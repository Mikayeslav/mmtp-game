/**
 * MMtp — Online Multiplayer WebSocket Integration (extracted from gameplay.js)
 * Handles WebSocket events, server state synchronization, and online game flow.
 *
 * KEY DESIGN: Perspective Remapping
 * - The server uses real player IDs (1=host, 2=guest).
 * - gameplay.js renders: players[0] → bottom hand (face-up), players[1] → top (face-down).
 * - To make the local player ALWAYS appear at the bottom, applyServerState remaps:
 *     my data → players[0] (bottom), opponent → players[1] (top)
 *     activePlayer: server's myPid → 1 (bottom), server's oppPid → 2 (top)
 *     scores, doubleNext, winner: similarly remapped
 * - GP.myPlayerId is always 1 for rendering. GP.serverPlayerId stores the real ID.
 *
 * CRITICAL: Event handlers are registered BEFORE MMtpNet.connect() to avoid a race
 * condition where the server sends gameState during auto-reconnect before .then() runs.
 *
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

  // Track whether we've received at least one gameState from the server
  let receivedServerState = false;

  // ══════════════════════════════════════════════════════════════
  // ── Perspective Helpers ──
  // ══════════════════════════════════════════════════════════════

  /**
   * Convert a server-side player ID to a local rendering player ID.
   * Local player is always 1 (bottom), opponent is always 2 (top).
   */
  function serverToLocal(serverPid) {
    return serverPid === GP.serverPlayerId ? 1 : 2;
  }

  // ══════════════════════════════════════════════════════════════
  // ── UI Helpers ──
  // ══════════════════════════════════════════════════════════════

  function showTurnTransition(localActivePlayer) {
    const name = gameState.players[localActivePlayer - 1]?.name || `Player ${localActivePlayer}`;
    const isYours = localActivePlayer === 1; // 1 = me (bottom)
    GP.showTurnBanner(isYours ? 'Your Turn!' : `${name}'s Turn`, isYours);
  }

  function showScoreFlash() {
    if (playfield) {
      playfield.classList.add('playfield-scored');
      setTimeout(() => playfield.classList.remove('playfield-scored'), 600);
    }
  }

  function showGameOverModal() {
    GP.endGame(gameState.winner);
  }

  function updateLabels() {
    const handP1Label = document.querySelector('#hand-p1 .hand-label');
    const handP2Label = document.querySelector('#hand-p2 .hand-label');
    if (handP1Label) handP1Label.textContent = gameState.players[0].name;
    if (handP2Label) handP2Label.textContent = gameState.players[1].name;
    const scoreLabels = document.querySelectorAll('.score-label');
    if (scoreLabels[0]) scoreLabels[0].textContent = (gameState.players[0].name || 'P1') + ':';
    if (scoreLabels[1]) scoreLabels[1].textContent = (gameState.players[1].name || 'P2') + ':';
  }

  // ══════════════════════════════════════════════════════════════
  // ── Apply Server State (with perspective remapping) ──
  // ══════════════════════════════════════════════════════════════

  /**
   * Apply authoritative server state to local gameState + re-render.
   *
   * PERSPECTIVE REMAPPING:
   * - Server sends data with real player IDs (1=host, 2=guest).
   * - We always put the local player's data in slot 0 (bottom hand, face-up)
   *   and the opponent's data in slot 1 (top hand, face-down).
   * - activePlayer, scores, doubleNext, winner are all remapped.
   */
  function applyServerState(serverState) {
    if (!serverState) return;
    console.log('[Online] applyServerState called, myPlayerId from server:', serverState.myPlayerId);

    // Ensure online game mode is active
    GP.onlineGame = true;
    receivedServerState = true;

    // ── Store real server player ID, set rendering ID to always 1 ──
    const sPid = serverState.myPlayerId;     // My real server ID (1 or 2)
    const sOpp = sPid === 1 ? 2 : 1;        // Opponent's real server ID

    GP.serverPlayerId = sPid;
    GP.myPlayerId = 1;                        // Always 1 for rendering (bottom hand)
    GP.isHost = sPid === 1;

    // ── My hand → slot 0 (bottom, face-up) ──
    const me = gameState.players[0];
    me.hand = serverState.myHand || [];

    // ── Opponent → slot 1 (top, face-down) ──
    const opp = gameState.players[1];
    const oppCount = serverState.opponentHandCount || 0;
    opp.hand = [];
    for (let i = 0; i < oppCount; i++) {
      opp.hand.push({ type: CardType.Number, value: '?', faceDown: true });
    }

    // ── Playfield: show active player's playfield ──
    if (serverState.activePlayer === sPid) {
      gameState.playfield = serverState.myPlayfield || [];
    } else {
      gameState.playfield = serverState.opponentPlayfield || [];
    }

    // ── Scores (remapped: me → slot 0, opponent → slot 1) ──
    me.score = serverState.scores[sPid] || 0;
    opp.score = serverState.scores[sOpp] || 0;

    // ── Score piles (remapped) ──
    me.scorePile = (serverState.scorePiles[sPid] || []).map(p => ({
      expression: p.exprString,
      target: p.target,
    }));
    opp.scorePile = (serverState.scorePiles[sOpp] || []).map(p => ({
      expression: p.exprString,
      target: p.target,
    }));

    // ── Player names (remapped: me → slot 0, opponent → slot 1) ──
    if (serverState.players) {
      serverState.players.forEach(p => {
        if (p.playerId === sPid) {
          me.name = p.name;
        } else {
          opp.name = p.name;
        }
      });
    }

    // ── Active player (remapped: server's me → 1, server's opponent → 2) ──
    gameState.activePlayer = serverToLocal(serverState.activePlayer);

    // ── Timer (server-authoritative) ──
    gameState.turnTimer = serverState.timeLeft;

    // ── Target ──
    gameState.target = serverState.target;

    // ── Turn number ──
    if (serverState.turnNumber) GP.turnNumber = serverState.turnNumber;

    // ── Game over / winner (remapped) ──
    gameState.gameOver = serverState.gameOver || false;
    gameState.winner = serverState.winner ? serverToLocal(serverState.winner) : null;

    // ── Double next (remapped: me → key 1, opponent → key 2) ──
    if (serverState.doubleNext) {
      gameState.doubleNext = {
        1: serverState.doubleNext[sPid],
        2: serverState.doubleNext[sOpp],
      };
    }

    // ── Deck count ──
    const deckCountDisplay = serverState.deckCount || 0;
    if (gameState.deck.length !== deckCountDisplay) {
      gameState.deck = new Array(deckCountDisplay).fill(null);
    }

    // ── Update labels and re-render everything ──
    updateLabels();
    GP.renderHands();
    GP.renderPlayfield();
    GP.updateScores();
    GP.updateTimer();
    GP.updateTurn();
    GP.updateTarget();
    GP.updateRoundCounter();
    GP.updateDeckCount();

    if (gameState.gameOver && gameState.winner) {
      showGameOverModal();
    }
  }

  // ══════════════════════════════════════════════════════════════
  // ── Online Game Initialization ──
  // ══════════════════════════════════════════════════════════════

  function initOnlineGame() {
    if (!GP.onlineParam || GP.onlineParam !== '1') return;
    if (!window.MMtpNet) {
      console.warn('[Online] MMtpNet not available');
      return;
    }

    // ── Set online game mode EARLY ──
    // This ensures updateTimer(), canMakeMove(), etc. use the online code path
    // even before the first gameState arrives.
    GP.onlineGame = true;

    // Stop any local timer (server manages timer)
    if (gameState.timerInterval) {
      clearInterval(gameState.timerInterval);
      gameState.timerInterval = null;
    }

    // ════════════════════════════════════════════════════════════
    // ── CRITICAL: Register ALL handlers BEFORE connecting ──
    // The server sends gameState during auto-reconnect (in the joinRoom
    // callback). If we registered handlers in .then(), they'd miss events
    // that arrive before the microtask queue flushes.
    // ════════════════════════════════════════════════════════════

    // ── gameState: authoritative state from server ──
    MMtpNet.on('gameState', applyServerState);

    // ── timerUpdate: tick from server ──
    MMtpNet.on('timerUpdate', (data) => {
      gameState.turnTimer = data.timeLeft;
      GP.updateTimer();
    });

    // ── turnChanged: server says new turn ──
    MMtpNet.on('turnChanged', (data) => {
      gameState.activePlayer = serverToLocal(data.activePlayer);
      if (data.turnNumber) GP.turnNumber = data.turnNumber;
      GP.updateRoundCounter();
      showTurnTransition(gameState.activePlayer);
      GP.updateTurn();
      if (window.SFX) SFX.play('turnChange');
    });

    // ── scored: someone scored ──
    MMtpNet.on('scored', (data) => {
      const localPid = serverToLocal(data.playerId);
      const name = gameState.players[localPid - 1]?.name || `Player ${localPid}`;
      GP.toast(`${name} scored! ${data.expression} = ${data.oldTarget}`, 'success');
      showScoreFlash();
      if (window.SFX) SFX.play('score');
      GP.addOnlineExpressionToHistory(localPid, data.expression, data.oldTarget);
    });

    // ── scoreMiss: missed expression ──
    MMtpNet.on('scoreMiss', (data) => {
      GP.toast(`Miss: ${data.expression} = ${data.result} (target: ${data.target})`, 'warning');
    });

    // ── gameOver: game ended ──
    MMtpNet.on('gameOver', (data) => {
      gameState.gameOver = true;
      gameState.winner = data.winner ? serverToLocal(data.winner) : 0;
      gameState.matchStats.endTime = Date.now();

      // Remap scores: me → slot 0, opponent → slot 1
      const sPid = GP.serverPlayerId;
      const sOpp = sPid === 1 ? 2 : 1;
      gameState.players[0].score = data.scores[sPid] || 0;
      gameState.players[1].score = data.scores[sOpp] || 0;

      if (data.matchStats) {
        const myStats = data.matchStats[sPid];
        const oppStats = data.matchStats[sOpp];
        if (myStats && gameState.matchStats.players[0]) {
          Object.assign(gameState.matchStats.players[0], {
            cardsPlayed: myStats.cardsPlayed || 0,
            cardsDrawn: myStats.cardsDrawn || 0,
            cardsDiscarded: myStats.cardsDiscarded || 0,
            expressionsScored: myStats.expressionsScored || [],
            rehandsUsed: myStats.rehandsUsed || 0,
            timeSaved: myStats.timeSaved || 0,
          });
        }
        if (oppStats && gameState.matchStats.players[1]) {
          Object.assign(gameState.matchStats.players[1], {
            cardsPlayed: oppStats.cardsPlayed || 0,
            cardsDrawn: oppStats.cardsDrawn || 0,
            cardsDiscarded: oppStats.cardsDiscarded || 0,
            expressionsScored: oppStats.expressionsScored || [],
            rehandsUsed: oppStats.rehandsUsed || 0,
            timeSaved: oppStats.timeSaved || 0,
          });
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
      const localPid = serverToLocal(data.playerId);
      const name = gameState.players[localPid - 1]?.name || `Player ${localPid}`;
      GP.toast(`🎯 ${name} rerolled target! ${data.oldTarget} → ${data.newTarget}`, 'success');
      if (window.SFX) SFX.play('score');
    });

    // ── doubleActivated: someone activated ×2 ──
    MMtpNet.on('doubleActivated', (data) => {
      const localPid = serverToLocal(data.playerId);
      const name = gameState.players[localPid - 1]?.name || `Player ${localPid}`;
      GP.toast(`×2 ${name} activated Double Score!`, 'success');
      if (window.SFX) SFX.play('turnChange');
    });

    // ── doubleDeactivated: ×2 was consumed ──
    MMtpNet.on('doubleDeactivated', () => {
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
      // data.playerId is server-side
      if (data.playerId !== GP.serverPlayerId) {
        GP.toast('👁 Opponent peeked at your hand!', 'warning');
      }
    });

    // ── cardSwapped: someone swapped cards ──
    MMtpNet.on('cardSwapped', (data) => {
      const localPid = serverToLocal(data.playerId);
      const name = gameState.players[localPid - 1]?.name || `Player ${localPid}`;
      GP.toast(`🔄 ${name} swapped a card!`, 'info');
      if (window.SFX) SFX.play('cardDraw');
    });

    // ── rematch: server reset the game ──
    MMtpNet.on('rematch', () => {
      GP.toast('Rematch starting!', 'info');
    });

    // ── playerDisconnected ──
    MMtpNet.on('playerDisconnected', () => {
      GP.toast('Opponent disconnected — waiting…', 'warning');
      GP.appendSystemChatMessage('Opponent disconnected');
    });

    // ── playerLeft: opponent gone for good ──
    MMtpNet.on('playerLeft', (data) => {
      GP.toast(`${data.name || 'Player'} left the game`, 'error');
      GP.appendSystemChatMessage(`${data.name || 'Player'} left the game`);
    });

    // ════════════════════════════════════════════════════════════
    // ── NOW connect (handlers are already registered) ──
    // ════════════════════════════════════════════════════════════

    MMtpNet.connect().then((ok) => {
      if (!ok) {
        console.warn('[Online] Could not connect to server — falling back to local');
        GP.onlineGame = false;
        GP.toast('Server unreachable — playing locally', 'warning');

        // Unregister online handlers
        MMtpNet.off('gameState');
        MMtpNet.off('timerUpdate');
        MMtpNet.off('turnChanged');
        MMtpNet.off('scored');
        MMtpNet.off('scoreMiss');
        MMtpNet.off('gameOver');
        MMtpNet.off('deckReshuffled');
        MMtpNet.off('targetRerolled');
        MMtpNet.off('doubleActivated');
        MMtpNet.off('doubleDeactivated');
        MMtpNet.off('peekRevealed');
        MMtpNet.off('peekUsed');
        MMtpNet.off('cardSwapped');
        MMtpNet.off('rematch');
        MMtpNet.off('playerDisconnected');
        MMtpNet.off('playerLeft');

        // Fall back: create local game
        GP.state.deck = GP.createDeck();
        GP.dealInitialHands();
        GP.startTimer();
        GP.renderHands();
        GP.updateScores();
        GP.updateTurn();
        GP.updateDeckCount();
        return;
      }

      console.log('[Online] Connected for gameplay — room:', GP.roomCode);

      // Request fresh game state (belt and suspenders — in case the
      // initial gameState event was dropped during reconnection)
      if (!receivedServerState) {
        console.log('[Online] No state received yet — requesting from server');
        MMtpNet.gameAction('requestState', {}).then(res => {
          if (!res.ok) console.warn('[Online] requestState failed:', res.error);
        });
      }
    });
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
