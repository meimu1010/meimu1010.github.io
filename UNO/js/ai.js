/**
 * ai.js - AI opponent decision-making
 * Easy / Normal / Hard strategies
 */

import { getPlayableCards, getTopCard, canPlayCard } from './game.js';

/**
 * @typedef {'easy'|'normal'|'hard'} Difficulty
 */

/**
 * Choose a card to play (or null to draw)
 * @param {import('./game.js').Player} aiPlayer
 * @param {import('./game.js').GameState} state
 * @param {Difficulty} difficulty
 * @returns {{ card: import('./game.js').Card|null, chosenColor?: string }}
 */
export function aiChooseCard(aiPlayer, state, difficulty) {
  const top = getTopCard(state);
  const playable = getPlayableCards(aiPlayer.hand, top, state.drawStack);

  if (playable.length === 0) return { card: null };

  switch (difficulty) {
    case 'easy':  return aiEasy(playable, aiPlayer.hand);
    case 'normal':return aiNormal(playable, aiPlayer.hand);
    case 'hard':  return aiHard(playable, aiPlayer, state);
    default:      return aiNormal(playable, aiPlayer.hand);
  }
}

/**
 * Easy: pick random playable card
 */
function aiEasy(playable, hand) {
  const card = playable[Math.floor(Math.random() * playable.length)];
  return {
    card,
    chosenColor: (card.type === 'wild' || card.type === 'wild4')
      ? randomColor()
      : undefined
  };
}

/**
 * Normal: prefer color that matches most cards in hand
 */
function aiNormal(playable, hand) {
  // Prefer non-wild cards first
  const nonWild = playable.filter(c => c.type !== 'wild' && c.type !== 'wild4');
  const pool = nonWild.length > 0 ? nonWild : playable;
  const card = pool[Math.floor(Math.random() * pool.length)];
  return {
    card,
    chosenColor: (card.type === 'wild' || card.type === 'wild4')
      ? bestColor(hand)
      : undefined
  };
}

/**
 * Hard: strategic play
 * - Prefer special cards when others have few cards
 * - Save wild4 for emergencies
 * - Pick color that maximizes hand playability
 */
function aiHard(playable, aiPlayer, state) {
  const hand = aiPlayer.hand;

  // Priority order: draw2/wild4 if drawStack > 0, then skip/reverse, then numbers, then wilds last
  const byType = (types) => playable.filter(c => types.includes(c.type));

  // Check if any opponent is close to winning
  const opponentLow = state.players.some(p =>
    p.id !== aiPlayer.id && !state.rankings.includes(p.id) && p.hand.length <= 2
  );

  // If drawStack active, respond
  if (state.drawStack > 0) {
    const stacking = playable.filter(c => c.type === 'draw2' || c.type === 'wild4');
    if (stacking.length > 0) {
      const card = stacking[0];
      return { card, chosenColor: (card.type === 'wild4') ? bestColor(hand) : undefined };
    }
    return { card: null }; // draw
  }

  // If opponent is low, play attack cards
  if (opponentLow) {
    const attacks = byType(['draw2', 'wild4', 'skip', 'reverse']);
    if (attacks.length > 0) {
      const card = attacks[0];
      return { card, chosenColor: (card.type === 'wild' || card.type === 'wild4') ? bestColor(hand) : undefined };
    }
  }

  // Prefer non-wild cards (save wilds)
  const nonWild = playable.filter(c => c.type !== 'wild' && c.type !== 'wild4');
  if (nonWild.length > 0) {
    // Among non-wild, prefer specials if we have many cards, else numbers
    const specials = nonWild.filter(c => c.type !== 'number');
    const numbers  = nonWild.filter(c => c.type === 'number');

    let card;
    if (hand.length > 5 && specials.length > 0) {
      card = specials[Math.floor(Math.random() * specials.length)];
    } else if (numbers.length > 0) {
      // Pick number of most common color in hand
      const preferred = bestColor(hand);
      const preferred_nums = numbers.filter(c => c.color === preferred);
      card = preferred_nums.length > 0
        ? preferred_nums[Math.floor(Math.random() * preferred_nums.length)]
        : numbers[Math.floor(Math.random() * numbers.length)];
    } else {
      card = specials[Math.floor(Math.random() * specials.length)];
    }
    return { card };
  }

  // Use wild as last resort
  const wilds = byType(['wild', 'wild4']);
  if (wilds.length > 0) {
    // Prefer regular wild over wild4
    const regularWild = wilds.find(c => c.type === 'wild');
    const card = regularWild || wilds[0];
    return { card, chosenColor: bestColor(hand) };
  }

  return { card: null };
}

/**
 * Find the color that appears most in hand
 * @param {import('./game.js').Card[]} hand
 * @returns {string}
 */
function bestColor(hand) {
  const counts = { red: 0, blue: 0, green: 0, yellow: 0 };
  for (const c of hand) {
    if (c.color !== 'wild' && counts[c.color] !== undefined) {
      counts[c.color]++;
    }
  }
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return best[1] > 0 ? best[0] : randomColor();
}

/**
 * @returns {string}
 */
function randomColor() {
  const colors = ['red', 'blue', 'green', 'yellow'];
  return colors[Math.floor(Math.random() * colors.length)];
}

/**
 * Decide if AI should say UNO
 * AI always says UNO (no penalty possible)
 * @returns {boolean}
 */
export function aiShouldSayUno() {
  return true;
}
