/**
 * MMtp - Cheat/Debug Panel (extracted from gameplay.js for modularity)
 * Testing, stat manipulation, and game override controls.
 * Depends on window.GP (GamePlay API) exposed by gameplay.js.
 */
(function (GP) {
  'use strict';
  if (!GP) { console.error('[gameplay-cheat] window.GP not found'); return; }

  const { CardType, OperatorKind } = window.MMtpExpression;
  const $ = (id) => document.getElementById(id);

  function initCheatPanel() {
    // Alias shared state
    const gameState = GP.state;
    const gameRules = GP.rules;
    const cheatPanel = $('cheat-panel');
    const btnCheatPanel = $('btn-cheat-panel');
    const btnCloseCheat = $('btn-close-cheat');

    if (!cheatPanel || !btnCheatPanel) return;

    // Toggle button
    btnCheatPanel.addEventListener('click', () => {
      cheatPanel.classList.toggle('hidden');
    });
    if (btnCloseCheat) btnCloseCheat.addEventListener('click', () => {
      cheatPanel.classList.add('hidden');
    });
    if (cheatPanel.querySelector('.cheat-backdrop')) {
      cheatPanel.querySelector('.cheat-backdrop').addEventListener('click', () => {
        cheatPanel.classList.add('hidden');
      });
    }

    // Keyboard shortcut
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'C') {
        e.preventDefault();
        cheatPanel.classList.toggle('hidden');
      }
    });

    // Collapsible sections
    const sectionTitles = cheatPanel.querySelectorAll('.cheat-section-title');
    sectionTitles.forEach(title => {
      title.addEventListener('click', () => {
        const section = title.closest('.cheat-section');
        if (section) section.classList.toggle('collapsed');
      });
    });

    // Testing Features
    const cheatBotP1 = $('cheat-bot-p1');
    const cheatSkipBot = $('cheat-skip-bot');
    const cheatAutoSkipBot = $('cheat-auto-skip-bot');
    const cheatBotDifficulty = $('cheat-bot-difficulty');
    const cheatForceEndTurn = $('cheat-force-end-turn');
    const cheatForceWinP1 = $('cheat-force-win-p1');
    const cheatForceWinP2 = $('cheat-force-win-p2');
    const cheatForceDraw = $('cheat-force-draw');
    const cheatSetTarget = $('cheat-set-target');
    const cheatApplyTarget = $('cheat-apply-target');
    const cheatSetTimer = $('cheat-set-timer');
    const cheatApplyTimer = $('cheat-apply-timer');

    if (cheatBotP1) {
      cheatBotP1.checked = gameRules.botP1 || false;
      cheatBotP1.addEventListener('change', (e) => {
        gameRules.botP1 = e.target.checked;
        GP.toast(`P1 Bot ${e.target.checked ? 'enabled' : 'disabled'}`, 'info');
        // If P1 bot enabled and it's P1's turn, start bot
        if (e.target.checked && gameState.activePlayer === 1 && !gameState.gameOver && GP.isHost) {
          setTimeout(() => GP.runBotTurn(1), 500);
        }
      });
    }

    if (cheatAutoSkipBot) {
      cheatAutoSkipBot.addEventListener('change', (e) => {
        GP.autoSkipBotTurns = e.target.checked;
        GP.toast(GP.autoSkipBotTurns ? 'Auto-skip bot turns ON' : 'Auto-skip bot turns OFF', 'info');
      });
    }

    if (cheatSkipBot) {
      cheatSkipBot.addEventListener('change', (e) => {
        const activeBot = (gameRules.botP1 && gameState.activePlayer === 1) || 
                         (gameRules.allowBots && gameState.activePlayer === 2);
        if (e.target.checked && activeBot && !gameState.gameOver) {
          GP.endTurn();
          e.target.checked = false;
        }
      });
    }

    if (cheatBotDifficulty) {
      cheatBotDifficulty.value = gameRules.botDifficulty || 'medium';
      cheatBotDifficulty.addEventListener('change', (e) => {
        gameRules.botDifficulty = e.target.value;
        GP.toast(`Bot difficulty set to ${e.target.value}`, 'info');
      });
    }

    if (cheatForceEndTurn) {
      cheatForceEndTurn.addEventListener('click', () => {
        if (!gameState.gameOver) GP.endTurn();
      });
    }

    if (cheatForceWinP1) {
      cheatForceWinP1.addEventListener('click', () => {
        if (!gameState.gameOver) GP.endGame(1);
      });
    }

    if (cheatForceWinP2) {
      cheatForceWinP2.addEventListener('click', () => {
        if (!gameState.gameOver) GP.endGame(2);
      });
    }

    if (cheatForceDraw) {
      cheatForceDraw.addEventListener('click', () => {
        if (!gameState.gameOver) GP.endGame(0);
      });
    }

    if (cheatApplyTarget && cheatSetTarget) {
      cheatApplyTarget.addEventListener('click', () => {
        const val = parseInt(cheatSetTarget.value);
        if (val >= 1 && val <= 99) {
          gameState.target = val;
          GP.updateTarget();
          GP.toast(`Target set to ${val}`, 'info');
        }
      });
    }

    if (cheatApplyTimer && cheatSetTimer) {
      cheatApplyTimer.addEventListener('click', () => {
        const val = parseInt(cheatSetTimer.value);
        if (val >= 0) {
          gameState.turnTimer = val;
          GP.updateTimer();
          GP.toast(`Timer set to ${val}s`, 'info');
        }
      });
    }

    const cheatPauseTimer = $('cheat-pause-timer');
    const cheatInfiniteTimer = $('cheat-infinite-timer');
    if (cheatPauseTimer) {
      cheatPauseTimer.addEventListener('change', (e) => {
        GP.timerPaused = e.target.checked;
        GP.toast(GP.timerPaused ? 'Timer paused' : 'Timer resumed', 'info');
      });
    }
    if (cheatInfiniteTimer) {
      cheatInfiniteTimer.addEventListener('change', (e) => {
        GP.timerInfinite = e.target.checked;
        GP.toast(GP.timerInfinite ? 'Infinite timer ON' : 'Infinite timer OFF', 'info');
      });
    }

    // Game speed multiplier
    const cheatGameSpeed = $('cheat-game-speed');
    if (cheatGameSpeed) {
      cheatGameSpeed.value = '1';
      cheatGameSpeed.addEventListener('change', (e) => {
        GP.gameSpeedMultiplier = parseFloat(e.target.value) || 1.0;
        GP.toast(`Game speed: ${GP.gameSpeedMultiplier}x`, 'info');
        GP.dbg(`[Cheat Panel] Game speed set to ${GP.gameSpeedMultiplier}x`);
      });
    }
    
    // Bot minimum expression length
    const cheatBotMinLength = $('cheat-bot-min-length');
    if (cheatBotMinLength) {
      cheatBotMinLength.value = '0';
      cheatBotMinLength.addEventListener('change', (e) => {
        GP.botMinExpressionLength = parseInt(e.target.value) || 0;
        if (GP.botMinExpressionLength > 0) {
          GP.toast(`Bot minimum expression length: ${GP.botMinExpressionLength} cards`, 'info');
          GP.dbg(`[Cheat Panel] Bot minimum expression length set to ${GP.botMinExpressionLength}`);
        } else {
          GP.toast(`Bot minimum expression length: disabled`, 'info');
          GP.dbg(`[Cheat Panel] Bot minimum expression length disabled`);
        }
      });
    }
    
    // Discard pile testing functions
    const cheatClearDiscardPile = $('cheat-clear-discard-pile');
    const cheatAddDiscardCards = $('cheat-add-discard-cards');
    const cheatShowDiscardCount = $('cheat-show-discard-count');
    
    if (cheatClearDiscardPile) {
      cheatClearDiscardPile.addEventListener('click', () => {
        const count = gameState.discardPile.length;
        gameState.discardPile = [];
        GP.renderDiscardPile();
        GP.toast(`Cleared ${count} cards from discard pile`, 'info');
        GP.dbg(`[Cheat Panel] Cleared ${count} cards from discard pile`);
      });
    }
    
    if (cheatAddDiscardCards) {
      cheatAddDiscardCards.addEventListener('click', () => {
        // Add 10 random cards to discard pile
        for (let i = 0; i < 10; i++) {
          const isNumber = Math.random() > 0.4; // 60% numbers, 40% operators
          if (isNumber) {
            const value = Math.floor(Math.random() * 99) + 1;
            gameState.discardPile.push({
              type: CardType.Number,
              value: value
            });
          } else {
            const opKinds = [OperatorKind.Add, OperatorKind.Sub, OperatorKind.Mul, OperatorKind.Div];
            const opKind = opKinds[Math.floor(Math.random() * opKinds.length)];
            gameState.discardPile.push({
              type: CardType.Operator,
              operatorKind: opKind
            });
          }
        }
        GP.renderDiscardPile();
        GP.toast(`Added 10 random cards to discard pile (total: ${gameState.discardPile.length})`, 'info');
        GP.dbg(`[Cheat Panel] Added 10 cards to discard pile (total: ${gameState.discardPile.length})`);
      });
    }
    
    // Show all discards toggle
    const checkboxShowAllDiscards = cheatPanel.querySelector('#cheat-show-all-discards');
    if (checkboxShowAllDiscards) {
      checkboxShowAllDiscards.addEventListener('change', (e) => {
        GP.showAllDiscards = e.target.checked;
        GP.renderDiscardPile();
        GP.toast(GP.showAllDiscards ? 'Showing ALL discarded cards' : 'Showing last 15 discarded cards', 'info');
        GP.dbg(`[Cheat Panel] Show all discards: ${GP.showAllDiscards}`);
      });
    }
    
    if (cheatShowDiscardCount) {
      cheatShowDiscardCount.addEventListener('click', () => {
        const count = gameState.discardPile.length;
        const numbers = gameState.discardPile.filter(c => c.type === CardType.Number).length;
        const operators = gameState.discardPile.filter(c => c.type === CardType.Operator).length;
        GP.toast(`Discard Pile: ${count} cards (${numbers} numbers, ${operators} operators)`, 'info');
        GP.dbg(`[Cheat Panel] Discard Pile: ${count} total cards (${numbers} numbers, ${operators} operators)`);
      });
    }

    // Stat Manipulation
    const cheatXPAmount = $('cheat-xp-amount');
    const cheatAddXP = $('cheat-add-xp');
    const cheatResetXP = $('cheat-reset-xp');
    const cheatSetLevel = $('cheat-set-level');
    const cheatApplyLevel = $('cheat-apply-level');
    const cheatLevelUp = $('cheat-level-up');
    const cheatLevelDown = $('cheat-level-down');
    const cheatAddWins = $('cheat-add-wins');
    const cheatApplyWins = $('cheat-apply-wins');
    const cheatAddLosses = $('cheat-add-losses');
    const cheatApplyLosses = $('cheat-apply-losses');
    const cheatSetRating = $('cheat-set-rating');
    const cheatApplyRating = $('cheat-apply-rating');
    const cheatRatingPlus = $('cheat-rating-plus');
    const cheatRatingMinus = $('cheat-rating-minus');
    const cheatResetStats = $('cheat-reset-stats');

    if (cheatAddXP && cheatXPAmount) {
      cheatAddXP.addEventListener('click', () => {
        const amount = parseInt(cheatXPAmount.value) || 0;
        if (amount > 0) {
          try {
            const raw = localStorage.getItem('mmtp-player-stats');
            const stats = raw ? JSON.parse(raw) : { level: 1, xp: 0, xpToNext: 100 };
            stats.xp = (stats.xp || 0) + amount;
            while (stats.xp >= stats.xpToNext) {
              stats.xp -= stats.xpToNext;
              stats.level = (stats.level || 1) + 1;
              stats.xpToNext = Math.round((stats.xpToNext || 100) * 1.15);
              GP.showXPNotification(0, `LEVEL ${stats.level}!`, 'levelup');
            }
            localStorage.setItem('mmtp-player-stats', JSON.stringify(stats));
            GP.showXPNotification(amount, 'XP Added', 'score');
            GP.toast(`Added ${amount} XP`, 'success');
          } catch (e) {
            GP.toast('Failed to add XP', 'error');
          }
        }
      });
    }

    if (cheatResetXP) {
      cheatResetXP.addEventListener('click', () => {
        try {
          const raw = localStorage.getItem('mmtp-player-stats');
          const stats = raw ? JSON.parse(raw) : { level: 1, xp: 0, xpToNext: 100 };
          stats.xp = 0;
          localStorage.setItem('mmtp-player-stats', JSON.stringify(stats));
          GP.toast('XP reset to 0', 'info');
        } catch (e) {
          GP.toast('Failed to reset XP', 'error');
        }
      });
    }

    if (cheatApplyLevel && cheatSetLevel) {
      cheatApplyLevel.addEventListener('click', () => {
        const level = parseInt(cheatSetLevel.value) || 1;
        if (level >= 1) {
          try {
            const raw = localStorage.getItem('mmtp-player-stats');
            const stats = raw ? JSON.parse(raw) : { level: 1, xp: 0, xpToNext: 100 };
            stats.level = level;
            stats.xp = 0;
            stats.xpToNext = 100;
            for (let i = 1; i < level; i++) {
              stats.xpToNext = Math.round(stats.xpToNext * 1.15);
            }
            localStorage.setItem('mmtp-player-stats', JSON.stringify(stats));
            GP.toast(`Level set to ${level}`, 'success');
          } catch (e) {
            GP.toast('Failed to set level', 'error');
          }
        }
      });
    }

    if (cheatLevelUp) {
      cheatLevelUp.addEventListener('click', () => {
        try {
          const raw = localStorage.getItem('mmtp-player-stats');
          const stats = raw ? JSON.parse(raw) : { level: 1, xp: 0, xpToNext: 100 };
          stats.level = (stats.level || 1) + 1;
          stats.xp = 0;
          stats.xpToNext = Math.round((stats.xpToNext || 100) * 1.15);
          localStorage.setItem('mmtp-player-stats', JSON.stringify(stats));
          GP.showXPNotification(0, `LEVEL ${stats.level}!`, 'levelup');
          GP.toast(`Level up to ${stats.level}`, 'success');
        } catch (e) {
          GP.toast('Failed to level up', 'error');
        }
      });
    }

    if (cheatLevelDown) {
      cheatLevelDown.addEventListener('click', () => {
        try {
          const raw = localStorage.getItem('mmtp-player-stats');
          const stats = raw ? JSON.parse(raw) : { level: 1, xp: 0, xpToNext: 100 };
          if (stats.level > 1) {
            stats.level = stats.level - 1;
            stats.xp = 0;
            stats.xpToNext = 100;
            for (let i = 1; i < stats.level; i++) {
              stats.xpToNext = Math.round(stats.xpToNext * 1.15);
            }
            localStorage.setItem('mmtp-player-stats', JSON.stringify(stats));
            GP.toast(`Level down to ${stats.level}`, 'info');
          }
        } catch (e) {
          GP.toast('Failed to level down', 'error');
        }
      });
    }

    if (cheatApplyWins && cheatAddWins) {
      cheatApplyWins.addEventListener('click', () => {
        const amount = parseInt(cheatAddWins.value) || 0;
        if (amount > 0) {
          try {
            const raw = localStorage.getItem('mmtp-player-stats');
            const stats = raw ? JSON.parse(raw) : { wins: 0 };
            stats.wins = (stats.wins || 0) + amount;
            localStorage.setItem('mmtp-player-stats', JSON.stringify(stats));
            GP.toast(`Added ${amount} win(s)`, 'success');
          } catch (e) {
            GP.toast('Failed to add wins', 'error');
          }
        }
      });
    }

    if (cheatApplyLosses && cheatAddLosses) {
      cheatApplyLosses.addEventListener('click', () => {
        const amount = parseInt(cheatAddLosses.value) || 0;
        if (amount > 0) {
          try {
            const raw = localStorage.getItem('mmtp-player-stats');
            const stats = raw ? JSON.parse(raw) : { losses: 0 };
            stats.losses = (stats.losses || 0) + amount;
            localStorage.setItem('mmtp-player-stats', JSON.stringify(stats));
            GP.toast(`Added ${amount} loss(es)`, 'info');
          } catch (e) {
            GP.toast('Failed to add losses', 'error');
          }
        }
      });
    }

    if (cheatApplyRating && cheatSetRating) {
      cheatApplyRating.addEventListener('click', () => {
        const rating = parseInt(cheatSetRating.value) || 1000;
        try {
          const raw = localStorage.getItem('mmtp-player-stats');
          const stats = raw ? JSON.parse(raw) : { rating: 1000 };
          stats.rating = rating;
          localStorage.setItem('mmtp-player-stats', JSON.stringify(stats));
          GP.toast(`Rating set to ${rating}`, 'success');
        } catch (e) {
          GP.toast('Failed to set rating', 'error');
        }
      });
    }

    if (cheatRatingPlus) {
      cheatRatingPlus.addEventListener('click', () => {
        try {
          const raw = localStorage.getItem('mmtp-player-stats');
          const stats = raw ? JSON.parse(raw) : { rating: 1000 };
          stats.rating = (stats.rating || 1000) + 50;
          localStorage.setItem('mmtp-player-stats', JSON.stringify(stats));
          GP.toast(`Rating +50 (now ${stats.rating})`, 'success');
        } catch (e) {
          GP.toast('Failed to update rating', 'error');
        }
      });
    }

    if (cheatRatingMinus) {
      cheatRatingMinus.addEventListener('click', () => {
        try {
          const raw = localStorage.getItem('mmtp-player-stats');
          const stats = raw ? JSON.parse(raw) : { rating: 1000 };
          stats.rating = Math.max(0, (stats.rating || 1000) - 50);
          localStorage.setItem('mmtp-player-stats', JSON.stringify(stats));
          GP.toast(`Rating -50 (now ${stats.rating})`, 'info');
        } catch (e) {
          GP.toast('Failed to update rating', 'error');
        }
      });
    }

    if (cheatResetStats) {
      cheatResetStats.addEventListener('click', () => {
        if (confirm('Are you sure you want to reset ALL stats? This cannot be undone.')) {
          try {
            localStorage.setItem('mmtp-player-stats', JSON.stringify({
              level: 1, xp: 0, xpToNext: 100, wins: 0, losses: 0, rating: 1000, lastPlayed: null
            }));
            GP.toast('All stats reset', 'success');
          } catch (e) {
            GP.toast('Failed to reset stats', 'error');
          }
        }
      });
    }

    // Game Override
    const cheatCardP1Type = $('cheat-card-p1-type');
    const cheatCardP1Value = $('cheat-card-p1-value');
    const cheatGiveCardP1 = $('cheat-give-card-p1');
    const cheatFillHandP1 = $('cheat-fill-hand-p1');
    const cheatEmptyDeck = $('cheat-empty-deck');
    const cheatReshuffleDeck = $('cheat-reshuffle-deck');

    if (cheatGiveCardP1 && cheatCardP1Type && cheatCardP1Value) {
      cheatGiveCardP1.addEventListener('click', () => {
        const type = cheatCardP1Type.value;
        const value = parseInt(cheatCardP1Value.value) || 0;
        let card;
        if (type === 'number') {
          card = { type: CardType.Number, value: value };
        } else {
          const ops = [OperatorKind.Add, OperatorKind.Sub, OperatorKind.Mul, OperatorKind.Div];
          card = { type: CardType.Operator, operatorKind: ops[Math.abs(value) % 4] };
        }
        gameState.players[0].hand.push(card);
        GP.renderHands();
        GP.toast('Card added to P1 hand', 'success');
      });
    }

    if (cheatFillHandP1) {
      cheatFillHandP1.addEventListener('click', () => {
        const targetSize = gameRules.handSize || 7;
        while (gameState.players[0].hand.length < targetSize) {
          const card = GP.drawCard(1);
          if (!card) break;
        }
        GP.renderHands();
        GP.toast('P1 hand filled', 'success');
      });
    }

    if (cheatEmptyDeck) {
      cheatEmptyDeck.addEventListener('click', () => {
        gameState.deck = [];
        GP.updateDeckCount();
        GP.toast('Deck emptied', 'info');
      });
    }

    if (cheatReshuffleDeck) {
      cheatReshuffleDeck.addEventListener('click', () => {
        gameState.deck = [...gameState.discardPile];
        gameState.discardPile = [];
        GP.shuffleDeck();
        GP.updateDeckCount();
        GP.toast('Deck reshuffled', 'success');
      });
    }
  }

  // Register on GP namespace and auto-initialize
  GP.initCheatPanel = initCheatPanel;
  initCheatPanel();

})(window.GP);
