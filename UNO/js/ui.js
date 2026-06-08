/**
 * ui.js — レンダリング・アニメーション
 */

export function cardLabel(card) {
  if (!card) return '?';
  const m = {number:String(card.value),skip:'⊘',reverse:'⇄',draw2:'+2',wild:'★',wild4:'+4'};
  return m[card.type] ?? '?';
}
export function cardColor(card) {
  return card?.chosenColor || card?.color || 'wild';
}

/* ===================== カード要素 ===================== */
export function makeCard(card, playable, onClick) {
  const el = document.createElement('div');
  el.className = `card card-${cardColor(card)}${playable ? '' : ' not-playable'}`;
  el.dataset.cardId = card.id;
  const lbl = cardLabel(card);
  el.innerHTML = `<span class="card-corner tl">${lbl}</span><div class="card-inner"><span class="card-value">${lbl}</span></div><span class="card-corner br">${lbl}</span>`;
  if (playable && onClick) el.addEventListener('click', () => onClick(card));
  return el;
}

export function makeDiscardCard(card) {
  const el = document.createElement('div');
  el.className = `discard-card card-${cardColor(card)}`;
  const lbl = cardLabel(card);
  el.innerHTML = `<span class="card-corner tl">${lbl}</span><div class="card-inner"><span class="card-value">${lbl}</span></div><span class="card-corner br">${lbl}</span>`;
  return el;
}

/* ===================== 相手パネル ===================== */
export function makeOppPanel(player, isActive) {
  const el = document.createElement('div');
  el.className = `opp-panel${isActive ? ' my-turn-active' : ''}`;
  el.id = `opp-${player.id}`;

  const count = player.handCount ?? player.hand?.length ?? 0;
  const show  = Math.min(count, 12);
  const cards = Array.from({length: show}, () => `<div class="opp-card"></div>`).join('');

  el.innerHTML = `
    ${player.isAI ? '<div class="opp-ai-dot">🤖</div>' : ''}
    <div class="opp-panel-name">${esc(player.name)}</div>
    <div class="opp-cards">${cards}</div>
    <div class="opp-panel-count">${count}枚</div>
    ${player.saidUno && count === 1 ? '<div class="opp-uno-tag">UNO!</div>' : ''}`;
  return el;
}

/**
 * 人数に応じてゾーン配置
 * 2人: 上1人
 * 3人: 左1人 + 右1人
 * 4人: 左1人 + 上1人 + 右1人
 */
export function layoutOpponents(opponents, currentTurnIdx, allPlayers) {
  const top   = document.getElementById('zone-top');
  const left  = document.getElementById('zone-left');
  const right = document.getElementById('zone-right');
  if (!top || !left || !right) return;
  top.innerHTML = left.innerHTML = right.innerHTML = '';

  const n      = opponents.length;
  const active = (p) => allPlayers[currentTurnIdx]?.id === p.id;

  if (n === 1) {
    top.appendChild(makeOppPanel(opponents[0], active(opponents[0])));
  } else if (n === 2) {
    left.appendChild(makeOppPanel(opponents[0], active(opponents[0])));
    right.appendChild(makeOppPanel(opponents[1], active(opponents[1])));
  } else if (n === 3) {
    left.appendChild(makeOppPanel(opponents[0], active(opponents[0])));
    top.appendChild(makeOppPanel(opponents[1], active(opponents[1])));
    right.appendChild(makeOppPanel(opponents[2], active(opponents[2])));
  }
}

/* ===================== 手札レンダリング ===================== */
function localCanPlay(card, top, drawStack) {
  if (!top) return true;
  if (drawStack > 0) {
    if (top.type === 'draw2')  return card.type === 'draw2';
    if (top.type === 'wild4')  return card.type === 'wild4';
    return false;
  }
  const eff = top.chosenColor || top.color;
  if (card.type === 'wild' || card.type === 'wild4') return true;
  if (card.color === eff) return true;
  if (card.type === top.type && card.type !== 'number') return true;
  if (card.type === 'number' && top.type === 'number' && card.value === top.value) return true;
  return false;
}

export function renderHand(hand, topCard, drawStack, isMyTurn, onCardClick) {
  const box = document.getElementById('my-hand');
  if (!box) return;

  const hadIds = new Set([...box.querySelectorAll('.card')].map(e => e.dataset.cardId));
  const nowIds = new Set(hand.map(c => c.id));

  // 削除
  [...box.querySelectorAll('.card')].forEach(el => { if (!nowIds.has(el.dataset.cardId)) el.remove(); });

  // 追加・更新
  hand.forEach(card => {
    const playable = isMyTurn && topCard ? localCanPlay(card, topCard, drawStack) : false;
    const existing = box.querySelector(`[data-card-id="${card.id}"]`);
    const newEl    = makeCard(card, playable, isMyTurn ? onCardClick : null);
    if (!existing) {
      if (!hadIds.has(card.id)) newEl.classList.add('card-new');
      box.appendChild(newEl);
    } else {
      existing.replaceWith(newEl);
    }
  });

  const badge = document.getElementById('my-card-count');
  if (badge) badge.textContent = hand.length;
}

/* ===================== 捨て札更新 ===================== */
export function updateDiscard(card) {
  const el = document.getElementById('discard-pile');
  if (!el) return;
  el.innerHTML = '';
  if (card) {
    const dc = makeDiscardCard(card);
    dc.classList.add('discard-new');
    el.appendChild(dc);
  } else {
    el.innerHTML = '<div class="empty-pile-hint">捨て札</div>';
  }
}

/* ===================== ゲーム情報 ===================== */
export function updateTurn(name, isMe) {
  const el = document.getElementById('turn-indicator');
  if (!el) return;
  el.textContent = isMe ? '🟡 あなたのターン' : `${name} のターン`;
  el.style.color = isMe ? 'var(--gold)' : 'var(--text-dim)';
}

export function updateDeckCount(n) {
  const el = document.getElementById('draw-count');
  if (el) el.textContent = `${n}枚`;
}

export function updateDrawStack(n) {
  const el = document.getElementById('draw-stack-display');
  const ct = document.getElementById('draw-stack-count');
  if (!el || !ct) return;
  el.style.display = n > 0 ? 'block' : 'none';
  ct.textContent = n;
}

/**
 * 向き矢印 SVG を描画
 * direction: 1=時計回り, -1=反時計回り
 * players: 全プレイヤー配列, myId: 自分のID
 * currentTurn: 現在ターンの index
 */
export function updateDirectionArrow(direction, players, myId, currentTurn) {
  const svg = document.getElementById('dir-svg');
  if (!svg) return;

  const cx = 30, cy = 30, r = 22;
  const n  = players.filter(p => !p.hand || p.hand.length > 0 || true).length; // 全員
  // 時計回り = 矢印が右回り
  const arrowPath = direction === 1
    ? `M${cx+r},${cy} A${r},${r} 0 1,1 ${cx + r * Math.cos(2.8)},${cy + r * Math.sin(2.8)}`
    : `M${cx+r},${cy} A${r},${r} 0 1,0 ${cx + r * Math.cos(2.8)},${cy - r * Math.sin(2.8)}`;

  const arrowTip = direction === 1
    ? `M${cx + r * Math.cos(2.8)},${cy + r * Math.sin(2.8)} l4,-8 l-8,2z`
    : `M${cx + r * Math.cos(2.8)},${cy - r * Math.sin(2.8)} l4,8 l-8,-2z`;

  svg.innerHTML = `
    <path d="${arrowPath}" fill="none" stroke="rgba(255,215,0,0.5)" stroke-width="3" stroke-linecap="round"/>
    <path d="${arrowTip}" fill="rgba(255,215,0,0.7)"/>
    <text x="${cx}" y="${cy+5}" text-anchor="middle" font-size="10" fill="rgba(255,215,0,0.6)" font-family="Bebas Neue">${direction===1?'CW':'CCW'}</text>`;
}

export function showUnoBtn(show) {
  const b = document.getElementById('uno-btn');
  if (b) b.style.display = show ? 'block' : 'none';
}

/* ===================== カード出し演出 (手札→捨て札) ===================== */
export function animatePlayCard(fromEl, card, onDone) {
  const discardArea = document.getElementById('discard-pile');
  const layer       = document.getElementById('anim-layer');
  if (!discardArea || !layer || !fromEl) { if (onDone) onDone(); return; }

  const fr = fromEl.getBoundingClientRect();
  const tr = discardArea.getBoundingClientRect();

  const fly = document.createElement('div');
  fly.className = `fly-card card-${cardColor(card)}`;
  fly.style.cssText = `left:${fr.left}px;top:${fr.top}px;`;
  const lbl = cardLabel(card);
  fly.innerHTML = `<div class="fly-card-inner"><span class="fly-card-value">${lbl}</span></div>`;
  layer.appendChild(fly);

  // 元カードを隠す
  fromEl.style.opacity = '0';
  fromEl.style.pointerEvents = 'none';

  // Web Animations API で飛ばす
  const toX = tr.left - fr.left;
  const toY = tr.top  - fr.top;
  const rot = (Math.random() * 22 - 11).toFixed(1);

  fly.animate([
    { transform: `translate(0,0) scale(1) rotate(0deg)`,         opacity: 1 },
    { transform: `translate(${toX*.55}px,${toY*.4}px) scale(1.22) rotate(${rot}deg)`, opacity: 1, offset: .55 },
    { transform: `translate(${toX}px,${toY}px) scale(0.96) rotate(0deg)`,            opacity: .85 }
  ], { duration: 420, easing: 'cubic-bezier(.25,.8,.35,1)', fill: 'forwards' })
    .onfinish = () => { fly.remove(); if (onDone) onDone(); };
}

/* ===================== 山札から引くアニメ (山札→手札) ===================== */
export function animateDrawCard(onDone) {
  const drawPile = document.getElementById('draw-pile');
  const handBox  = document.getElementById('my-hand');
  const layer    = document.getElementById('anim-layer');
  if (!drawPile || !handBox || !layer) { if (onDone) onDone(); return; }

  const fr = drawPile.getBoundingClientRect();
  const tr = handBox.getBoundingClientRect();

  const fly = document.createElement('div');
  fly.className = 'draw-fly';
  fly.style.cssText = `left:${fr.left}px;top:${fr.top}px;width:${fr.width}px;height:${fr.height}px;border-radius:10px;`;
  layer.appendChild(fly);

  const toX = tr.left + tr.width / 2 - fr.left - fr.width / 2;
  const toY = tr.top  - fr.top;

  fly.animate([
    { transform: `translate(0,0) scale(1)`,                   opacity: 1 },
    { transform: `translate(${toX*.4}px,${toY*.3}px) scale(1.1)`, opacity: 1, offset: .4 },
    { transform: `translate(${toX}px,${toY}px) scale(.92)`,  opacity: .7 }
  ], { duration: 380, easing: 'cubic-bezier(.3,.8,.4,1)', fill: 'forwards' })
    .onfinish = () => { fly.remove(); if (onDone) onDone(); };
}

/* ===================== トースト ===================== */
export function toast(msg, type = 'info') {
  const c = document.getElementById('toast-container');
  if (!c) return;
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

/* ===================== アクションオーバーレイ ===================== */
export function showAction(text) {
  const ov = document.getElementById('action-overlay');
  const tx = document.getElementById('action-text');
  if (!ov || !tx) return;
  tx.textContent = text;
  ov.style.display = 'flex';
  tx.style.animation = 'none';
  requestAnimationFrame(() => { tx.style.animation = 'actionPop 1.6s ease-in-out forwards'; });
  setTimeout(() => { ov.style.display = 'none'; }, 1600);
}

/* ===================== 結果 ===================== */
export function renderResults(rankings, players, myId) {
  const list = document.getElementById('ranking-list');
  if (!list) return;
  list.innerHTML = '';
  const medals = ['🥇','🥈','🥉','4位'];
  rankings.forEach((pid, i) => {
    const p = players.find(pl => pl.id === pid);
    if (!p) return;
    const el = document.createElement('div');
    el.className = 'rank-item';
    el.innerHTML = `<div class="rank-medal">${medals[i]||`${i+1}`}</div><div class="rank-name">${esc(p.name)}${pid===myId?'<span class="rank-you">YOU</span>':''}</div>${p.isAI?'<div>🤖</div>':''}`;
    list.appendChild(el);
  });
}

/* 紙吹雪 */
export function launchConfetti() {
  const c   = document.getElementById('confetti-container');
  if (!c) return;
  const clrs = ['#ffd700','#e94560','#1E88E5','#43A047','#ff6b6b','#fff176'];
  for (let i = 0; i < 60; i++) {
    const p = document.createElement('div');
    p.className = 'confetti-piece';
    p.style.cssText = `
      left:${Math.random()*100}%;
      background:${clrs[Math.floor(Math.random()*clrs.length)]};
      animation-duration:${2.2+Math.random()*2.5}s;
      animation-delay:${Math.random()*1.5}s;
      width:${6+Math.random()*8}px;height:${6+Math.random()*8}px;
      border-radius:${Math.random()>.5?'50%':'2px'};
    `;
    c.appendChild(p);
  }
  setTimeout(() => c.innerHTML = '', 6000);
}

/* ===================== ロビー ===================== */
export function renderLobbyPlayers(players, maxPlayers, hostId) {
  const grid = document.getElementById('players-grid');
  if (!grid) return;
  grid.innerHTML = '';
  for (let i = 0; i < maxPlayers; i++) {
    const p  = players[i];
    const el = document.createElement('div');
    const isHost = p && p.id === hostId;
    el.className = `player-slot${p ? ' filled' : ''}${isHost ? ' is-host' : ''}`;
    if (p) {
      el.innerHTML = `
        ${isHost ? '<div class="player-slot-role">HOST</div>' : ''}
        <div class="player-slot-icon">${isHost ? '👑' : '👤'}</div>
        <div class="player-slot-name">${esc(p.name)}</div>`;
    } else {
      el.innerHTML = `<div class="player-slot-icon" style="opacity:.25">・・・</div><div class="player-slot-name" style="color:var(--text-dim)">待機中</div>`;
    }
    grid.appendChild(el);
  }
  const ce = document.getElementById('player-count');
  if (ce) ce.textContent = players.length;
}

function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
export { esc as escapeHtml };
