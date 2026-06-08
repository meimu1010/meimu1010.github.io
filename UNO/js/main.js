/**
 * main.js — エントリーポイント + AI ゲームモード
 */

import { createGameState, initGame, playCard, playerDraw, getTopCard, drawFromDeck } from './game.js';
import { aiChooseCard } from './ai.js';
import {
  makeCard, makeDiscardCard, renderHand, updateDiscard, updateTurn,
  updateDeckCount, updateDrawStack, updateDirectionArrow, layoutOpponents,
  renderResults, showAction, showUnoBtn, toast,
  animatePlayCard, animateDrawCard, renderLobbyPlayers, launchConfetti
} from './ui.js';

// ================================================================
// 名前の永続化 (localStorage)
// ================================================================
function loadName(key, fallback) {
  try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
}
function saveName(key, val) {
  try { localStorage.setItem(key, val); } catch {}
}

// ================================================================
// 画面切替
// ================================================================
export function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(`screen-${name}`);
  if (el) el.classList.add('active');
}
window.showScreen = showScreen;

// ================================================================
// AI ゲーム状態
// ================================================================
let G        = null;   // GameState
const MY_ID  = 'local-player';
let pendWild = null;
let aiTimer  = null;
let unoTimer = null;
let aiDiff   = 'normal';

const THINK = { easy:{min:1000,max:2200}, normal:{min:1600,max:3000}, hard:{min:2200,max:4200} };

// ================================================================
// 設定コントロール
// ================================================================
let _aiN  = 3, _maxP = 4, _diff = 'normal';
window.adjustAICount    = d => { _aiN  = Math.max(1,Math.min(3,_aiN+d));  document.getElementById('ai-count').textContent = _aiN; };
window.adjustMaxPlayers = d => { _maxP = Math.max(2,Math.min(4,_maxP+d)); document.getElementById('max-players-display').textContent = _maxP; };
window.selectDifficulty = btn => {
  document.querySelectorAll('.diff-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active'); _diff = btn.dataset.diff;
};

// ================================================================
// AI ゲーム開始
// ================================================================
window.startAIGame = () => {
  const inp  = document.getElementById('ai-player-name');
  const name = inp?.value?.trim() || 'プレイヤー';
  saveName('uno_player_name', name);
  aiDiff = _diff; pendWild = null;
  clearTimeout(aiTimer); clearTimeout(unoTimer);

  G = createGameState('LOCAL','AI Game',MY_ID,_aiN+1);
  G.players.push({ id:MY_ID, name, hand:[], isAI:false, saidUno:false });

  const aiNames = ['ゆいな','たかし','はるか','けんじ'];
  for (let i = 0; i < _aiN; i++) {
    G.players.push({ id:`ai-${i}`, name:aiNames[i]||`AI${i+1}`, hand:[], isAI:true, difficulty:_diff, saidUno:false });
  }
  initGame(G);
  showScreen('game');
  renderGame();
  scheduleAI();
};

// ================================================================
// ゲーム UI 全更新
// ================================================================
function renderGame() {
  if (!G) return;
  const me      = G.players.find(p => p.id === MY_ID);
  if (!me) return;
  const top     = getTopCard(G);
  const isMine  = G.players[G.currentTurn]?.id === MY_ID;

  // 相手 — 時計回り順で取得
  const myIdx = G.players.findIndex(p => p.id === MY_ID);
  const opps  = [];
  for (let i = 1; i < G.players.length; i++) opps.push(G.players[(myIdx+i)%G.players.length]);
  layoutOpponents(opps, G.currentTurn, G.players);

  // 中央
  updateDiscard(top);
  updateDeckCount(G.deck.length);
  updateDrawStack(G.drawStack);
  updateDirectionArrow(G.direction, G.players, MY_ID, G.currentTurn);
  updateTurn(G.players[G.currentTurn]?.name||'?', isMine);

  // 自分手札
  renderHand(me.hand, top, G.drawStack, isMine, onCardClick);

  const nn = document.getElementById('my-name-display');
  if (nn) nn.textContent = me.name;
  showUnoBtn(isMine && me.hand.length===1 && !me.saidUno);

  const dp = document.getElementById('draw-pile');
  if (dp) { dp.style.opacity = isMine?'1':'.65'; dp.style.cursor = isMine?'pointer':'not-allowed'; }
}

// ================================================================
// カードクリック
// ================================================================
function onCardClick(card) {
  if (!G || G.players[G.currentTurn]?.id !== MY_ID) {
    toast('あなたのターンではありません','warn'); return;
  }
  if (card.type==='wild'||card.type==='wild4') {
    pendWild = card;
    document.getElementById('color-picker').style.display = 'flex';
  } else {
    const el = document.querySelector(`[data-card-id="${card.id}"]`);
    animatePlayCard(el, card, () => doPlay(card, null));
  }
}

function doPlay(card, color) {
  if (!G) return;
  const result = playCard(G, MY_ID, card.id, color);
  if (!result.success) {
    if (result.needsColor) { pendWild=card; document.getElementById('color-picker').style.display='flex'; return; }
    toast('そのカードは出せません','error');
    renderGame(); return;
  }
  doSpecialEffect(getTopCard(G));
  clearTimeout(unoTimer);
  const me = G.players.find(p=>p.id===MY_ID);
  if (me?.hand.length===1 && !me.saidUno) {
    unoTimer = setTimeout(()=>{
      if (!G) return;
      const mp=G.players.find(p=>p.id===MY_ID);
      if(mp?.hand.length===1&&!mp.saidUno){
        for(let i=0;i<2;i++){const c=drawFromDeck(G);if(c)mp.hand.push(c);}
        toast('UNO宣言を忘れて2枚ドロー!','error');
        renderGame();
      }
    }, 5000);
  }
  if (G.gameOver){ renderGame(); setTimeout(showAIResult, 800); return; }
  renderGame();
  scheduleAI();
}

// ================================================================
// 山札を引く (+2/+4 自動ドロー対応)
// ================================================================
window.handleDrawCard = async () => {
  if (G) {
    if (G.players[G.currentTurn]?.id !== MY_ID){ toast('あなたのターンではありません','warn'); return; }
    // drawStack があるとき対応カードを持っているか確認
    if (G.drawStack > 0) {
      const top = getTopCard(G);
      const me  = G.players.find(p=>p.id===MY_ID);
      const canCounter = me.hand.some(c=>{
        if(top?.type==='draw2')  return c.type==='draw2';
        if(top?.type==='wild4')  return c.type==='wild4';
        return false;
      });
      if (canCounter) { toast('+2/+4カードで対応できます','info'); return; }
    }
    // 山札から引くアニメ → 実際にドロー
    animateDrawCard(()=>{
      playerDraw(G, MY_ID);
      renderGame();
      scheduleAI();
    });
  } else if (onlineMode) {
    const r = await getRm(); r.onDrawCard();
  }
};

// ================================================================
// UNO宣言
// ================================================================
window.declareUno = async () => {
  if (G) {
    const me=G.players.find(p=>p.id===MY_ID);
    if(me?.hand.length===1){ me.saidUno=true; clearTimeout(unoTimer); toast('UNO! 🎉','success'); renderGame(); }
  } else if (onlineMode) {
    const r = await getRm(); r.onDeclareUno();
  }
};

// ================================================================
// 色選択
// ================================================================
window.selectColor = async color => {
  document.getElementById('color-picker').style.display='none';
  if (G) {
    if (!pendWild) return;
    const card=pendWild; pendWild=null;
    const el=document.querySelector(`[data-card-id="${card.id}"]`);
    animatePlayCard(el,{...card,chosenColor:color},()=>doPlay(card,color));
  } else if (onlineMode) {
    const r=await getRm(); r.onColorSelected(color);
  }
};

// ================================================================
// AI スケジュール & 実行
// ================================================================
function scheduleAI() {
  if (!G||G.gameOver) return;
  const cur=G.players[G.currentTurn];
  if (!cur?.isAI) return;
  clearTimeout(aiTimer);
  const t=THINK[cur.difficulty||aiDiff]||THINK.normal;
  aiTimer=setTimeout(()=>runAI(cur), t.min+Math.random()*(t.max-t.min));
}

function runAI(aiPlayer) {
  if (!G||G.gameOver) return;
  if (G.players[G.currentTurn].id!==aiPlayer.id) return;

  const {card,chosenColor}=aiChooseCard(aiPlayer,G,aiPlayer.difficulty||aiDiff);

  if (card) {
    if (aiPlayer.hand.length===2&&!aiPlayer.saidUno){ aiPlayer.saidUno=true; toast(`${aiPlayer.name} が UNO!`,'warn'); }
    const res=playCard(G,aiPlayer.id,card.id,chosenColor||null);
    if (res.success) doSpecialEffect(getTopCard(G));
    else playerDraw(G,aiPlayer.id);
  } else {
    playerDraw(G,aiPlayer.id);
  }

  if (G.gameOver){ renderGame(); setTimeout(showAIResult,800); return; }
  renderGame();
  setTimeout(scheduleAI,250);
}

function doSpecialEffect(card) {
  if (!card||card.type==='number') return;
  const m={skip:'SKIP!',reverse:'REVERSE!',draw2:'+2!',wild4:'+4!'};
  const t=m[card.type]; if(t) showAction(t);
}

// ================================================================
// AI 結果
// ================================================================
function showAIResult() {
  if (!G) return;
  const w=G.players.find(p=>p.id===G.rankings[0]);
  document.getElementById('result-title').textContent = w?.id===MY_ID?'🎉 あなたの勝利!':`${w?.name} の勝利!`;
  renderResults(G.rankings,G.players,MY_ID);
  document.getElementById('play-again-btn').style.display='block';
  if (w?.id===MY_ID) launchConfetti();
  showScreen('result');
}

// ================================================================
// オンラインモード (lazy)
// ================================================================
let rmMod=null, onlineMode=false;
async function getRm() { if(!rmMod) rmMod=await import('./room.js'); return rmMod; }

window.createRoom = async () => {
  const name    =document.getElementById('host-player-name')?.value?.trim()||'ホスト';
  const roomName=document.getElementById('room-name-input')?.value?.trim()||'UNO Room';
  saveName('uno_player_name',name);
  const se=document.getElementById('create-room-status');
  if(se){se.textContent='接続中...';se.className='status-message';}
  try {
    const r=await getRm();
    const {peerManager}=await import('./peer.js');
    const rid=await r.hostCreateRoom(name,roomName,_maxP);
    onlineMode=true; showScreen('lobby');
    document.getElementById('display-room-id').textContent=rid;
    document.getElementById('invite-url').value=`${location.origin}${location.pathname}?room=${peerManager.myPeerId}`;
    document.getElementById('max-player-count').textContent=_maxP;
    renderLobbyPlayers([{id:peerManager.myPeerId,name}],_maxP,peerManager.myPeerId);
    document.getElementById('start-game-btn').style.display='none';
    document.getElementById('waiting-message').style.display='none';
  } catch(e){ if(se){se.textContent=`エラー: ${e.message}`;se.className='status-message error';} }
};

window.joinRoom = async () => {
  const name=document.getElementById('join-player-name')?.value?.trim()||'プレイヤー';
  const rid =document.getElementById('room-id-input')?.value?.trim();
  saveName('uno_player_name',name);
  const se=document.getElementById('join-room-status');
  if(!rid){if(se){se.textContent='ルームIDを入力してください';se.className='status-message error';} return;}
  if(se){se.textContent='接続中...';se.className='status-message';}
  try { const r=await getRm(); await r.clientJoinRoom(name,rid); onlineMode=true; showScreen('lobby'); }
  catch(e){ if(se){se.textContent=`接続失敗: ${e.message}`;se.className='status-message error';} }
};

window.startOnlineGame = async () => { const r=await getRm(); r.startOnlineGame(); };
window.leaveLobby      = async () => { if(rmMod)rmMod.resetRoomState(); onlineMode=false; showScreen('online-select'); };
window.copyRoomId      = () => { const e=document.getElementById('display-room-id'); if(e) navigator.clipboard.writeText(e.textContent).then(()=>toast('コピーしました','success')); };
window.copyInviteUrl   = () => { const e=document.getElementById('invite-url'); if(e) navigator.clipboard.writeText(e.value).then(()=>toast('URLをコピーしました','success')); };

// ================================================================
// リザルト
// ================================================================
window.returnToTitle = async () => {
  G=null; onlineMode=false; clearTimeout(aiTimer); clearTimeout(unoTimer);
  if(rmMod){rmMod.resetRoomState();rmMod=null;}
  showScreen('title');
};
window.playAgain = () => {
  const me=G?.players?.find(p=>p.id===MY_ID);
  const nm=me?.name||'プレイヤー';
  G=null; clearTimeout(aiTimer);
  const ni=document.getElementById('ai-player-name'); if(ni)ni.value=nm;
  window.startAIGame();
};

// ================================================================
// 名前をフォームに復元
// ================================================================
function restoreNames() {
  const saved = loadName('uno_player_name', '');
  if (!saved) return;
  ['ai-player-name','host-player-name','join-player-name'].forEach(id=>{
    const el=document.getElementById(id); if(el&&!el.value) el.value=saved;
  });
  // 入力時に随時保存
  ['ai-player-name','host-player-name','join-player-name'].forEach(id=>{
    const el=document.getElementById(id);
    if(el) el.addEventListener('input',()=>saveName('uno_player_name',el.value.trim()));
  });
}

// ================================================================
// URL パラメータ & 初期化
// ================================================================
function init() {
  restoreNames();
  const p=new URLSearchParams(location.search);
  const rid=p.get('room');
  if(rid){ const i=document.getElementById('room-id-input'); if(i) i.value=rid; showScreen('join-room'); }
  else showScreen('title');
}
init();
