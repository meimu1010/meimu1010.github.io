/**
 * room.js - Online room management
 * Host/client architecture via PeerJS
 */

import { peerManager } from './peer.js';
import {
  createGameState, initGame, playCard, playerDraw,
  getTopCard, serializeStateForPlayer, getPlayableCards,
  drawFromDeck, advanceTurn
} from './game.js';
import {
  showToast, renderLobbyPlayers, updateTurnIndicator,
  updateDirectionIndicator, updateDeckCount, updateDrawStack,
  renderOpponentPanel, renderHand, updateDiscardDisplay,
  renderResults, showActionOverlay, showUnoButton
} from './ui.js';

import { aiChooseCard } from './ai.js';

function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(`screen-${name}`);
  if (el) el.classList.add('active');
}

// ================================================================
// MODULE STATE
// ================================================================

/** @type {import('./game.js').GameState|null} */
let gameState = null;

/** My player */
let myPlayer = { id: '', name: '', peerId: '' };

/** Pending wild card awaiting color */
let pendingWildCardId = null;

/** UNO penalty timers: playerId -> timeoutId */
const unoPenaltyTimers = new Map();

/** AI turn timer */
let aiTurnTimer = null;

/** Current serialized view state (client side) */
let viewState = null;

/** Cached players for result display (client) */
let cachedPlayers = [];

// ================================================================
// HOST: ROOM CREATION
// ================================================================

/**
 * Create a room as host
 * @param {string} playerName
 * @param {string} roomName
 * @param {number} maxP
 * @returns {Promise<string>} roomId
 */
export async function hostCreateRoom(playerName, roomName, maxP) {
  const max = Math.max(2, Math.min(4, maxP));
  await peerManager.init();
  peerManager.becomeHost();

  const peerId = peerManager.myPeerId;
  myPlayer = { id: peerId, name: playerName, peerId };

  // Use peerId as room ID (clients connect directly)
  const roomId = peerId.slice(0, 6).toUpperCase();
  gameState = createGameState(roomId, roomName, peerId, max);
  gameState.players.push({ id: peerId, name: playerName, hand: [], isAI: false, saidUno: false });

  peerManager.onMessage = handleHostMessage;
  peerManager.onPeerConnected = (pid) => console.log('[Room] Client connected:', pid);
  peerManager.onPeerDisconnected = handlePeerDisconnected;

  return roomId;
}

// ================================================================
// HOST: MESSAGE HANDLER
// ================================================================

function handleHostMessage(fromPeerId, msg) {
  if (!gameState) return;

  switch (msg.type) {

    case 'join': {
      if (gameState.gameStarted) {
        peerManager.sendTo(fromPeerId, { type: 'error', message: 'ゲームはすでに開始されています' });
        return;
      }
      if (gameState.players.length >= gameState.maxPlayers) {
        peerManager.sendTo(fromPeerId, { type: 'error', message: 'ルームが満員です' });
        return;
      }
      gameState.players.push({
        id: fromPeerId,
        name: msg.playerName || 'Player',
        hand: [], isAI: false, saidUno: false
      });
      broadcastLobbyState();
      break;
    }

    case 'playCard': {
      if (!gameState.gameStarted || gameState.gameOver) return;
      // Validate it's this player's turn
      const idx = gameState.players.findIndex(p => p.id === fromPeerId);
      if (idx !== gameState.currentTurn) return;
      hostProcessPlay(fromPeerId, msg.cardId, msg.chosenColor || null);
      break;
    }

    case 'drawCard': {
      if (!gameState.gameStarted || gameState.gameOver) return;
      const idx = gameState.players.findIndex(p => p.id === fromPeerId);
      if (idx !== gameState.currentTurn) return;
      hostProcessDraw(fromPeerId);
      break;
    }

    case 'uno': {
      hostProcessUno(fromPeerId);
      break;
    }

    case 'requestState': {
      sendStateTo(fromPeerId);
      break;
    }
  }
}

// ================================================================
// HOST: GAME ACTIONS
// ================================================================

function hostProcessPlay(playerId, cardId, chosenColor) {
  if (!gameState) return;
  const result = playCard(gameState, playerId, cardId, chosenColor);
  if (!result.success) return;

  const top = getTopCard(gameState);
  if (top && top.type !== 'number') {
    const labels = { skip: 'SKIP!', reverse: 'REVERSE!', draw2: '+2!', wild4: '+4!' };
    const text = labels[top.type];
    if (text) {
      peerManager.broadcast({ type: 'action', text });
      showActionOverlay(text);
    }
  }

  clearUnoTimer(playerId);

  const player = gameState.players.find(p => p.id === playerId);
  if (player && player.hand.length === 1 && !player.saidUno) {
    startUnoTimer(playerId);
  }

  if (gameState.gameOver) {
    endGame();
  } else {
    dobroadcastGameState();
    setTimeout(checkAndRunAI, 400);
  }
}

function hostProcessDraw(playerId) {
  if (!gameState) return;
  playerDraw(gameState, playerId);
  dobroadcastGameState();
  setTimeout(checkAndRunAI, 400);
}

function hostProcessUno(playerId) {
  if (!gameState) return;
  const player = gameState.players.find(p => p.id === playerId);
  if (!player || player.hand.length !== 1) return;
  player.saidUno = true;
  clearUnoTimer(playerId);
  peerManager.broadcast({ type: 'unoAnnounce', playerName: player.name });
  showToast(`${player.name} が UNO!`, 'warn');
  dobroadcastGameState();
}

// ================================================================
// HOST: DISCONNECT
// ================================================================

function handlePeerDisconnected(peerId) {
  if (!gameState) return;
  const idx = gameState.players.findIndex(p => p.id === peerId);
  if (idx < 0) return;

  if (!gameState.gameStarted) {
    gameState.players.splice(idx, 1);
    broadcastLobbyState();
  } else {
    const player = gameState.players[idx];
    player.isAI = true;
    player.difficulty = 'normal';
    player.name = player.name + ' (AI)';
    showToast(`${player.name} が切断されました。AIが引き継ぎます`, 'warn');
    dobroadcastGameState();
    setTimeout(checkAndRunAI, 500);
  }
}

// ================================================================
// HOST: UNO PENALTY TIMERS
// ================================================================

function startUnoTimer(playerId) {
  clearUnoTimer(playerId);
  const t = setTimeout(() => {
    if (!gameState) return;
    const p = gameState.players.find(pl => pl.id === playerId);
    if (p && p.hand.length === 1 && !p.saidUno) {
      for (let i = 0; i < 2; i++) {
        const c = drawFromDeck(gameState);
        if (c) p.hand.push(c);
      }
      showToast(`${p.name} はUNO宣言を忘れてペナルティ (2枚ドロー)!`, 'warn');
      dobroadcastGameState();
    }
  }, 5000);
  unoPenaltyTimers.set(playerId, t);
}

function clearUnoTimer(playerId) {
  const t = unoPenaltyTimers.get(playerId);
  if (t !== undefined) { clearTimeout(t); unoPenaltyTimers.delete(playerId); }
}

// ================================================================
// HOST: BROADCAST
// ================================================================

function broadcastLobbyState() {
  if (!gameState) return;
  const data = {
    type: 'lobbyState',
    roomId: gameState.roomId,
    hostId: gameState.hostId,
    players: gameState.players.map(p => ({ id: p.id, name: p.name })),
    maxPlayers: gameState.maxPlayers
  };
  peerManager.broadcast(data);
  updateLobbyUI(data);
}

function sendStateTo(peerId) {
  if (!gameState) return;
  const s = serializeStateForPlayer(gameState, peerId);
  peerManager.sendTo(peerId, { type: 'gameState', state: s });
}

function dobroadcastGameState() {
  if (!gameState) return;
  // Host updates its own UI
  const mySerial = serializeStateForPlayer(gameState, myPlayer.id);
  updateGameUI(mySerial);
  // Each client gets their personalized state
  for (const p of gameState.players) {
    if (p.id !== myPlayer.id && !p.isAI) {
      const s = serializeStateForPlayer(gameState, p.id);
      peerManager.sendTo(p.id, { type: 'gameState', state: s });
    }
  }
}

// Re-export for external use
export { dobroadcastGameState as broadcastGameState };

function endGame() {
  if (!gameState) return;
  peerManager.broadcast({ type: 'gameOver', rankings: gameState.rankings,
    players: gameState.players.map(p => ({ id: p.id, name: p.name, isAI: p.isAI })) });
  showGameResults(gameState.rankings, gameState.players, myPlayer.id);
}

// ================================================================
// CLIENT: JOIN
// ================================================================

export async function clientJoinRoom(playerName, hostPeerId) {
  await peerManager.init();
  myPlayer = { id: peerManager.myPeerId, name: playerName, peerId: peerManager.myPeerId };
  peerManager.onMessage = handleClientMessage;
  peerManager.onPeerDisconnected = (pid) => {
    if (pid === hostPeerId) showToast('ホストが切断されました', 'error');
  };
  await peerManager.connectToHost(hostPeerId);
  peerManager.sendToHost({ type: 'join', playerName });
}

// ================================================================
// CLIENT: MESSAGE HANDLER
// ================================================================

function handleClientMessage(fromPeerId, msg) {
  switch (msg.type) {
    case 'lobbyState':
      updateLobbyUI(msg);
      if (!document.getElementById('screen-lobby')?.classList.contains('active')) {
        showScreen('lobby');
      }
      break;
    case 'gameStarting':
      showScreen('game');
      break;
    case 'gameState':
      viewState = msg.state;
      cachedPlayers = msg.state.players.map(p => ({ id: p.id, name: p.name, isAI: p.isAI, hand: p.hand || [] }));
      updateGameUI(msg.state);
      break;
    case 'action':
      showActionOverlay(msg.text);
      break;
    case 'unoAnnounce':
      showToast(`${msg.playerName} が UNO!`, 'warn');
      break;
    case 'gameOver':
      cachedPlayers = msg.players || cachedPlayers;
      showGameResults(msg.rankings, cachedPlayers, myPlayer.id);
      break;
    case 'error':
      showToast(msg.message, 'error');
      break;
  }
}

// ================================================================
// GAME START (HOST ONLY)
// ================================================================

export function startOnlineGame() {
  if (!gameState) return;
  if (gameState.players.length < 2) { showToast('最低2人必要です', 'error'); return; }
  if (gameState.gameStarted) return;

  initGame(gameState);
  peerManager.broadcast({ type: 'gameStarting' });
  showScreen('game');
  dobroadcastGameState();
  setTimeout(checkAndRunAI, 600);
}

// ================================================================
// GAME ACTIONS (called from main.js)
// ================================================================

export function onPlayCard(card) {
  if (peerManager.isHost) {
    hostProcessPlay(myPlayer.id, card.id, card.chosenColor || null);
  } else {
    peerManager.sendToHost({ type: 'playCard', cardId: card.id, chosenColor: card.chosenColor || null });
  }
}

export function onDrawCard() {
  if (peerManager.isHost) {
    hostProcessDraw(myPlayer.id);
  } else {
    peerManager.sendToHost({ type: 'drawCard' });
  }
}

export function onDeclareUno() {
  if (peerManager.isHost) {
    hostProcessUno(myPlayer.id);
  } else {
    peerManager.sendToHost({ type: 'uno' });
  }
  showToast('UNO! 🎉', 'success');
}

export function onColorSelected(color) {
  document.getElementById('color-picker').style.display = 'none';
  if (!pendingWildCardId) return;
  if (peerManager.isHost) {
    hostProcessPlay(myPlayer.id, pendingWildCardId, color);
  } else {
    peerManager.sendToHost({ type: 'playCard', cardId: pendingWildCardId, chosenColor: color });
  }
  pendingWildCardId = null;
}

export function requestWildColor(card) {
  pendingWildCardId = card.id;
  document.getElementById('color-picker').style.display = 'flex';
}

// ================================================================
// UI UPDATES
// ================================================================

function updateLobbyUI(data) {
  const roomIdEl = document.getElementById('display-room-id');
  if (roomIdEl) roomIdEl.textContent = data.roomId || '------';

  const inviteUrlEl = document.getElementById('invite-url');
  if (inviteUrlEl) {
    const hostId = data.hostId;
    inviteUrlEl.value = `${location.origin}${location.pathname}?room=${hostId}`;
  }

  const maxEl = document.getElementById('max-player-count');
  if (maxEl) maxEl.textContent = data.maxPlayers;

  renderLobbyPlayers(data.players, data.maxPlayers, data.hostId);

  const startBtn = document.getElementById('start-game-btn');
  const waitMsg = document.getElementById('waiting-message');

  if (peerManager.isHost) {
    if (startBtn) startBtn.style.display = data.players.length >= 2 ? 'block' : 'none';
    if (waitMsg) waitMsg.style.display = 'none';
  } else {
    if (startBtn) startBtn.style.display = 'none';
    if (waitMsg) waitMsg.style.display = 'block';
  }
}

export function updateGameUI(state) {
  if (!state) return;

  const me = state.players.find(p => p.id === myPlayer.id);
  if (!me) return;

  const isMyTurn = state.players[state.currentTurn]?.id === myPlayer.id;
  const top = state.topCard;

  // Opponents
  const opArea = document.getElementById('opponents-area');
  if (opArea) {
    opArea.innerHTML = '';
    state.players.forEach((p, i) => {
      if (p.id === myPlayer.id) return;
      opArea.appendChild(renderOpponentPanel(p, i === state.currentTurn));
    });
  }

  updateDiscardDisplay(top);
  updateDeckCount(state.deckCount || 0);
  updateDrawStack(state.drawStack || 0);
  updateDirectionIndicator(state.direction || 1);

  const cur = state.players[state.currentTurn];
  updateTurnIndicator(cur?.name || '?', isMyTurn);

  const myHand = me.hand || [];
  renderHand(myHand, top, state.drawStack || 0, isMyTurn, handleOnlineCardClick);

  const myNameEl = document.getElementById('my-name-display');
  if (myNameEl) myNameEl.textContent = me.name;

  showUnoButton(isMyTurn && myHand.length === 1 && !me.saidUno);

  const drawPile = document.getElementById('draw-pile');
  if (drawPile) {
    drawPile.style.opacity = isMyTurn ? '1' : '0.6';
    drawPile.style.cursor = isMyTurn ? 'pointer' : 'not-allowed';
  }
}

function handleOnlineCardClick(card) {
  const curState = viewState || (gameState ? serializeStateForPlayer(gameState, myPlayer.id) : null);
  if (!curState) return;
  if (curState.players[curState.currentTurn]?.id !== myPlayer.id) {
    showToast('あなたのターンではありません', 'warn'); return;
  }
  if (card.type === 'wild' || card.type === 'wild4') {
    requestWildColor(card);
  } else {
    onPlayCard(card);
  }
}

// ================================================================
// AI (HOST SIDE)
// ================================================================

function checkAndRunAI() {
  if (!peerManager.isHost || !gameState || gameState.gameOver) return;
  const cur = gameState.players[gameState.currentTurn];
  if (!cur?.isAI) return;
  clearTimeout(aiTurnTimer);
  aiTurnTimer = setTimeout(() => runAITurn(cur), 900 + Math.random() * 700);
}

function runAITurn(aiPlayer) {
  if (!gameState || gameState.gameOver) return;
  if (gameState.players[gameState.currentTurn].id !== aiPlayer.id) return;

  const { card, chosenColor } = aiChooseCard(aiPlayer, gameState, aiPlayer.difficulty || 'normal');

  if (card) {
    if (aiPlayer.hand.length === 2 && !aiPlayer.saidUno) {
      aiPlayer.saidUno = true;
      showToast(`${aiPlayer.name} が UNO!`, 'warn');
    }
    const result = playCard(gameState, aiPlayer.id, card.id, chosenColor || null);
    if (result.success) {
      const top = getTopCard(gameState);
      if (top && top.type !== 'number') {
        const labels = { skip: 'SKIP!', reverse: 'REVERSE!', draw2: '+2!', wild4: '+4!' };
        const text = labels[top.type];
        if (text) { peerManager.broadcast({ type: 'action', text }); showActionOverlay(text); }
      }
    } else {
      playerDraw(gameState, aiPlayer.id);
    }
  } else {
    playerDraw(gameState, aiPlayer.id);
  }

  if (gameState.gameOver) {
    endGame(); return;
  }
  dobroadcastGameState();
  setTimeout(checkAndRunAI, 300);
}

// ================================================================
// RESULTS
// ================================================================

function showGameResults(rankings, players, myId) {
  renderResults(rankings, players, myId);
  const titleEl = document.getElementById('result-title');
  const winner = players.find(p => p.id === rankings[0]);
  if (titleEl && winner) {
    titleEl.textContent = winner.id === myId ? '🎉 あなたの勝利!' : `${winner.name} の勝利!`;
  }
  const btn = document.getElementById('play-again-btn');
  if (btn) btn.style.display = peerManager.isHost ? 'block' : 'none';
  showScreen('result');
}

// ================================================================
// RESET
// ================================================================

export function resetRoomState() {
  gameState = null;
  myPlayer = { id: '', name: '', peerId: '' };
  pendingWildCardId = null;
  viewState = null;
  cachedPlayers = [];
  unoPenaltyTimers.forEach(t => clearTimeout(t));
  unoPenaltyTimers.clear();
  clearTimeout(aiTurnTimer);
  peerManager.destroy();
}

export function getMyPlayer() { return myPlayer; }
