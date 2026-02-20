/**
 * MMtp — Online Multiplayer WebSocket Integration (extracted from gameplay.js)
 * Handles WebSocket events, server state synchronization, and online game flow.
 * Depends on window.GP (GamePlay API) exposed by gameplay.js.
 */
(function (GP) {
  'use strict';
  if (!GP) { console.error('[gameplay-online] window.GP not found'); return; }

  const { CardType, ParenKind } = window.MMtpExpression;

  // Alias shared state (objects are by-reference, always current)
  const gameState = GP.state;
  const playfield = document.getElementById('playfield');
  const btnBackToLobby = document.getElementById('btn-back-to-lobby');

  // ══════════════════════════════════════════════════════════════
  // ── Online Multiplayer: WebSocket Integration ──
  // ══════════════════════════════════════════════════════════════

  // Wrapper functions used by online event handlers
  function showTurnTransition(activePlayer) {
    const name = gameState.players[activePlayer - 1]?.name || `Player ${activePlayer}`;
    const isYours = activePlayer === GP.myPlayerId;
    GP.showTurnBanner(isYours ? 'Your Turn!' : `${name}'s Turn`, isYours);
  }

  function showScoreFlash(playerId) {
    if (playfield) {
      playfield.classList.add('playfield-scored');
      setTimeout(() => playfield.classList.remove('playfield-scored'), 600);
    }
  }

  function showGameOverModal() {
    GP.endGame(gameState.winner);
  }

  function initOnlineGame() {
    if (!GP.onlineParam || GP.onlineParam !== '1') return;
    if (!window.MMtpNet) {
      console.warn('[Online] MMtpNet not available');
      return;
    }

    MMtpNet.connect().then((ok) => {
      if (!ok) {
        console.warn('[Online] Could not connect to server — falling back to local');
        GP.toast('Server unreachable — playing locally', 'warning');
        return;
      }

      GP.onlineGame = true;
      console.log('[Online] Connected for gameplay — room:', GP.roomCode);

      // Stop local timer (server manages timer)
      if (gameState.timerInterval) {
        clearInterval(gameState.timerInterval);
        gameState.timerInterval = null;
      }

      // ── gameState: authoritative state from server ──
      MMtpNet.on('gameState', applyServerState);

      // ── timerUpdate: tick from server ──
      MMtpNet.on('timerUpdate', (data) => {
        gameState.turnTimer = data.timeLeft;
        GP.updateTimer();
      });

      // ── turnChanged: server says new turn ──
      MMtpNet.on('turnChanged', (data) => {
        gameState.activePlayer = data.activePlayer;
        if (data.turnNumber) GP.turnNumber = data.turnNumber;
        GP.updateRoundCounter();
        showTurnTransition(data.activePlayer);
        GP.updateTurn();
        if (window.SFX) SFX.play('turnChange');
      });

      // ── scored: someone scored ──
      MMtpNet.on('scored', (data) => {
        const name = gameState.players[data.playerId - 1]?.name || `Player ${data.playerId}`;
        GP.toast(`${name} scored! ${data.expression} = ${data.oldTarget}`, 'success');
        showScoreFlash(data.playerId);
        if (window.SFX) SFX.play('score');
        GP.addOnlineExpressionToHistory(data.playerId, data.expression, data.oldTarget);
      });

      // ── scoreMiss: missed expression ──
      MMtpNet.on('scoreMiss', (data) => {
        GP.toast(`Miss: ${data.expression} = ${data.result} (target: ${data.target})`, 'warning');
      });

      // ── gameOver: game ended ──
      MMtpNet.on('gameOver', (data) => {
        gameState.gameOver = true;
        gameState.winner = data.winner;
        gameState.matchStats.endTime = Date.now();
        for (let pid = 1; pid <= 2; pid++) {
          gameState.players[pid - 1].score = data.scores[pid] || 0;
        }
        if (data.matchStats) {
          for (let pid = 1; pid <= 2; pid++) {
            const serverStats = data.matchStats[pid];
            if (serverStats && gameState.matchStats.players[pid - 1]) {
              Object.assign(gameState.matchStats.players[pid - 1], {
                cardsPlayed: serverStats.cardsPlayed || 0,
                cardsDrawn: serverStats.cardsDrawn || 0,
                cardsDiscarded: serverStats.cardsDiscarded || 0,
                expressionsScored: serverStats.expressionsScored || [],
                rehandsUsed: serverStats.rehandsUsed || 0,
                timeSaved: serverStats.timeSaved || 0,
              });
            }
          }
        }
        showGameOverModal();
      });

      // ── deckReshuffled: notify ──
      MMtpNet.on('deckReshuffled', (data) => {
        GP.toast(`Deck reshuffled (${data.deckCount} cards)`, 'info');
      });

      // ── targetRerolled: someone rerolled the target ──
      MMtpNet.on('targetRerolled', (data) => {
        const name = gameState.players[data.playerId - 1]?.name || `Player ${data.playerId}`;
        GP.toast(`🎯 ${name} rerolled target! ${data.oldTarget} → ${data.newTarget}`, 'success');
        if (window.SFX) SFX.play('score');
      });

      // ── doubleActivated: someone activated ×2 ──
      MMtpNet.on('doubleActivated', (data) => {
        const name = gameState.players[data.playerId - 1]?.name || `Player ${data.playerId}`;
        GP.toast(`×2 ${name} activated Double Score!`, 'success');
        if (window.SFX) SFX.play('turnChange');
      });

      // ── doubleDeactivated: ×2 was consumed ──
      MMtpNet.on('doubleDeactivated', (data) => {
        // Already handled by state update
      });

      // ── peekRevealed: we peeked at opponent's hand ──
      MMtpNet.on('peekRevealed', (data) => {
        GP.showPeekOverlay(data.opponentHand, data.duration || 5000);
        GP.toast('👁 Peeking at opponent\'s hand!', 'success');
        if (window.SFX) SFX.play('turnChange');
      });

      // ── peekUsed: someone used a Peek card ──
      MMtpNet.on('peekUsed', (data) => {
        if (data.playerId !== GP.myPlayerId) {
          GP.toast('👁 Opponent peeked at your hand!', 'warning');
        }
      });

      // ── cardSwapped: someone swapped cards ──
      MMtpNet.on('cardSwapped', (data) => {
        const name = gameState.players[data.playerId - 1]?.name || `Player ${data.playerId}`;
        GP.toast(`🔄 ${name} swapped a card!`, 'info');
        if (window.SFX) SFX.play('cardDraw');
      });

      // ── rematch: server reset the game ──
      MMtpNet.on('rematch', () => {
        GP.toast('Rematch starting!', 'info');
      });

      // ── playerDisconnected ──
      MMtpNet.on('playerDisconnected', (data) => {
        GP.toast('Opponent disconnected — waiting…', 'warning');
        GP.appendSystemChatMessage('Opponent disconnected');
      });

      // ── playerLeft: opponent gone for good ──
      MMtpNet.on('playerLeft', (data) => {
        GP.toast(`${data.name || 'Player'} left the game`, 'error');
        GP.appendSystemChatMessage(`${data.name || 'Player'} left the game`);
      });

      if (GP.roomCode) {
        console.log('[Online] Expecting auto-reconnect to room:', GP.roomCode);
      }
    });
  }

  /**
   * Apply authoritative server state to local gameState + re-render.
   */
  function applyServerState(serverState) {
    if (!serverState) return;
    GP.dbg('[Online] Applying server state', serverState);

    // Update my player ID from server
    GP.myPlayerId = serverState.myPlayerId;
    GP.isHost = GP.myPlayerId === 1;

    // My hand
    const me = gameState.players[GP.myPlayerId - 1];
    me.hand = serverState.myHand || [];

    // Opponent hand (we only know count, create face-down cards)
    const oppId = GP.myPlayerId === 1 ? 2 : 1;
    const opp = gameState.players[oppId - 1];
    const oppCount = serverState.opponentHandCount || 0;
    opp.hand = [];
    for (let i = 0; i < oppCount; i++) {
      opp.hand.push({ type: CardType.Number, value: '?', faceDown: true });
    }

    // Playfield
    if (serverState.activePlayer === GP.myPlayerId) {
      gameState.playfield = serverState.myPlayfield || [];
    } else {
      gameState.playfield = serverState.opponentPlayfield || [];
    }

    // Scores
    for (let pid = 1; pid <= 2; pid++) {
      gameState.players[pid - 1].score = serverState.scores[pid] || 0;
    }

    // Score piles
    for (let pid = 1; pid <= 2; pid++) {
      gameState.players[pid - 1].scorePile = (serverState.scorePiles[pid] || []).map(p => ({
        expression: p.exprString,
        target: p.target,
      }));
    }

    // Player names
    if (serverState.players) {
      serverState.players.forEach(p => {
        if (gameState.players[p.playerId - 1]) {
          gameState.players[p.playerId - 1].name = p.name;
        }
      });
    }

    // Target, turn, timer, deck
    gameState.target = serverState.target;
    gameState.activePlayer = serverState.activePlayer;
    gameState.turnTimer = serverState.timeLeft;
    gameState.gameOver = serverState.gameOver || false;
    gameState.winner = serverState.winner;
    if (serverState.doubleNext) gameState.doubleNext = serverState.doubleNext;

    // Update deck count display
    const deckCountDisplay = serverState.deckCount || 0;
    if (gameState.deck.length !== deckCountDisplay) {
      gameState.deck = new Array(deckCountDisplay).fill(null);
    }

    // Re-render everything
    GP.renderHands();
    GP.renderPlayfield();
    GP.updateScores();
    GP.updateTimer();
    GP.updateTurn();
    GP.updateDeckCount();
    // updateExpressionHint is a no-op placeholder
    if (GP.updateExpressionHint) GP.updateExpressionHint();

    if (gameState.gameOver && gameState.winner) {
      showGameOverModal();
    }
  }

  // ── Back to Lobby (online aware) ──
  if (btnBackToLobby) {
    btnBackToLobby.addEventListener('click', () => {
      if (GP.onlineGame && window.MMtpNet) {
        MMtpNet.leaveRoom();
      }
    });
  }

  // ── Rematch (online aware) ──
  const btnRematchEl = document.getElementById('btn-rematch');
  if (btnRematchEl && GP.onlineParam === '1') {
    btnRematchEl.addEventListener('click', (e) => {
      if (GP.onlineGame && window.MMtpNet && MMtpNet.isOnline) {
        e.stopImmediatePropagation();
        MMtpNet.requestRematch().then(res => {
          if (!res.ok) GP.toast(res.error || 'Cannot rematch', 'warning');
        });
      }
    }, true);
  }

  // Initialize online game if applicable
  initOnlineGame();

  // Initialize chat (only shows for multiplayer)
  GP.initChat();

  // Initialize round counter
  GP.updateRoundCounter();

  // Register on GP namespace
  GP.initOnlineGame = initOnlineGame;
  GP.applyServerState = applyServerState;

})(window.GP);
