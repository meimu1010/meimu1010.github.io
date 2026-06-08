/**
 * ui.js - UI rendering and animation
 */

/**
 * Get display label for a card
 * @param {import('./game.js').Card} card
 * @returns {string}
 */
export function cardLabel(card) {
  if (!card) return '?';
  switch (card.type) {
    case 'number':  return String(card.value);
    case 'skip':    return '⊘';
    case 'reverse': return '⇄';
    case 'draw2':   return '+2';
    case 'wild':    return '★';
    case 'wild4':   return '+4';
    default:        return '?';
  }
}

/**
 * Get effective display color for a card
 * @param {import('./game.js').Card} card
 * @returns {string}
 */
export function cardDisplayColor(card) {
  if (!card) return 'wild';
  if (card.chosenColor) return card.chosenColor;
  return card.color;
}

/**
 * Render a card element for the player's hand
 * @param {import('./game.js').Card} card
 * @param {boolean} playable
 * @param {Function} onClick
 * @returns {HTMLElement}
 */
export function renderCard(card, playable, onClick) {
  const el = document.createElement('div');
  const color = cardDisplayColor(card);
  el.className = `card card-${color}${playable ? '' : ' not-playable'}`;
  el.dataset.cardId = card.id;

  const label = cardLabel(card);
  el.innerHTML = `
    <span class="card-corner top-left">${label}</span>
    <div class="card-inner">
      <span class="card-value">${label}</span>
    </div>
    <span class="card-corner bot-right">${label}</span>
  `;

  if (playable && onClick) {
    el.addEventListener('click', () => onClick(card));
  }
  return el;
}

/**
 * Render a discard pile card (larger display)
 * @param {import('./game.js').Card} card
 * @returns {HTMLElement}
 */
export function renderDiscardCard(card) {
  const el = document.createElement('div');
  const color = cardDisplayColor(card);
  el.className = `discard-card card-${color}`;
  const label = cardLabel(card);
  el.innerHTML = `
    <span class="card-corner top-left">${label}</span>
    <div class="card-inner">
      <span class="card-value">${label}</span>
    </div>
    <span class="card-corner bot-right">${label}</span>
  `;
  return el;
}

/**
 * Render opponent mini-panel
 * @param {Object} player - serialized player data
 * @param {boolean} isCurrentTurn
 * @returns {HTMLElement}
 */
export function renderOpponentPanel(player, isCurrentTurn) {
  const el = document.createElement('div');
  el.className = `opponent-panel${isCurrentTurn ? ' active-turn' : ''}`;
  el.id = `opponent-${player.id}`;

  const handCount = player.handCount || 0;
  const miniCards = Math.min(handCount, 7);
  const handHTML = Array.from({ length: miniCards }, () => '<div class="mini-card"></div>').join('');

  el.innerHTML = `
    ${player.isAI ? '<div class="ai-badge">🤖</div>' : ''}
    <div class="player-slot-icon">${player.isAI ? '🤖' : '👤'}</div>
    <div class="opponent-name">${escapeHtml(player.name)}</div>
    <div class="opponent-hand">${handHTML}</div>
    <div class="opponent-card-count">${handCount}枚</div>
    ${player.saidUno && handCount === 1 ? '<div style="color:#fdd835;font-size:11px;font-weight:800;">UNO!</div>' : ''}
  `;
  return el;
}

/**
 * Update the hand container with new cards
 * @param {import('./game.js').Card[]} hand
 * @param {import('./game.js').Card|null} topCard
 * @param {number} drawStack
 * @param {boolean} isMyTurn
 * @param {Function} onCardClick
 */
export function renderHand(hand, topCard, drawStack, isMyTurn, onCardClick) {
  const container = document.getElementById('my-hand');
  if (!container) return;

  const existingIds = new Set([...container.querySelectorAll('.card')].map(el => el.dataset.cardId));
  const newIds = new Set(hand.map(c => c.id));

  // Remove cards no longer in hand
  for (const el of [...container.querySelectorAll('.card')]) {
    if (!newIds.has(el.dataset.cardId)) el.remove();
  }

  // Add/update cards
  hand.forEach((card, i) => {
    const playable = isMyTurn && topCard ? require_canPlay(card, topCard, drawStack) : false;
    const existing = container.querySelector(`[data-card-id="${card.id}"]`);
    if (!existing) {
      const el = renderCard(card, playable, isMyTurn ? onCardClick : null);
      if (!existingIds.has(card.id)) el.classList.add('card-drawn');
      container.appendChild(el);
    } else {
      // Update playable state
      existing.className = `card card-${cardDisplayColor(card)}${playable ? '' : ' not-playable'}`;
      // Re-bind click
      const newEl = renderCard(card, playable, isMyTurn ? onCardClick : null);
      existing.replaceWith(newEl);
    }
  });

  document.getElementById('my-card-count').textContent = hand.length;
}

// Local canPlay to avoid circular import
function require_canPlay(card, top, drawStack) {
  if (!top) return true;
  if (drawStack > 0) {
    if (top.type === 'draw2') return card.type === 'draw2';
    if (top.type === 'wild4') return card.type === 'wild4';
    return false;
  }
  const effectiveColor = top.chosenColor || top.color;
  if (card.type === 'wild' || card.type === 'wild4') return true;
  if (card.color === effectiveColor) return true;
  if (card.type === top.type && card.type !== 'number') return true;
  if (card.type === 'number' && top.type === 'number' && card.value === top.value) return true;
  return false;
}

/**
 * Update discard pile display
 * @param {import('./game.js').Card|null} card
 */
export function updateDiscardDisplay(card) {
  const el = document.getElementById('discard-pile');
  if (!el) return;
  el.innerHTML = '';
  if (card) {
    el.appendChild(renderDiscardCard(card));
  } else {
    el.innerHTML = '<div class="empty-pile">捨て札</div>';
  }
}

/**
 * Show a toast notification
 * @param {string} message
 * @param {'info'|'success'|'warn'|'error'} type
 */
export function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

/**
 * Show an action overlay animation (e.g. "SKIP!", "REVERSE!")
 * @param {string} text
 */
export function showActionOverlay(text) {
  const overlay = document.getElementById('action-overlay');
  const textEl = document.getElementById('action-text');
  if (!overlay || !textEl) return;
  textEl.textContent = text;
  overlay.style.display = 'flex';
  textEl.style.animation = 'none';
  requestAnimationFrame(() => {
    textEl.style.animation = 'actionAnim 1.5s ease-in-out forwards';
  });
  setTimeout(() => { overlay.style.display = 'none'; }, 1500);
}

/**
 * Show/hide UNO button
 * @param {boolean} show
 */
export function showUnoButton(show) {
  const btn = document.getElementById('uno-btn');
  if (btn) btn.style.display = show ? 'block' : 'none';
}

/**
 * Update turn indicator text
 * @param {string} name
 * @param {boolean} isMe
 */
export function updateTurnIndicator(name, isMe) {
  const el = document.getElementById('turn-indicator');
  if (!el) return;
  el.textContent = isMe ? 'あなたのターン' : `${name} のターン`;
  el.style.color = isMe ? '#fdd835' : '#aaa';
}

/**
 * Update direction indicator
 * @param {number} direction - 1 or -1
 */
export function updateDirectionIndicator(direction) {
  const el = document.getElementById('direction-indicator');
  if (el) el.textContent = direction === 1 ? '→' : '←';
}

/**
 * Update deck count
 * @param {number} count
 */
export function updateDeckCount(count) {
  const el = document.getElementById('draw-count');
  if (el) el.textContent = `${count}枚`;
}

/**
 * Update draw stack display
 * @param {number} stack
 */
export function updateDrawStack(stack) {
  const el = document.getElementById('draw-stack-display');
  const count = document.getElementById('draw-stack-count');
  if (!el || !count) return;
  if (stack > 0) {
    el.style.display = 'block';
    count.textContent = stack;
  } else {
    el.style.display = 'none';
  }
}

/**
 * Render result/ranking screen
 * @param {string[]} rankings - player ids in order
 * @param {import('./game.js').Player[]} players
 * @param {string} myId
 */
export function renderResults(rankings, players, myId) {
  const list = document.getElementById('ranking-list');
  if (!list) return;
  list.innerHTML = '';

  const medals = ['🥇', '🥈', '🥉', '4位'];
  rankings.forEach((playerId, i) => {
    const player = players.find(p => p.id === playerId);
    if (!player) return;
    const el = document.createElement('div');
    el.className = 'rank-item';
    el.innerHTML = `
      <div class="rank-num">${medals[i] || `${i+1}位`}</div>
      <div class="rank-name">
        ${escapeHtml(player.name)}
        ${playerId === myId ? '<span class="rank-you">YOU</span>' : ''}
      </div>
      ${player.isAI ? '<div>🤖</div>' : ''}
    `;
    list.appendChild(el);
  });
}

/**
 * Escape HTML for safe insertion
 * @param {string} str
 * @returns {string}
 */
export function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Render player slots in lobby
 * @param {Array} players
 * @param {number} maxPlayers
 * @param {string} hostId
 */
export function renderLobbyPlayers(players, maxPlayers, hostId) {
  const grid = document.getElementById('players-grid');
  if (!grid) return;
  grid.innerHTML = '';

  for (let i = 0; i < maxPlayers; i++) {
    const player = players[i];
    const el = document.createElement('div');
    el.className = `player-slot${player ? ' filled' : ''}${player && player.id === hostId ? ' host' : ''}`;
    if (player) {
      el.innerHTML = `
        <div class="player-slot-icon">👤</div>
        <div class="player-slot-name">${escapeHtml(player.name)}</div>
        ${player.id === hostId ? '<div class="player-slot-tag">HOST</div>' : ''}
      `;
    } else {
      el.innerHTML = `
        <div class="player-slot-icon" style="opacity:0.3">⋯</div>
        <div class="player-slot-name" style="color:var(--text-dim)">待機中</div>
      `;
    }
    grid.appendChild(el);
  }

  const countEl = document.getElementById('player-count');
  if (countEl) countEl.textContent = players.length;
}
