/**
 * MMtp — Server-Side Game Engine
 * Authoritative: deck, hands, turns, scoring, timer all on server.
 * Clients send actions, server validates and broadcasts results.
 */

const { CardType, OperatorKind, SpecialKind, evaluate, canPlaceCard, canScore } = require('./expression');

class GameEngine {
  /**
   * @param {import('./rooms').Room} room
   * @param {Function} broadcast - (event, data, roomCode) => void
   * @param {Function} sendTo - (socketId, event, data) => void
   */
  constructor(room, broadcast, sendTo) {
    this.room = room;
    this.broadcast = broadcast;
    this.sendTo = sendTo;

    const r = room.rules;
    this.rules = { ...r };

    // Game state (server-authoritative)
    this.deck = [];
    this.numberPile = [];    // separate pile when splitDeck is on
    this.operatorPile = [];  // separate pile when splitDeck is on
    this.discardPile = [];
    this.hands = { 1: [], 2: [] };       // playerId -> card[]
    this.playfields = { 1: [], 2: [] };   // playerId -> card[] on their playfield
    this.scores = { 1: 0, 2: 0 };
    this.scorePiles = { 1: [], 2: [] };   // scored expression records
    this.activePlayer = 1;
    this.target = r.targetMin; // Start at min (fixedStart)
    this.turnTimer = r.turnTimerSec;
    this.turnTimerInterval = null;
    this.turnNumber = 0;
    this.gameOver = false;
    this.winner = null;
    this.drawsThisTurn = 0;
    this.startTime = Date.now();

    // Per-player match stats
    this.matchStats = {
      1: { cardsPlayed: 0, cardsDrawn: 0, cardsDiscarded: 0, expressionsScored: [], rehandsUsed: 0, timeSaved: 0, bestExpression: null },
      2: { cardsPlayed: 0, cardsDrawn: 0, cardsDiscarded: 0, expressionsScored: [], rehandsUsed: 0, timeSaved: 0, bestExpression: null },
    };

    // Special card state
    this.doubleNext = { 1: false, 2: false }; // ×2 buff active for next score

    // Card ID counter
    this._nextCardId = 1;
  }

  /**
   * Start the game: create deck, deal hands, start timer.
   */
  start() {
    const allCards = this._createDeck();
    if (this.rules.splitDeck) {
      // Separate into number pile and operator/special pile
      this.numberPile = allCards.filter(c => c.type === CardType.Number);
      this.operatorPile = allCards.filter(c => c.type !== CardType.Number);
      this._shuffle(this.numberPile);
      this._shuffle(this.operatorPile);
      this.deck = []; // unused in split mode
    } else {
      this.deck = allCards;
      this._shuffle(this.deck);
    }

    // Deal initial hands (alternate number and operator for a balanced start)
    for (let p = 1; p <= 2; p++) {
      for (let i = 0; i < this.rules.handSize; i++) {
        const card = this._drawFromDeck();
        if (card) this.hands[p].push(card);
      }
    }

    this.target = this.rules.targetMin; // Fixed start
    this.activePlayer = 1;
    this.turnNumber = 1;
    this.drawsThisTurn = 0;
    this.gameOver = false;
    this.startTime = Date.now();

    // Send initial state to each player
    for (const player of this.room.players) {
      const pid = player.playerId;
      const state = this._buildStateFor(pid);
      console.log(`[GameEngine] Sending initial gameState to P${pid} "${player.name}" (socket:${player.socketId}, connected:${player.connected}, handSize:${state.myHand.length})`);
      this.sendTo(player.socketId, 'gameState', state);
    }

    this._startTurnTimer();
    console.log(`[GameEngine] Game started in room ${this.room.code} — deck:${this.deck.length}, P1 hand:${this.hands[1].length}, P2 hand:${this.hands[2].length}`);
  }

  /**
   * Handle player action. Returns { ok, error? }.
   */
  handleAction(socketId, action, data = {}) {
    const player = this.room.getPlayer(socketId);
    if (!player) return { ok: false, error: 'Not in this room' };
    const pid = player.playerId;

    // requestState is allowed even after game over (for reconnection)
    if (action === 'requestState') {
      this.sendTo(socketId, 'gameState', this._buildStateFor(pid));
      return { ok: true };
    }

    if (this.gameOver) return { ok: false, error: 'Game is over' };

    switch (action) {
      case 'draw': return this._handleDraw(pid, data.pile);
      case 'placeCard': return this._handlePlace(pid, data.cardId, data.wildValue);
      case 'undoCard': return this._handleUndo(pid);
      case 'clearPlayfield': return this._handleClear(pid);
      case 'tryScore': return this._handleScore(pid);
      case 'endTurn': return this._handleEndTurn(pid);
      case 'discard': return this._handleDiscard(pid, data.cardId);
      case 'rehand': return this._handleRehand(pid);
      case 'sortHand': return this._handleSort(pid);
      case 'useSpecial': return this._handleUseSpecial(pid, data.cardId, data.specialKind);
      default: return { ok: false, error: `Unknown action: ${action}` };
    }
  }

  // ── Draw ──
  _handleDraw(pid, pileChoice) {
    if (pid !== this.activePlayer) return { ok: false, error: 'Not your turn' };
    if (this.rules.maxDrawPerTurn > 0 && this.drawsThisTurn >= this.rules.maxDrawPerTurn) {
      return { ok: false, error: 'Max draws per turn reached' };
    }

    const hand = this.hands[pid];
    if (hand.length >= this.rules.handLimit) {
      return { ok: false, error: 'Hand is full' };
    }

    const count = this.rules.minDrawPerClick || 1;
    const drawn = [];
    for (let i = 0; i < count; i++) {
      if (hand.length >= this.rules.handLimit) break;
      const card = this.rules.splitDeck
        ? this._drawFromPile(pileChoice)
        : this._drawFromDeck();
      if (!card) break;
      hand.push(card);
      drawn.push(card);
      this.matchStats[pid].cardsDrawn++;
      this.drawsThisTurn++;
    }

    if (drawn.length === 0) return { ok: false, error: 'Pile is empty' };

    this._broadcastState();
    return { ok: true, drawn };
  }

  // ── Place card on playfield ──
  _handlePlace(pid, cardId, wildValue) {
    if (pid !== this.activePlayer) return { ok: false, error: 'Not your turn' };
    const hand = this.hands[pid];
    const idx = hand.findIndex(c => c.id === cardId);
    if (idx === -1) return { ok: false, error: 'Card not in hand' };

    let card = hand[idx];
    const pf = this.playfields[pid];

    // Wild card: resolve to a number card with chosen value
    if (card.type === CardType.Special && card.specialKind === SpecialKind.Wild) {
      const maxVal = this.rules.maxCardValue ?? 9;
      if (wildValue === undefined || wildValue < 0 || wildValue > maxVal) {
        return { ok: false, error: `Wild card requires a value 0-${maxVal}` };
      }
      card = { id: card.id, type: CardType.Number, value: wildValue, wasWild: true };
    }

    // Paren special card: paired parentheses (2 uses per card)
    if (card.type === CardType.Special && card.specialKind === SpecialKind.Paren) {
      const uses = card.parenUses ?? 2;
      // First use = open paren, second use = close paren
      const parenKind = uses === 2 ? 'open' : 'close';
      const parenCard = { id: card.id, type: CardType.Paren, parenKind };
      const placeCheck = canPlaceCard(pf, parenCard);
      if (!placeCheck.ok) return { ok: false, error: placeCheck.reason };
      pf.push(parenCard);
      this.matchStats[pid].cardsPlayed++;
      if (uses <= 1) {
        // Both uses consumed — remove from hand
        hand.splice(idx, 1);
        this.discardPile.push(card);
      } else {
        // Decrement uses — card stays in hand
        hand[idx] = { ...card, parenUses: uses - 1 };
      }
      this._broadcastState();
      return { ok: true };
    }

    // Non-Wild/non-Paren specials can't be placed on playfield
    if (card.type === CardType.Special) {
      return { ok: false, error: 'This special card can\'t be placed on the playfield. Use it from your hand.' };
    }

    // Validate placement using shared canPlaceCard logic
    const placeCheck = canPlaceCard(pf, card);
    if (!placeCheck.ok) return { ok: false, error: placeCheck.reason };

    // Move card from hand to playfield
    hand.splice(idx, 1);
    pf.push(card);
    this.matchStats[pid].cardsPlayed++;

    this._broadcastState();
    return { ok: true };
  }

  // ── Undo last playfield card ──
  _handleUndo(pid) {
    if (pid !== this.activePlayer) return { ok: false, error: 'Not your turn' };
    const pf = this.playfields[pid];
    if (pf.length === 0) return { ok: false, error: 'Playfield is empty' };

    const card = pf.pop();
    this.hands[pid].push(card);

    this._broadcastState();
    return { ok: true };
  }

  // ── Clear entire playfield ──
  _handleClear(pid) {
    if (pid !== this.activePlayer) return { ok: false, error: 'Not your turn' };
    const pf = this.playfields[pid];
    while (pf.length > 0) {
      this.hands[pid].push(pf.pop());
    }
    this._broadcastState();
    return { ok: true };
  }

  // ── Try to score ──
  _handleScore(pid) {
    if (pid !== this.activePlayer) return { ok: false, error: 'Not your turn' };
    const pf = this.playfields[pid];
    if (pf.length === 0) return { ok: false, error: 'Playfield is empty' };

    // Validate scorability
    const scoreCheck = canScore(pf);
    if (!scoreCheck.ok) return { ok: false, error: scoreCheck.reason };

    const result = evaluate(pf, this.rules.operatorPrecedence, {
      allowNegative: this.rules.allowNegative,
    });

    if (!result.ok) return { ok: false, error: result.reason };

    const diff = Math.abs(result.value - this.target);
    const isExact = diff === 0;
    const nearestEnabled = !!this.rules.nearestScore;
    const nearThreshold = this.rules.nearestThreshold ?? 2;
    const isNearScore = nearestEnabled && !isExact && diff <= nearThreshold;

    if (!isExact && !isNearScore) {
      // Miss — broadcast the miss
      this.broadcast('scoreMiss', {
        playerId: pid,
        expression: this._exprToString(pf),
        result: result.value,
        target: this.target,
      }, this.room.code);
      return { ok: false, error: `Expression = ${result.value}, target = ${this.target}` };
    }

    // Score! Calculate points: exact = 1, near = proportional to distance
    let basePoints;
    if (isExact) {
      basePoints = 1;
    } else {
      // Linear falloff: closer = more points, e.g. diff=1 out of threshold=3 → 0.67
      basePoints = Math.max(0.25, 1 - (diff / (nearThreshold + 1)));
    }
    const doubleBuff = this.doubleNext[pid];
    const pointsAwarded = doubleBuff ? basePoints * 2 : basePoints;
    this.scores[pid] += pointsAwarded;
    if (doubleBuff) {
      this.doubleNext[pid] = false;
      this.broadcast('doubleUsed', { playerId: pid, points: pointsAwarded }, this.room.code);
    }
    this.scorePiles[pid].push({
      expression: [...pf],
      target: this.target,
      exprString: this._exprToString(pf),
      result: result.value,
      near: !isExact,
    });
    this.matchStats[pid].expressionsScored.push({
      expression: this._exprToString(pf),
      target: this.target,
      value: result.value,
      length: pf.length,
      near: !isExact,
    });
    // Note: cardsPlayed is already incremented in _handlePlace() when each card is placed

    // Track best expression per player (longest expression = most impressive)
    if (!this.matchStats[pid].bestExpression ||
        pf.length > this.matchStats[pid].bestExpression.length) {
      this.matchStats[pid].bestExpression = {
        value: result.value,
        expression: this._exprToString(pf),
        target: this.target,
        length: pf.length,
      };
    }

    // Discard played cards
    pf.forEach(c => this.discardPile.push(c));
    this.playfields[pid] = [];

    // New target
    const oldTarget = this.target;
    this.target = this._randomTarget();

    // Check win
    if (this.scores[pid] >= this.rules.winPoints) {
      this._endGame(pid);
      return { ok: true, scored: true, won: true };
    }

    this.broadcast('scored', {
      playerId: pid,
      scores: { ...this.scores },
      newTarget: this.target,
      oldTarget,
      expression: this.scorePiles[pid][this.scorePiles[pid].length - 1].exprString,
      near: !isExact,
      pointsAwarded,
    }, this.room.code);

    // Auto-end turn after scoring (mirrors local game behavior)
    this.matchStats[pid].timeSaved += this.turnTimer;
    this._nextTurn();
    return { ok: true, scored: true, near: !isExact, pointsAwarded };
  }

  // ── End turn ──
  _handleEndTurn(pid) {
    if (pid !== this.activePlayer) return { ok: false, error: 'Not your turn' };

    // Return playfield cards to hand
    const pf = this.playfields[pid];
    while (pf.length > 0) {
      this.hands[pid].push(pf.pop());
    }

    // Track time saved
    this.matchStats[pid].timeSaved += this.turnTimer;

    this._nextTurn();
    return { ok: true };
  }

  // ── Discard ──
  _handleDiscard(pid, cardId) {
    if (pid !== this.activePlayer) return { ok: false, error: 'Not your turn' };
    const hand = this.hands[pid];
    const idx = hand.findIndex(c => c.id === cardId);
    if (idx === -1) return { ok: false, error: 'Card not in hand' };

    const card = hand.splice(idx, 1)[0];
    this.discardPile.push(card);
    this.matchStats[pid].cardsDiscarded++;

    this._broadcastState();
    return { ok: true };
  }

  // ── Rehand ──
  _handleRehand(pid) {
    if (pid !== this.activePlayer) return { ok: false, error: 'Not your turn' };

    // Return playfield to hand first
    while (this.playfields[pid].length > 0) {
      this.hands[pid].push(this.playfields[pid].pop());
    }

    // Discard entire hand
    while (this.hands[pid].length > 0) {
      this.discardPile.push(this.hands[pid].pop());
    }

    // Draw new cards
    const drawCount = this.rules.rehandDrawCount || this.rules.handSize;
    for (let i = 0; i < drawCount; i++) {
      const card = this._drawFromDeck();
      if (!card) break;
      this.hands[pid].push(card);
    }

    this.matchStats[pid].rehandsUsed++;
    this.matchStats[pid].timeSaved += this.turnTimer;

    // End turn after rehand
    this._nextTurn();
    return { ok: true };
  }

  // ── Sort hand ──
  _handleSort(pid) {
    const typeOrder = { [CardType.Number]: 0, [CardType.Operator]: 1, [CardType.Special]: 2 };
    const opOrder = { [OperatorKind.Add]: 0, [OperatorKind.Sub]: 1, [OperatorKind.Mul]: 2, [OperatorKind.Div]: 3, [OperatorKind.Mod]: 4, [OperatorKind.Pow]: 5, [OperatorKind.Concat]: 6 };
    const specOrder = { [SpecialKind.Wild]: 0, [SpecialKind.Reroll]: 1, [SpecialKind.Double]: 2, [SpecialKind.Peek]: 3, [SpecialKind.Swap]: 4 };
    this.hands[pid].sort((a, b) => {
      if (a.type !== b.type) return (typeOrder[a.type] ?? 99) - (typeOrder[b.type] ?? 99);
      if (a.type === CardType.Number) return (a.value ?? 0) - (b.value ?? 0);
      if (a.type === CardType.Operator) return (opOrder[a.operatorKind] ?? 99) - (opOrder[b.operatorKind] ?? 99);
      return (specOrder[a.specialKind] ?? 99) - (specOrder[b.specialKind] ?? 99);
    });
    // Only send to the player who sorted
    const player = this.room.getPlayerById(pid);
    if (player) {
      this.sendTo(player.socketId, 'gameState', this._buildStateFor(pid));
    }
    return { ok: true };
  }

  // ── Use special card (Reroll, Double, Peek, Swap) ──
  _handleUseSpecial(pid, cardId, specialKind) {
    if (pid !== this.activePlayer) return { ok: false, error: 'Not your turn' };
    const hand = this.hands[pid];
    const idx = hand.findIndex(c => c.id === cardId);
    if (idx === -1) return { ok: false, error: 'Card not in hand' };

    const card = hand[idx];
    if (card.type !== CardType.Special) return { ok: false, error: 'Not a special card' };

    switch (card.specialKind) {
      case SpecialKind.Reroll: {
        // Change the target to a new random one
        const oldTarget = this.target;
        this.target = this._randomTarget();
        hand.splice(idx, 1);
        this.discardPile.push(card);
        this.broadcast('targetRerolled', {
          playerId: pid,
          oldTarget,
          newTarget: this.target,
        }, this.room.code);
        this._broadcastState();
        return { ok: true, rerolled: true, newTarget: this.target };
      }

      case SpecialKind.Double: {
        // Activate ×2 for next score
        if (this.doubleNext[pid]) return { ok: false, error: '×2 already active' };
        this.doubleNext[pid] = true;
        hand.splice(idx, 1);
        this.discardPile.push(card);
        this.broadcast('doubleActivated', {
          playerId: pid,
        }, this.room.code);
        this._broadcastState();
        return { ok: true, doubled: true };
      }

      case SpecialKind.Peek: {
        // Reveal opponent's hand to this player for 5 seconds
        const oppId = pid === 1 ? 2 : 1;
        const oppHand = this.hands[oppId].map(c => ({ ...c })); // Copy
        hand.splice(idx, 1);
        this.discardPile.push(card);
        // Send only to the player who peeked
        const player = this.room.getPlayerById(pid);
        if (player) {
          this.sendTo(player.socketId, 'peekRevealed', {
            opponentHand: oppHand,
            duration: 5000, // 5 seconds
          });
        }
        this.broadcast('peekUsed', { playerId: pid }, this.room.code);
        this._broadcastState();
        return { ok: true, peeked: true };
      }

      case SpecialKind.Swap: {
        // Swap entire hands with opponent
        const oppId = pid === 1 ? 2 : 1;
        // Remove the Swap card first, then swap hands
        hand.splice(idx, 1);
        this.discardPile.push(card);
        // Swap the hand arrays
        const temp = [...this.hands[pid]];
        this.hands[pid] = [...this.hands[oppId]];
        this.hands[oppId] = temp;
        this.broadcast('handSwapped', {
          playerId: pid,
          myNewCount: this.hands[pid].length,
          oppNewCount: this.hands[oppId].length,
        }, this.room.code);
        this._broadcastState();
        return { ok: true, swapped: true };
      }

      case SpecialKind.Paren: {
        // Paren card: place open or close parenthesis on playfield
        // This is handled via placeCard, not useSpecial
        return { ok: false, error: 'Place Paren cards on the playfield (they work as ( and ) )' };
      }

      default:
        return { ok: false, error: 'Use Wild cards by placing them on the playfield' };
    }
  }

  // ── Internal helpers ──

  _nextTurn() {
    this._stopTurnTimer();
    this.activePlayer = this.activePlayer === 1 ? 2 : 1;
    this.turnNumber++;
    this.drawsThisTurn = 0;
    this.turnTimer = this.rules.turnTimerSec;

    this.broadcast('turnChanged', {
      activePlayer: this.activePlayer,
      turnNumber: this.turnNumber,
    }, this.room.code);

    this._broadcastState();
    this._startTurnTimer();
  }

  _startTurnTimer() {
    this._stopTurnTimer();
    this.turnTimer = this.rules.turnTimerSec;

    this.turnTimerInterval = setInterval(() => {
      this.turnTimer--;
      this.broadcast('timerUpdate', { timeLeft: this.turnTimer }, this.room.code);

      if (this.turnTimer <= 0) {
        // Time's up — auto end turn
        const pf = this.playfields[this.activePlayer];
        while (pf.length > 0) {
          this.hands[this.activePlayer].push(pf.pop());
        }
        this._nextTurn();
      }
    }, 1000);
  }

  _stopTurnTimer() {
    if (this.turnTimerInterval) {
      clearInterval(this.turnTimerInterval);
      this.turnTimerInterval = null;
    }
  }

  _endGame(winnerId) {
    this.gameOver = true;
    this.winner = winnerId;
    this._stopTurnTimer();

    const duration = Math.floor((Date.now() - this.startTime) / 1000);

    this.broadcast('gameOver', {
      winner: winnerId,
      scores: { ...this.scores },
      scorePiles: {
        1: this.scorePiles[1].map(p => ({ exprString: p.exprString, target: p.target })),
        2: this.scorePiles[2].map(p => ({ exprString: p.exprString, target: p.target })),
      },
      matchStats: { ...this.matchStats },
      duration,
      turnNumber: this.turnNumber,
      players: this.room.players.map(p => ({ playerId: p.playerId, name: p.name })),
    }, this.room.code);

    console.log(`[GameEngine] Game over in room ${this.room.code}: Player ${winnerId} wins (${this.scores[1]}-${this.scores[2]})`);
  }

  _createDeck() {
    const deck = [];
    // Allowed operators & specials from rules (with fallback)
    const allowedOps = (Array.isArray(this.rules.allowedOperators) && this.rules.allowedOperators.length > 0)
      ? this.rules.allowedOperators
      : [OperatorKind.Add, OperatorKind.Sub, OperatorKind.Mul, OperatorKind.Div];
    // Filter out 'paren' from specials for individual card generation —
    // paren cards are generated via the allowedSpecials list and use SpecialKind.Paren
    const allowedSpecialsRaw = (Array.isArray(this.rules.allowedSpecials) && this.rules.allowedSpecials.length > 0)
      ? this.rules.allowedSpecials
      : [];
    const hasParenCards = allowedSpecialsRaw.includes('paren');
    const allowedSpecials = allowedSpecialsRaw.filter(s => s !== 'paren');
    const useSpecials = allowedSpecials.length > 0 || hasParenCards;

    // Deck composition from rules (percentages, sum doesn't have to be 100)
    const numPct = (this.rules.deckNumberPct ?? 63) / 100;
    const opPct = (this.rules.deckOperatorPct ?? 30) / 100;
    const spPct = useSpecials ? (this.rules.deckSpecialPct ?? 7) / 100 : 0;
    const total = numPct + opPct + spPct;
    // Normalize to ensure they sum to 1
    const nNum = numPct / total;
    const nOp = opPct / total;
    // nSp = 1 - nNum - nOp (remainder)

    for (let i = 0; i < 100; i++) {
      const roll = Math.random();
      if (useSpecials && roll < (1 - nNum - nOp)) {
        // Special cards
        if (hasParenCards && (allowedSpecials.length === 0 || Math.random() < 0.3)) {
          // Parentheses pair card: starts with 2 uses
          deck.push({
            id: this._nextCardId++,
            type: CardType.Special,
            specialKind: SpecialKind.Paren,
            parenUses: 2, // paired card: use once for (, again for )
          });
        } else if (allowedSpecials.length > 0) {
          deck.push({
            id: this._nextCardId++,
            type: CardType.Special,
            specialKind: allowedSpecials[Math.floor(Math.random() * allowedSpecials.length)],
          });
        } else {
          // Only paren specials available, create one
          deck.push({
            id: this._nextCardId++,
            type: CardType.Special,
            specialKind: SpecialKind.Paren,
            parenUses: 2,
          });
        }
      } else if (roll < (1 - nNum)) {
        // Operators — only from allowed list
        deck.push({
          id: this._nextCardId++,
          type: CardType.Operator,
          operatorKind: allowedOps[Math.floor(Math.random() * allowedOps.length)],
        });
      } else {
        const maxVal = this.rules.maxCardValue ?? 9;
        deck.push({
          id: this._nextCardId++,
          type: CardType.Number,
          value: Math.floor(Math.random() * (maxVal + 1)),
        });
      }
    }
    return deck;
  }

  _shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }

  _drawFromDeck() {
    // In split deck mode, draw alternately for balanced dealing
    if (this.rules.splitDeck) {
      // Alternate: even draws from numbers, odd from operators
      if (this.numberPile.length > 0 && this.operatorPile.length > 0) {
        return (Math.random() < 0.5) ? this.numberPile.pop() : this.operatorPile.pop();
      }
      return this.numberPile.pop() || this.operatorPile.pop() || null;
    }
    if (this.deck.length === 0) {
      // Reshuffle discard pile
      if (this.discardPile.length === 0) return null;
      this.deck = [...this.discardPile];
      this.discardPile = [];
      this._shuffle(this.deck);
      this.broadcast('deckReshuffled', { deckCount: this.deck.length }, this.room.code);
    }
    return this.deck.pop() || null;
  }

  /**
   * Draw from a specific pile (split deck mode).
   * @param {'numbers'|'operators'} pileChoice - Which pile to draw from
   */
  _drawFromPile(pileChoice) {
    if (pileChoice === 'numbers') {
      if (this.numberPile.length === 0) {
        // Reshuffle number-type discards back
        const numDiscards = this.discardPile.filter(c => c.type === CardType.Number);
        if (numDiscards.length === 0) return null;
        this.discardPile = this.discardPile.filter(c => c.type !== CardType.Number);
        this.numberPile = numDiscards;
        this._shuffle(this.numberPile);
        this.broadcast('deckReshuffled', { pile: 'numbers', count: this.numberPile.length }, this.room.code);
      }
      return this.numberPile.pop() || null;
    } else {
      // 'operators' (includes operators + specials)
      if (this.operatorPile.length === 0) {
        const opDiscards = this.discardPile.filter(c => c.type !== CardType.Number);
        if (opDiscards.length === 0) return null;
        this.discardPile = this.discardPile.filter(c => c.type === CardType.Number);
        this.operatorPile = opDiscards;
        this._shuffle(this.operatorPile);
        this.broadcast('deckReshuffled', { pile: 'operators', count: this.operatorPile.length }, this.room.code);
      }
      return this.operatorPile.pop() || null;
    }
  }

  _randomTarget() {
    const min = this.rules.targetMin;
    const max = this.rules.targetMax;
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  _exprToString(cards) {
    return cards.map(c => {
      if (c.type === CardType.Number) return String(c.value);
      if (c.type === CardType.Paren) return c.parenKind === 'close' ? ')' : '(';
      const syms = { add:'+', sub:'−', mul:'×', div:'÷', mod:'%', pow:'^', concat:'‖' };
      return syms[c.operatorKind] || '?';
    }).join(' ');
  }

  /**
   * Build game state visible to a specific player.
   * Each player sees their own hand but only card count for opponent.
   */
  _buildStateFor(playerId) {
    const opponentId = playerId === 1 ? 2 : 1;
    return {
      myPlayerId: playerId,
      myHand: this.hands[playerId],
      opponentHandCount: this.hands[opponentId].length,
      myPlayfield: this.playfields[playerId],
      opponentPlayfield: this.playfields[opponentId],
      scores: { ...this.scores },
      scorePiles: {
        [playerId]: this.scorePiles[playerId].map(p => ({ exprString: p.exprString, target: p.target })),
        [opponentId]: this.scorePiles[opponentId].map(p => ({ exprString: p.exprString, target: p.target })),
      },
      target: this.target,
      activePlayer: this.activePlayer,
      turnNumber: this.turnNumber,
      timeLeft: this.turnTimer,
      deckCount: this.rules.splitDeck
        ? this.numberPile.length + this.operatorPile.length
        : this.deck.length,
      numberPileCount: this.numberPile.length,
      operatorPileCount: this.operatorPile.length,
      splitDeck: !!this.rules.splitDeck,
      discardCount: this.discardPile.length,
      gameOver: this.gameOver,
      winner: this.winner,
      doubleNext: { ...this.doubleNext },
      players: this.room.players.map(p => ({
        playerId: p.playerId, name: p.name,
        avatar: p.avatar || '🃏', title: p.title || '',
      })),
      rules: {
        handSize: this.rules.handSize,
        handLimit: this.rules.handLimit,
        turnTimerSec: this.rules.turnTimerSec,
        winPoints: this.rules.winPoints,
        targetMin: this.rules.targetMin,
        targetMax: this.rules.targetMax,
        nearestScore: this.rules.nearestScore,
        nearestThreshold: this.rules.nearestThreshold ?? 2,
        maxDrawPerTurn: this.rules.maxDrawPerTurn,
        minDrawPerClick: this.rules.minDrawPerClick,
        allowNegative: this.rules.allowNegative,
        operatorPrecedence: this.rules.operatorPrecedence,
        splitDeck: !!this.rules.splitDeck,
        maxCardValue: this.rules.maxCardValue ?? 9,
      },
    };
  }

  _broadcastState() {
    for (const player of this.room.players) {
      if (player.connected) {
        this.sendTo(player.socketId, 'gameState', this._buildStateFor(player.playerId));
      }
    }
  }

  /**
   * Clean up timers on destroy.
   */
  destroy() {
    this._stopTurnTimer();
  }

  /**
   * Handle rematch: reset everything, redeal.
   */
  rematch() {
    this.destroy();
    this.deck = [];
    this.numberPile = [];
    this.operatorPile = [];
    this.discardPile = [];
    this.hands = { 1: [], 2: [] };
    this.playfields = { 1: [], 2: [] };
    this.scores = { 1: 0, 2: 0 };
    this.scorePiles = { 1: [], 2: [] };
    this.activePlayer = 1;
    this.turnNumber = 0;
    this.gameOver = false;
    this.winner = null;
    this.drawsThisTurn = 0;
    this.doubleNext = { 1: false, 2: false };
    this._nextCardId = 1;
    this.matchStats = {
      1: { cardsPlayed: 0, cardsDrawn: 0, cardsDiscarded: 0, expressionsScored: [], rehandsUsed: 0, timeSaved: 0, bestExpression: null },
      2: { cardsPlayed: 0, cardsDrawn: 0, cardsDiscarded: 0, expressionsScored: [], rehandsUsed: 0, timeSaved: 0, bestExpression: null },
    };
    this.start();
  }
}

module.exports = { GameEngine };
