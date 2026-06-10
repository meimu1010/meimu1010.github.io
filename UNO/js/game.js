/**
 * game.js - Core UNO game logic
 * Handles deck, card rules, game state management
 */

/** @typedef {'red'|'blue'|'green'|'yellow'|'wild'} CardColor */
/** @typedef {'number'|'skip'|'reverse'|'draw2'|'wild'|'wild4'} CardType */

/**
 * @typedef {Object} Card
 * @property {string} id
 * @property {CardColor} color
 * @property {CardType} type
 * @property {number|null} value
 * @property {CardColor|null} chosenColor - for wilds after color chosen
 */

/**
 * @typedef {Object} Player
 * @property {string} id
 * @property {string} name
 * @property {Card[]} hand
 * @property {boolean} isAI
 * @property {string} [difficulty]
 * @property {boolean} saidUno
 */

/**
 * @typedef {Object} GameState
 * @property {string} roomId
 * @property {string} roomName
 * @property {string} hostId
 * @property {Player[]} players
 * @property {number} maxPlayers
 * @property {boolean} gameStarted
 * @property {number} currentTurn  - index into players
 * @property {number} direction    - 1=clockwise, -1=counter
 * @property {number} drawStack    - accumulated draws from +2/+4
 * @property {Card[]} deck
 * @property {Card[]} discardPile
 * @property {string[]} rankings   - player ids in finish order
 * @property {boolean} gameOver
 * @property {string|null} pendingWildCard - id of wild being played
 */

const COLORS = ['red', 'blue', 'green', 'yellow'];
let cardIdCounter = 0;

/**
 * Create a single card
 * @param {CardColor} color
 * @param {CardType} type
 * @param {number|null} value
 * @returns {Card}
 */
export function createCard(color, type, value = null) {
  return {
    id: `card_${++cardIdCounter}_${Math.random().toString(36).slice(2,6)}`,
    color,
    type,
    value,
    chosenColor: null
  };
}

/**
 * Build and shuffle a standard 108-card UNO deck
 * @returns {Card[]}
 */
export function buildDeck() {
  const deck = [];
  for (const color of COLORS) {
    // 0 (one per color)
    deck.push(createCard(color, 'number', 0));
    // 1-9 x2, Skip x2, Reverse x2, Draw Two x2
    for (let i = 0; i < 2; i++) {
      for (let n = 1; n <= 9; n++) deck.push(createCard(color, 'number', n));
      deck.push(createCard(color, 'skip', null));
      deck.push(createCard(color, 'reverse', null));
      deck.push(createCard(color, 'draw2', null));
    }
  }
  // 4 Wilds, 4 Wild Draw Four
  for (let i = 0; i < 4; i++) {
    deck.push(createCard('wild', 'wild', null));
    deck.push(createCard('wild', 'wild4', null));
  }
  return shuffleDeck(deck);
}

/**
 * Fisher-Yates shuffle
 * @param {Card[]} deck
 * @returns {Card[]}
 */
export function shuffleDeck(deck) {
  const d = [...deck];
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

/**
 * Deal initial hands
 * @param {GameState} state
 */
export function dealCards(state) {
  for (const player of state.players) {
    player.hand = [];
    for (let i = 0; i < 7; i++) {
      const card = state.deck.pop();
      if (card) player.hand.push(card);
    }
  }
  // Place first card (re-draw if wild)
  let firstCard;
  do {
    firstCard = state.deck.pop();
    if (!firstCard) break;
    if (firstCard.type === 'wild' || firstCard.type === 'wild4') {
      state.deck.unshift(firstCard);
      firstCard = null;
    }
  } while (!firstCard);
  if (firstCard) state.discardPile.push(firstCard);
}

/**
 * Get the top card of the discard pile (effective color/type)
 * @param {GameState} state
 * @returns {Card|null}
 */
export function getTopCard(state) {
  return state.discardPile.length > 0
    ? state.discardPile[state.discardPile.length - 1]
    : null;
}

/**
 * Check if a card can be played on the current top card
 * @param {Card} card - card to play
 * @param {Card} top  - current discard
 * @param {number} drawStack
 * @returns {boolean}
 */
export function canPlayCard(card, top, drawStack) {
  if (!top) return true;

  // If draw stack is active, only draw2 or wild4 can be stacked
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
 * Get all playable cards from hand
 * @param {Card[]} hand
 * @param {Card} top
 * @param {number} drawStack
 * @returns {Card[]}
 */
export function getPlayableCards(hand, top, drawStack) {
  return hand.filter(c => canPlayCard(c, top, drawStack));
}

/**
 * Apply card effect to game state (mutates state)
 * @param {GameState} state
 * @param {Card} card
 */
export function applyCardEffect(state, card) {
  const n = state.players.length;

  switch (card.type) {
    case 'skip':
      advanceTurn(state);
      break;

    case 'reverse':
      state.direction *= -1;
      if (n === 2) advanceTurn(state); // Reverse acts as Skip in 2p
      break;

    case 'draw2':
      state.drawStack = (state.drawStack || 0) + 2;
      break;

    case 'wild4':
      state.drawStack = (state.drawStack || 0) + 4;
      break;

    case 'wild':
    case 'number':
    default:
      // 通常カードを出した時点で drawStack はクリア
      state.drawStack = 0;
      break;
  }
}

/**
 * Resolve draw stack: next player draws and is skipped
 * @param {GameState} state
 */
export function resolveDrawStack(state) {
  if (state.drawStack === 0) return;
  const nextIdx = getNextPlayerIndex(state);
  const nextPlayer = state.players[nextIdx];
  for (let i = 0; i < state.drawStack; i++) {
    const card = drawFromDeck(state);
    if (card) nextPlayer.hand.push(card);
  }
  state.drawStack = 0;
  advanceTurn(state); // skip the drawing player
}

/**
 * Advance the turn pointer
 * @param {GameState} state
 */
export function advanceTurn(state) {
  const n = state.players.filter(p => p.hand.length > 0 || !state.rankings.includes(p.id)).length;
  if (n <= 1) return;
  let next = (state.currentTurn + state.direction + state.players.length) % state.players.length;
  // Skip already-finished players
  let safety = 0;
  while (state.rankings.includes(state.players[next].id) && safety < state.players.length) {
    next = (next + state.direction + state.players.length) % state.players.length;
    safety++;
  }
  state.currentTurn = next;
}

/**
 * Get next player index without modifying state
 * @param {GameState} state
 * @returns {number}
 */
export function getNextPlayerIndex(state) {
  const n = state.players.length;
  let next = (state.currentTurn + state.direction + n) % n;
  let safety = 0;
  while (state.rankings.includes(state.players[next].id) && safety < n) {
    next = (next + state.direction + n) % n;
    safety++;
  }
  return next;
}

/**
 * Draw a card from the deck, reshuffling discard if needed
 * @param {GameState} state
 * @returns {Card|null}
 */
export function drawFromDeck(state) {
  if (state.deck.length === 0) {
    // Reshuffle discard pile into deck (keep top card)
    if (state.discardPile.length <= 1) return null;
    const top = state.discardPile.pop();
    const reshuffled = shuffleDeck(state.discardPile.map(c => ({ ...c, chosenColor: null })));
    state.deck = reshuffled;
    state.discardPile = [top];
  }
  return state.deck.pop() || null;
}

/**
 * Play a card from a player's hand
 * @param {GameState} state
 * @param {string} playerId
 * @param {string} cardId
 * @param {CardColor|null} chosenColor - for wilds
 * @returns {{ success: boolean, message?: string, needsColor?: boolean }}
 */
export function playCard(state, playerId, cardId, chosenColor = null) {
  const playerIdx = state.players.findIndex(p => p.id === playerId);
  if (playerIdx < 0) return { success: false, message: 'Player not found' };
  if (playerIdx !== state.currentTurn) return { success: false, message: 'Not your turn' };

  const player = state.players[playerIdx];
  const cardIdx = player.hand.findIndex(c => c.id === cardId);
  if (cardIdx < 0) return { success: false, message: 'Card not in hand' };

  const card = player.hand[cardIdx];
  const top = getTopCard(state);
  if (top && !canPlayCard(card, top, state.drawStack)) {
    return { success: false, message: 'Cannot play this card' };
  }

  // Wild needs color
  if ((card.type === 'wild' || card.type === 'wild4') && !chosenColor) {
    return { success: false, needsColor: true };
  }

  // Remove from hand
  player.hand.splice(cardIdx, 1);

  // Apply chosen color
  if (chosenColor) card.chosenColor = chosenColor;

  // Add to discard
  state.discardPile.push(card);

  // Apply effects
  applyCardEffect(state, card);

  // Reset UNO flag
  player.saidUno = false;
  // 出した結果1枚残ったか判定してunoMissedフラグを立てる
  if (player.hand.length === 1) {
    player.unoMissed = !player.saidUno;
  } else {
    player.unoMissed = false;
  }

  // Check win
  if (player.hand.length === 0) {
    state.rankings.push(playerId);
  }

  // Check game over (only 1 or 0 players left with cards)
  const activePlayers = state.players.filter(p => !state.rankings.includes(p.id));
  if (activePlayers.length <= 1) {
    if (activePlayers.length === 1) state.rankings.push(activePlayers[0].id);
    state.gameOver = true;
    return { success: true };
  }

  // Advance turn (skip/reverse already handled inside applyCardEffect)
  if (card.type !== 'skip' && card.type !== 'reverse') {
    advanceTurn(state);
  }

  return { success: true };
}

/**
 * Player draws a card (or resolves draw stack)
 * @param {GameState} state
 * @param {string} playerId
 * @returns {{ success: boolean, drawn?: Card[], message?: string }}
 */
export function playerDraw(state, playerId) {
  const playerIdx = state.players.findIndex(p => p.id === playerId);
  if (playerIdx < 0) return { success: false, message: 'Player not found' };
  if (playerIdx !== state.currentTurn) return { success: false, message: 'Not your turn' };

  const player = state.players[playerIdx];
  const drawn = [];

  if (state.drawStack > 0) {
    // +2/+4 のペナルティ消化: 引いてターン終了
    for (let i = 0; i < state.drawStack; i++) {
      const c = drawFromDeck(state);
      if (c) { player.hand.push(c); drawn.push(c); }
    }
    state.drawStack = 0;
    player.saidUno = false;
    advanceTurn(state);
    return { success: true, drawn, penalty: true };
  }

  // 通常ドロー: 1枚引いて、出せるならプレイ可能
  const c = drawFromDeck(state);
  if (c) { player.hand.push(c); drawn.push(c); }

  // 引いたカードが出せるか判定
  const top = getTopCard(state);
  const playable = c && top && canPlayCard(c, top, 0);

  if (playable) {
    // ターン進めず、引いたカードのIDをペンディングに記録
    state.pendingDrawCardId = c.id;
    return { success: true, drawn, canPlayDrawn: true, drawnCard: c };
  }

  // 出せないので自動でターン進行
  player.saidUno = false;
  state.pendingDrawCardId = null;
  advanceTurn(state);
  return { success: true, drawn, canPlayDrawn: false };
}

/**
 * Create a fresh game state
 * @param {string} roomId
 * @param {string} roomName
 * @param {string} hostId
 * @param {number} maxPlayers
 * @returns {GameState}
 */
export function createGameState(roomId, roomName, hostId, maxPlayers) {
  return {
    roomId,
    roomName,
    hostId,
    players: [],
    maxPlayers,
    gameStarted: false,
    currentTurn: 0,
    direction: 1,
    drawStack: 0,
    deck: [],
    discardPile: [],
    rankings: [],
    gameOver: false,
    pendingWildCard: null,
    pendingDrawCardId: null
  };
}

/**
 * Initialize game (build deck, deal cards)
 * @param {GameState} state
 */
export function initGame(state) {
  state.deck = buildDeck();
  state.discardPile = [];
  state.rankings = [];
  state.gameOver = false;
  state.currentTurn = Math.floor(Math.random() * state.players.length);
  state.direction = 1;
  state.drawStack = 0;
  state.pendingDrawCardId = null;
  state.gameStarted = true;
  // 全プレイヤーフラグ初期化
  for (const p of state.players) {
    p.saidUno = false;
    p.unoMissed = false;
  }
  dealCards(state);

  // 最初の捨て札が特殊カードなら効果適用
  const top = getTopCard(state);
  if (top) {
    if (top.type === 'skip') advanceTurn(state);
    else if (top.type === 'reverse') {
      state.direction = -1;
      if (state.players.length === 2) advanceTurn(state);
    } else if (top.type === 'draw2') {
      state.drawStack = 2;
    }
    // wild系は dealCards 内で除外済み
  }
}

/**
 * Serialize state for network transmission (strips deck for security)
 * @param {GameState} state
 * @param {string} forPlayerId - which player's perspective
 * @returns {Object}
 */
export function serializeStateForPlayer(state, forPlayerId) {
  return {
    roomId: state.roomId,
    roomName: state.roomName,
    hostId: state.hostId,
    players: state.players.map(p => ({
      id: p.id,
      name: p.name,
      isAI: p.isAI,
      saidUno: p.saidUno,
      handCount: p.hand.length,
      // Only send own hand
      hand: p.id === forPlayerId ? p.hand : undefined
    })),
    maxPlayers: state.maxPlayers,
    gameStarted: state.gameStarted,
    currentTurn: state.currentTurn,
    direction: state.direction,
    drawStack: state.drawStack,
    deckCount: state.deck.length,
    topCard: getTopCard(state),
    rankings: state.rankings,
    gameOver: state.gameOver
  };
}
