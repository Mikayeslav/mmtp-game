/**
 * MMtp — Shared Expression Evaluator (UMD)
 * Used by both server (game-engine.js) and client (gameplay.js, bot-ai-v2.js)
 *
 * In Node.js:  const { CardType, evaluate, ... } = require('./expression');
 * In Browser:  window.MMtpExpression.CardType, window.MMtpExpression.evaluate, ...
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    // Node.js / CommonJS
    module.exports = factory();
  } else {
    // Browser global
    root.MMtpExpression = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {

const CardType = { Number: 'number', Operator: 'operator', Special: 'special', Paren: 'paren' };
const OperatorKind = { Add: 'add', Sub: 'sub', Mul: 'mul', Div: 'div', Mod: 'mod', Pow: 'pow' };
const SpecialKind = { Wild: 'wild', Reroll: 'reroll', Double: 'double', Peek: 'peek', Swap: 'swap' };
const ParenKind = { Open: 'open', Close: 'close' };

/**
 * Check if a token array contains any parenthesis tokens.
 */
function hasParens(tokens) {
  return tokens.some(t => t.type === CardType.Paren);
}

/**
 * Resolve all parentheses by repeatedly evaluating the innermost group.
 * Returns a flat token array with no parens, or an error.
 * @param {Array} tokens - Array of card tokens (may contain Paren cards)
 * @param {string} mode - 'left-to-right' or 'standard'
 * @param {Object} opts
 * @returns {{ ok: boolean, tokens?: Array, value?: number, reason?: string }}
 */
function resolveParentheses(tokens, mode, opts) {
  let work = [...tokens];
  let maxIter = 50; // safety limit for deeply nested parens

  while (maxIter-- > 0) {
    // Find the LAST open paren (innermost)
    let openIdx = -1;
    for (let i = work.length - 1; i >= 0; i--) {
      if (work[i].type === CardType.Paren && work[i].parenKind === ParenKind.Open) {
        openIdx = i;
        break;
      }
    }
    if (openIdx === -1) break; // No more parens

    // Find the matching close paren (first close after this open)
    let closeIdx = -1;
    for (let i = openIdx + 1; i < work.length; i++) {
      if (work[i].type === CardType.Paren && work[i].parenKind === ParenKind.Close) {
        closeIdx = i;
        break;
      }
    }
    if (closeIdx === -1) {
      return { ok: false, value: 0, reason: 'Unmatched open parenthesis' };
    }

    // Extract sub-expression (excluding the parens themselves)
    const subTokens = work.slice(openIdx + 1, closeIdx);
    if (subTokens.length === 0) {
      return { ok: false, value: 0, reason: 'Empty parentheses' };
    }

    // Check for nested parens in sub-expression (shouldn't happen since we pick innermost)
    if (hasParens(subTokens)) {
      return { ok: false, value: 0, reason: 'Unexpected nested parenthesis' };
    }

    // Evaluate the sub-expression
    const subResult = (mode === 'standard')
      ? evaluateStandard(subTokens, { ...opts, allowNegative: true })
      : evaluateLeftToRight(subTokens, { ...opts, allowNegative: true });

    if (!subResult.ok) return subResult;

    // Replace the entire (sub-expression) with a single Number token
    const replacement = { type: CardType.Number, value: subResult.value };
    work = [...work.slice(0, openIdx), replacement, ...work.slice(closeIdx + 1)];
  }

  // Check for unmatched close parens
  if (work.some(t => t.type === CardType.Paren)) {
    return { ok: false, value: 0, reason: 'Unmatched parenthesis' };
  }

  return { ok: true, tokens: work };
}

/**
 * Evaluate a list of card tokens using left-to-right precedence.
 * @param {Array} tokens - Array of card objects
 * @param {Object} opts - { allowNegative: boolean }
 * @returns {{ ok: boolean, value: number, reason: string }}
 */
function evaluateLeftToRight(tokens, opts = {}) {
  if (!tokens || tokens.length === 0) {
    return { ok: false, value: 0, reason: 'No tokens provided' };
  }

  // Handle parentheses first
  if (hasParens(tokens)) {
    const resolved = resolveParentheses(tokens, 'left-to-right', opts);
    if (!resolved.ok) return resolved;
    tokens = resolved.tokens;
  }

  if (tokens[0].type !== CardType.Number || tokens[0].value === undefined) {
    return { ok: false, value: 0, reason: 'Expression must start with a number' };
  }
  let acc = tokens[0].value;

  for (let i = 1; i < tokens.length; i += 2) {
    if (i + 1 >= tokens.length) {
      return { ok: false, value: 0, reason: 'Expression ends with operator' };
    }
    const op = tokens[i];
    const num = tokens[i + 1];
    if (!op || !num) {
      return { ok: false, value: 0, reason: 'Missing operator or number' };
    }
    if (op.type !== CardType.Operator || num.type !== CardType.Number) {
      return { ok: false, value: 0, reason: 'Invalid expression pattern' };
    }
    switch (op.operatorKind) {
      case OperatorKind.Add: acc += num.value; break;
      case OperatorKind.Sub: acc -= num.value; break;
      case OperatorKind.Mul: acc *= num.value; break;
      case OperatorKind.Div:
        if (num.value === 0) return { ok: false, value: 0, reason: 'Division by zero' };
        acc = Math.floor(acc / num.value);
        break;
      case OperatorKind.Mod:
        if (num.value === 0) return { ok: false, value: 0, reason: 'Modulo by zero' };
        acc = acc % num.value;
        break;
      case OperatorKind.Pow:
        if (num.value < 0) return { ok: false, value: 0, reason: 'Negative exponent' };
        acc = Math.pow(acc, num.value);
        if (!isFinite(acc)) return { ok: false, value: 0, reason: 'Result too large' };
        acc = Math.round(acc);
        break;
    }
  }
  if (!opts.allowNegative && acc < 0) {
    return { ok: false, value: acc, reason: 'Negative result not allowed' };
  }
  return { ok: true, value: acc, reason: '' };
}

/**
 * Evaluate using standard math precedence (* / before + -).
 */
function evaluateStandard(tokens, opts = {}) {
  if (!tokens || tokens.length === 0) {
    return { ok: false, value: 0, reason: 'No tokens provided' };
  }

  // Handle parentheses first
  if (hasParens(tokens)) {
    const resolved = resolveParentheses(tokens, 'standard', opts);
    if (!resolved.ok) return resolved;
    tokens = resolved.tokens;
  }

  if (tokens[0].type !== CardType.Number || tokens[0].value === undefined) {
    return { ok: false, value: 0, reason: 'Expression must start with a number' };
  }
  if (tokens.length === 1) {
    return { ok: true, value: tokens[0].value, reason: '' };
  }

  const nums = [];
  const ops = [];
  for (let i = 0; i < tokens.length; i++) {
    if (i % 2 === 0) {
      if (!tokens[i] || tokens[i].type !== CardType.Number) {
        return { ok: false, value: 0, reason: 'Invalid expression pattern' };
      }
      nums.push(tokens[i].value);
    } else {
      if (!tokens[i] || tokens[i].type !== CardType.Operator) {
        return { ok: false, value: 0, reason: 'Invalid expression pattern' };
      }
      ops.push(tokens[i].operatorKind);
    }
  }
  if (nums.length !== ops.length + 1) {
    return { ok: false, value: 0, reason: 'Expression ends with operator' };
  }

  // Pass 1: resolve ^ (power) — highest precedence
  let curNums = [...nums];
  let curOps = [...ops];
  let nextNums = [curNums[0]];
  let nextOps = [];
  for (let i = 0; i < curOps.length; i++) {
    if (curOps[i] === OperatorKind.Pow) {
      if (curNums[i + 1] < 0) return { ok: false, value: 0, reason: 'Negative exponent' };
      const r = Math.pow(nextNums[nextNums.length - 1], curNums[i + 1]);
      if (!isFinite(r)) return { ok: false, value: 0, reason: 'Result too large' };
      nextNums[nextNums.length - 1] = Math.round(r);
    } else {
      nextNums.push(curNums[i + 1]);
      nextOps.push(curOps[i]);
    }
  }

  // Pass 2: resolve *, /, %
  const nums2 = [nextNums[0]];
  const ops2 = [];
  for (let i = 0; i < nextOps.length; i++) {
    if (nextOps[i] === OperatorKind.Mul) {
      nums2[nums2.length - 1] *= nextNums[i + 1];
    } else if (nextOps[i] === OperatorKind.Div) {
      if (nextNums[i + 1] === 0) return { ok: false, value: 0, reason: 'Division by zero' };
      nums2[nums2.length - 1] = Math.floor(nums2[nums2.length - 1] / nextNums[i + 1]);
    } else if (nextOps[i] === OperatorKind.Mod) {
      if (nextNums[i + 1] === 0) return { ok: false, value: 0, reason: 'Modulo by zero' };
      nums2[nums2.length - 1] = nums2[nums2.length - 1] % nextNums[i + 1];
    } else {
      nums2.push(nextNums[i + 1]);
      ops2.push(nextOps[i]);
    }
  }

  // Pass 3: resolve + and -
  let acc = nums2[0];
  for (let i = 0; i < ops2.length; i++) {
    if (ops2[i] === OperatorKind.Add) acc += nums2[i + 1];
    else if (ops2[i] === OperatorKind.Sub) acc -= nums2[i + 1];
  }

  if (!opts.allowNegative && acc < 0) {
    return { ok: false, value: acc, reason: 'Negative result not allowed' };
  }
  return { ok: true, value: acc, reason: '' };
}

/**
 * Validate that parentheses in a token array are balanced.
 * Returns true if balanced, false otherwise.
 */
function validateParenBalance(tokens) {
  let depth = 0;
  for (const t of tokens) {
    if (t.type === CardType.Paren) {
      if (t.parenKind === ParenKind.Open) depth++;
      else if (t.parenKind === ParenKind.Close) depth--;
      if (depth < 0) return false; // Close before open
    }
  }
  return depth === 0;
}

/**
 * Check if a card can be legally placed at the end of the current playfield.
 * Returns { ok: boolean, reason?: string }
 */
function canPlaceCard(playfield, card) {
  if (playfield.length === 0) {
    // First card: Number or Open Paren
    if (card.type === CardType.Number) return { ok: true };
    if (card.type === CardType.Paren && card.parenKind === ParenKind.Open) return { ok: true };
    return { ok: false, reason: 'Expression must start with a number or (' };
  }

  const last = playfield[playfield.length - 1];

  // After Number: Operator or Close Paren
  if (last.type === CardType.Number) {
    if (card.type === CardType.Operator) return { ok: true };
    if (card.type === CardType.Paren && card.parenKind === ParenKind.Close) {
      // Check there's an open to match
      let depth = 0;
      for (const t of playfield) {
        if (t.type === CardType.Paren) {
          if (t.parenKind === ParenKind.Open) depth++;
          else if (t.parenKind === ParenKind.Close) depth--;
        }
      }
      if (depth > 0) return { ok: true };
      return { ok: false, reason: 'No open parenthesis to close' };
    }
    return { ok: false, reason: 'Expected an operator or ) after a number' };
  }

  // After Operator: Number or Open Paren
  if (last.type === CardType.Operator) {
    if (card.type === CardType.Number) return { ok: true };
    if (card.type === CardType.Paren && card.parenKind === ParenKind.Open) return { ok: true };
    return { ok: false, reason: 'Expected a number or ( after an operator' };
  }

  // After Open Paren: Number or Open Paren
  if (last.type === CardType.Paren && last.parenKind === ParenKind.Open) {
    if (card.type === CardType.Number) return { ok: true };
    if (card.type === CardType.Paren && card.parenKind === ParenKind.Open) return { ok: true };
    return { ok: false, reason: 'Expected a number or ( after (' };
  }

  // After Close Paren: Operator or Close Paren
  if (last.type === CardType.Paren && last.parenKind === ParenKind.Close) {
    if (card.type === CardType.Operator) return { ok: true };
    if (card.type === CardType.Paren && card.parenKind === ParenKind.Close) {
      let depth = 0;
      for (const t of playfield) {
        if (t.type === CardType.Paren) {
          if (t.parenKind === ParenKind.Open) depth++;
          else if (t.parenKind === ParenKind.Close) depth--;
        }
      }
      if (depth > 0) return { ok: true };
      return { ok: false, reason: 'No open parenthesis to close' };
    }
    return { ok: false, reason: 'Expected an operator or ) after )' };
  }

  return { ok: false, reason: 'Invalid card placement' };
}

/**
 * Check if the playfield expression can be scored (ends correctly and parens balanced).
 */
function canScore(playfield) {
  if (playfield.length === 0) return { ok: false, reason: 'Playfield is empty' };
  const last = playfield[playfield.length - 1];
  // Must end with a number or close paren
  if (last.type !== CardType.Number && !(last.type === CardType.Paren && last.parenKind === ParenKind.Close)) {
    return { ok: false, reason: 'Expression must end with a number or )' };
  }
  if (!validateParenBalance(playfield)) {
    return { ok: false, reason: 'Unbalanced parentheses' };
  }
  return { ok: true };
}

/**
 * Evaluate expression using the specified precedence mode.
 */
function evaluate(tokens, mode = 'left-to-right', opts = {}) {
  if (!tokens || tokens.length === 0) {
    return { ok: false, value: 0, reason: 'No cards on playfield' };
  }
  // Allow starting with ( or Number
  const first = tokens[0];
  if (first.type !== CardType.Number && !(first.type === CardType.Paren && first.parenKind === ParenKind.Open)) {
    return { ok: false, value: 0, reason: 'Expression must start with a number or (' };
  }
  if (mode === 'standard') return evaluateStandard(tokens, opts);
  return evaluateLeftToRight(tokens, opts);
}

// ── Public API ──
return {
  CardType, OperatorKind, SpecialKind, ParenKind,
  evaluate, evaluateLeftToRight, evaluateStandard,
  canPlaceCard, canScore, validateParenBalance, hasParens
};

});
