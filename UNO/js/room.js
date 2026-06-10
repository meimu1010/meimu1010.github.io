/**
 * room.js — オンラインルーム管理 (PeerJS Host/Client)
 */

import { peerManager } from './peer.js';
import {
  createGameState, initGame, playCard, playerDraw,
  getTopCard, serializeStateForPlayer, drawFromDeck
} from './game.js';
import {
  renderHand, updateDiscard, updateTurn, updateDeckCount, updateDrawStack,
  updateDirectionArrow, layoutOpponents, renderResults, showAction,
  showUnoBtn, toast, renderLobbyPlayers, animatePlayCard, animateDrawCard, launchConfetti
} from './ui.js';
import { aiChooseCard } from './ai.js';

function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(`screen-${name}`);
  if (el) el.classList.add('active');
}

// ================================================================
// 状態
// ================================================================
let gameState   = null;
let myPlayer    = { id:'', name:'', peerId:'' };
let pendingWild = null;
let viewState   = null;
let cachedPlayers = [];
let aiTimer     = null;

const THINK = { easy:{min:1000,max:2200}, normal:{min:1600,max:3000}, hard:{min:2200,max:4200} };

// ================================================================
// HOST — ルーム作成
// ================================================================
export async function hostCreateRoom(playerName, roomName, maxP) {
  const max = Math.max(2, Math.min(4, maxP));
  await peerManager.init();
  peerManager.becomeHost();

  const peerId = peerManager.myPeerId;
  myPlayer = { id:peerId, name:playerName, peerId };

  // ルームIDは Peer ID そのもの (招待URLと一致させる)
  const roomId = peerId;
  gameState = createGameState(roomId, roomName, peerId, max);
  gameState.players.push({ id:peerId, name:playerName, hand:[], isAI:false, saidUno:false });

  peerManager.onMessage          = handleHostMsg;
  peerManager.onPeerConnected    = pid => console.log('[Room] connected:', pid);
  peerManager.onPeerDisconnected = handleDisconnect;
  return roomId;
}

// ================================================================
// HOST — メッセージ処理
// ================================================================
function handleHostMsg(fromPeer, msg) {
  if (!gameState) return;
  switch (msg.type) {

    case 'join': {
      if (gameState.gameStarted) { peerManager.sendTo(fromPeer,{type:'error',message:'ゲームは開始済みです'}); return; }
      if (gameState.players.length >= gameState.maxPlayers) { peerManager.sendTo(fromPeer,{type:'error',message:'満員です'}); return; }
      // 重複参加防止
      if (gameState.players.some(p => p.id === fromPeer)) { broadcastLobby(); return; }
      // 名前 sanitize
      const safeName = sanitizeName(msg.playerName);
      gameState.players.push({ id:fromPeer, name:safeName, hand:[], isAI:false, saidUno:false, unoMissed:false });
      broadcastLobby();
      break;
    }
    case 'playCard': {
      if (!gameState.gameStarted||gameState.gameOver) return;
      if (gameState.players[gameState.currentTurn]?.id !== fromPeer) return;
      hostPlay(fromPeer, msg.cardId, msg.chosenColor||null);
      break;
    }
    case 'drawCard': {
      if (!gameState.gameStarted||gameState.gameOver) return;
      if (gameState.players[gameState.currentTurn]?.id !== fromPeer) return;
      hostDraw(fromPeer);
      break;
    }
    case 'uno': {
      hostUno(fromPeer);
      break;
    }
    case 'callUnoOut': {
      hostCallUnoOut(fromPeer, msg.targetId);
      break;
    }
  }
}

// ================================================================
// HOST — ゲームアクション
// ================================================================
function hostPlay(pid, cardId, color) {
  if (!gameState) return;
  const res = playCard(gameState, pid, cardId, color);
  if (!res.success) return;

  const top = getTopCard(gameState);
  if (top && top.type !== 'number') {
    const m={skip:'SKIP!',reverse:'REVERSE!',draw2:'+2!',wild4:'+4!'};
    const t=m[top.type]; if(t){ peerManager.broadcast({type:'action',text:t}); showAction(t); }
  }

  if (gameState.gameOver) { endGame(); return; }
  broadcastState();
  setTimeout(checkAI, 400);
}

function hostDraw(pid) {
  if (!gameState) return;
  playerDraw(gameState, pid);
  broadcastState();
  setTimeout(checkAI, 400);
}

function hostUno(pid) {
  if (!gameState) return;
  const p = gameState.players.find(pl=>pl.id===pid);
  if (!p||p.hand.length!==1) return;
  p.saidUno=true; clearUnoTimer(pid);
  peerManager.broadcast({type:'unoAnnounce',playerName:p.name});
  toast(`${p.name} が UNO!`,'warn');
  broadcastState();
}

function sanitizeName(n) {
  if (typeof n !== 'string') return 'Player';
  const cleaned = n.replace(/[\x00-\x1F\x7F<>"'`]/g, '').trim().slice(0, 12);
  return cleaned || 'Player';
}

// ================================================================
// HOST — UNO忘れ指摘
// ================================================================
function hostCallUnoOut(callerPid, targetPid) {
  if (!gameState) return;
  const target = gameState.players.find(p => p.id === targetPid);
  if (!target) return;
  if (target.hand.length === 1 && !target.saidUno && target.unoMissed) {
    for (let i = 0; i < 2; i++) {
      const c = drawFromDeck(gameState);
      if (c) target.hand.push(c);
    }
    target.unoMissed = false;
    const caller = gameState.players.find(p => p.id === callerPid);
    toast(`${caller?.name || '誰か'}が ${target.name} のUNO忘れを指摘! +2枚`, 'warn');
    peerManager.broadcast({ type:'unoMissedCalled', targetName: target.name, callerName: caller?.name });
    broadcastState();
  } else {
    peerManager.sendTo(callerPid, { type:'error', message:'指摘できません' });
  }
}

// ================================================================
// HOST — 切断対応
// ================================================================
function handleDisconnect(peerId) {
  if (!gameState) return;
  const idx = gameState.players.findIndex(p=>p.id===peerId);
  if (idx<0) return;
  if (!gameState.gameStarted) {
    gameState.players.splice(idx,1);
    broadcastLobby();
  } else {
    const p=gameState.players[idx];
    p.isAI=true; p.difficulty='normal'; p.name+=' (AI)';
    toast(`${p.name}が切断。AIが引き継ぎます`,'warn');
    broadcastState();
    setTimeout(checkAI,500);
  }
}

// ================================================================
// HOST — ブロードキャスト
// ================================================================
function broadcastLobby() {
  if (!gameState) return;
  const d={type:'lobbyState',roomId:gameState.roomId,hostId:gameState.hostId,
    players:gameState.players.map(p=>({id:p.id,name:p.name})),maxPlayers:gameState.maxPlayers};
  peerManager.broadcast(d);
  updateLobbyUI(d);
}

function broadcastState() {
  if (!gameState) return;
  // Host自身のUI
  updateGameUI(serializeStateForPlayer(gameState, myPlayer.id));
  // 各クライアントへ個別配信
  for (const p of gameState.players) {
    if (p.id!==myPlayer.id && !p.isAI) {
      peerManager.sendTo(p.id, {type:'gameState', state:serializeStateForPlayer(gameState,p.id)});
    }
  }
}
export { broadcastState as broadcastGameState };

function endGame() {
  if (!gameState) return;
  peerManager.broadcast({type:'gameOver', rankings:gameState.rankings,
    players:gameState.players.map(p=>({id:p.id,name:p.name,isAI:p.isAI}))});
  showResult(gameState.rankings, gameState.players, myPlayer.id);
}

// ================================================================
// CLIENT — 接続
// ================================================================
export async function clientJoinRoom(playerName, hostPeerId) {
  await peerManager.init();
  myPlayer = { id:peerManager.myPeerId, name:playerName, peerId:peerManager.myPeerId };
  peerManager.onMessage = handleClientMsg;
  peerManager.onPeerDisconnected = pid => { if(pid===hostPeerId) toast('ホストが切断されました','error'); };
  await peerManager.connectToHost(hostPeerId);
  peerManager.sendToHost({type:'join', playerName});
}

// ================================================================
// CLIENT — メッセージ処理
// ================================================================
function handleClientMsg(fromPeer, msg) {
  switch (msg.type) {
    case 'lobbyState':
      updateLobbyUI(msg);
      if (!document.getElementById('screen-lobby')?.classList.contains('active')) showScreen('lobby');
      break;
    case 'gameStarting':
      showScreen('game'); break;
    case 'gameState':
      viewState=msg.state;
      cachedPlayers=msg.state.players.map(p=>({id:p.id,name:p.name,isAI:p.isAI,hand:p.hand||[]}));
      updateGameUI(msg.state);
      break;
    case 'action':
      showAction(msg.text); break;
    case 'unoAnnounce':
      toast(`${msg.playerName} が UNO!`,'warn'); break;
    case 'unoMissedCalled':
      toast(`${msg.callerName} が ${msg.targetName} のUNO忘れを指摘! +2枚`,'warn'); break;
    case 'gameOver':
      cachedPlayers=msg.players||cachedPlayers;
      showResult(msg.rankings,cachedPlayers,myPlayer.id); break;
    case 'error':
      toast(msg.message,'error'); break;
  }
}

// ================================================================
// ゲーム開始 (HOST のみ)
// ================================================================
export function startOnlineGame() {
  if (!gameState||gameState.players.length<2||gameState.gameStarted) return;
  initGame(gameState);
  peerManager.broadcast({type:'gameStarting'});
  showScreen('game');
  setTimeout(() => {
    if (gameState) broadcastState();
    setTimeout(checkAI, 600);
  }, 120);
}

// ================================================================
// ゲームアクション (クライアントから)
// ================================================================
export function onPlayCard(card) {
  if (peerManager.isHost) hostPlay(myPlayer.id, card.id, card.chosenColor||null);
  else peerManager.sendToHost({type:'playCard',cardId:card.id,chosenColor:card.chosenColor||null});
}
export function onDrawCard() {
  if (peerManager.isHost) hostDraw(myPlayer.id);
  else peerManager.sendToHost({type:'drawCard'});
}
export function onDeclareUno() {
  if (peerManager.isHost) hostUno(myPlayer.id);
  else peerManager.sendToHost({type:'uno'});
  toast('UNO! 🎉','success');
}
export function onColorSelected(color) {
  document.getElementById('color-picker').style.display='none';
  if (!pendingWild) return;
  const id=pendingWild; pendingWild=null;
  if (peerManager.isHost) hostPlay(myPlayer.id,id,color);
  else peerManager.sendToHost({type:'playCard',cardId:id,chosenColor:color});
}
export function requestWild(card) {
  pendingWild=card.id;
  document.getElementById('color-picker').style.display='flex';
}

// ================================================================
// UI 更新 — ロビー
// ================================================================
function updateLobbyUI(data) {
  const re=document.getElementById('display-room-id'); if(re) re.textContent=data.roomId||'------';
  const ie=document.getElementById('invite-url');
  if(ie) ie.value=`${location.origin}${location.pathname}?room=${data.hostId}`;
  const me=document.getElementById('max-player-count'); if(me) me.textContent=data.maxPlayers;

  renderLobbyPlayers(data.players,data.maxPlayers,data.hostId);

  const sb=document.getElementById('start-game-btn');
  const wm=document.getElementById('waiting-message');
  if(peerManager.isHost){
    if(sb) sb.style.display=data.players.length>=2?'block':'none';
    if(wm) wm.style.display='none';
  } else {
    if(sb) sb.style.display='none';
    if(wm) wm.style.display='block';
  }
}

// ================================================================
// UI 更新 — ゲーム画面
// ================================================================
export function updateGameUI(state) {
  if (!state) return;
  const me=state.players.find(p=>p.id===myPlayer.id);
  if (!me) return;

  const isMine=state.players[state.currentTurn]?.id===myPlayer.id;
  const top=state.topCard;

  // 相手パネル配置
  const myIdx=state.players.findIndex(p=>p.id===myPlayer.id);
  const opps=[];
  for(let i=1;i<state.players.length;i++) opps.push(state.players[(myIdx+i)%state.players.length]);
  layoutOpponents(opps, state.currentTurn, state.players);

  updateDiscard(top);
  updateDeckCount(state.deckCount||0);
  updateDrawStack(state.drawStack||0);
  updateDirectionArrow(state.direction||1, state.players, myPlayer.id, state.currentTurn);
  updateTurn(state.players[state.currentTurn]?.name||'?', isMine);

  const hand=me.hand||[];
  renderHand(hand, top, state.drawStack||0, isMine, onlineCardClick);

  const nn=document.getElementById('my-name-display'); if(nn) nn.textContent=me.name;
  showUnoBtn(isMine&&hand.length===1&&!me.saidUno);

  const dp=document.getElementById('draw-pile');
  if(dp){dp.style.opacity=isMine?'1':'.65';dp.style.cursor=isMine?'pointer':'not-allowed';}
}

function onlineCardClick(card) {
  const s=viewState||(gameState?serializeStateForPlayer(gameState,myPlayer.id):null);
  if(!s) return;
  if(s.players[s.currentTurn]?.id!==myPlayer.id){ toast('あなたのターンではありません','warn'); return; }
  if(card.type==='wild'||card.type==='wild4') requestWild(card);
  else {
    const el=document.querySelector(`[data-card-id="${card.id}"]`);
    animatePlayCard(el,card,()=>onPlayCard(card));
  }
}

// ================================================================
// HOST — AI ターン
// ================================================================
function checkAI() {
  clearTimeout(aiTimer);
  aiTimer = null;
  if (!peerManager.isHost || !gameState || gameState.gameOver) return;
  if (!gameState.gameStarted) return;
  const cur = gameState.players[gameState.currentTurn];
  if (!cur || !cur.isAI) return;
  const t = THINK[cur.difficulty || 'normal'] || THINK.normal;
  const delay = t.min + Math.random() * (t.max - t.min);
  aiTimer = setTimeout(() => runAI(cur), delay);
}

function runAI(aiPlayer) {
  if(!gameState||gameState.gameOver) return;
  if(gameState.players[gameState.currentTurn].id!==aiPlayer.id) return;

  const {card,chosenColor}=aiChooseCard(aiPlayer,gameState,aiPlayer.difficulty||'normal');
  if(card){
    if(aiPlayer.hand.length===2&&!aiPlayer.saidUno){ aiPlayer.saidUno=true; toast(`${aiPlayer.name} が UNO!`,'warn'); }
    const res=playCard(gameState,aiPlayer.id,card.id,chosenColor||null);
    if(res.success){
      const top=getTopCard(gameState);
      if(top&&top.type!=='number'){
        const m={skip:'SKIP!',reverse:'REVERSE!',draw2:'+2!',wild4:'+4!'};
        const t=m[top.type]; if(t){peerManager.broadcast({type:'action',text:t});showAction(t);}
      }
    } else playerDraw(gameState,aiPlayer.id);
  } else playerDraw(gameState,aiPlayer.id);

  if(gameState.gameOver){endGame();return;}
  broadcastState();
  setTimeout(checkAI,300);
}

// ================================================================
// 結果
// ================================================================
function showResult(rankings, players, myId) {
  renderResults(rankings, players, myId);
  const w = players.find(p => p.id === rankings[0]);
  const t = document.getElementById('result-title');
  if (t && w) t.textContent = w.id === myId ? '🎉 あなたの勝利!' : `${w.name} の勝利!`;
  if (w?.id === myId) launchConfetti();
  const btn = document.getElementById('play-again-btn');
  if (btn) btn.style.display = peerManager.isHost ? 'block' : 'none';
  showScreen('result');
}

// ================================================================
// リセット
// ================================================================
export function resetRoomState() {
  gameState=null; myPlayer={id:'',name:'',peerId:''};
  pendingWild=null; viewState=null; cachedPlayers=[];
  clearTimeout(aiTimer);
  peerManager.destroy();
}
export function getMyPlayer() { return myPlayer; }
