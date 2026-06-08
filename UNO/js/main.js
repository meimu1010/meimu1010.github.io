/**
 * main.js - Application entry point
 * Screen management, AI game mode, global event handlers
 */

import {
  createGameState, initGame, playCard, playerDraw,
  getTopCard
} from './game.js';
import { aiChooseCard } from './ai.js';
import {
  showToast, renderHand, updateDiscardDisplay, updateTurnIndicator,
  updateDirectionIndicator, updateDeckCount, updateDrawStack,
  renderOpponentPanel, renderResults, showActionOverlay,
  showUnoButton, renderLobbyPlayers
} from './ui.js';

// ================================================================
// SCREEN MANAGEMENT
// ================================================================

export function showScreen(screenName) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(`screen-${screenName}`);
  if (el) el.classList.add('active');
}
window.showScreen = showScreen;

// ================================================================
// AI GAME STATE
// ================================================================

let aiGameState = null;
const AI_MY_ID = 'local-player';
let aiPendingWild = null;
let aiTurnTimer = null;
let unoUnclaimedTimer = null;
let aiDifficulty = 'normal';

// Controls
let _aiCount = 3;
let _maxPlayers = 4;
let _difficulty = 'normal';

window.adjustAICount = (delta) => {
  _aiCount = Math.max(1, Math.min(3, _aiCount + delta));
  const el = document.getElementById('ai-count');
  if (el) el.textContent = _aiCount;
};

window.adjustMaxPlayers = (delta) => {
  _maxPlayers = Math.max(2, Math.min(4, _maxPlayers + delta));
  const el = document.getElementById('max-players-display');
  if (el) el.textContent = _maxPlayers;
};

window.selectDifficulty = (btn) => {
  document.querySelectorAll('.diff-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  _difficulty = btn.dataset.diff;
};

// ================================================================
// AI GAME START
// ================================================================

window.startAIGame = () => {
  const nameEl = document.getElementById('ai-player-name');
  const playerName = nameEl?.value?.trim() || 'プレイヤー';
  aiDifficulty = _difficulty;
  aiPendingWild = null;
  clearTimeout(aiTurnTimer);
  clearTimeout(unoUnclaimedTimer);

  aiGameState = createGameState('LOCAL', 'AI Game', AI_MY_ID, _aiCount + 1);
  aiGameState.players.push({ id: AI_MY_ID, name: playerName, hand: [], isAI: false, saidUno: false });

  const aiNames = ['ゆいな', 'たかし', 'はるか', 'けんじ'];
  for (let i = 0; i < _aiCount; i++) {
    aiGameState.players.push({
      id: `ai-${i}`, name: aiNames[i] || `AI ${i+1}`,
      hand: [], isAI: true, difficulty: aiDifficulty, saidUno: false
    });
  }

  initGame(aiGameState);
  showScreen('game');
  renderAIGameUI();
  scheduleAIIfNeeded();
};

function renderAIGameUI() {
  if (!aiGameState) return;
  const state = aiGameState;
  const me = state.players.find(p => p.id === AI_MY_ID);
  if (!me) return;

  const top = getTopCard(state);
  const isMyTurn = state.players[state.currentTurn]?.id === AI_MY_ID;

  // Opponents
  const opArea = document.getElementById('opponents-area');
  if (opArea) {
    opArea.innerHTML = '';
    state.players.forEach((p, i) => {
      if (p.id === AI_MY_ID) return;
      opArea.appendChild(renderOpponentPanel(p, i === state.currentTurn));
    });
  }

  updateDiscardDisplay(top);
  updateDeckCount(state.deck.length);
  updateDrawStack(state.drawStack);
  updateDirectionIndicator(state.direction);

  const cur = state.players[state.currentTurn];
  updateTurnIndicator(cur?.name || '?', isMyTurn);

  renderHand(me.hand, top, state.drawStack, isMyTurn, handleAICardClick);

  const myNameEl = document.getElementById('my-name-display');
  if (myNameEl) myNameEl.textContent = me.name;

  showUnoButton(isMyTurn && me.hand.length === 1 && !me.saidUno);

  const drawPile = document.getElementById('draw-pile');
  if (drawPile) {
    drawPile.style.opacity = isMyTurn ? '1' : '0.6';
    drawPile.style.cursor = isMyTurn ? 'pointer' : 'not-allowed';
  }
}

function handleAICardClick(card) {
  if (!aiGameState) return;
  if (aiGameState.players[aiGameState.currentTurn]?.id !== AI_MY_ID) {
    showToast('あなたのターンではありません', 'warn'); return;
  }
  if (card.type === 'wild' || card.type === 'wild4') {
    aiPendingWild = card;
    document.getElementById('color-picker').style.display = 'flex';
  } else {
    doAIPlay(card, null);
  }
}

function doAIPlay(card, color) {
  if (!aiGameState) return;
  const result = playCard(aiGameState, AI_MY_ID, card.id, color);
  if (!result.success) {
    if (result.needsColor) {
      aiPendingWild = card;
      document.getElementById('color-picker').style.display = 'flex';
      return;
    }
    showToast('そのカードは出せません', 'error');
    return;
  }

  showSpecialEffect(getTopCard(aiGameState));
  clearTimeout(unoUnclaimedTimer);

  const me = aiGameState.players.find(p => p.id === AI_MY_ID);
  if (me && me.hand.length === 1 && !me.saidUno) {
    unoUnclaimedTimer = setTimeout(() => {
      if (!aiGameState) return;
      const mp = aiGameState.players.find(p => p.id === AI_MY_ID);
      if (mp && mp.hand.length === 1 && !mp.saidUno) {
        for (let i = 0; i < 2; i++) { const c = deckDraw(aiGameState); if (c) mp.hand.push(c); }
        showToast('UNO宣言を忘れて2枚ドロー!', 'error');
        renderAIGameUI();
      }
    }, 5000);
  }

  if (aiGameState.gameOver) { renderAIGameUI(); setTimeout(showAIResults, 800); return; }
  renderAIGameUI();
  scheduleAIIfNeeded();
}

function scheduleAIIfNeeded() {
  if (!aiGameState || aiGameState.gameOver) return;
  const cur = aiGameState.players[aiGameState.currentTurn];
  if (!cur?.isAI) return;
  clearTimeout(aiTurnTimer);
  aiTurnTimer = setTimeout(() => runAITurn(cur), 900 + Math.random() * 700);
}

function runAITurn(aiPlayer) {
  if (!aiGameState || aiGameState.gameOver) return;
  if (aiGameState.players[aiGameState.currentTurn].id !== aiPlayer.id) return;

  const { card, chosenColor } = aiChooseCard(aiPlayer, aiGameState, aiPlayer.difficulty || aiDifficulty);
  if (card) {
    if (aiPlayer.hand.length === 2 && !aiPlayer.saidUno) {
      aiPlayer.saidUno = true;
      showToast(`${aiPlayer.name} が UNO!`, 'warn');
    }
    const result = playCard(aiGameState, aiPlayer.id, card.id, chosenColor || null);
    if (result.success) showSpecialEffect(getTopCard(aiGameState));
    else playerDraw(aiGameState, aiPlayer.id);
  } else {
    playerDraw(aiGameState, aiPlayer.id);
  }

  if (aiGameState.gameOver) {
    renderAIGameUI();
    setTimeout(showAIResults, 800);
    return;
  }
  renderAIGameUI();
  setTimeout(scheduleAIIfNeeded, 200);
}

function showAIResults() {
  if (!aiGameState) return;
  renderResults(aiGameState.rankings, aiGameState.players, AI_MY_ID);
  const titleEl = document.getElementById('result-title');
  const winner = aiGameState.players.find(p => p.id === aiGameState.rankings[0]);
  if (titleEl && winner) {
    titleEl.textContent = winner.id === AI_MY_ID ? '🎉 あなたの勝利!' : `${winner.name} の勝利!`;
  }
  const btn = document.getElementById('play-again-btn');
  if (btn) btn.style.display = 'block';
  showScreen('result');
}

function showSpecialEffect(card) {
  if (!card || card.type === 'number') return;
  const labels = { skip: 'SKIP!', reverse: 'REVERSE!', draw2: '+2!', wild4: '+4!' };
  const text = labels[card.type];
  if (text) showActionOverlay(text);
}

// Deck draw helper (avoids import cycle)
function deckDraw(state) {
  if (state.deck.length === 0) {
    if (state.discardPile.length <= 1) return null;
    const top = state.discardPile.pop();
    const r = state.discardPile.map(c => ({ ...c, chosenColor: null }));
    for (let i = r.length-1; i > 0; i--) { const j = Math.floor(Math.random()*(i+1)); [r[i],r[j]]=[r[j],r[i]]; }
    state.deck = r;
    state.discardPile = [top];
  }
  return state.deck.pop() || null;
}

// ================================================================
// ONLINE MODE - lazy load room.js
// ================================================================

let roomModule = null;
async function getRoomModule() {
  if (!roomModule) roomModule = await import('./room.js');
  return roomModule;
}

// Track if we're in online mode
let onlineMode = false;

window.createRoom = async () => {
  const name = document.getElementById('host-player-name')?.value?.trim() || 'ホスト';
  const roomName = document.getElementById('room-name-input')?.value?.trim() || 'UNO Room';
  const statusEl = document.getElementById('create-room-status');
  if (statusEl) { statusEl.textContent = '接続中...'; statusEl.className = 'status-message'; }

  try {
    const room = await getRoomModule();
    const { peerManager } = await import('./peer.js');
    const roomId = await room.hostCreateRoom(name, roomName, _maxPlayers);
    onlineMode = true;
    showScreen('lobby');

    // Update lobby UI
    document.getElementById('display-room-id').textContent = roomId;
    const hostId = peerManager.myPeerId;
    document.getElementById('invite-url').value = `${location.origin}${location.pathname}?room=${hostId}`;
    document.getElementById('max-player-count').textContent = _maxPlayers;

    // Initial player display
    renderLobbyPlayers([{ id: hostId, name }], _maxPlayers, hostId);

    const startBtn = document.getElementById('start-game-btn');
    if (startBtn) startBtn.style.display = 'none';
    const waitMsg = document.getElementById('waiting-message');
    if (waitMsg) waitMsg.style.display = 'none';

    // Host sees their own lobby controls
    const actions = document.getElementById('lobby-actions');
    if (actions) {
      const hostNote = document.createElement('p');
      hostNote.style.cssText = 'text-align:center;color:var(--text-dim);font-size:14px;margin-top:8px;';
      hostNote.textContent = '2人以上集まったらゲームを開始できます';
      actions.appendChild(hostNote);
    }
  } catch(e) {
    if (statusEl) { statusEl.textContent = `エラー: ${e.message}`; statusEl.className = 'status-message error'; }
  }
};

window.joinRoom = async () => {
  const name = document.getElementById('join-player-name')?.value?.trim() || 'プレイヤー';
  const roomInput = document.getElementById('room-id-input')?.value?.trim();
  const statusEl = document.getElementById('join-room-status');

  if (!roomInput) {
    if (statusEl) { statusEl.textContent = 'ルームIDを入力してください'; statusEl.className = 'status-message error'; }
    return;
  }
  if (statusEl) { statusEl.textContent = '接続中...'; statusEl.className = 'status-message'; }

  try {
    const room = await getRoomModule();
    await room.clientJoinRoom(name, roomInput);
    onlineMode = true;
    showScreen('lobby');
  } catch(e) {
    if (statusEl) { statusEl.textContent = `接続失敗: ${e.message}`; statusEl.className = 'status-message error'; }
  }
};

window.startOnlineGame = async () => {
  const room = await getRoomModule();
  room.startOnlineGame();
};

window.leaveLobby = async () => {
  if (roomModule) roomModule.resetRoomState();
  onlineMode = false;
  showScreen('online-select');
};

window.copyRoomId = () => {
  const el = document.getElementById('display-room-id');
  if (el) navigator.clipboard.writeText(el.textContent).then(() => showToast('コピーしました', 'success'));
};

window.copyInviteUrl = () => {
  const el = document.getElementById('invite-url');
  if (el) navigator.clipboard.writeText(el.value).then(() => showToast('URLをコピーしました', 'success'));
};

// ================================================================
// SHARED GAME ACTIONS (AI & Online)
// ================================================================

window.handleDrawCard = async () => {
  if (aiGameState) {
    if (aiGameState.players[aiGameState.currentTurn]?.id !== AI_MY_ID) {
      showToast('あなたのターンではありません', 'warn'); return;
    }
    playerDraw(aiGameState, AI_MY_ID);
    renderAIGameUI();
    scheduleAIIfNeeded();
  } else if (onlineMode) {
    const room = await getRoomModule();
    room.onDrawCard();
  }
};

window.declareUno = async () => {
  if (aiGameState) {
    const me = aiGameState.players.find(p => p.id === AI_MY_ID);
    if (me && me.hand.length === 1) {
      me.saidUno = true;
      clearTimeout(unoUnclaimedTimer);
      showToast('UNO! 🎉', 'success');
      renderAIGameUI();
    }
  } else if (onlineMode) {
    const room = await getRoomModule();
    room.onDeclareUno();
  }
};

window.selectColor = async (color) => {
  document.getElementById('color-picker').style.display = 'none';
  if (aiGameState) {
    if (aiPendingWild) { doAIPlay(aiPendingWild, color); aiPendingWild = null; }
  } else if (onlineMode) {
    const room = await getRoomModule();
    room.onColorSelected(color);
  }
};

// ================================================================
// RESULT ACTIONS
// ================================================================

window.returnToTitle = async () => {
  aiGameState = null;
  onlineMode = false;
  clearTimeout(aiTurnTimer);
  clearTimeout(unoUnclaimedTimer);
  if (roomModule) { roomModule.resetRoomState(); roomModule = null; }
  showScreen('title');
};

window.playAgain = () => {
  if (aiGameState || !onlineMode) {
    const me = aiGameState?.players?.find(p => p.id === AI_MY_ID);
    const name = me?.name || 'プレイヤー';
    aiGameState = null;
    clearTimeout(aiTurnTimer);
    const nameEl = document.getElementById('ai-player-name');
    if (nameEl) nameEl.value = name;
    window.startAIGame();
  }
};

// ================================================================
// URL PARAMS - Auto join from invite link
// ================================================================

function checkUrlParams() {
  const params = new URLSearchParams(location.search);
  const roomPeerId = params.get('room');
  if (roomPeerId) {
    const input = document.getElementById('room-id-input');
    if (input) input.value = roomPeerId;
    showScreen('join-room');
  } else {
    showScreen('title');
  }
}

checkUrlParams();
