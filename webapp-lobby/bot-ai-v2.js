/**
 * BOT AI V2 - Redesigned with Better Planning and Mathematical Theory
 * 
 * Key Improvements:
 * 1. Hand Evaluation: Evaluates ALL possible plays from hand before deciding
 * 2. Value Preservation: Doesn't waste valuable cards on suboptimal plays
 * 3. Lookahead Planning: Considers future possibilities (draws, extensions)
 * 4. Mathematical Scoring: Uses heuristics based on target size and card value
 * 5. Clear Turn Ending: No infinite loops, clear conditions for ending
 * 
 * Algorithm:
 * - Evaluate all possible N/O/N combinations from hand
 * - Score each combination based on:
 *   * Distance to target
 *   * Card value preservation (don't waste high-value cards)
 *   * Expression length (prefer shorter for small targets, longer for large)
 *   * Future potential (can this be extended?)
 * - Choose best play or extend existing expression
 * - Only end turn when truly no good options exist
 */

(function() {
  'use strict';

  // Card type constants — imported from shared expression module (server/expression.js loaded via <script>)
  const { CardType, OperatorKind, ParenKind, evaluate: sharedEvaluate } = window.MMtpExpression;

  /** Check if a value matches the target (exact or within nearest-score threshold) */
  function botValueMatchesTarget(value, target, nearestScore) {
    if (value === target) return true;
    if (nearestScore && Math.abs(value - target) <= 2) return true;
    return false;
  }

  /**
   * Evaluates all possible plays from a hand and returns scored options
   * @param {Array} hand - Current hand of cards
   * @param {number} target - Target number
   * @param {Array} playfield - Current playfield (for extending)
   * @returns {Array} Array of scored play options
   */
  function evaluateAllPlays(hand, target, playfield = [], opts = {}) {
    const options = [];
    const numbers = hand.filter(c => c.type === CardType.Number);
    const operators = hand.filter(c => c.type === CardType.Operator);
    const nearestScore = !!opts.nearestScore;
    // Note: Bot doesn't use Paren cards strategically yet - they'll be discarded as low-priority
    
    // If playfield exists, evaluate extensions
    if (playfield.length > 0) {
      const lastCard = playfield[playfield.length - 1];
      const needsNumber = lastCard.type === CardType.Operator || (lastCard.type === CardType.Paren && lastCard.parenKind === ParenKind.Open);
      const needsOperator = lastCard.type === CardType.Number || (lastCard.type === CardType.Paren && lastCard.parenKind === ParenKind.Close);
      
      if (needsNumber) {
        // Can extend with a number
        for (const num of numbers) {
          const newPlayfield = [...playfield, num];
          const result = evaluateExpressionFromCards(newPlayfield);
          if (result.ok) {
            const score = scorePlay(result.value, target, newPlayfield.length, hand, num);
            options.push({
              type: 'extend',
              card: num,
              playfield: newPlayfield,
              result: result.value,
              diff: Math.abs(result.value - target),
              score: score,
              canScore: botValueMatchesTarget(result.value, target, nearestScore)
            });
          }
        }
      } else if (needsOperator) {
        // Can extend with an operator
        for (const op of operators) {
          const newPlayfield = [...playfield, op];
          const result = evaluateExpressionFromCards(newPlayfield);
          if (result.ok) {
            const score = scorePlay(result.value, target, newPlayfield.length, hand, op);
            options.push({
              type: 'extend',
              card: op,
              playfield: newPlayfield,
              result: result.value,
              diff: Math.abs(result.value - target),
              score: score,
              canScore: botValueMatchesTarget(result.value, target, nearestScore)
            });
          }
        }
      }
    } else {
      // Build new expressions: N/O/N patterns
      for (const num1 of numbers) {
        for (const op of operators) {
          for (const num2 of numbers) {
            if (num1 === num2 && numbers.length === 2) continue; // Can't use same card twice
            
            const newPlayfield = [num1, op, num2];
            const result = evaluateExpressionFromCards(newPlayfield);
            if (result.ok) {
              const score = scorePlay(result.value, target, newPlayfield.length, hand, [num1, op, num2]);
              options.push({
                type: 'build',
                cards: [num1, op, num2],
                playfield: newPlayfield,
                result: result.value,
                diff: Math.abs(result.value - target),
                score: score,
                canScore: botValueMatchesTarget(result.value, target, nearestScore)
              });
            }
          }
        }
      }
    }
    
    // Sort by score (higher is better)
    options.sort((a, b) => b.score - a.score);
    return options;
  }

  /**
   * Scores a play based on multiple factors
   * @param {number} result - Result of the expression
   * @param {number} target - Target number
   * @param {number} length - Expression length
   * @param {Array} hand - Current hand (for value preservation)
   * @param {Card|Array} cardsUsed - Card(s) used in this play
   * @returns {number} Score (higher is better)
   */
  function scorePlay(result, target, length, hand, cardsUsed) {
    const diff = Math.abs(result - target);
    const isExact = diff === 0;
    const targetSize = target <= 20 ? 'small' : (target <= 50 ? 'medium' : 'large');
    
    let score = 0;
    
    // 1. Exact match is highest priority (but consider minimum length requirement)
    if (isExact) {
      score += 10000; // Base score for exact match
      // Prefer shorter expressions for small targets, longer for large
      if (targetSize === 'small' && length <= 3) score += 1000;
      else if (targetSize === 'large' && length >= 5) score += 1000;
      // Bonus for using fewer cards (efficiency)
      score += (10 - length) * 50;
    } else {
      // 2. Distance to target (closer is better) — use logarithmic decay for better resolution
      if (diff <= 5) score += 2000 - (diff * 200);
      else if (diff <= 20) score += 1000 - (diff * 30);
      else score += 500 - Math.min(diff * 5, 500);
      
      // 3. For large targets, prefer expressions that can be extended
      if (targetSize === 'large' && length < 7) {
        score += 100; // Bonus for extendable expressions
      }

      // 3b. Reachability bonus: can the remaining hand finish the expression?
      if (!isExact && length % 2 === 1) { // ends with a number — can extend with op+num
        const remainingNums = hand.filter(c => c.type === CardType.Number && !cardsArrayHas(cardsUsed, c));
        const remainingOps = hand.filter(c => c.type === CardType.Operator && !cardsArrayHas(cardsUsed, c));
        if (remainingOps.length > 0 && remainingNums.length > 0) {
          // Check if any single op+num can reach target from current result
          for (const op of remainingOps) {
            for (const num of remainingNums) {
              const reach = applyOp(result, op.operatorKind, num.value);
              if (reach !== null && reach === target) {
                score += 3000; // Very close to scoring in next step
                break;
              }
            }
          }
        }
      }
    }
    
    // 4. Value preservation: Don't waste high-value cards
    const cardsArray = Array.isArray(cardsUsed) ? cardsUsed : [cardsUsed];
    for (const card of cardsArray) {
      if (card.type === CardType.Number) {
        const cardValue = card.value;
        // High-value cards (7-9) are valuable for multiplication
        if (cardValue >= 7 && targetSize === 'large') {
          // Only use high-value cards if we're very close or exact
          if (diff > 5) score -= 500; // Penalty for wasting high-value cards
        }
        // Don't waste exact match cards on non-exact plays
        if (cardValue === target && !isExact) {
          score -= 2000; // Heavy penalty
        }
      }
    }
    
    // 5. Expression length preference based on target size
    if (targetSize === 'small') {
      if (length <= 3) score += 200; // Prefer short expressions
      else if (length > 5) score -= 100; // Penalty for too long
    } else if (targetSize === 'large') {
      if (length >= 5) score += 200; // Prefer longer expressions
      else if (length <= 3) score -= 100; // Penalty for too short
    }
    
    return score;
  }

  /** Helper: check if cardsUsed (single card or array) contains a specific card by reference */
  function cardsArrayHas(cardsUsed, card) {
    const arr = Array.isArray(cardsUsed) ? cardsUsed : [cardsUsed];
    return arr.some(c => c === card);
  }

  /** Apply a single operator and return result (or null if invalid) */
  function applyOp(left, opKind, rightVal) {
    switch (opKind) {
      case OperatorKind.Add: return left + rightVal;
      case OperatorKind.Sub: { const r = left - rightVal; return r >= 0 ? r : null; }
      case OperatorKind.Mul: return left * rightVal;
      case OperatorKind.Div: return rightVal !== 0 ? Math.floor(left / rightVal) : null;
      case OperatorKind.Mod: return rightVal !== 0 ? left % rightVal : null;
      case OperatorKind.Pow: {
        if (rightVal < 0) return null;
        const r = Math.pow(left, rightVal);
        return isFinite(r) ? Math.round(r) : null;
      }
      default: return null;
    }
  }

  /**
   * Deep lookahead: Evaluate all N/O/N/O/N combos (5-card expressions) for hard bot.
   * Only called for hard difficulty to find multi-step solutions.
   */
  function evaluateDeepPlays(hand, target, opts = {}) {
    const options = [];
    const numbers = hand.filter(c => c.type === CardType.Number);
    const operators = hand.filter(c => c.type === CardType.Operator);
    const nearestScore = !!opts.nearestScore;
    if (numbers.length < 3 || operators.length < 2) return options;

    // 5-card combos: N O N O N
    for (let n1 = 0; n1 < numbers.length; n1++) {
      for (let o1 = 0; o1 < operators.length; o1++) {
        for (let n2 = 0; n2 < numbers.length; n2++) {
          if (n2 === n1) continue;
          for (let o2 = 0; o2 < operators.length; o2++) {
            if (o2 === o1) continue;
            for (let n3 = 0; n3 < numbers.length; n3++) {
              if (n3 === n1 || n3 === n2) continue;
              const cards = [numbers[n1], operators[o1], numbers[n2], operators[o2], numbers[n3]];
              const result = evaluateExpressionFromCards(cards);
              if (result.ok && botValueMatchesTarget(result.value, target, nearestScore)) {
                const diff = Math.abs(result.value - target);
                const isExact = diff === 0;
                options.push({
                  type: 'build',
                  cards,
                  playfield: cards,
                  result: result.value,
                  diff,
                  score: (isExact ? 12000 : 8000 - diff * 500) + (10 - cards.length) * 50,
                  canScore: true
                });
                if (options.length >= 5) return options; // Limit search for performance
              }
            }
          }
        }
      }
    }
    return options;
  }

  /**
   * Evaluates an expression from an array of cards.
   * Delegates to the shared expression module (left-to-right mode, no negative allowed).
   * @param {Array} cards - Array of cards
   * @returns {Object} {ok: boolean, value: number, reason: string}
   */
  function evaluateExpressionFromCards(cards) {
    if (cards.length === 0) return { ok: false, value: 0, reason: 'Empty expression' };
    if (cards.length === 1) {
      if (cards[0].type === CardType.Number) {
        return { ok: true, value: cards[0].value, reason: '' };
      }
      return { ok: false, value: 0, reason: 'Single operator' };
    }
    return sharedEvaluate(cards, 'left-to-right', { allowNegative: false });
  }

  /**
   * Finds the best play from all evaluated options
   * @param {Array} options - Scored play options
   * @param {number} target - Target number
   * @param {number} minExpressionLength - Minimum expression length (if set)
   * @returns {Object|null} Best play option or null
   */
  function findBestPlay(options, target, minExpressionLength = 0) {
    if (options.length === 0) return null;
    
    // Filter by minimum length if required
    const validOptions = minExpressionLength > 0
      ? options.filter(opt => opt.canScore ? opt.playfield.length >= minExpressionLength : true)
      : options;
    
    if (validOptions.length === 0) return null;
    
    // Prioritize exact matches
    const exactMatches = validOptions.filter(opt => opt.canScore);
    if (exactMatches.length > 0) {
      // If minimum length is set, prefer longer exact matches
      if (minExpressionLength > 0) {
        const longEnough = exactMatches.filter(opt => opt.playfield.length >= minExpressionLength);
        if (longEnough.length > 0) {
          return longEnough[0]; // Best score among long enough matches
        }
      }
      return exactMatches[0]; // Best exact match
    }
    
    // No exact match: return best scoring option
    return validOptions[0];
  }

  // Export functions for use in gameplay.js
  if (typeof window !== 'undefined') {
    window.BotAIv2 = {
      evaluateAllPlays,
      evaluateDeepPlays,
      scorePlay,
      evaluateExpressionFromCards,
      findBestPlay,
      applyOp
    };
  }

})();
