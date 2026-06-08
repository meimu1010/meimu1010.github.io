/**
 * peer.js - PeerJS WebRTC connection management
 * Handles host/client roles, messaging, reconnection
 */

/**
 * @typedef {Object} PeerMessage
 * @property {string} type
 * @property {*} [payload]
 */

const PEER_CONFIG = {
  // Using PeerJS public server (no TURN/STUN config needed for LAN/simple cases)
  // For production, consider hosting your own PeerJS server
  debug: 0
};

const RETRY_DELAY = 2000;
const MAX_RETRIES = 5;

/**
 * PeerManager - wraps PeerJS for UNO
 */
export class PeerManager {
  constructor() {
    /** @type {Peer|null} */
    this.peer = null;
    /** @type {Map<string, DataConnection>} connections by peerId */
    this.connections = new Map();
    /** @type {string|null} */
    this.myPeerId = null;
    /** @type {boolean} */
    this.isHost = false;
    /** @type {string|null} */
    this.hostPeerId = null;
    /** @type {Map<string, number>} retry counts */
    this._retryCounts = new Map();
    /** @type {Function|null} */
    this.onMessage = null;
    /** @type {Function|null} */
    this.onPeerConnected = null;
    /** @type {Function|null} */
    this.onPeerDisconnected = null;
    /** @type {Function|null} */
    this.onReady = null;
    /** @type {Function|null} */
    this.onError = null;
  }

  /**
   * Initialize PeerJS and obtain a peer ID
   * @returns {Promise<string>} peerId
   */
  init() {
    return new Promise((resolve, reject) => {
      if (this.peer && !this.peer.destroyed) {
        resolve(this.myPeerId);
        return;
      }

      this.peer = new Peer(PEER_CONFIG);

      this.peer.on('open', (id) => {
        this.myPeerId = id;
        console.log('[Peer] My peer ID:', id);
        if (this.onReady) this.onReady(id);
        resolve(id);
      });

      this.peer.on('error', (err) => {
        console.error('[Peer] Error:', err.type, err.message);
        if (this.onError) this.onError(err);
        // Only reject on initial connection
        if (!this.myPeerId) reject(err);
      });

      this.peer.on('connection', (conn) => {
        // Incoming connection (host receives clients)
        this._setupConnection(conn);
      });

      this.peer.on('disconnected', () => {
        console.warn('[Peer] Disconnected from signaling server, reconnecting...');
        if (this.peer && !this.peer.destroyed) {
          try { this.peer.reconnect(); } catch (e) { /* ignore */ }
        }
      });

      this.peer.on('close', () => {
        console.warn('[Peer] Peer closed');
        this.myPeerId = null;
      });
    });
  }

  /**
   * Connect to a host peer (client mode)
   * @param {string} hostPeerId
   * @returns {Promise<void>}
   */
  connectToHost(hostPeerId) {
    return new Promise((resolve, reject) => {
      if (!this.peer) { reject(new Error('Peer not initialized')); return; }
      this.hostPeerId = hostPeerId;
      this.isHost = false;

      const conn = this.peer.connect(hostPeerId, {
        reliable: true,
        metadata: { peerId: this.myPeerId }
      });

      conn.on('open', () => {
        console.log('[Peer] Connected to host:', hostPeerId);
        this._setupConnection(conn);
        resolve();
      });

      conn.on('error', (err) => {
        console.error('[Peer] Connection to host error:', err);
        reject(err);
      });

      setTimeout(() => reject(new Error('Connection timeout')), 10000);
    });
  }

  /**
   * Set this peer as host
   */
  becomeHost() {
    this.isHost = true;
    this.hostPeerId = this.myPeerId;
  }

  /**
   * Set up a data connection (both sides)
   * @param {DataConnection} conn
   */
  _setupConnection(conn) {
    const peerId = conn.peer;

    conn.on('open', () => {
      this.connections.set(peerId, conn);
      console.log('[Peer] Connection established with:', peerId);
      if (this.onPeerConnected) this.onPeerConnected(peerId);
    });

    conn.on('data', (data) => {
      try {
        const msg = typeof data === 'string' ? JSON.parse(data) : data;
        if (this.onMessage) this.onMessage(peerId, msg);
      } catch (e) {
        console.error('[Peer] Failed to parse message:', e);
      }
    });

    conn.on('close', () => {
      this.connections.delete(peerId);
      console.log('[Peer] Connection closed with:', peerId);
      if (this.onPeerDisconnected) this.onPeerDisconnected(peerId);
    });

    conn.on('error', (err) => {
      console.error('[Peer] Connection error with', peerId, ':', err);
      this.connections.delete(peerId);
      if (this.onPeerDisconnected) this.onPeerDisconnected(peerId);
    });

    // If not open yet (incoming connections are often already open)
    if (conn.open) {
      this.connections.set(peerId, conn);
      if (this.onPeerConnected) this.onPeerConnected(peerId);
    }
  }

  /**
   * Send a message to a specific peer
   * @param {string} peerId
   * @param {PeerMessage} msg
   */
  sendTo(peerId, msg) {
    const conn = this.connections.get(peerId);
    if (!conn || !conn.open) {
      console.warn('[Peer] Cannot send to', peerId, '- not connected');
      return;
    }
    try {
      conn.send(msg);
    } catch (e) {
      console.error('[Peer] Send error:', e);
    }
  }

  /**
   * Broadcast a message to all connected peers
   * @param {PeerMessage} msg
   * @param {string[]} [exclude] - peer IDs to skip
   */
  broadcast(msg, exclude = []) {
    for (const [peerId, conn] of this.connections) {
      if (exclude.includes(peerId)) continue;
      if (conn.open) {
        try { conn.send(msg); } catch (e) { console.error('[Peer] Broadcast error:', e); }
      }
    }
  }

  /**
   * Send message to host (client mode)
   * @param {PeerMessage} msg
   */
  sendToHost(msg) {
    if (!this.hostPeerId) { console.warn('[Peer] No host peer ID'); return; }
    this.sendTo(this.hostPeerId, msg);
  }

  /**
   * Get all connected peer IDs
   * @returns {string[]}
   */
  getConnectedPeers() {
    return [...this.connections.keys()].filter(id => this.connections.get(id)?.open);
  }

  /**
   * Destroy peer and all connections
   */
  destroy() {
    for (const conn of this.connections.values()) {
      try { conn.close(); } catch (e) { /* ignore */ }
    }
    this.connections.clear();
    if (this.peer && !this.peer.destroyed) {
      try { this.peer.destroy(); } catch (e) { /* ignore */ }
    }
    this.peer = null;
    this.myPeerId = null;
    this.isHost = false;
    this.hostPeerId = null;
  }

  /**
   * Check if connected to a specific peer
   * @param {string} peerId
   * @returns {boolean}
   */
  isConnectedTo(peerId) {
    const conn = this.connections.get(peerId);
    return conn?.open === true;
  }
}

/**
 * Singleton peer manager instance
 */
export const peerManager = new PeerManager();
