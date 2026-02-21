/**
 * MMtp - Bot Turn Logic (extracted from gameplay.js for modularity)
 * Handles bot AI decision-making, card placement, scoring, and turn management.
 * Depends on window.GP (GamePlay API) exposed by gameplay.js.
 */
(function (GP) {
  'use strict';
  if (!GP) { console.error('[gameplay-bot] window.GP not found'); return; }

  const { CardType, OperatorKind, SpecialKind } = window.MMtpExpression;

  // ── Bot-specific state ──
  // Shared via GP.bot so tryScore/endTurn/endGame (in gameplay.js) can clear the watchdog
  let botWatchdogTimer = null;
  let botTurnStartTime = 0;
  const BOT_WATCHDOG_MS = 8000;

  GP.bot = {
    get watchdogTimer() { return botWatchdogTimer; },
    set watchdogTimer(v) { botWatchdogTimer = v; },
    get turnStartTime() { return botTurnStartTime; },
    set turnStartTime(v) { botTurnStartTime = v; },
    BOT_WATCHDOG_MS,
  };

  /** Check if a value matches the target (exact or within nearest-score threshold) */
  function valueMatchesTarget(value, target) {
    const gameRules = GP.rules;
    if (value === target) return true;
    if (gameRules.nearestScore && Math.abs(value - target) <= 2) return true;
    return false;
  }

  function runBotTurn(playerId = null) {
    // Alias shared state from GP namespace (objects are by-reference, always current)
    const gameState = GP.state;
    const gameRules = GP.rules;
    const isHost = GP.isHost;
    const autoSkipBotTurns = GP.autoSkipBotTurns;
    const gameSpeedMultiplier = GP.gameSpeedMultiplier;
    const botMinExpressionLength = GP.botMinExpressionLength;
    const BOT_DIFFICULTY = gameRules.botDifficulty || 'medium';
    const targetPlayer = playerId || gameState.activePlayer;
    
    // ========== VALIDATION ==========
    if (targetPlayer === 1 && !gameRules.botP1) return;
    if (targetPlayer === 2 && !gameRules.allowBots) return;
    if (gameState.gameOver || gameState.activePlayer !== targetPlayer) return;
    if (!isHost) return;
    if (targetPlayer < 1 || targetPlayer > 2) {
      console.error(`[runBotTurn] Invalid targetPlayer: ${targetPlayer}`);
      return;
    }

    if (autoSkipBotTurns) {
      setTimeout(() => GP.endTurn(), 100);
      return;
    }

    // Watchdog: if the bot has been "thinking" too long without acting, force end turn
    if (!botTurnStartTime || Date.now() - botTurnStartTime > BOT_WATCHDOG_MS) {
      botTurnStartTime = Date.now();
    }
    if (botWatchdogTimer) clearTimeout(botWatchdogTimer);
    botWatchdogTimer = setTimeout(() => {
      if (!gameState.gameOver && gameState.activePlayer === targetPlayer) {
        console.warn(`[BOT] Watchdog: forced end turn after ${BOT_WATCHDOG_MS}ms`);
        gameState.botReevalAttempts = {};
        gameState.botDiscardCount = {};
        GP.endTurn();
      }
      botWatchdogTimer = null;
      botTurnStartTime = 0;
    }, BOT_WATCHDOG_MS);
    
    const bot = gameState.players[targetPlayer - 1];
    if (!bot || !bot.hand) {
      console.error(`[runBotTurn] Bot player ${targetPlayer} not found or invalid`);
      return;
    }
    
    const playerName = bot.name || `Player ${targetPlayer}`;
    GP.toast(`${playerName} (Bot) thinking…`, 'info');

    const DIFF = {
      easy:   { baseDelay: 250, delayJitter: 150, maxReevals: 1, missChance: 0.25, maxDiscardsPerTurn: 0, drawAggression: 0.3 },
      medium: { baseDelay: 120, delayJitter: 60,  maxReevals: 2, missChance: 0,    maxDiscardsPerTurn: 1, drawAggression: 0.6 },
      hard:   { baseDelay: 60,  delayJitter: 30,  maxReevals: 3, missChance: 0,    maxDiscardsPerTurn: 2, drawAggression: 0.9 },
    }[BOT_DIFFICULTY] || { baseDelay: 120, delayJitter: 60, maxReevals: 2, missChance: 0, maxDiscardsPerTurn: 1, drawAggression: 0.6 };

    const baseDelay = DIFF.baseDelay + Math.random() * DIFF.delayJitter;
    const delay = Math.max(10, baseDelay / gameSpeedMultiplier);
    
    setTimeout(() => {
      // Re-validate after delay
      if (gameState.gameOver || gameState.activePlayer !== targetPlayer) return;
      const bot = gameState.players[targetPlayer - 1];
      if (!bot || !bot.hand) return;
      
      const target = gameState.target;
      const botName = bot.name || `Player ${targetPlayer}`;
      const currentHand = bot.hand; // Always fresh reference
      const handLimit = gameRules.handLimit || 12;
      const maxDraw = gameRules.maxDrawPerTurn || 3;
      
      // Pre-compute target size and time pressure (used multiple times)
      const targetSize = target <= 20 ? 'small' : (target <= 50 ? 'medium' : 'large');
      const diffMaxBonus = BOT_DIFFICULTY === 'hard' ? 2 : (BOT_DIFFICULTY === 'easy' ? -2 : 0);
      const maxLength = Math.max(3, (targetSize === 'small' ? 5 : (targetSize === 'medium' ? 7 : 9)) + diffMaxBonus);
      const timePressure = gameState.turnTimer < 10;
      const veryLowTime = gameState.turnTimer < 5;
      
      // Initialize tracking
      if (!gameState.botReevalAttempts) gameState.botReevalAttempts = {};
      if (!gameState.botReevalAttempts[targetPlayer]) gameState.botReevalAttempts[targetPlayer] = 0;
      if (!gameState.botDiscardCount) gameState.botDiscardCount = {};
      if (!gameState.botDiscardCount[targetPlayer]) gameState.botDiscardCount[targetPlayer] = 0;
      
      const maxReevalAttempts = DIFF.maxReevals;
      const maxDiscardsPerTurn = DIFF.maxDiscardsPerTurn;
      
      // Helper function to get speed-adjusted delay
      const getDelay = (baseDelay) => Math.max(10, baseDelay / gameSpeedMultiplier);
      
      // Helper: Check if scoring is allowed (respects minimum expression length)
      const canScore = (playfieldLength) => {
        if (botMinExpressionLength <= 0) return true; // No minimum requirement
        return playfieldLength >= botMinExpressionLength;
      };
      
      GP.dbg(`[BOT ${botName}] === TURN === Target: ${target}, Hand: ${currentHand.length}/${handLimit}, Playfield: ${gameState.playfield.length}, Timer: ${Math.ceil(gameState.turnTimer)}s`);
      
      // Safety: Force end turn if too many attempts
      if (gameState.botReevalAttempts[targetPlayer] >= maxReevalAttempts) {
        GP.dbg(`[BOT ${botName}] SAFETY: Max attempts (${maxReevalAttempts}), ending turn`);
        setTimeout(() => {
          if (!gameState.gameOver && gameState.activePlayer === targetPlayer) {
            gameState.botReevalAttempts[targetPlayer] = 0;
            gameState.botDiscardCount[targetPlayer] = 0;
            GP.endTurn();
          }
        }, getDelay(50));
        return;
      }
      
      // Additional safety: If hand is empty and no cards available, end turn immediately
      if (currentHand.length === 0 && gameState.deck.length === 0 && gameState.discardPile.length === 0) {
        GP.dbg(`[BOT ${botName}] SAFETY: No cards available, ending turn`);
        setTimeout(() => {
          if (!gameState.gameOver && gameState.activePlayer === targetPlayer) {
            gameState.botReevalAttempts[targetPlayer] = 0;
            gameState.botDiscardCount[targetPlayer] = 0;
            GP.endTurn();
          }
        }, getDelay(50));
        return;
      }
      
      // Safety: Always ensure bot ends turn - if nothing actionable, end immediately
      const hasActionableCards = currentHand.length > 0;
      const canDraw = gameState.drawsThisTurn < maxDraw && (gameState.deck.length > 0 || gameState.discardPile.length > 0);
      const hasPlayfield = gameState.playfield.length > 0;
      
      if (!hasActionableCards && !canDraw && !hasPlayfield) {
        GP.dbg(`[BOT ${botName}] SAFETY: Nothing to do (no cards, can't draw, no playfield), ending turn`);
        setTimeout(() => {
          if (!gameState.gameOver && gameState.activePlayer === targetPlayer) {
            gameState.botReevalAttempts[targetPlayer] = 0;
            gameState.botDiscardCount[targetPlayer] = 0;
            GP.endTurn();
          }
        }, getDelay(50));
        return;
      }
      
      // ========== PHASE 0: SPECIAL CARD USAGE ==========
      // Bot uses special cards strategically
      const specialCards = currentHand.filter(c => c.type === CardType.Special);
      if (specialCards.length > 0 && gameState.playfield.length === 0) {
        // Use Double card if target is easy to reach and no double already active
        const doubleCard = specialCards.find(c => c.specialKind === SpecialKind.Double);
        if (doubleCard && !gameState.doubleNext[targetPlayer]) {
          // Check if we can likely score this turn (have a number matching target, or small target)
          const hasExactMatch = currentHand.some(c => c.type === CardType.Number && valueMatchesTarget(c.value, target));
          if (hasExactMatch || (BOT_DIFFICULTY === 'hard' && target <= 20)) {
            GP.dbg(`[BOT ${botName}] PHASE 0: Using Double card before scoring`);
            const idx = currentHand.indexOf(doubleCard);
            setTimeout(() => {
              if (gameState.gameOver || gameState.activePlayer !== targetPlayer) return;
              GP.useSpecialCard(targetPlayer, idx, doubleCard, 'double');
              setTimeout(() => runBotTurn(targetPlayer), getDelay(delay));
            }, getDelay(delay));
            return;
          }
        }

        // Use Reroll if target is very high and we have mostly small numbers
        const rerollCard = specialCards.find(c => c.specialKind === SpecialKind.Reroll);
        if (rerollCard && target > 50) {
          const numbers = currentHand.filter(c => c.type === CardType.Number);
          const maxNum = numbers.reduce((max, c) => Math.max(max, c.value || 0), 0);
          if (maxNum <= 5) {
            GP.dbg(`[BOT ${botName}] PHASE 0: Rerolling target (${target} too high, max number ${maxNum})`);
            const idx = currentHand.indexOf(rerollCard);
            setTimeout(() => {
              if (gameState.gameOver || gameState.activePlayer !== targetPlayer) return;
              GP.useSpecialCard(targetPlayer, idx, rerollCard, 'reroll');
              setTimeout(() => runBotTurn(targetPlayer), getDelay(delay));
            }, getDelay(delay));
            return;
          }
        }

        // Use Swap if we have bad cards and difficulty is medium+
        const swapCard = specialCards.find(c => c.specialKind === SpecialKind.Swap);
        if (swapCard && BOT_DIFFICULTY !== 'easy') {
          const numbers = currentHand.filter(c => c.type === CardType.Number);
          const operators = currentHand.filter(c => c.type === CardType.Operator);
          // Use swap if severely imbalanced hand (no operators or all operators)
          if (numbers.length > 0 && operators.length === 0 && currentHand.length >= 4) {
            GP.dbg(`[BOT ${botName}] PHASE 0: Using Swap (no operators in hand)`);
            const idx = currentHand.indexOf(swapCard);
            setTimeout(() => {
              if (gameState.gameOver || gameState.activePlayer !== targetPlayer) return;
              GP.useSpecialCard(targetPlayer, idx, swapCard, 'swap');
              setTimeout(() => runBotTurn(targetPlayer), getDelay(delay));
            }, getDelay(delay));
            return;
          }
        }

        // Use Peek on hard difficulty when opponent is close to winning
        const peekCard = specialCards.find(c => c.specialKind === SpecialKind.Peek);
        if (peekCard && BOT_DIFFICULTY === 'hard') {
          const oppId = targetPlayer === 1 ? 2 : 1;
          const oppScore = gameState.players[oppId - 1].score || 0;
          const winPts = gameRules.winPoints || 5;
          if (oppScore >= winPts - 2) {
            GP.dbg(`[BOT ${botName}] PHASE 0: Using Peek (opponent at ${oppScore}/${winPts})`);
            const idx = currentHand.indexOf(peekCard);
            setTimeout(() => {
              if (gameState.gameOver || gameState.activePlayer !== targetPlayer) return;
              GP.useSpecialCard(targetPlayer, idx, peekCard, 'peek');
              setTimeout(() => runBotTurn(targetPlayer), getDelay(delay));
            }, getDelay(delay));
            return;
          }
        }
      }

      // ========== PHASE 1: IMMEDIATE SCORE CHECK ==========
      if (gameState.playfield.length > 0) {
        const currentResult = GP.evaluateExpression();
        if (currentResult.ok && valueMatchesTarget(currentResult.value, target)) {
          if (canScore(gameState.playfield.length)) {
            GP.dbg(`[BOT ${botName}] PHASE 1: SCORING! Expression = ${target} (length: ${gameState.playfield.length})`);
            GP.tryScore();
            return;
          } else {
            GP.dbg(`[BOT ${botName}] PHASE 1: Can score but too short (${gameState.playfield.length} < ${botMinExpressionLength}), extending...`);
            // Continue to extend expression instead of scoring
          }
        }
      }
      
      // ========== PHASE 2: SINGLE CARD SCORE ==========
      // Easy bot randomly misses single-card plays
      if (DIFF.missChance > 0 && Math.random() < DIFF.missChance && gameState.playfield.length === 0) {
        GP.dbg(`[BOT ${botName}] EASY: Missed single-card opportunity (${(DIFF.missChance * 100).toFixed(0)}% miss)`);
        // Skip phase 2, fall through to phase 3 (builds worse expressions)
      } else if (gameState.playfield.length === 0 && target <= 20) {
        for (let i = 0; i < currentHand.length; i++) {
          const card = currentHand[i];
          if (card.type === CardType.Number && valueMatchesTarget(card.value, target)) {
            // Validate card still exists before placing
            const freshHand = gameState.players[targetPlayer - 1].hand;
            if (i >= freshHand.length || freshHand[i] !== card) {
              // Card index changed - find card by value instead
              const actualIdx = freshHand.findIndex(c => 
                c.type === CardType.Number && c.value === card.value
              );
              if (actualIdx === -1) {
                // Card was removed, continue searching
                continue;
              }
              i = actualIdx;
              card = freshHand[actualIdx];
            }
            
            GP.dbg(`[BOT ${botName}] PHASE 2: Single card ${card.value} matches!`);
            gameState.selectedCard = { playerId: targetPlayer, index: i, card: card };
            GP.placeCardOnPlayfield(true);
            GP.writeGameState();
            setTimeout(() => {
              if (!gameState.gameOver && gameState.activePlayer === targetPlayer) {
                const verifyResult = GP.evaluateExpression();
                if (verifyResult.ok && valueMatchesTarget(verifyResult.value, target) && canScore(gameState.playfield.length)) {
                  GP.tryScore();
                } else if (verifyResult.ok && valueMatchesTarget(verifyResult.value, target) && !canScore(gameState.playfield.length)) {
                  GP.dbg(`[BOT ${botName}] PHASE 2: Can score but too short (${gameState.playfield.length} < ${botMinExpressionLength}), extending...`);
                  runBotTurn(targetPlayer);
                } else {
                  runBotTurn(targetPlayer);
                }
              }
            }, getDelay(80));
            return;
          }
        }
      }
      
      // ========== PHASE 3: BUILD/EXTEND EXPRESSION ==========
      // 3A: If playfield exists, try to extend or score
      if (gameState.playfield.length > 0) {
        const currentResult = GP.evaluateExpression();
        if (!currentResult.ok) {
          // Invalid expression - clear and start over
          GP.dbg(`[BOT ${botName}] PHASE 3A: Invalid expression, clearing`);
          GP.clearPlayfieldOnly();
          // Fall through to 3B
        } else {
          const currentValue = currentResult.value;
          const currentDiff = Math.abs(currentValue - target);
          
          // Check if we can score by adding one card
          // Optimize: only test cards that could potentially score
          // For numbers: only test if (currentValue + num) or (currentValue - num) or (currentValue * num) or (currentValue / num) could equal target
          // For operators: test all (we need to know the next number)
          let scoringCardFound = false;
          for (let i = 0; i < currentHand.length; i++) {
            const card = currentHand[i];
            
            // Quick pre-check: can this card type help us score?
            if (card.type === CardType.Number) {
              // Quick test: can any operation with this number reach target?
              const canReachWithAdd = (currentValue + card.value) === target;
              const canReachWithSub = (currentValue - card.value) === target;
              const canReachWithMul = (currentValue * card.value) === target;
              const canReachWithDiv = card.value !== 0 && (Math.floor(currentValue / card.value) === target);
              
              // But we need an operator first, so skip if playfield ends with number
              const lastCard = gameState.playfield[gameState.playfield.length - 1];
              if (lastCard.type === CardType.Number) {
                // Need operator first, skip this number
                continue;
              }
              
              // If playfield ends with operator, test this number
              if (lastCard.type === CardType.Operator) {
                const testPlayfield = [...gameState.playfield, card];
                const oldPlayfield = gameState.playfield;
                gameState.playfield = testPlayfield;
                const testResult = GP.evaluateExpression();
                gameState.playfield = oldPlayfield;
                
                if (testResult.ok && valueMatchesTarget(testResult.value, target) && canScore(testPlayfield.length)) {
                  // Found scoring number - handle it below
                  scoringCardFound = true;
                } else if (testResult.ok && valueMatchesTarget(testResult.value, target) && !canScore(testPlayfield.length)) {
                  // Can score but too short - continue searching for longer expression
                  continue;
                } else {
                  continue; // This number doesn't score, try next
                }
              } else {
                continue; // Unexpected playfield state
              }
            } else {
              // Operator: if playfield ends with number, test operator + a number combo
              const lastCard = gameState.playfield[gameState.playfield.length - 1];
              if (lastCard.type === CardType.Number) {
                // Need to test operator + number combinations
                const remainingNums = currentHand.filter((c, idx) => idx !== i && c.type === CardType.Number);
                
                for (const num of remainingNums.slice(0, 3)) { // Test first 3 numbers
                  // VALIDATION: Check for division by zero
                  if (card.operatorKind === OperatorKind.Div && num.value === 0) continue;
                  
                  const testPlayfield = [...gameState.playfield, card, num];
                  const oldPlayfield = gameState.playfield;
                  gameState.playfield = testPlayfield;
                  const testResult = GP.evaluateExpression();
                  gameState.playfield = oldPlayfield;
                  
                  // Only consider valid expressions that score
                  if (testResult.ok && valueMatchesTarget(testResult.value, target) && canScore(testPlayfield.length)) {
                    // Found scoring combo: operator + number
                    // Place operator first, then number
                    const freshHand = gameState.players[targetPlayer - 1].hand;
                    const opIdx = freshHand.findIndex(c => 
                      c.type === CardType.Operator && c.operatorKind === card.operatorKind
                    );
                    if (opIdx === -1) continue;
                    
                    gameState.selectedCard = { playerId: targetPlayer, index: opIdx, card: freshHand[opIdx] };
                    GP.placeCardOnPlayfield(true);
                    GP.writeGameState();
                    setTimeout(() => {
                      if (!gameState.gameOver && gameState.activePlayer === targetPlayer) {
                        const finalHand = gameState.players[targetPlayer - 1].hand;
                        const finalNumIdx = finalHand.findIndex(c => 
                          c.type === CardType.Number && c.value === num.value
                        );
                        if (finalNumIdx !== -1) {
                          gameState.selectedCard = { playerId: targetPlayer, index: finalNumIdx, card: finalHand[finalNumIdx] };
                          GP.placeCardOnPlayfield(true);
                          GP.writeGameState();
                          setTimeout(() => {
                            if (!gameState.gameOver && gameState.activePlayer === targetPlayer) {
                              const verifyResult = GP.evaluateExpression();
                              if (verifyResult.ok && valueMatchesTarget(verifyResult.value, target) && canScore(gameState.playfield.length)) {
                                GP.tryScore();
                              } else if (verifyResult.ok && valueMatchesTarget(verifyResult.value, target) && !canScore(gameState.playfield.length)) {
                                GP.dbg(`[BOT ${botName}] PHASE 3: Can score but too short (${gameState.playfield.length} < ${botMinExpressionLength}), extending...`);
                                runBotTurn(targetPlayer);
                              } else {
                                runBotTurn(targetPlayer);
                              }
                            }
                          }, getDelay(80));
                        } else {
                          runBotTurn(targetPlayer);
                        }
                      }
                    }, getDelay(80));
                    return;
                  }
                }
                continue; // No scoring combo found with this operator
              }
            }
            
            // Standard test: add card and check (for operators when playfield ends with operator)
            // VALIDATION: Check expression structure before testing
            const lastCardForTest = gameState.playfield[gameState.playfield.length - 1];
            const testCard = currentHand[i];
            if (lastCardForTest.type === CardType.Number && testCard.type !== CardType.Operator) {
              continue; // Can't place non-operator after number
            }
            if (lastCardForTest.type === CardType.Operator && testCard.type !== CardType.Number) {
              continue; // Can't place non-number after operator
            }
            // VALIDATION: Check for division by zero
            if (testCard.type === CardType.Number && lastCardForTest.type === CardType.Operator && 
                lastCardForTest.operatorKind === OperatorKind.Div && testCard.value === 0) {
              continue; // Skip division by zero
            }
            
            const testPlayfield = [...gameState.playfield, testCard];
            const oldPlayfield = gameState.playfield;
            gameState.playfield = testPlayfield;
            const testResult = GP.evaluateExpression();
            gameState.playfield = oldPlayfield;
            
            // Only consider valid expressions that score
            if (testResult.ok && valueMatchesTarget(testResult.value, target) && canScore(testPlayfield.length)) {
              scoringCardFound = true;
              // Validate card still exists before placing
              const freshHand = gameState.players[targetPlayer - 1].hand;
              if (i >= freshHand.length || freshHand[i] !== currentHand[i]) {
                // Card index changed - find card by value/type instead
                const cardToFind = currentHand[i];
                const actualIdx = freshHand.findIndex(c => 
                  c.type === cardToFind.type && 
                  (c.type === CardType.Number ? c.value === cardToFind.value : c.operatorKind === cardToFind.operatorKind)
                );
                if (actualIdx === -1) {
                  // Card was removed, continue searching
                  continue;
                }
                i = actualIdx;
                currentHand[i] = freshHand[actualIdx];
              }
              
              GP.dbg(`[BOT ${botName}] PHASE 3A: Found scoring card!`);
              gameState.selectedCard = { playerId: targetPlayer, index: i, card: currentHand[i] };
              GP.placeCardOnPlayfield(true);
              GP.writeGameState();
                  setTimeout(() => {
                    if (!gameState.gameOver && gameState.activePlayer === targetPlayer) {
                      const verifyResult = GP.evaluateExpression();
                      if (verifyResult.ok && valueMatchesTarget(verifyResult.value, target) && canScore(gameState.playfield.length)) {
                        GP.tryScore();
                      } else if (verifyResult.ok && valueMatchesTarget(verifyResult.value, target) && !canScore(gameState.playfield.length)) {
                        GP.dbg(`[BOT ${botName}] PHASE 3A: Can score but too short (${gameState.playfield.length} < ${botMinExpressionLength}), extending...`);
                        runBotTurn(targetPlayer);
                      } else {
                        runBotTurn(targetPlayer);
                      }
                    }
                  }, getDelay(80));
              return;
            }
          }
          
          // Early exit: if we found a scoring card above, we already returned
          // This check prevents unnecessary extension attempts when we could score
          if (scoringCardFound) {
            return; // Already handled scoring above
          }
          
          // Can't score with one card - decide if we should extend
          // If minimum length is set, ensure we can reach it
          const effectiveMaxLength = botMinExpressionLength > 0 ? Math.max(maxLength, botMinExpressionLength + 2) : maxLength;
          const canExtend = gameState.playfield.length < effectiveMaxLength;
          // Force extension if we haven't reached minimum length yet
          const mustExtendForMinLength = botMinExpressionLength > 0 && gameState.playfield.length < botMinExpressionLength;
          
          const isClose = currentDiff <= 10;
          const isModerate = currentDiff > 10 && currentDiff <= 20;
          const isFar = currentDiff > 20;
          const isImpossible = currentDiff > (targetSize === 'large' ? 80 : 50);
          
          // Improved extension logic - MORE AGGRESSIVE for longer expressions:
          // For larger targets, we MUST build longer expressions (5-9 cards)
          // 1. Very close (≤5): Always extend if can
          // 2. Close (5-10): Always extend if under maxLength
          // 3. Moderate (10-20): Extend if under maxLength-1 OR (large target and under maxLength)
          // 4. Far (>20): Extend if (large target and under maxLength-1) OR (medium target and under maxLength-2)
          // 5. Very low time: Always try to extend
          // 6. For large targets: Always extend if under maxLength (we NEED longer expressions)
          const isVeryClose = currentDiff <= 5;
          // isVeryLargeTarget already computed at function start
          
          // More aggressive: For large targets, we MUST build longer expressions
          // CRITICAL: If minimum length is set, we MUST extend until we reach it
          const shouldExtend = canExtend && !isImpossible && (
            mustExtendForMinLength || // FORCE extension if minimum length not met
            isVeryClose || // Very close: always try
            (isClose && gameState.playfield.length < maxLength) || // Close: always extend if can
            (isModerate && (gameState.playfield.length < maxLength - 1 || (targetSize === 'large' && gameState.playfield.length < maxLength))) || // Moderate: extend more aggressively
            (isFar && (targetSize === 'large' && gameState.playfield.length < maxLength - 1) || (targetSize === 'medium' && gameState.playfield.length < maxLength - 2)) || // Far: extend for large/medium targets
            (targetSize === 'large' && gameState.playfield.length < maxLength) || // Large targets: always extend if under max
            (isVeryLargeTarget && gameState.playfield.length < 7) || // Very large targets: extend up to 7+ cards
            veryLowTime // Very low time: always try
          );
          
          if (shouldExtend) {
            // Try to find best card to extend
            // Optimize: skip cards that would create invalid expressions
            let bestCard = null;
            let bestIdx = -1;
            let bestNewDiff = currentDiff; // Start with current diff (no improvement)
            let bestImprovement = 0;
            let bestScore = -999; // Track best overall score
            
            // Pre-check: what type of card do we need next?
            const lastCard = gameState.playfield[gameState.playfield.length - 1];
            const needsNumber = lastCard.type === CardType.Operator;
            const needsOperator = lastCard.type === CardType.Number;
            
            // Optimize: Sort cards by priority before testing (test most promising first)
            // This allows early exit if we find a very good card
            const isVeryLargeTarget = target >= 80;
            const cardsToTest = currentHand
              .map((card, idx) => ({ card, idx }))
              .filter(({ card }) => {
                // Quick validation: skip if card type doesn't match what we need
                if (needsNumber && card.type !== CardType.Number) return false;
                if (needsOperator && card.type !== CardType.Operator) return false;
                return true;
              })
              .sort((a, b) => {
                // Sort by priority: multiplication operators first for large targets, then numbers close to target
                if (targetSize === 'large' || isVeryLargeTarget) {
                  if (a.card.type === CardType.Operator && a.card.operatorKind === OperatorKind.Mul) return -1;
                  if (b.card.type === CardType.Operator && b.card.operatorKind === OperatorKind.Mul) return 1;
                  if (a.card.type === CardType.Number && a.card.value >= 5 && b.card.type === CardType.Number && b.card.value < 5) return -1;
                  if (b.card.type === CardType.Number && b.card.value >= 5 && a.card.type === CardType.Number && a.card.value < 5) return 1;
                }
                // For small/medium targets, prefer numbers close to target
                if (a.card.type === CardType.Number && b.card.type === CardType.Number) {
                  return Math.abs(a.card.value - target) - Math.abs(b.card.value - target);
                }
                return 0;
              });
            
            for (const { card, idx: originalIdx } of cardsToTest) {
              // VALIDATION: Check if adding this card would create a valid expression structure
              const lastCard = gameState.playfield[gameState.playfield.length - 1];
              if (lastCard.type === CardType.Number && card.type !== CardType.Operator) {
                // Can't place number after number
                continue;
              }
              if (lastCard.type === CardType.Operator && card.type !== CardType.Number) {
                // Can't place operator after operator
                continue;
              }
              
              // Additional validation: check for division by zero
              if (card.type === CardType.Number && lastCard.type === CardType.Operator && 
                  lastCard.operatorKind === OperatorKind.Div && card.value === 0) {
                continue; // Skip division by zero
              }
              
              const testPlayfield = [...gameState.playfield, card];
              const oldPlayfield = gameState.playfield;
              gameState.playfield = testPlayfield;
              const testResult = GP.evaluateExpression();
              gameState.playfield = oldPlayfield;
              
              // Only consider valid expressions
              if (!testResult.ok) {
                continue; // Skip invalid expressions
              }
              
              if (testResult.ok) {
                const newDiff = Math.abs(testResult.value - target);
                const improvement = currentDiff - newDiff;
                
                // Priority scoring for card selection
                // Improved: Better handling of very large targets (80-99) and progressive difficulty
                let priority = 0;
                const isVeryLargeTarget = target >= 80;
                const scoreDifference = gameState.players[0].score - gameState.players[1].score;
                const isBehind = (targetPlayer === 1 && scoreDifference < 0) || (targetPlayer === 2 && scoreDifference > 0);
                const isAhead = (targetPlayer === 1 && scoreDifference > 2) || (targetPlayer === 2 && scoreDifference < -2);
                
                if (targetSize === 'large' || isVeryLargeTarget) {
                  // Large/very large targets: prioritize multiplication chains
                  if (card.type === CardType.Operator && card.operatorKind === OperatorKind.Mul) {
                    priority = isVeryLargeTarget ? 50 : 30; // Even higher priority for very large targets
                    // Bonus if behind in score
                    if (isBehind) priority += 10;
                  } else if (card.type === CardType.Operator && card.operatorKind === OperatorKind.Add) {
                    priority = 15; // Medium priority for addition (to finish multiplication chains)
                    // For very large targets, addition is less useful unless we're close
                    if (isVeryLargeTarget && currentDiff > 30) priority = 5;
                  }
                  // For numbers in large targets, prefer larger numbers (better for multiplication)
                  if (card.type === CardType.Number) {
                    if (card.value >= 5) {
                      priority = 10 + (card.value >= 7 ? 5 : 0); // Bonus for very large numbers
                      // For very large targets, prefer numbers that can create good multiplication chains
                      if (isVeryLargeTarget) {
                        // Check if this number can multiply with other numbers to get close
                        const otherNums = currentHand.filter((c, idx) => idx !== originalIdx && c.type === CardType.Number && c.value >= 3);
                        const canCreateGoodChain = otherNums.some(n => {
                          const product = card.value * n.value;
                          return product >= target * 0.4 && product <= target * 1.2;
                        });
                        if (canCreateGoodChain) priority += 15;
                      }
                    } else if (card.value < 3) {
                      priority = -10; // Small numbers less useful for large targets
                    }
                  }
                } else {
                  // Small/medium targets: all operators similar, prefer numbers close to target
                  if (card.type === CardType.Number) {
                    priority = 10 - Math.min(10, Math.abs(card.value - target) / 3);
                    // If behind, be more aggressive
                    if (isBehind) priority += 5;
                  }
                }
                
                // Score = improvement + priority
                // For moderate/far distances, require significant improvement
                // Time pressure: lower thresholds to be more aggressive
                // For large targets: be more lenient (we need to build longer expressions)
                const veryLowTime = gameState.turnTimer < 5;
                // More lenient thresholds for large targets (need to build longer expressions)
                const minImprovement = veryLowTime ? 0 : 
                  (targetSize === 'large' ? (isClose ? 0 : (isModerate ? 2 : (timePressure ? 1 : 5))) : // Large: more lenient
                  (isClose ? 1 : (isModerate ? 5 : (timePressure ? 3 : 10)))); // Small/medium: original thresholds
                
                const score = improvement * 10 + priority;
                const currentBestScore = bestImprovement * 10 + (bestCard ? (targetSize === 'large' && bestCard.type === CardType.Operator && bestCard.operatorKind === OperatorKind.Mul ? 30 : 0) : 0);
                
                // Check if this creates a good intermediate value (for building toward target)
                const createsGoodIntermediate = targetSize === 'large' && 
                  testResult.value >= target * 0.3 && testResult.value <= target * 1.5 &&
                  gameState.playfield.length < maxLength - 1;
                
                // Improved selection: accept if:
                // 1. Better diff AND meets improvement threshold, OR
                // 2. Same diff but better score, OR
                // 3. Slightly worse diff (≤2) but high priority (multiplication for large targets), OR
                // 4. Very low time: accept any improvement, OR
                // 5. Large target: accept if creates good intermediate value (building toward goal)
                if ((newDiff < bestNewDiff && (improvement >= minImprovement || veryLowTime)) || 
                    (newDiff === bestNewDiff && score > currentBestScore) ||
                    (newDiff <= bestNewDiff + 2 && priority >= 25) || // Allow slight diff increase if high priority
                    (veryLowTime && newDiff <= bestNewDiff + 5 && improvement > 0) || // Very low time: accept small improvements
                    (createsGoodIntermediate && newDiff <= currentDiff + 5 && priority >= 20)) { // Good intermediate for large targets
                  bestNewDiff = newDiff;
                  bestImprovement = improvement;
                  bestScore = score; // Update best score
                  bestCard = card; // Use the card object, not currentHand[i]
                  bestIdx = originalIdx; // Use the original index from the hand
                }
              }
            }
            
            // Only extend if we found a good improvement
            // More lenient for large targets (need to build longer expressions)
            const createsGoodIntermediate = targetSize === 'large' && bestCard && 
              gameState.playfield.length < maxLength - 1;
            
            // More lenient acceptance for large targets - we need to build longer expressions
            const hasGoodImprovement = bestCard && bestIdx !== -1 && (
              bestNewDiff < currentDiff || // Improved
              (bestNewDiff <= currentDiff + 2 && targetSize === 'large' && bestCard.type === CardType.Operator && bestCard.operatorKind === OperatorKind.Mul) || // Multiplication for large targets
              (bestNewDiff <= currentDiff + 3 && targetSize === 'large' && createsGoodIntermediate) || // Good intermediate for large targets
              (bestNewDiff === currentDiff && targetSize === 'large' && gameState.playfield.length < 5) || // Same diff but building longer expression for large target
              (bestNewDiff <= currentDiff + 1 && targetSize === 'large' && gameState.playfield.length < 4) || // Slight increase but early in expression for large target
              (veryLowTime && bestNewDiff <= currentDiff + 3) // Very low time: accept any reasonable extension
            );
            
            if (hasGoodImprovement) {
              // Validate card still exists at index before placing
              const freshHand = gameState.players[targetPlayer - 1].hand;
              if (bestIdx >= freshHand.length || freshHand[bestIdx] !== bestCard) {
                // Card index changed - find card by value/type instead
                const actualIdx = freshHand.findIndex(c => 
                  c.type === bestCard.type && 
                  (c.type === CardType.Number ? c.value === bestCard.value : c.operatorKind === bestCard.operatorKind)
                );
                if (actualIdx === -1) {
                  GP.dbg(`[BOT ${botName}] PHASE 3A: Card no longer available, skipping extension`);
                  // Card was removed, end turn
                  setTimeout(() => {
                    if (!gameState.gameOver && gameState.activePlayer === targetPlayer) {
                      gameState.botReevalAttempts[targetPlayer] = 0;
                      GP.endTurn();
                    }
                  }, getDelay(80));
                  return;
                }
                bestIdx = actualIdx;
                bestCard = freshHand[actualIdx];
              }
              
              GP.dbg(`[BOT ${botName}] PHASE 3A: Extending (diff: ${currentDiff}→${bestNewDiff}, improvement: ${bestImprovement})`);
              gameState.selectedCard = { playerId: targetPlayer, index: bestIdx, card: bestCard };
              GP.placeCardOnPlayfield(true);
              GP.writeGameState();
              gameState.botReevalAttempts[targetPlayer]++;
              setTimeout(() => {
                if (!gameState.gameOver && gameState.activePlayer === targetPlayer) {
                  runBotTurn(targetPlayer);
                }
              }, getDelay(80));
              return;
            }
          }
          
          // Can't extend or improve - but check if expression is close enough to keep
          // Improved: Smarter clearing logic based on target size, time, and score
          const scoreDifference = gameState.players[0].score - gameState.players[1].score;
          const isBehind = (targetPlayer === 1 && scoreDifference < 0) || (targetPlayer === 2 && scoreDifference > 0);
          const isVeryLargeTarget = target >= 80;
          
          // Clear threshold varies by target size and situation
          let clearThreshold = targetSize === 'large' ? 50 : (targetSize === 'medium' ? 40 : 30);
          if (isVeryLargeTarget) clearThreshold = 60; // Very large targets: allow larger diff
          if (isBehind) clearThreshold -= 10; // If behind, be more aggressive (clear sooner)
          if (veryLowTime) clearThreshold -= 15; // If very low time, clear sooner to try fresh approach
          
          // CRITICAL: If minimum length is required and not met, MUST continue extending
          if (mustExtendForMinLength) {
            GP.dbg(`[BOT ${botName}] PHASE 3A: Must extend to reach minimum length (${gameState.playfield.length} < ${botMinExpressionLength}), continuing...`);
            // Even if no good card found, retry to force extension
            gameState.botReevalAttempts[targetPlayer]++;
            if (gameState.botReevalAttempts[targetPlayer] < maxReevalAttempts * 2) { // Allow more attempts when forcing minimum length
              setTimeout(() => {
                if (!gameState.gameOver && gameState.activePlayer === targetPlayer) {
                  runBotTurn(targetPlayer);
                }
              }, getDelay(80));
              return;
            } else {
              GP.dbg(`[BOT ${botName}] PHASE 3A: Too many attempts forcing minimum length, ending turn (safety)`);
            }
          }
          
          // More aggressive: Don't end turn if we can still extend and target is large
          // isVeryLargeTarget already declared above (line 1656)
          if (currentDiff <= 5 && gameState.playfield.length >= 3 && gameState.turnTimer > 5 && !canExtend) {
            // Very close but can't extend - keep expression, end turn
            GP.dbg(`[BOT ${botName}] PHASE 3A: Very close (diff: ${currentDiff}), keeping expression, ending turn`);
          } else if (currentDiff > clearThreshold && gameState.playfield.length >= 3 && !canExtend) {
            // Too far and can't extend - clear and try fresh approach
            GP.dbg(`[BOT ${botName}] PHASE 3A: Too far (diff: ${currentDiff} > threshold ${clearThreshold}), clearing expression`);
            GP.clearPlayfieldOnly();
            // Fall through to try building fresh
          } else if (currentDiff > 20 && gameState.playfield.length >= 7 && !canExtend) {
            // Expression is very long and can't extend - clear if moderately far
            GP.dbg(`[BOT ${botName}] PHASE 3A: Very long expression (${gameState.playfield.length} cards) can't extend, clearing (diff: ${currentDiff})`);
            GP.clearPlayfieldOnly();
          } else if (canExtend && (targetSize === 'large' || isVeryLargeTarget)) {
            // Can extend and target is large - check if we have useful cards before retrying
            const lastCard = gameState.playfield[gameState.playfield.length - 1];
            const needsNumber = lastCard.type === CardType.Operator;
            const needsOperator = lastCard.type === CardType.Number;
            const hasUsefulCards = currentHand.some(card => {
              if (needsNumber && card.type === CardType.Number) return true;
              if (needsOperator && card.type === CardType.Operator) return true;
              return false;
            });
            
            if (hasUsefulCards) {
              GP.dbg(`[BOT ${botName}] PHASE 3A: Can extend (${gameState.playfield.length} < ${maxLength}), continuing for large target (diff: ${currentDiff})`);
              // Don't end turn - let it fall through to extension logic or retry
              setTimeout(() => {
                if (!gameState.gameOver && gameState.activePlayer === targetPlayer) {
                  runBotTurn(targetPlayer);
                }
              }, getDelay(80));
              return;
            } else {
              // Can extend but no useful cards - end turn
              GP.dbg(`[BOT ${botName}] PHASE 3A: Can extend but no useful cards available, ending turn (diff: ${currentDiff})`);
            }
          } else if (!canExtend) {
            // Can't extend - end turn
            GP.dbg(`[BOT ${botName}] PHASE 3A: Can't extend (${gameState.playfield.length} >= ${effectiveMaxLength}), ending turn (diff: ${currentDiff})`);
          } else {
            // Can extend but didn't find good card — increment attempts and retry or give up
            gameState.botReevalAttempts[targetPlayer]++;
            if ((currentDiff <= 15 || gameState.turnTimer > 10) && gameState.botReevalAttempts[targetPlayer] < maxReevalAttempts) {
              setTimeout(() => {
                if (!gameState.gameOver && gameState.activePlayer === targetPlayer) {
                  runBotTurn(targetPlayer);
                }
              }, getDelay(80));
              return;
            }
          }
          
          setTimeout(() => {
            if (!gameState.gameOver && gameState.activePlayer === targetPlayer) {
              gameState.botReevalAttempts[targetPlayer] = 0;
              GP.endTurn();
            }
          }, getDelay(80));
          return;
        }
      }
      
      // 3B: Build new expression (playfield empty or invalid)
      if (gameState.playfield.length === 0) {
        // Hard bot: use BotAIv2 planning to find optimal combo
        if (BOT_DIFFICULTY === 'hard' && typeof BotAIv2 !== 'undefined') {
          // Try 3-card combos first
          const nearOpts = { nearestScore: !!gameRules.nearestScore };
          const allPlays = BotAIv2.evaluateAllPlays(currentHand, target, [], nearOpts);
          let bestPlay = BotAIv2.findBestPlay(allPlays, target, botMinExpressionLength);
          // If no exact 3-card match, try 5-card deep lookahead
          if (!bestPlay || !bestPlay.canScore) {
            const deepPlays = BotAIv2.evaluateDeepPlays(currentHand, target, nearOpts);
            if (deepPlays.length > 0) {
              bestPlay = deepPlays[0]; // Already sorted by score
              GP.dbg(`[BOT ${botName}] HARD: Deep lookahead found 5-card combo = ${bestPlay.result}`);
            }
          }
          if (bestPlay && bestPlay.canScore && bestPlay.type === 'build' && bestPlay.cards?.length >= 3) {
            GP.dbg(`[BOT ${botName}] HARD: BotAIv2 found scoring combo = ${bestPlay.result} (${bestPlay.cards.length} cards)`);
            const placeSequentially = (cardsToPlace, idx) => {
              if (idx >= cardsToPlace.length || gameState.gameOver || gameState.activePlayer !== targetPlayer) {
                if (!gameState.gameOver && gameState.activePlayer === targetPlayer) {
                  const vr = GP.evaluateExpression();
                  if (vr.ok && valueMatchesTarget(vr.value, target) && canScore(gameState.playfield.length)) {
                    GP.tryScore();
                  } else {
                    runBotTurn(targetPlayer);
                  }
                }
                return;
              }
              const cardSpec = cardsToPlace[idx];
              const freshHand = gameState.players[targetPlayer - 1].hand;
              const fi = freshHand.findIndex(c =>
                c.type === cardSpec.type &&
                (c.type === CardType.Number ? c.value === cardSpec.value : c.operatorKind === cardSpec.operatorKind)
              );
              if (fi === -1) { runBotTurn(targetPlayer); return; }
              gameState.selectedCard = { playerId: targetPlayer, index: fi, card: freshHand[fi] };
              GP.placeCardOnPlayfield(true);
              GP.writeGameState();
              setTimeout(() => placeSequentially(cardsToPlace, idx + 1), getDelay(60));
            };
            placeSequentially(bestPlay.cards, 0);
            return;
          }
        }

        const numbers = currentHand.filter(c => c.type === CardType.Number);
        const operators = currentHand.filter(c => c.type === CardType.Operator);
        
        if (numbers.length === 0 || operators.length === 0) {
          // Can't build - skip to hand management
          GP.dbg(`[BOT ${botName}] PHASE 3B: Can't build (${numbers.length} nums, ${operators.length} ops)`);
        } else {
          // Find best starting number
          // Strategy varies by target size:
          // - Small (≤20): Prefer number closest to target (might score with single card or N/O/N)
          // - Medium (21-50): Prefer numbers that can reach target with one operation
          // - Large (>50): Prefer larger numbers (≥5) that work well in multiplication chains
          let bestNum = numbers[0];
          let bestNumIdx = currentHand.findIndex(c => c === bestNum);
          let bestNumScore = -999;
          
          for (let i = 0; i < numbers.length; i++) {
            const num = numbers[i];
            let score = 0;
            
            if (target <= 20) {
              // Small targets: prefer closest to target
              score = 100 - Math.abs(num.value - target);
            } else if (target <= 50) {
              // Medium targets: prefer numbers that can reach target with one operation
              // Check if this number can reach target with available operators
              const canReachWithAdd = num.value < target && (target - num.value) <= 20;
              const canReachWithMul = num.value > 1 && (target % num.value === 0) && (target / num.value) <= 20;
              score = canReachWithMul ? 80 : (canReachWithAdd ? 60 : (50 - Math.abs(num.value - target / 2)));
            } else {
              // Large targets: prefer larger numbers (≥5) for multiplication chains
              // Examples: 5×3+50, 8×8+1, 10×6+5
              if (num.value >= 5) {
                score = num.value * 2; // Larger numbers get higher score
                // Bonus if number is a good multiplier (3, 4, 5, 6, 7, 8, 9, 10)
                if (num.value >= 3 && num.value <= 10) score += 20;
              } else {
                score = num.value; // Smaller numbers less useful for large targets
              }
            }
            
            if (score > bestNumScore) {
              bestNumScore = score;
              bestNum = num;
              bestNumIdx = currentHand.findIndex(c => c === num);
            }
          }
          
          // Validate card still exists before placing
          const freshHandForNum = gameState.players[targetPlayer - 1].hand;
          if (bestNumIdx >= freshHandForNum.length || freshHandForNum[bestNumIdx] !== bestNum) {
            // Card index changed - find card by value instead
            const actualIdx = freshHandForNum.findIndex(c => 
              c.type === CardType.Number && c.value === bestNum.value
            );
            if (actualIdx === -1) {
              GP.dbg(`[BOT ${botName}] PHASE 3B: Starting number no longer available, skipping build`);
              // Can't build, skip to hand management
            } else {
              bestNumIdx = actualIdx;
              bestNum = freshHandForNum[actualIdx];
              GP.dbg(`[BOT ${botName}] PHASE 3B: Building new expression with ${bestNum.value}`);
              gameState.selectedCard = { playerId: targetPlayer, index: bestNumIdx, card: bestNum };
              GP.placeCardOnPlayfield(true);
              GP.writeGameState();
            }
          } else {
            // Place starting number
            GP.dbg(`[BOT ${botName}] PHASE 3B: Building new expression with ${bestNum.value}`);
            gameState.selectedCard = { playerId: targetPlayer, index: bestNumIdx, card: bestNum };
            GP.placeCardOnPlayfield(true);
            GP.writeGameState();
          }
          
          // Continue building N/O/N only if number was successfully placed
          // Check if playfield has the number (it was placed)
          const playfieldHasNumber = gameState.playfield.length > 0 && 
            gameState.playfield[0].type === CardType.Number && 
            gameState.playfield[0].value === bestNum.value;
          
          if (!playfieldHasNumber) {
            gameState.botReevalAttempts[targetPlayer]++;
            setTimeout(() => {
              if (!gameState.gameOver && gameState.activePlayer === targetPlayer) {
                runBotTurn(targetPlayer);
              }
            }, getDelay(80));
            return;
          }
          
          setTimeout(() => {
            if (gameState.gameOver || gameState.activePlayer !== targetPlayer) return;
            const remainingHand = gameState.players[targetPlayer - 1].hand;
            const remainingOps = remainingHand.filter(c => c.type === CardType.Operator);
            const remainingNums = remainingHand.filter(c => c.type === CardType.Number);
            
            if (remainingOps.length === 0 || remainingNums.length === 0) {
              gameState.botReevalAttempts[targetPlayer] = 0;
              setTimeout(() => {
                if (!gameState.gameOver && gameState.activePlayer === targetPlayer) GP.endTurn();
              }, getDelay(80));
              return;
            }
            
            // Find best operator + number combination
            // Improved: Evaluate combinations more intelligently
            // For large targets, prioritize multiplication chains (N × N patterns)
            // For small targets, prefer operations that get close to target
            // For medium targets, balance between getting close and building chains
            // (targetSize and timePressure already computed at function start)
            let bestOp = remainingOps[0];
            let bestOpIdx = remainingHand.findIndex(c => c === bestOp);
            let bestNextNum = remainingNums[0];
            let bestNextNumIdx = remainingHand.findIndex(c => c === bestNextNum);
            let bestResult = bestNum.value;
            let bestDiff = Math.abs(bestResult - target);
            let bestScore = -999;
            
            for (const op of remainingOps) {
              for (const num of remainingNums) {
                // VALIDATION: Check for division by zero and negative results
                if (op.operatorKind === OperatorKind.Div && num.value === 0) continue;
                
                let result;
                let isValidOperation = true;
                switch (op.operatorKind) {
                  case OperatorKind.Add: result = bestNum.value + num.value; break;
                  case OperatorKind.Sub: 
                    result = bestNum.value - num.value;
                    if (result < 0) isValidOperation = false; // Negative results not allowed
                    break;
                  case OperatorKind.Mul: result = bestNum.value * num.value; break;
                  case OperatorKind.Div: 
                    if (num.value === 0) {
                      isValidOperation = false;
                      result = bestNum.value; // Avoid division by zero errors
                    } else {
                      result = Math.floor(bestNum.value / num.value);
                    }
                    break;
                }
                
                // Skip invalid operations
                if (!isValidOperation || result < 0) continue;
                
                const diff = Math.abs(result - target);
                
                // Priority scoring: multiplication is crucial for large targets
                let priority = 0;
                const isVeryLargeTarget = target >= 80;
                const scoreDifference = gameState.players[0].score - gameState.players[1].score;
                const isBehind = (targetPlayer === 1 && scoreDifference < 0) || (targetPlayer === 2 && scoreDifference > 0);
                
                if (target > 50 || isVeryLargeTarget) {
                  // Large targets: heavily favor multiplication
                  if (op.operatorKind === OperatorKind.Mul) {
                    priority = isVeryLargeTarget ? 50 : 40; // Even higher for very large targets
                    // Bonus if multiplication creates a good intermediate value
                    if (result >= target * 0.5 && result <= target * 1.5) priority += 20;
                    // Extra bonus if result is close to target
                    if (result >= target * 0.8 && result <= target * 1.2) priority += 15;
                    if (isBehind) priority += 10;
                  } else if (op.operatorKind === OperatorKind.Add) {
                    priority = 15; // Addition is good for finishing multiplication chains
                    // For very large targets, addition is less useful unless we're building a chain
                    if (isVeryLargeTarget && diff > 30) priority = 5;
                  }
                  // For numbers: prefer larger numbers for multiplication chains
                  if (num.value >= 5) priority += 5;
                  if (num.value >= 7) priority += 5;
                } else if (target <= 20) {
                  // Small targets: prefer operations that get close
                  if (diff <= 5) priority = 20;
                  else if (diff <= 10) priority = 10;
                } else {
                  // Medium targets: balanced approach
                  if (op.operatorKind === OperatorKind.Mul && result >= target * 0.7 && result <= target * 1.3) {
                    priority = 25; // Multiplication that gets close
                  } else if (diff <= 10) {
                    priority = 15;
                  }
                }
                
                // Score = negative diff (closer is better) + priority
                const score = -diff + priority;
                
                if (score > bestScore) {
                  bestScore = score;
                  bestDiff = diff;
                  bestResult = result;
                  bestOp = op;
                  bestOpIdx = remainingHand.findIndex(c => c === op);
                  bestNextNum = num;
                  bestNextNumIdx = remainingHand.findIndex(c => c === num);
                }
              }
            }
            
            // Validate operator still exists before placing
            const freshHandForOp = gameState.players[targetPlayer - 1].hand;
            if (bestOpIdx >= freshHandForOp.length || freshHandForOp[bestOpIdx] !== bestOp) {
              // Operator index changed - find by operatorKind
              const actualOpIdx = freshHandForOp.findIndex(c => 
                c.type === CardType.Operator && c.operatorKind === bestOp.operatorKind
              );
              if (actualOpIdx === -1) {
                gameState.botReevalAttempts[targetPlayer] = 0;
                setTimeout(() => {
                  if (!gameState.gameOver && gameState.activePlayer === targetPlayer) GP.endTurn();
                }, getDelay(80));
                return;
              }
              bestOpIdx = actualOpIdx;
              bestOp = freshHandForOp[actualOpIdx];
            }
            
            // Place operator
            gameState.selectedCard = { playerId: targetPlayer, index: bestOpIdx, card: bestOp };
            GP.placeCardOnPlayfield(true);
            GP.writeGameState();
            
            setTimeout(() => {
              if (gameState.gameOver || gameState.activePlayer !== targetPlayer) return;
              const finalHand = gameState.players[targetPlayer - 1].hand;
              
              // Validate number still exists before placing
              let finalNumIdx = finalHand.findIndex(c => 
                c.type === CardType.Number && c.value === bestNextNum.value
              );
              
              if (finalNumIdx === -1) {
                gameState.botReevalAttempts[targetPlayer] = 0;
                setTimeout(() => {
                  if (!gameState.gameOver && gameState.activePlayer === targetPlayer) GP.endTurn();
                }, getDelay(80));
                return;
              }
              
              // Place number
              gameState.selectedCard = { playerId: targetPlayer, index: finalNumIdx, card: finalHand[finalNumIdx] };
              GP.placeCardOnPlayfield(true);
              GP.writeGameState();
              
              // Check if we can score
              setTimeout(() => {
                if (gameState.gameOver || gameState.activePlayer !== targetPlayer) return;
                const finalResult = GP.evaluateExpression();
                if (finalResult.ok && valueMatchesTarget(finalResult.value, target) && canScore(gameState.playfield.length)) {
                  GP.tryScore();
                } else if (finalResult.ok && valueMatchesTarget(finalResult.value, target) && !canScore(gameState.playfield.length)) {
                  GP.dbg(`[BOT ${botName}] PHASE 3B: Can score but too short (${gameState.playfield.length} < ${botMinExpressionLength}), extending...`);
                  gameState.botReevalAttempts[targetPlayer]++;
                  setTimeout(() => {
                    if (!gameState.gameOver && gameState.activePlayer === targetPlayer) {
                      runBotTurn(targetPlayer);
                    }
                  }, getDelay(80));
                } else {
                  // After building N/O/N, decide whether to continue or end
                  const currentValue = finalResult.ok ? finalResult.value : 0;
                  const currentDiff = Math.abs(currentValue - target);
                  const currentLength = gameState.playfield.length; // Should be 3 (N/O/N)
                  
                  // Dynamic max length based on target size (use pre-computed targetSize)
                  let maxLength = targetSize === 'small' ? 5 : (targetSize === 'medium' ? 7 : 9);
                  
                  const canBuildMore = currentLength < maxLength;
                  const isClose = currentDiff <= 10;
                  const isModerate = currentDiff > 10 && currentDiff <= 20;
                  const isFar = currentDiff > 20;
                  const timePressure = gameState.turnTimer < 10;
                  
                  // Improved continuation logic - MORE AGGRESSIVE:
                  // After building N/O/N, we MUST continue for larger targets
                  // 1. Very close (≤5): Always continue if under max
                  // 2. Close (5-10): Always continue if under maxLength
                  // 3. Moderate (10-20): Continue if under maxLength-1 OR (large target and under maxLength)
                  // 4. Far (>20): Continue if (large target and under maxLength-1) OR (medium target and under maxLength-2)
                  // 5. Large targets: Always continue if under maxLength (we NEED longer expressions)
                  const isVeryClose = currentDiff <= 5;
                  const isVeryLargeTarget = target >= 80;
                  const hasGoodCards = remainingHand.length >= 3; // Lower threshold - just need some cards
                  
                  // Check if we can make improvement with available cards (more lenient)
                  let canImprove = false;
                  if (hasGoodCards) {
                    // Quick check: can we get closer with one more card?
                    const remainingOps = remainingHand.filter(c => c.type === CardType.Operator);
                    const remainingNums = remainingHand.filter(c => c.type === CardType.Number);
                    if (remainingOps.length > 0 && remainingNums.length > 0) {
                      // Test if any combination gets us closer (lower threshold for improvement)
                      for (const op of remainingOps.slice(0, 5)) { // Check more ops
                        for (const num of remainingNums.slice(0, 5)) { // Check more nums
                          let testResult;
                          switch (op.operatorKind) {
                            case OperatorKind.Add: testResult = currentValue + num.value; break;
                            case OperatorKind.Sub: testResult = currentValue - num.value; break;
                            case OperatorKind.Mul: testResult = currentValue * num.value; break;
                            case OperatorKind.Div: testResult = num.value !== 0 ? Math.floor(currentValue / num.value) : currentValue; break;
                          }
                          const testDiff = Math.abs(testResult - target);
                          // More lenient improvement detection for large targets
                          const improvementThreshold = targetSize === 'large' ? 1 : 3;
                          if (testDiff < currentDiff - improvementThreshold) {
                            canImprove = true;
                            break;
                          }
                          // For large targets, also accept if it creates a good intermediate value
                          if (targetSize === 'large' && testResult >= target * 0.3 && testResult <= target * 1.5 && testDiff <= currentDiff + 5) {
                            canImprove = true;
                            break;
                          }
                        }
                        if (canImprove) break;
                      }
                    }
                  }
                  
                  // More aggressive continuation - especially for larger targets
                  // CRITICAL: If minimum length is set, MUST continue until reached
                  const mustContinueForMinLength = botMinExpressionLength > 0 && currentLength < botMinExpressionLength;
                  const shouldContinue = canBuildMore && (
                    mustContinueForMinLength || // FORCE continuation if minimum length not met
                    (isVeryClose && currentLength < maxLength) || // Very close: always try
                    (isClose && currentLength < maxLength) || // Close: always continue if can
                    (isModerate && (currentLength < maxLength - 1 || (targetSize === 'large' && currentLength < maxLength))) || // Moderate: more aggressive
                    (isFar && (targetSize === 'large' && currentLength < maxLength - 1) || (targetSize === 'medium' && currentLength < maxLength - 2)) || // Far: continue for large/medium
                    (targetSize === 'large' && currentLength < maxLength) || // Large targets: always continue if under max
                    (isVeryLargeTarget && currentLength < 7) || // Very large targets: extend up to 7+ cards
                    (canImprove && currentLength < maxLength - 1) // If can improve, continue
                  );
                  
                  // Continue building if we should AND haven't exceeded attempts
                  // Allow more attempts when forcing minimum length
                  const maxAttemptsForMinLength = mustContinueForMinLength ? maxReevalAttempts * 2 : maxReevalAttempts;
                  if (shouldContinue && gameState.botReevalAttempts[targetPlayer] < maxAttemptsForMinLength) {
                    gameState.botReevalAttempts[targetPlayer]++;
                    if (mustContinueForMinLength) {
                      GP.dbg(`[BOT ${botName}] PHASE 3B: Must continue to reach minimum length (${currentLength} < ${botMinExpressionLength})`);
                    }
                    setTimeout(() => {
                      if (!gameState.gameOver && gameState.activePlayer === targetPlayer) {
                        runBotTurn(targetPlayer);
                      }
                    }, getDelay(80));
                  } else {
                    // Can't improve or max attempts, end turn
                    if (mustContinueForMinLength && gameState.botReevalAttempts[targetPlayer] >= maxAttemptsForMinLength) {
                      GP.dbg(`[BOT ${botName}] PHASE 3B: Too many attempts forcing minimum length, ending turn (safety)`);
                    }
                    gameState.botReevalAttempts[targetPlayer] = 0;
                    setTimeout(() => {
                      if (!gameState.gameOver && gameState.activePlayer === targetPlayer) GP.endTurn();
                    }, getDelay(80));
                  }
                }
              }, getDelay(80));
            }, getDelay(80));
          }, getDelay(80));
          return;
        }
      }
      
      // ========== PHASE 4: HAND MANAGEMENT ==========
      // CRITICAL: If minimum length is required and not met, skip hand management and continue building
      if (botMinExpressionLength > 0 && gameState.playfield.length > 0 && gameState.playfield.length < botMinExpressionLength) {
        GP.dbg(`[BOT ${botName}] PHASE 4: Skipping hand management - must extend to reach minimum length (${gameState.playfield.length} < ${botMinExpressionLength})`);
        // Continue building instead of managing hand
        gameState.botReevalAttempts[targetPlayer]++;
        if (gameState.botReevalAttempts[targetPlayer] < maxReevalAttempts * 2) {
          setTimeout(() => {
            if (!gameState.gameOver && gameState.activePlayer === targetPlayer) {
              runBotTurn(targetPlayer);
            }
          }, getDelay(80));
          return;
        } else {
          GP.dbg(`[BOT ${botName}] PHASE 4: Too many attempts, proceeding to hand management (safety)`);
        }
      }
      
      // 4A: Fill hand if not full (ALWAYS prioritize this)
      if (currentHand.length < handLimit && gameState.drawsThisTurn < maxDraw) {
        const cardsNeeded = handLimit - currentHand.length;
        const aggressiveDraw = Math.max(1, Math.ceil(cardsNeeded * DIFF.drawAggression));
        const canDraw = Math.min(aggressiveDraw, maxDraw - gameState.drawsThisTurn);
        const totalCardsAvailable = gameState.deck.length + gameState.discardPile.length;
        
        // Only draw if cards are available
        if (canDraw > 0 && totalCardsAvailable > 0) {
          GP.dbg(`[BOT ${botName}] PHASE 4A: Drawing ${canDraw} card(s) (${currentHand.length}/${handLimit}, ${totalCardsAvailable} cards available)`);
          let actuallyDrawn = 0;
          for (let i = 0; i < canDraw; i++) {
            const drawn = GP.drawCard(targetPlayer);
            if (drawn) {
              gameState.drawsThisTurn++;
              actuallyDrawn++;
            } else {
              // No more cards available, stop trying
              break;
            }
          }
          
          if (actuallyDrawn > 0) {
            GP.writeGameState();
            GP.renderHands();
            GP.updateDeckCount();
            setTimeout(() => {
              if (!gameState.gameOver && gameState.activePlayer === targetPlayer) {
                runBotTurn(targetPlayer);
              }
            }, getDelay(100));
            return;
          }
        }
      }
      
      // 4B: Discard worst card if hand is full
      if (currentHand.length >= handLimit && gameState.botDiscardCount[targetPlayer] < maxDiscardsPerTurn) {
        const numbers = currentHand.filter(c => c.type === CardType.Number);
        const operators = currentHand.filter(c => c.type === CardType.Operator);
        
        // Better evaluation: check if we can build useful expressions
        // Consider card synergies, not just individual cards
        const hasGoodNumbers = numbers.some(n => {
          if (target > 50) {
            // Large targets: any number >= 3 is potentially useful (for multiplication)
            return n.value >= 3;
          } else if (target > 30) {
            // Medium-large: numbers that can help reach target
            return n.value >= 2 && (n.value <= target || Math.abs(n.value - target) <= 30);
          } else {
            // Small targets: numbers close to target
            return Math.abs(n.value - target) <= 30;
          }
        });
        const hasEnoughOps = operators.length >= 2;
        const hasMul = operators.some(op => op.operatorKind === OperatorKind.Mul);
        const needsMulForLargeTarget = target > 50 && !hasMul;
        
        // Check if we can build a useful expression with current cards
        // Quick test: can we get within 20 of target with available cards?
        let canBuildUseful = false;
        if (numbers.length >= 1 && operators.length >= 1) {
          for (const num1 of numbers.slice(0, 3)) { // Check first 3 numbers
            for (const op of operators.slice(0, 2)) { // Check first 2 operators
              for (const num2 of numbers.slice(0, 3)) {
                if (num1 === num2 && numbers.length === 1) continue; // Need 2 different numbers
                let result;
                switch (op.operatorKind) {
                  case OperatorKind.Add: result = num1.value + num2.value; break;
                  case OperatorKind.Sub: result = num1.value - num2.value; break;
                  case OperatorKind.Mul: result = num1.value * num2.value; break;
                  case OperatorKind.Div: result = num2.value !== 0 ? Math.floor(num1.value / num2.value) : num1.value; break;
                }
                if (Math.abs(result - target) <= 20) {
                  canBuildUseful = true;
                  break;
                }
              }
              if (canBuildUseful) break;
            }
            if (canBuildUseful) break;
          }
        }
        
        // Don't discard if we have materials to build, OR if we need multiplication for large target
        if ((hasGoodNumbers && hasEnoughOps && numbers.length > 0) || needsMulForLargeTarget || canBuildUseful) {
          // Has good materials, skip discard
        } else {
          // Find worst card to discard (considering combinations, not just individual value)
          let worstCard = null;
          let worstIdx = -1;
          let worstScore = -1;
          
          for (let i = 0; i < currentHand.length; i++) {
            const card = currentHand[i];
            let score = 0;
            
            if (card.type === CardType.Number) {
              // Score based on usefulness for current target
              // Consider: can this number be used with other cards to reach target?
              let baseScore = 0;
              if (target > 50) {
                // Large targets: prefer numbers >= 3 (good for multiplication)
                baseScore = card.value < 3 ? 100 : Math.abs(card.value - target / 2);
                // Check if this number can be multiplied with other numbers to get close
                const canMultiply = numbers.some(n => n !== card && n.value >= 2 && (card.value * n.value >= target * 0.5 && card.value * n.value <= target * 1.5));
                if (canMultiply) baseScore -= 20; // Less likely to discard if useful in multiplication
              } else if (target > 30) {
                // Medium targets: prefer numbers that can help
                baseScore = Math.abs(card.value - target);
                if (card.value < 2) baseScore += 50; // Very small numbers less useful
                // Check if this number can be combined with others to reach target
                const canCombine = numbers.some(n => n !== card && operators.some(op => {
                  let result;
                  switch (op.operatorKind) {
                    case OperatorKind.Add: result = card.value + n.value; break;
                    case OperatorKind.Sub: result = Math.abs(card.value - n.value); break;
                    case OperatorKind.Mul: result = card.value * n.value; break;
                    default: return false;
                  }
                  return Math.abs(result - target) <= 15;
                }));
                if (canCombine) baseScore -= 15; // Less likely to discard if useful in combinations
              } else {
                // Small targets: prefer numbers close to target
                baseScore = Math.abs(card.value - target);
              }
              score = baseScore;
            } else {
              // Operators: consider balance
              if (target > 50) {
                // Large targets: need multiplication, don't discard if we have few
                if (operators.length <= 2 && card.operatorKind === OperatorKind.Mul) {
                  score = 5; // Keep multiplication if we have few ops
                } else if (operators.length > 5) {
                  score = 80; // Too many operators
                } else if (card.operatorKind === OperatorKind.Mul && operators.filter(o => o.operatorKind === OperatorKind.Mul).length <= 1) {
                  score = 10; // Keep at least one multiplication
                } else {
                  score = 40;
                }
              } else {
                // Small/medium targets: balance operators
                if (operators.length > 4) score = 100; // Too many ops
                else if (operators.length < 2) score = 10; // Need ops, don't discard
                else score = 30; // Moderate amount
              }
            }
            
            if (score > worstScore) {
              worstScore = score;
              worstCard = card;
              worstIdx = i;
            }
          }
          
          // Only discard if card is truly bad (higher threshold for large targets)
          const discardThreshold = target > 50 ? 20 : 15;
          if (worstCard && worstIdx !== -1 && worstScore > discardThreshold) {
            GP.dbg(`[BOT ${botName}] PHASE 4B: Discarding worst card (score: ${worstScore})`);
            gameState.botDiscardCount[targetPlayer]++;
            GP.discardCard(targetPlayer, worstIdx, true);
            GP.writeGameState();
            setTimeout(() => {
              if (!gameState.gameOver && gameState.activePlayer === targetPlayer) {
                runBotTurn(targetPlayer);
              }
            }, getDelay(80));
            return;
          }
        }
      }
      
      // 4C: Rehand if hand is truly terrible
      // Improved: Better detection of bad hands, including very large target scenarios
      // Only rehand if: hand has 7+ cards, playfield empty, timer allows, AND hand is truly bad
      const scoreDifference = gameState.players[0].score - gameState.players[1].score;
      const isBehind = (targetPlayer === 1 && scoreDifference < 0) || (targetPlayer === 2 && scoreDifference > 0);
      const isVeryLargeTarget = target >= 80;
      const minTimerForRehand = isBehind ? 10 : 15; // If behind, rehand sooner
      
      if (currentHand.length >= 7 && gameState.playfield.length === 0 && gameState.turnTimer > minTimerForRehand) {
        const numbers = currentHand.filter(c => c.type === CardType.Number);
        const operators = currentHand.filter(c => c.type === CardType.Operator);
        const operatorRatio = currentHand.length > 0 ? operators.length / currentHand.length : 0;
        
        // Check for "pure operators" situation: too many operators, too few numbers
        const isPureOperators = operatorRatio >= 0.7 && operators.length >= 5;
        
        // Check for "too many small numbers" for large targets
        const smallNumbers = numbers.filter(n => n.value < 3);
        const hasTooManySmallNumbers = isVeryLargeTarget && smallNumbers.length >= 4 && numbers.length <= 5;
        
        // Check for usable numbers based on target size
        const hasUsableNumbers = numbers.some(n => {
          if (isVeryLargeTarget || target > 50) {
            // Large/very large targets: need numbers >= 3 for multiplication
            return n.value >= 3;
          } else if (target > 30) {
            // Medium-large: numbers that can help
            return n.value >= 2 && Math.abs(n.value - target) <= 40;
          } else {
            // Small targets: numbers close to target
            return Math.abs(n.value - target) <= 40;
          }
        });
        
        // Check if we have multiplication for large targets
        const hasMul = operators.some(op => op.operatorKind === OperatorKind.Mul);
        const needsMulForLargeTarget = (isVeryLargeTarget || target > 50) && !hasMul && numbers.length >= 3;
        
        // Check if we can build ANY useful expression (quick test)
        let canBuildAnythingUseful = false;
        if (numbers.length >= 2 && operators.length >= 1) {
          // Quick test: can we get within 30 of target?
          for (const num1 of numbers.slice(0, 3)) {
            for (const op of operators.slice(0, 2)) {
              for (const num2 of numbers.slice(0, 3)) {
                if (num1 === num2 && numbers.length === 2) continue;
                let result;
                switch (op.operatorKind) {
                  case OperatorKind.Add: result = num1.value + num2.value; break;
                  case OperatorKind.Sub: result = Math.abs(num1.value - num2.value); break;
                  case OperatorKind.Mul: result = num1.value * num2.value; break;
                  case OperatorKind.Div: result = num2.value !== 0 ? Math.floor(num1.value / num2.value) : num1.value; break;
                }
                if (Math.abs(result - target) <= 30) {
                  canBuildAnythingUseful = true;
                  break;
                }
              }
              if (canBuildAnythingUseful) break;
            }
            if (canBuildAnythingUseful) break;
          }
        }
        
        // Rehand conditions (expanded):
        // 1. Pure operators (70%+ operators with 5+ ops)
        // 2. Too few numbers (<2) AND no usable numbers
        // 3. Large target without multiplication AND not enough good numbers
        // 4. Very large target with too many small numbers
        // 5. Can't build anything useful AND (behind OR very large target)
        const shouldRehand = 
          isPureOperators || 
          (numbers.length < 2 && !hasUsableNumbers) ||
          (needsMulForLargeTarget && !numbers.some(n => n.value >= 5)) ||
          hasTooManySmallNumbers ||
          (!canBuildAnythingUseful && (isBehind || isVeryLargeTarget));
        
        if (shouldRehand) {
          const reason = isPureOperators ? 
            `too many operators (${operators.length}/${currentHand.length})` :
            (hasTooManySmallNumbers ? `very large target (${target}) with too many small numbers (${smallNumbers.length})` :
            (needsMulForLargeTarget ? `large target (${target}) without multiplication` :
            (!canBuildAnythingUseful ? `can't build useful expression` :
            `no usable numbers (${numbers.length} nums)`)));
          GP.dbg(`[BOT ${botName}] PHASE 4C: Rehanding - ${reason}`);
          GP.doRehand(targetPlayer, true);
          GP.writeGameState();
          return;
        }
      }
      
      // ========== PHASE 5: END TURN ==========
      // Final check: Can we score?
      if (gameState.playfield.length > 0) {
        const finalCheck = GP.evaluateExpression();
        if (finalCheck.ok && valueMatchesTarget(finalCheck.value, target)) {
          if (canScore(gameState.playfield.length)) {
            GP.dbg(`[BOT ${botName}] PHASE 5: Final check - SCORING! (length: ${gameState.playfield.length})`);
            GP.tryScore();
            return;
          } else {
            GP.dbg(`[BOT ${botName}] PHASE 5: Can score but too short (${gameState.playfield.length} < ${botMinExpressionLength}), ending turn (safety)`);
            // Safety: If we can't meet minimum length requirement and timer is low, end turn to prevent infinite loop
            if (gameState.turnTimer < 5 || gameState.botReevalAttempts[targetPlayer] >= maxReevalAttempts) {
              gameState.botReevalAttempts[targetPlayer] = 0;
              gameState.botDiscardCount[targetPlayer] = 0;
              setTimeout(() => {
                if (!gameState.gameOver && gameState.activePlayer === targetPlayer) {
                  GP.endTurn();
                }
              }, getDelay(80));
              return;
            }
            // Otherwise, try to extend
            gameState.botReevalAttempts[targetPlayer]++;
            setTimeout(() => {
              if (!gameState.gameOver && gameState.activePlayer === targetPlayer) {
                runBotTurn(targetPlayer);
              }
            }, getDelay(80));
            return;
          }
        }
      }
      
      // Fallback: If we have a playfield expression but can't score, check if it's worth keeping
      // Only keep if very close (≤5) and have cards to potentially improve next turn
      if (gameState.playfield.length > 0 && gameState.playfield.length < maxLength) {
        const finalCheck = GP.evaluateExpression();
        if (finalCheck.ok) {
          const finalDiff = Math.abs(finalCheck.value - target);
          const hasCardsToImprove = currentHand.length >= 3; // At least 3 cards to potentially improve
          
          if (finalDiff <= 5 && hasCardsToImprove && gameState.turnTimer > 5) {
            // Very close and have cards - keep expression for next turn
            GP.dbg(`[BOT ${botName}] PHASE 5: Keeping close expression (diff: ${finalDiff}) for next turn`);
          } else if (finalDiff > 30 && gameState.playfield.length >= 3) {
            // Too far - clear expression to start fresh next turn
            GP.dbg(`[BOT ${botName}] PHASE 5: Clearing far expression (diff: ${finalDiff})`);
            GP.clearPlayfieldOnly();
          }
        }
      }
      
      // Nothing else to do - end turn
      GP.dbg(`[BOT ${botName}] PHASE 5: Ending turn (Hand: ${currentHand.length}, Playfield: ${gameState.playfield.length}, Timer: ${Math.ceil(gameState.turnTimer)}s)`);
      gameState.botReevalAttempts[targetPlayer] = 0;
      gameState.botDiscardCount[targetPlayer] = 0;
      setTimeout(() => {
        if (!gameState.gameOver && gameState.activePlayer === targetPlayer) {
          GP.endTurn();
        }
      }, getDelay(80));
    }, delay);
  }

  // Register on GP namespace
  GP.runBotTurn = runBotTurn;
  GP.valueMatchesTarget = valueMatchesTarget;

})(window.GP);
