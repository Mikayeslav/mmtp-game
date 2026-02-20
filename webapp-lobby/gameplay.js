/**
 * MMtp — PlayingScene Gameplay Logic
 * Card game: Build expressions to match target numbers
 */

(function () {
  'use strict';

  const DEBUG = false;
  function dbg(...args) { if (DEBUG) console.log(...args); }

  // Multiplayer sync
  const GAME_STATE_KEY = 'mmtp-game-state';
  const ROOM_KEY = 'mmtp-lobby-';
  let isHost = false;
  let myPlayerId = 1; // 1 = P1, 2 = P2
  let roomCode = null;
  let syncInterval = null;
  let lastSyncVersion = 0;
  let onlineGame = false; // Set true when connected to WebSocket server

  // Detect role from URL or localStorage
  const urlParams = new URLSearchParams(window.location.search);
  const rulesFromUrl = urlParams.get('rules');
  const roleParam = urlParams.get('role'); // 'host' or 'client'
  const roomCodeParam = urlParams.get('room');
  const onlineParam = urlParams.get('online'); // '1' if from WebSocket lobby
  
  if (roomCodeParam) {
    roomCode = roomCodeParam;
    isHost = roleParam === 'host';
    myPlayerId = isHost ? 1 : 2;
  } else {
    // Fallback: check if we have a room in localStorage
    try {
      const allKeys = Object.keys(localStorage);
      const roomKey = allKeys.find(k => k.startsWith(ROOM_KEY));
      if (roomKey) {
        const room = JSON.parse(localStorage.getItem(roomKey));
        if (room && room.players) {
          const tabId = sessionStorage.getItem('mmtp-tab-id');
          isHost = room.hostTabId === tabId;
          myPlayerId = isHost ? 1 : 2;
          roomCode = room.roomCode;
        }
      }
    } catch (e) {
      console.warn('Could not detect multiplayer role:', e);
    }
  }

  // ── Online multiplayer helpers ──
  async function netAction(action, data) {
    if (!window.MMtpNet || !MMtpNet.isOnline) return { ok: false, error: 'Not connected' };
    return MMtpNet.gameAction(action, data);
  }

  // Game speed multiplier (for cheat panel)
  let gameSpeedMultiplier = 1.0;
  let timerPaused = false;
  let timerInfinite = false;
  let autoSkipBotTurns = false;
  // Minimum expression length for bot (0 = no minimum, 4+ = force longer expressions)
  let botMinExpressionLength = 0;
  // Show all discarded cards (not just last 15)
  let showAllDiscards = false;
  
  let gameRules = {
    handSize: 7,
    turnTimerSec: 20,
    targetMin: 1,
    targetMax: 10,
    winPoints: 5,
    fixedStartTarget: true,
    operatorPrecedence: 'left-to-right',
    allowNegative: false,
    nearestScore: false,     // Allow scoring near the target (reduced points)
    drawMode: 'always',
    handLimit: 12,
    discardMethod: 'player-select',
    maxPlayers: 2,
    // Advanced draw / rehand rules (host-tunable later)
    rehandDrawCount: 5,      // 0 = refill full hand, >0 = draw N cards on rehand
    minDrawPerClick: 1,      // minimum cards drawn per click
    maxDrawPerTurn: 0,       // 0 = unlimited per turn
    drawLimit: 0,            // 0 = unlimited total draws per game
    // Bot settings
    allowBots: false,        // Enable bot players (P2)
    botP1: false,            // Enable P1 bot (for testing)
    botDifficulty: 'medium', // 'easy' | 'medium' | 'hard'
  };

  if (rulesFromUrl) {
    try {
      const parsed = JSON.parse(decodeURIComponent(rulesFromUrl));
      gameRules = { ...gameRules, ...parsed };
    } catch (e) {
      console.error('Failed to parse rules from URL:', e);
    }
  }

  // Game state
  let gameState = {
    players: [
      { id: 1, name: 'Player 1', score: 0, hand: [], scorePile: [] },
      { id: 2, name: 'Player 2', score: 0, hand: [], scorePile: [] },
    ],
    activePlayer: 1,
    target: gameRules.fixedStartTarget ? 1 : randomTarget(),
    turnTimer: gameRules.turnTimerSec,
    turnTimerStart: gameRules.turnTimerSec, // Store initial timer value
    actualTimeElapsed: 0, // Track actual real-time elapsed (in seconds)
    timerInterval: null,
    deck: [],
    discardPile: [],
    playfield: [], // Array of {type, value, operatorKind}
    selectedCard: null,
    selectedCards: [], // For mass selection
    gameOver: false,
    winner: null,
    isDragging: false,
    dragValidDrop: false, // Track if drag ended in valid drop zone
    dragStartPos: null,
    isDragSelecting: false,
    dragSelectBox: null,
    dragSelectStart: null,
    rehandHolding: false,
    rehandTimeout: null,
    drawsThisTurn: 0,
    doubleNext: { 1: false, 2: false }, // ×2 buff active for next score
    // Match statistics tracking
    matchStats: {
      startTime: Date.now(),
      endTime: null,
      players: [
        {
          cardsPlayed: 0,
          cardsDrawn: 0,
          cardsDiscarded: 0,
          expressionsScored: [],
          rehandsUsed: 0,
          timeSaved: 0, // seconds
          bestExpression: null, // {value, expression, target}
        },
        {
          cardsPlayed: 0,
          cardsDrawn: 0,
          cardsDiscarded: 0,
          expressionsScored: [],
          rehandsUsed: 0,
          timeSaved: 0,
          bestExpression: null,
        }
      ],
      allExpressions: [], // All expressions attempted (scored or not)
    },
  };

  // Card types — imported from shared expression module (server/expression.js loaded via <script>)
  const { CardType, OperatorKind, SpecialKind, ParenKind, canPlaceCard: sharedCanPlaceCard,
          canScore: sharedCanScore, evaluate: sharedEvaluate, validateParenBalance: sharedValidateParenBalance,
          hasParens: sharedHasParens } = window.MMtpExpression;

  // DOM elements
  const $ = (id) => document.getElementById(id);
  const targetValue = $('target-value');
  const targetBig = $('target-big');
  const timerValue = $('timer-value');
  const timerFloating = $('timer-floating');
  const turnText = $('turn-text');
  const scoreP1 = $('score-p1');
  const scoreP2 = $('score-p2');
  const playfield = $('playfield');
  const expressionDisplay = $('expression-display');
  const cardsP1 = $('cards-p1');
  const cardsP2 = $('cards-p2');
  const btnDraw = $('btn-draw');
  const deckCount = $('deck-count');
  const deckLoading = $('deck-loading');
  const toastEl = $('toast');
  const helpPanel = $('help-panel');
  const btnCloseHelp = $('btn-close-help');
  const gameOverModal = $('game-over-modal');
  const btnBackToLobby = $('btn-back-to-lobby');
  const turnArrow = $('turn-arrow');
  const scoreZoneP1 = $('score-zone-p1');
  const scoreZoneP2 = $('score-zone-p2');
  const handCountP1 = $('hand-count-p1');
  // P2 header count optional in this build
  const btnSortHand = $('btn-sort-hand');
  const btnSkipBot = $('btn-skip-bot');
  const btnUndoPlayfield = $('btn-undo-playfield');
  const btnClearPlayfield = $('btn-clear-playfield');
  const xpNotifications = $('xp-notifications');
  const cheatPanel = $('cheat-panel');
  const btnCheatPanel = $('btn-cheat-panel');
  const btnCloseCheat = $('btn-close-cheat');
  const btnHelpTrigger = $('btn-help-trigger');
  const handP1El = $('hand-p1');
  const handP2El = $('hand-p2');
  // Expression history panel
  const exprHistoryPanel = $('expr-history-panel');
  const btnToggleExprHistory = $('btn-toggle-expr-history');
  const exprHistoryList = $('expr-history-list');
  const exprHistoryBadge = $('expr-history-badge');
  const exprHistoryEmpty = $('expr-history-empty');
  const exprHistoryRound = $('expr-history-round');
  // Chat panel
  const chatPanel = $('chat-panel');
  const btnToggleChat = $('btn-toggle-chat');
  const chatMessages = $('chat-messages');
  const chatInput = $('chat-input');
  const btnChatSend = $('btn-chat-send');
  const chatBadge = $('chat-badge');
  // Round badge
  const roundBadge = $('round-badge');

  let toastTimer = null;
  let turnNumber = 0;
  let chatUnreadCount = 0;

  // Multiplayer sync functions
  function writeGameState() {
    if (!isHost || !roomCode) return;
    try {
      const syncState = {
        version: lastSyncVersion + 1,
        players: gameState.players.map(p => ({
          id: p.id,
          name: p.name,
          score: p.score,
          hand: p.hand, // Full hand (host authority)
          scorePile: p.scorePile,
        })),
        activePlayer: gameState.activePlayer,
        target: gameState.target,
        turnTimer: gameState.turnTimer,
        deck: gameState.deck,
        discardPile: gameState.discardPile,
        playfield: gameState.playfield,
        gameOver: gameState.gameOver,
        winner: gameState.winner,
        drawsThisTurn: gameState.drawsThisTurn,
        timestamp: Date.now(),
      };
      localStorage.setItem(GAME_STATE_KEY + roomCode, JSON.stringify(syncState));
      lastSyncVersion = syncState.version;
    } catch (e) {
      console.error('Failed to write game state:', e);
    }
  }

  function readGameState() {
    if (!roomCode) return null;
    try {
      const raw = localStorage.getItem(GAME_STATE_KEY + roomCode);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      console.error('Failed to read game state:', e);
      return null;
    }
  }

  function syncFromStorage() {
    if (isHost) return; // Host doesn't sync from storage
    const syncState = readGameState();
    if (!syncState) return;
    
    // Only sync if version is newer
    if (syncState.version <= lastSyncVersion) return;
    lastSyncVersion = syncState.version;
    
    // Update game state (but preserve local UI state like selections)
    const oldActive = gameState.activePlayer;
    gameState.players = syncState.players.map(p => ({
      id: p.id,
      name: p.name,
      score: p.score,
      hand: p.hand,
      scorePile: p.scorePile,
    }));
    gameState.activePlayer = syncState.activePlayer;
    gameState.target = syncState.target;
    gameState.turnTimer = syncState.turnTimer;
    // Ensure timer tracking is initialized if not present
    if (gameState.turnTimerStart === undefined) {
      gameState.turnTimerStart = gameRules.turnTimerSec;
    }
    if (gameState.actualTimeElapsed === undefined) {
      gameState.actualTimeElapsed = 0;
    }
    gameState.deck = syncState.deck;
    gameState.discardPile = syncState.discardPile;
    gameState.playfield = syncState.playfield;
    gameState.gameOver = syncState.gameOver;
    gameState.winner = syncState.winner;
    gameState.drawsThisTurn = syncState.drawsThisTurn;
    
    // Update UI
    renderHands();
    renderPlayfield();
    updateTarget();
    updateTimer();
    updateTurn();
    updateScores();
    
    // If turn changed and it's now bot's turn, run bot
    if (oldActive !== gameState.activePlayer && isHost) {
      if (gameRules.allowBots && gameState.activePlayer === 2) {
        runBotTurn(2);
      } else if (gameRules.botP1 && gameState.activePlayer === 1) {
        runBotTurn(1);
      }
    }
    
    // If game over, show modal
    if (gameState.gameOver && gameOverModal && !gameOverModal.classList.contains('hidden')) {
      // Modal already shown, but update it
      const message = $('game-over-message');
      const finalScoreP1 = $('final-score-p1');
      const finalScoreP2 = $('final-score-p2');
      if (message && gameState.winner && gameState.players[gameState.winner - 1]) {
        message.textContent = `${gameState.players[gameState.winner - 1].name} wins!`;
      }
      if (finalScoreP1 && gameState.players[0]) finalScoreP1.textContent = formatScore(gameState.players[0].score);
      if (finalScoreP2 && gameState.players[1]) finalScoreP2.textContent = formatScore(gameState.players[1].score);
    }
  }

  function canMakeMove() {
    if (gameState.gameOver) return false;
    if (isHost && gameRules.allowBots && gameState.activePlayer === 2) return false; // P2 Bot's turn
    if (isHost && gameRules.botP1 && gameState.activePlayer === 1) return false; // P1 Bot's turn
    return gameState.activePlayer === myPlayerId;
  }

  function toast(message, tone = 'info') {
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.classList.remove('hidden');
    toastEl.dataset.tone = tone;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.classList.add('hidden');
    }, 2200);
  }

  let turnBannerEl = null;
  function showTurnBanner(text, isYours) {
    if (turnBannerEl) turnBannerEl.remove();
    const el = document.createElement('div');
    el.className = 'turn-banner' + (isYours ? ' turn-banner-mine' : '');
    el.textContent = text;
    document.querySelector('.gameplay-root')?.appendChild(el);
    turnBannerEl = el;
    setTimeout(() => {
      el.classList.add('turn-banner-fade');
      setTimeout(() => { el.remove(); if (turnBannerEl === el) turnBannerEl = null; }, 400);
    }, 800);
  }

  // XP Notification System (Call of Duty style)
  function showXPNotification(amount, label, type = 'default') {
    if (!xpNotifications) return;
    
    const notif = document.createElement('div');
    notif.className = `xp-notif xp-notif-${type}`;
    
    const amountEl = document.createElement('div');
    amountEl.className = 'xp-notif-amount';
    amountEl.textContent = amount > 0 ? `+${amount} XP` : label;
    
    const labelEl = document.createElement('div');
    labelEl.className = 'xp-notif-label';
    labelEl.textContent = amount > 0 ? label : '';
    
    notif.appendChild(amountEl);
    if (amount > 0) notif.appendChild(labelEl);
    xpNotifications.appendChild(notif);
    
    // Trigger animation
    requestAnimationFrame(() => {
      notif.classList.add('show');
    });
    
    // Remove after animation
    setTimeout(() => {
      notif.classList.add('hide');
      setTimeout(() => notif.remove(), 500);
    }, 2000);
  }

  // ═══════════════════════════════════════
  //  EXPRESSION HISTORY PANEL
  // ═══════════════════════════════════════
  let exprHistoryCount = 0;

  function addExpressionToHistory(playerId, expressionCards, target, value, roundNum) {
    exprHistoryCount++;
    if (exprHistoryEmpty) exprHistoryEmpty.style.display = 'none';

    const syms = { add:'+', sub:'−', mul:'×', div:'÷', mod:'%', pow:'^' };
    const exprStr = expressionCards.map(c => {
      if (c.type === CardType.Number) return c.value;
      if (c.type === CardType.Paren) return c.parenKind === ParenKind.Open ? '(' : ')';
      return syms[c.operatorKind] || '?';
    }).join(' ');

    const playerName = gameState.players[playerId - 1]?.name || `Player ${playerId}`;

    const item = document.createElement('div');
    item.className = 'expr-history-item';
    item.innerHTML = `
      <div class="expr-player p${playerId}">${playerName}</div>
      <div class="expr-text">${exprStr} = ${value}</div>
      <div class="expr-meta">Target: ${target} · Round ${roundNum}</div>
    `;

    if (exprHistoryList) {
      exprHistoryList.appendChild(item);
      exprHistoryList.scrollTop = exprHistoryList.scrollHeight;
    }

    // Update badge
    if (exprHistoryBadge) {
      exprHistoryBadge.textContent = exprHistoryCount;
      exprHistoryBadge.classList.add('has-items');
    }
  }

  function updateRoundCounter() {
    const round = Math.floor(turnNumber / 2) + 1;
    if (roundBadge) roundBadge.textContent = `R${round}`;
    if (exprHistoryRound) exprHistoryRound.textContent = `Round ${round}`;
  }

  function addOnlineExpressionToHistory(playerId, exprStr, target) {
    exprHistoryCount++;
    if (exprHistoryEmpty) exprHistoryEmpty.style.display = 'none';
    const playerName = gameState.players[playerId - 1]?.name || `Player ${playerId}`;
    const round = Math.floor(turnNumber / 2) + 1;
    const item = document.createElement('div');
    item.className = 'expr-history-item';
    item.innerHTML = `
      <div class="expr-player p${playerId}">${playerName}</div>
      <div class="expr-text">${escapeHtml(exprStr)} = ${target}</div>
      <div class="expr-meta">Target: ${target} · Round ${round}</div>
    `;
    if (exprHistoryList) {
      exprHistoryList.appendChild(item);
      exprHistoryList.scrollTop = exprHistoryList.scrollHeight;
    }
    if (exprHistoryBadge) {
      exprHistoryBadge.textContent = exprHistoryCount;
      exprHistoryBadge.classList.add('has-items');
    }
  }

  function clearExpressionHistory() {
    exprHistoryCount = 0;
    if (exprHistoryList) exprHistoryList.innerHTML = '';
    if (exprHistoryEmpty) exprHistoryEmpty.style.display = '';
    if (exprHistoryBadge) {
      exprHistoryBadge.textContent = '0';
      exprHistoryBadge.classList.remove('has-items');
    }
  }

  if (btnToggleExprHistory) {
    btnToggleExprHistory.addEventListener('click', () => {
      exprHistoryPanel.classList.toggle('collapsed');
    });
  }

  // ═══════════════════════════════════════
  //  IN-GAME CHAT
  // ═══════════════════════════════════════
  function initChat() {
    // Show chat panel only in online multiplayer
    if (!onlineGame || !chatPanel) return;
    chatPanel.classList.remove('hidden');

    if (btnToggleChat) {
      btnToggleChat.addEventListener('click', () => {
        chatPanel.classList.toggle('collapsed');
        if (!chatPanel.classList.contains('collapsed')) {
          chatUnreadCount = 0;
          if (chatBadge) { chatBadge.textContent = '0'; chatBadge.classList.add('hidden'); }
          if (chatInput) chatInput.focus();
        }
      });
    }

    if (btnChatSend) {
      btnChatSend.addEventListener('click', sendChatMessage);
    }

    if (chatInput) {
      chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { sendChatMessage(); e.preventDefault(); }
        e.stopPropagation(); // Prevent gameplay shortcuts while typing
      });
      chatInput.addEventListener('keyup', (e) => e.stopPropagation());
    }

    // Listen for chat messages from server
    if (window.MMtpNet) {
      MMtpNet.on('chat', (data) => {
        appendChatMessage(data.playerId, data.name, data.message);
      });
    }
  }

  function sendChatMessage() {
    if (!chatInput || !chatInput.value.trim()) return;
    const msg = chatInput.value.trim();
    chatInput.value = '';
    if (window.MMtpNet && MMtpNet.isOnline) {
      MMtpNet.sendChat(msg);
    }
  }

  function appendChatMessage(playerId, name, message, isSystem = false) {
    if (!chatMessages) return;

    const msgEl = document.createElement('div');
    msgEl.className = isSystem ? 'chat-msg system-msg' : 'chat-msg';
    msgEl.innerHTML = `<span class="chat-sender ${isSystem ? 'system' : 'p' + playerId}">${name}:</span> <span class="chat-text">${escapeHtml(message)}</span>`;
    chatMessages.appendChild(msgEl);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    // Update unread badge if panel is collapsed
    if (chatPanel && chatPanel.classList.contains('collapsed') && !isSystem) {
      chatUnreadCount++;
      if (chatBadge) {
        chatBadge.textContent = chatUnreadCount;
        chatBadge.classList.remove('hidden');
      }
      if (window.SFX) SFX.play('buttonClick');
    }
  }

  function appendSystemChatMessage(message) {
    appendChatMessage(0, '⚙️ System', message, true);
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // Initialize deck
  function createDeck() {
    const deck = [];
    const useSpecials = gameRules.specialCards !== false;
    // Distribution: ~60% numbers, ~25% operators, ~5% parens, ~7% special (if enabled), ~3% advanced ops
    for (let i = 0; i < 100; i++) {
      const roll = Math.random();
      if (useSpecials && roll < 0.07) {
        // Special cards
        const specials = [SpecialKind.Wild, SpecialKind.Reroll, SpecialKind.Double, SpecialKind.Peek, SpecialKind.Swap];
        deck.push({ type: CardType.Special, specialKind: specials[Math.floor(Math.random() * specials.length)] });
      } else if (roll < (useSpecials ? 0.12 : 0.05)) {
        // Parenthesis cards
        deck.push({ type: CardType.Paren, parenKind: Math.random() < 0.5 ? ParenKind.Open : ParenKind.Close });
      } else if (roll < (useSpecials ? 0.37 : 0.32)) {
        // Common ops: +, -, × (80%), rare ops: %, ^ (20%)
        const r2 = Math.random();
        let ops;
        if (r2 < 0.8) {
          ops = [OperatorKind.Add, OperatorKind.Sub, OperatorKind.Mul];
        } else {
          ops = [OperatorKind.Mod, OperatorKind.Pow];
        }
        deck.push({ type: CardType.Operator, operatorKind: ops[Math.floor(Math.random() * ops.length)] });
      } else {
        deck.push({ type: CardType.Number, value: Math.floor(Math.random() * 10) });
      }
    }
    // Shuffle
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
  }

  function randomTarget() {
    return Math.floor(Math.random() * (gameRules.targetMax - gameRules.targetMin + 1)) + gameRules.targetMin;
  }

  // ── Placement validation — delegates to shared expression module ──
  const clientCanPlaceCard = sharedCanPlaceCard;
  const clientValidateParenBalance = sharedValidateParenBalance;
  const clientHasParens = sharedHasParens;

  function shuffleDeck() {
    // Shuffle the current deck
    for (let i = gameState.deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [gameState.deck[i], gameState.deck[j]] = [gameState.deck[j], gameState.deck[i]];
    }
  }

  function drawCard(playerId, silent = false) {
    // ── Online: send to server ──
    if (onlineGame && playerId === myPlayerId) {
      netAction('draw').then(res => {
        if (!res.ok) toast(res.error || 'Cannot draw', 'warning');
      });
      return;
    }

    const player = gameState.players[playerId - 1];
    
    // Check hand limit
    if (gameRules.handLimit > 0 && player.hand.length >= gameRules.handLimit) {
      // Must discard first
      if (gameRules.discardMethod === 'player-select') {
        toast('Hand full! Drag a card to Discard, or select it and press Delete.', 'warning');
        return null;
      } else if (gameRules.discardMethod === 'oldest') {
        player.hand.shift(); // Remove oldest
      } else if (gameRules.discardMethod === 'random') {
        const idx = Math.floor(Math.random() * player.hand.length);
        gameState.discardPile.push(player.hand[idx]);
        player.hand.splice(idx, 1);
      }
    }

    // Draw from deck
    if (gameState.deck.length === 0) {
      // Reshuffle discard pile
      if (gameState.discardPile.length === 0) {
        // No cards left
        return null;
      }
      gameState.deck = [...gameState.discardPile];
      gameState.discardPile = [];
      for (let i = gameState.deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [gameState.deck[i], gameState.deck[j]] = [gameState.deck[j], gameState.deck[i]];
      }
      toast(`🔄 Deck reshuffled! ${gameState.deck.length} cards recycled from discard pile`, 'info');
      if (window.SFX) SFX.play('reshuffle');
      if (btnDraw) {
        btnDraw.classList.add('deck-reshuffled');
        // Show reshuffle count badge
        const badge = document.createElement('div');
        badge.className = 'deck-reshuffle-badge';
        badge.textContent = `+${gameState.deck.length}`;
        btnDraw.style.position = 'relative';
        btnDraw.appendChild(badge);
        setTimeout(() => {
          btnDraw.classList.remove('deck-reshuffled');
          badge.remove();
        }, 2000);
      }
      renderDiscardPile();
    }

    const card = gameState.deck.pop();
    if (card) {
      player.hand.push(card);
      // Track cards drawn
      gameState.matchStats.players[playerId - 1].cardsDrawn++;
      if (!silent) {
        const playerName = gameState.players[playerId - 1].name || `Player ${playerId}`;
        dbg(`[${playerName}] Drew card: ${card.type === CardType.Number ? card.value : 'OP'}`);
        if (window.SFX) SFX.play('cardDraw');
      }
    }
    return card;
  }

  function animateCardFly(fromEl, toEl, labelText) {
    try {
      if (!fromEl || !toEl) return;
      if (localStorage.getItem('mmtp-card-animations') === 'false') return;
      const from = fromEl.getBoundingClientRect();
      const to = toEl.getBoundingClientRect();

      const temp = document.createElement('div');
      temp.className = 'card';
      temp.style.position = 'fixed';
      temp.style.left = `${from.left}px`;
      temp.style.top = `${from.top}px`;
      temp.style.width = `${from.width}px`;
      temp.style.height = `${from.height}px`;
      temp.style.zIndex = '2000';
      temp.style.pointerEvents = 'none';
      temp.style.transform = `rotate(${(Math.random() * 10 - 5).toFixed(1)}deg)`;

      const content = document.createElement('div');
      content.className = 'card-content';
      const v = document.createElement('div');
      v.className = 'card-value';
      v.style.fontSize = '16px';
      v.textContent = labelText || '';
      content.appendChild(v);
      temp.appendChild(content);

      document.body.appendChild(temp);

      const dx = (to.left + to.width / 2) - (from.left + from.width / 2);
      const dy = (to.top + to.height / 2) - (from.top + from.height / 2);

      temp.animate(
        [
          { transform: temp.style.transform, opacity: 0.9 },
          { transform: `translate(${dx}px, ${dy}px) rotate(${(Math.random() * 40 - 20).toFixed(1)}deg) scale(0.85)`, opacity: 0.0 },
        ],
        { duration: 450, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }
      ).onfinish = () => temp.remove();
    } catch (_) {}
  }

  function handleDrawClick() {
    if (gameState.gameOver) return;
    if (!canMakeMove()) {
      toast('Not your turn', 'warning');
      return;
    }
    const playerId = gameState.activePlayer;
    const targetHand = playerId === 1 ? cardsP1 : cardsP2;
    if (!targetHand) return;

    // Respect per-click and per-turn draw limits
    const perClick = Math.max(1, gameRules.minDrawPerClick || 1);
    let remaining = perClick;
    if (gameRules.maxDrawPerTurn > 0) {
      const leftThisTurn = gameRules.maxDrawPerTurn - gameState.drawsThisTurn;
      if (leftThisTurn <= 0) {
        toast('Draw limit reached for this turn', 'info');
        return;
      }
      remaining = Math.min(perClick, leftThisTurn);
    }

    let drawn = 0;
    for (let i = 0; i < remaining; i++) {
      const card = drawCard(playerId);
      if (!card) {
        if (drawn === 0) toast('No cards left to draw', 'info');
        break;
      }
      drawn++;
      animateCardFly(btnDraw, targetHand, card.type === CardType.Number ? String(card.value) : 'OP');
    }

    if (drawn > 0) {
      gameState.drawsThisTurn += drawn;
      if (localStorage.getItem('mmtp-auto-sort-hand') === 'true') {
        sortHand(playerId);
      }
      renderHands();
      updateDeckCount();
      writeGameState(); // Sync after draw
    }
  }

  function dealInitialHands() {
    for (let i = 0; i < gameRules.handSize; i++) {
      drawCard(1);
      drawCard(2);
    }
    if (localStorage.getItem('mmtp-auto-sort-hand') === 'true') {
      sortHand(1);
      sortHand(2);
    }
  }

  function renderCard(card, playerId, index) {
    const cardEl = document.createElement('div');
    cardEl.className = 'card';
    cardEl.dataset.playerId = playerId;
    cardEl.dataset.index = index;
    cardEl.draggable = playerId === gameState.activePlayer && !gameState.gameOver;
    
    if (playerId === 2) {
      // Player 2 cards face down
      cardEl.classList.add('face-down');
    } else {
      // Player 1 cards face up
      const content = document.createElement('div');
      content.className = 'card-content';
      
      if (card.type === CardType.Number) {
        const value = document.createElement('div');
        value.className = 'card-value';
        value.textContent = card.value;
        content.appendChild(value);
        const type = document.createElement('div');
        type.className = 'card-type';
        type.textContent = card.wasWild ? 'Wild' : 'Number';
        content.appendChild(type);
        if (card.wasWild) cardEl.classList.add('was-wild');
      } else if (card.type === CardType.Operator) {
        if (card.operatorKind === OperatorKind.Mod || card.operatorKind === OperatorKind.Pow) {
          cardEl.classList.add('card-advanced-op');
        }
        const op = document.createElement('div');
        op.className = 'card-operator';
        const opSymbols = { add: '+', sub: '−', mul: '×', div: '÷', mod: '%', pow: '^' };
        op.textContent = opSymbols[card.operatorKind] || '?';
        content.appendChild(op);
        const type = document.createElement('div');
        type.className = 'card-type';
        type.textContent = (card.operatorKind === OperatorKind.Mod) ? 'Modulo' :
                           (card.operatorKind === OperatorKind.Pow) ? 'Power' : 'Operator';
        content.appendChild(type);
      } else if (card.type === CardType.Paren) {
        cardEl.classList.add('card-paren', `card-paren-${card.parenKind}`);
        const symbol = document.createElement('div');
        symbol.className = 'card-paren-symbol';
        symbol.textContent = card.parenKind === ParenKind.Open ? '(' : ')';
        content.appendChild(symbol);
        const label = document.createElement('div');
        label.className = 'card-type';
        label.textContent = card.parenKind === ParenKind.Open ? 'Open' : 'Close';
        content.appendChild(label);
      } else if (card.type === CardType.Special) {
        cardEl.classList.add('special-card', `special-${card.specialKind}`);
        const icon = document.createElement('div');
        icon.className = 'card-special-icon';
        const iconMap = { wild: '★', reroll: '🎯', double: '×2', peek: '👁', swap: '🔄' };
        icon.textContent = iconMap[card.specialKind] || '?';
        content.appendChild(icon);
        const label = document.createElement('div');
        label.className = 'card-type';
        const labelMap = { wild: 'Wild', reroll: 'Reroll', double: 'Double', peek: 'Peek', swap: 'Swap' };
        label.textContent = labelMap[card.specialKind] || 'Special';
        content.appendChild(label);
      }
      
      cardEl.appendChild(content);
    }
    
    // QoL: Click to place directly on playfield (no selection step)
    // Hover shows discard button, click to discard
    // Right-click or Ctrl+click for multi-select
    cardEl.addEventListener('click', (e) => {
      if (playerId !== 1) return; // P2 hand is face-down in this test build
      if (playerId !== gameState.activePlayer) return; // Only active player can play
      if (gameState.gameOver) return;
      
      // Check if clicking on discard button (if it exists)
      if (e.target.classList.contains('discard-btn') || e.target.closest('.discard-btn')) {
        e.stopPropagation();
        discardCard(playerId, index, true, false);
        return;
      }
      
      // Right-click or Ctrl+click: multi-select mode
      if (e.button === 2 || e.ctrlKey || e.metaKey) {
        e.preventDefault();
        toggleCardSelection(playerId, index);
      } else {
        // Regular click: place directly on playfield
        const card = gameState.players[playerId - 1].hand[index];
        if (!card) return;

        // Special card handling
        if (card.type === CardType.Special) {
          handleSpecialCardClick(playerId, index, card);
          return;
        }
        
        // Set as selected temporarily for placement
        gameState.selectedCard = { playerId, index, card };
        // Try to place immediately
        const beforeLen = gameState.playfield.length;
        placeCardOnPlayfield();
        if (gameState.playfield.length === beforeLen) {
          // Placement failed (invalid pattern) - fall back to selection mode
          selectCard(playerId, index);
        } else {
          // Placement succeeded - clear selection
          clearSelection();
        }
      }
    });
    
    // Add discard button on hover (only for active player)
    if (playerId === gameState.activePlayer && playerId === 1) {
      const discardBtn = document.createElement('button');
      discardBtn.className = 'discard-btn';
      discardBtn.textContent = '×';
      discardBtn.title = 'Discard this card';
      discardBtn.style.display = 'none';
      cardEl.appendChild(discardBtn);
      
      cardEl.addEventListener('mouseenter', () => {
        if (playerId === gameState.activePlayer && !gameState.gameOver) {
          discardBtn.style.display = 'block';
        }
      });
      
      cardEl.addEventListener('mouseleave', () => {
        discardBtn.style.display = 'none';
      });
    }
    
    // Prevent context menu on right-click (for multi-select)
    cardEl.addEventListener('contextmenu', (e) => {
      if (playerId === gameState.activePlayer && !gameState.gameOver) {
        e.preventDefault();
        toggleCardSelection(playerId, index);
      }
    });
      
    // Drag and drop (reorder always; play/discard only on active turn)
    cardEl.addEventListener('dragstart', (e) => {
      gameState.isDragging = true;
      gameState.dragValidDrop = false; // Reset drop flag
      cardEl.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';

      // Discard zone removed - no visual indicator needed

      // If this card is part of a mass selection, drag the group (active turn only)
      const isSelected = cardEl.classList.contains('selected');
      if (playerId === gameState.activePlayer && isSelected && gameState.selectedCards && gameState.selectedCards.length > 0) {
        const payload = gameState.selectedCards
          .filter((c) => c.playerId === playerId)
          .map((c) => ({ playerId: c.playerId, index: c.index }));
        e.dataTransfer.setData('application/json', JSON.stringify({ type: 'multi', cards: payload }));
      } else {
        e.dataTransfer.setData('text/plain', `${playerId}-${index}`);
      }
    });
      
    cardEl.addEventListener('dragend', (e) => {
      const wasDragging = gameState.isDragging;
      gameState.isDragging = false;
      cardEl.classList.remove('dragging');
      
      // If drag ended outside valid drop zones (hand, playfield), discard the card
      if (wasDragging && !gameState.dragValidDrop && playerId === gameState.activePlayer && !gameState.gameOver && canMakeMove()) {
        // Check current mouse position to see if it's over a valid drop zone
        const point = { x: e.clientX, y: e.clientY };
        const elementAtPoint = document.elementFromPoint(point.x, point.y);
        
        const isOverHand = elementAtPoint?.closest('.hand') || elementAtPoint?.closest('.card');
        const isOverPlayfield = elementAtPoint?.closest('#playfield');
        
        // If not over hand or playfield, discard
        if (!isOverHand && !isOverPlayfield) {
          dbg(`[Drag] Card dragged off panel, discarding`);
          discardCard(playerId, index, true, false);
        }
      }
      
      gameState.dragValidDrop = false; // Reset for next drag
    });

      // Reorder within hand: drop another hand card on this card
      cardEl.addEventListener('dragover', (e) => {
        if (!gameState.isDragging) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      });

      cardEl.addEventListener('drop', (e) => {
        e.preventDefault();
        const data = e.dataTransfer.getData('text/plain');
        if (!data) return;
        const [fromPlayerId, fromIndex] = data.split('-').map(Number);
        if (fromPlayerId !== playerId) return;
        if (Number.isNaN(fromIndex)) return;
        if (fromIndex === index) return;

        const player = gameState.players[playerId - 1];
        if (!player?.hand) return;

        const moved = player.hand.splice(fromIndex, 1)[0];
        if (!moved) return;
        const insertAt = fromIndex < index ? index - 1 : index;
        player.hand.splice(insertAt, 0, moved);

        // Re-render to update indices
        renderHands();
      });
    if (playerId !== gameState.activePlayer) {
      // Not disabled anymore; prep interaction allowed. Visually dim a bit.
      cardEl.style.opacity = '0.85';
    }
    
    return cardEl;
  }

  function renderHands() {
    cardsP1.innerHTML = '';
    cardsP2.innerHTML = '';

    // Hand fullness indicator (header level)
    const limit = gameRules.handLimit > 0 ? gameRules.handLimit : gameRules.handSize;
    if (handCountP1) handCountP1.textContent = `${gameState.players[0].hand.length}/${limit}`;
    
    gameState.players[0].hand.forEach((card, idx) => {
      cardsP1.appendChild(renderCard(card, 1, idx));
    });
    
    gameState.players[1].hand.forEach((card, idx) => {
      cardsP2.appendChild(renderCard(card, 2, idx));
    });
    
    // Setup drag-to-select for active player's hand
    setupDragToSelect(1);
  }
  
  // Drag-to-select: drag a box to select multiple cards
  function setupDragToSelect(playerId) {
    const container = playerId === 1 ? cardsP1 : cardsP2;
    if (!container) return;
    
    // Create selection box element
    if (!gameState.dragSelectBox) {
      const box = document.createElement('div');
      box.id = 'drag-select-box';
      box.className = 'drag-select-box';
      box.style.display = 'none';
      document.body.appendChild(box);
      gameState.dragSelectBox = box;
    }
    
    let isSelecting = false;
    let startX = 0, startY = 0;
    
    container.addEventListener('mousedown', (e) => {
      // Don't start selection if clicking on a card, discard button, or card content
      if (e.target.closest('.card') || e.target.closest('.discard-btn') || e.target.closest('.card-content')) {
        return; // Let card handle its own click
      }
      
      // Only start selection if clicking on empty space (not a card) and not shift-clicking
      // Also don't start if we're already dragging a card
      if ((e.target === container || e.target.closest('.hand-header')) && !gameState.isDragging) {
        if (!e.shiftKey && e.button === 0 && playerId === gameState.activePlayer) { // Left click, no shift, active player
          isSelecting = true;
          gameState.isDragSelecting = true;
          startX = e.clientX;
          startY = e.clientY;
          gameState.dragSelectStart = { x: startX, y: startY };
          
          const box = gameState.dragSelectBox;
          box.style.left = startX + 'px';
          box.style.top = startY + 'px';
          box.style.width = '0px';
          box.style.height = '0px';
          box.style.display = 'block';
          
          e.preventDefault();
        }
      }
    });
    
    document.addEventListener('mousemove', (e) => {
      if (!isSelecting || !gameState.isDragSelecting) return;
      
      const box = gameState.dragSelectBox;
      const currentX = e.clientX;
      const currentY = e.clientY;
      
      const left = Math.min(startX, currentX);
      const top = Math.min(startY, currentY);
      const width = Math.abs(currentX - startX);
      const height = Math.abs(currentY - startY);
      
      box.style.left = left + 'px';
      box.style.top = top + 'px';
      box.style.width = width + 'px';
      box.style.height = height + 'px';
      
      // Select cards that intersect with the box
      const boxRect = { left, top, width, height };
      const cards = container.querySelectorAll('.card');
      cards.forEach((cardEl, idx) => {
        const cardRect = cardEl.getBoundingClientRect();
        const intersects = !(
          cardRect.right < boxRect.left ||
          cardRect.left > boxRect.left + boxRect.width ||
          cardRect.bottom < boxRect.top ||
          cardRect.top > boxRect.top + boxRect.height
        );
        
        if (intersects) {
          // Add to selection
          const key = `${playerId}-${idx}`;
          const existing = gameState.selectedCards.find(c => `${c.playerId}-${c.index}` === key);
          if (!existing) {
            const card = gameState.players[playerId - 1].hand[idx];
            if (card) {
              gameState.selectedCards.push({ playerId, index: idx, card });
              cardEl.classList.add('selected');
            }
          }
        }
      });
    });
    
    document.addEventListener('mouseup', (e) => {
      if (isSelecting) {
        isSelecting = false;
        gameState.isDragSelecting = false;
        if (gameState.dragSelectBox) {
          gameState.dragSelectBox.style.display = 'none';
        }
        gameState.dragSelectStart = null;
      }
    });
  }

  function enableHandDropReorder(playerId) {
    const container = playerId === 1 ? cardsP1 : cardsP2;
    if (!container) return;

    container.addEventListener('dragover', (e) => {
      if (!gameState.isDragging) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';

      // Highlight which card would be replaced/shifted into
      const cards = Array.from(container.querySelectorAll('.card'));
      let targetIdx = cards.length - 1;
      for (let i = 0; i < cards.length; i++) {
        const r = cards[i].getBoundingClientRect();
        if (e.clientX < r.left + r.width / 2) {
          targetIdx = i;
          break;
        }
      }
      cards.forEach((el, idx) => {
        el.classList.toggle('reorder-target', idx === targetIdx);
      });
    });

    container.addEventListener('drop', (e) => {
      if (!gameState.isDragging) return;
      e.preventDefault();
      gameState.dragValidDrop = true; // Mark as valid drop

      const data = e.dataTransfer.getData('text/plain');
      if (!data) return;
      const [fromPlayerId, fromIndex] = data.split('-').map(Number);
      if (fromPlayerId !== playerId) return;

      const player = gameState.players[playerId - 1];
      if (!player?.hand) return;
      const moved = player.hand[fromIndex];
      if (!moved) return;

      // Determine insert index by mouse X relative to cards
      const cards = Array.from(container.querySelectorAll('.card'));
      let insertAt = player.hand.length - 1;
      for (let i = 0; i < cards.length; i++) {
        const r = cards[i].getBoundingClientRect();
        if (e.clientX < r.left + r.width / 2) {
          insertAt = i;
          break;
        }
      }

      player.hand.splice(fromIndex, 1);
      if (fromIndex < insertAt) insertAt -= 1;
      player.hand.splice(Math.max(0, insertAt), 0, moved);

      renderHands();
      // Clear highlight
      container.querySelectorAll('.reorder-target').forEach((el) => el.classList.remove('reorder-target'));
    });
  }

  // (hand count badge helper removed – count is now header-level)

  function clearSelection() {
    gameState.selectedCard = null;
    gameState.selectedCards = [];
    document.querySelectorAll('.card.selected').forEach((el) => el.classList.remove('selected'));
    playfield.style.cursor = 'default';
  }

  function selectCard(playerId, index) {
    if (playerId !== gameState.activePlayer) return;
    if (gameState.gameOver) return;

    // Single select clears mass selection
    gameState.selectedCards = [];

    // If clicking the same card again -> deselect
    if (
      gameState.selectedCard &&
      gameState.selectedCard.playerId === playerId &&
      gameState.selectedCard.index === index
    ) {
      clearSelection();
      return;
    }

    // Deselect previous
    document.querySelectorAll('.card.selected').forEach((el) => el.classList.remove('selected'));

    const card = gameState.players[playerId - 1].hand[index];
    gameState.selectedCard = { playerId, index, card };
    
    // Highlight selected
    const cardEl = document.querySelector(`.card[data-player-id="${playerId}"][data-index="${index}"]`);
    if (cardEl) cardEl.classList.add('selected');
    
    // Enable playfield
    playfield.style.cursor = 'pointer';
    if (window.SFX) SFX.play('cardSelect');
  }

  function discardCard(playerId, index, animated = true, silent = false) {
    if (gameState.gameOver) return;
    if (!canMakeMove() || playerId !== gameState.activePlayer) {
      if (playerId === myPlayerId) toast('Not your turn', 'warning');
      return;
    }

    // ── Online: send to server ──
    if (onlineGame && playerId === myPlayerId) {
      const player = gameState.players[playerId - 1];
      const card = player.hand[index];
      if (card && card.id !== undefined) {
        netAction('discard', { cardId: card.id }).then(res => {
          if (!res.ok) toast(res.error || 'Cannot discard', 'warning');
        });
        return;
      }
    }

    const player = gameState.players[playerId - 1];
    const card = player.hand[index];
    if (!card) return;

    const cardEl = document.querySelector(`.card[data-player-id="${playerId}"][data-index="${index}"]`);
    if (window.SFX) SFX.play('cardDiscard');

    if (animated && cardEl) {
      // Animate discard (animate to bottom-right corner where discard zone used to be)
      const cardRect = cardEl.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const dx = (viewportWidth - 20) - (cardRect.left + cardRect.width / 2); // Bottom-right corner
      const dy = -((viewportHeight - 20) - (cardRect.top + cardRect.height / 2)); // Negative = upward
      
      cardEl.style.setProperty('--discard-x', `${dx}px`);
      cardEl.style.setProperty('--discard-y', `${dy}px`);
      cardEl.classList.add('discarding');
      
      setTimeout(() => {
        gameState.discardPile.push(card);
        player.hand.splice(index, 1);
        // Track cards discarded
        gameState.matchStats.players[playerId - 1].cardsDiscarded++;
        
        if (
          gameState.selectedCard &&
          gameState.selectedCard.playerId === playerId &&
          gameState.selectedCard.index === index
        ) {
          clearSelection();
        }
        
        if (!silent) {
          const playerName = gameState.players[playerId - 1].name || `Player ${playerId}`;
          const cardDesc = card.type === CardType.Number ? card.value : 'OP';
          dbg(`[${playerName}] Discarded card: ${cardDesc}`);
        }
        renderHands();
        updateDeckCount();
        renderDiscardPile(); // Update discard pile visualization
        writeGameState(); // Sync after discard
      }, 600);
    } else {
      // Instant discard (for rehand)
      gameState.discardPile.push(card);
      player.hand.splice(index, 1);
      // Track cards discarded
      gameState.matchStats.players[playerId - 1].cardsDiscarded++;
      if (!silent) {
        const playerName = gameState.players[playerId - 1].name || `Player ${playerId}`;
        const cardDesc = card.type === CardType.Number ? card.value : 'OP';
        dbg(`[${playerName}] Discarded card: ${cardDesc}`);
      }
      
      if (
        gameState.selectedCard &&
        gameState.selectedCard.playerId === playerId &&
        gameState.selectedCard.index === index
      ) {
        clearSelection();
      }
      
      renderHands();
      updateDeckCount();
      renderDiscardPile(); // Update discard pile visualization
      writeGameState(); // Sync after discard
    }
  }
  
  function toggleCardSelection(playerId, index) {
    if (playerId !== gameState.activePlayer) return;
    if (gameState.gameOver) return;
    
    const key = `${playerId}-${index}`;
    const idx = gameState.selectedCards.findIndex(c => `${c.playerId}-${c.index}` === key);
    
    if (idx >= 0) {
      gameState.selectedCards.splice(idx, 1);
      const cardEl = document.querySelector(`.card[data-player-id="${playerId}"][data-index="${index}"]`);
      if (cardEl) cardEl.classList.remove('selected');
    } else {
      const card = gameState.players[playerId - 1].hand[index];
      gameState.selectedCards.push({ playerId, index, card });
      const cardEl = document.querySelector(`.card[data-player-id="${playerId}"][data-index="${index}"]`);
      if (cardEl) cardEl.classList.add('selected');
    }

    // Keep last toggled as the "primary" selection for keyboard
    const last = gameState.selectedCards[gameState.selectedCards.length - 1] || null;
    gameState.selectedCard = last ? { playerId: last.playerId, index: last.index, card: last.card } : null;
    playfield.style.cursor = gameState.selectedCard || gameState.selectedCards.length ? 'pointer' : 'default';
  }

  function placeSelectedCardsOnPlayfield() {
    if (gameState.gameOver) return;
    if (!canMakeMove()) {
      toast('Not your turn', 'warning');
      return;
    }

    // Prefer mass selection if present
    if (gameState.selectedCards && gameState.selectedCards.length > 0) {
      // Place in the order selected (safe by card reference)
      const toPlace = [...gameState.selectedCards];
      for (const sel of toPlace) {
        const player = gameState.players[sel.playerId - 1];
        const currentIdx = player.hand.findIndex((c) => c === sel.card);
        if (currentIdx < 0) continue;
        gameState.selectedCard = { playerId: sel.playerId, index: currentIdx, card: sel.card };
        const beforeLen = gameState.playfield.length;
        placeCardOnPlayfield();
        if (gameState.playfield.length === beforeLen) {
          // placement rejected (invalid pattern) -> stop
          break;
        }
      }
      // Clear after attempting
      gameState.selectedCards = [];
      gameState.selectedCard = null;
      renderPlayfield();
      writeGameState(); // Sync after placing cards
      return;
    }

    // Fallback single
    if (gameState.selectedCard) {
      placeCardOnPlayfield();
      renderPlayfield();
      writeGameState(); // Sync after placing card
    }
  }

  // ── Special Card Handlers ──
  function handleSpecialCardClick(playerId, index, card) {
    if (window.SFX) SFX.play('click');
    
    if (card.specialKind === SpecialKind.Wild) {
      // Show number picker overlay
      showWildPicker(playerId, index, card);
    } else if (card.specialKind === SpecialKind.Reroll) {
      useSpecialCard(playerId, index, card, 'reroll');
    } else if (card.specialKind === SpecialKind.Double) {
      useSpecialCard(playerId, index, card, 'double');
    } else if (card.specialKind === SpecialKind.Peek) {
      useSpecialCard(playerId, index, card, 'peek');
    } else if (card.specialKind === SpecialKind.Swap) {
      useSpecialCard(playerId, index, card, 'swap');
    }
  }

  function showWildPicker(playerId, index, card) {
    // Remove any existing picker
    const existing = document.querySelector('.wild-picker-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'wild-picker-overlay';
    overlay.innerHTML = `
      <div class="wild-picker">
        <div class="wild-picker-title">Choose a number (0-9)</div>
        <div class="wild-picker-grid">
          ${[0,1,2,3,4,5,6,7,8,9].map(n => 
            `<button class="wild-picker-btn" data-value="${n}">${n}</button>`
          ).join('')}
        </div>
        <button class="wild-picker-cancel">Cancel</button>
      </div>
    `;

    overlay.addEventListener('click', (e) => {
      const btn = e.target.closest('.wild-picker-btn');
      if (btn) {
        const chosenValue = parseInt(btn.dataset.value, 10);
        overlay.remove();
        placeWildCard(playerId, index, card, chosenValue);
        return;
      }
      if (e.target.closest('.wild-picker-cancel') || e.target === overlay) {
        overlay.remove();
      }
    });

    document.body.appendChild(overlay);
  }

  function placeWildCard(playerId, index, card, chosenValue) {
    if (window.SFX) SFX.play('cardPlace');
    
    if (onlineGame) {
      // Online: send to server with wildValue
      netAction('placeCard', { cardId: card.id, wildValue: chosenValue });
      return;
    }

    // Local: convert Wild to number and place
    const hand = gameState.players[playerId - 1].hand;
    const resolvedCard = { type: CardType.Number, value: chosenValue, wasWild: true };
    const pf = gameState.playfield;

    // Validate placement pattern
    if (pf.length === 0 || pf[pf.length - 1].type === CardType.Operator) {
      hand.splice(index, 1);
      pf.push(resolvedCard);
      gameState.matchStats.players[playerId - 1].cardsPlayed++;
      renderHand(playerId);
      renderPlayfield();
      renderDeck();
      updateExpressionPreview();
      if (window.SFX) SFX.play('cardPlace');
      writeGameState();
    } else {
      toast('Need an operator before another number', 'warning');
    }
  }

  function useSpecialCard(playerId, index, card, kind) {
    if (onlineGame) {
      netAction('useSpecial', { cardId: card.id, specialKind: kind });
      return;
    }

    // Local mode
    const hand = gameState.players[playerId - 1].hand;
    hand.splice(index, 1);
    gameState.discardPile.push(card);

    if (kind === 'reroll') {
      const oldTarget = gameState.target;
      gameState.target = randomTarget();
      toast(`🎯 Target rerolled! ${oldTarget} → ${gameState.target}`, 'success');
      if (window.SFX) SFX.play('score');
      updateTarget();
    } else if (kind === 'double') {
      gameState.doubleNext[playerId] = true;
      toast('×2 activated! Next score counts double.', 'success');
      if (window.SFX) SFX.play('turnChange');
    } else if (kind === 'peek') {
      // Local: reveal opponent's hand for 5 seconds
      const oppId = playerId === 1 ? 2 : 1;
      const oppHand = gameState.players[oppId - 1].hand;
      showPeekOverlay(oppHand);
      toast('👁 Peeking at opponent\'s hand!', 'success');
      if (window.SFX) SFX.play('turnChange');
    } else if (kind === 'swap') {
      // Local: swap a random non-special card with opponent
      const oppId = playerId === 1 ? 2 : 1;
      const myHand = gameState.players[playerId - 1].hand;
      const oppHand = gameState.players[oppId - 1].hand;
      const mySwappable = myHand.filter(c => c.type !== CardType.Special);
      const oppSwappable = oppHand.filter(c => c.type !== CardType.Special);
      if (mySwappable.length === 0 || oppSwappable.length === 0) {
        toast('No cards available to swap!', 'error');
        // Re-add card to hand since we already removed it
        hand.push(card);
        gameState.discardPile.pop();
        renderHand(playerId);
        renderDeck();
        return;
      }
      const myCard = mySwappable[Math.floor(Math.random() * mySwappable.length)];
      const oppCard = oppSwappable[Math.floor(Math.random() * oppSwappable.length)];
      const myIdx = myHand.indexOf(myCard);
      const oppIdx = oppHand.indexOf(oppCard);
      myHand[myIdx] = oppCard;
      oppHand[oppIdx] = myCard;
      const opSym = k => ({ add:'+', sub:'−', mul:'×', div:'÷', mod:'%', pow:'^' }[k] || '?');
      const gaveLabel = myCard.type === CardType.Number ? myCard.value : opSym(myCard.operatorKind);
      const gotLabel = oppCard.type === CardType.Number ? oppCard.value : opSym(oppCard.operatorKind);
      toast(`🔄 Swapped ${gaveLabel} ↔ ${gotLabel}`, 'success');
      if (window.SFX) SFX.play('cardDraw');
      renderHand(oppId); // Refresh opponent's rendered hand too
    }

    renderHand(playerId);
    renderDeck();
    writeGameState();
  }

  function showPeekOverlay(opponentHand, duration = 5000) {
    // Remove any existing peek overlay
    const existing = document.querySelector('.peek-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'peek-overlay';
    
    let cardsHtml = '';
    for (const c of opponentHand) {
      if (c.type === CardType.Number) {
        cardsHtml += `<div class="peek-card peek-number">${c.value}</div>`;
      } else if (c.type === CardType.Operator) {
        const opSymbol = { add:'+', sub:'−', mul:'×', div:'÷', mod:'%', pow:'^' }[c.operatorKind] || '?';
        cardsHtml += `<div class="peek-card peek-operator">${opSymbol}</div>`;
      } else if (c.type === CardType.Special) {
        const iconMap = { wild: '★', reroll: '🎯', double: '×2', peek: '👁', swap: '🔄' };
        cardsHtml += `<div class="peek-card peek-special">${iconMap[c.specialKind] || '?'}</div>`;
      }
    }

    overlay.innerHTML = `
      <div class="peek-panel">
        <div class="peek-title">👁 Opponent's Hand</div>
        <div class="peek-timer-bar"><div class="peek-timer-fill"></div></div>
        <div class="peek-cards">${cardsHtml}</div>
        <button class="peek-close-btn">Close</button>
      </div>
    `;

    // Auto-close after duration
    const timer = setTimeout(() => overlay.remove(), duration);
    
    // Animate the timer bar
    requestAnimationFrame(() => {
      const fill = overlay.querySelector('.peek-timer-fill');
      if (fill) {
        fill.style.transition = `width ${duration}ms linear`;
        fill.style.width = '0%';
      }
    });

    overlay.addEventListener('click', (e) => {
      if (e.target.closest('.peek-close-btn') || e.target === overlay) {
        clearTimeout(timer);
        overlay.remove();
      }
    });

    document.body.appendChild(overlay);
  }

  function placeCardOnPlayfield(bypassCheck = false, silent = false) {
    if (!gameState.selectedCard) return;
    if (gameState.gameOver) return;
    if (!bypassCheck && !canMakeMove()) {
      toast('Not your turn', 'warning');
      return;
    }

    // ── Online: send to server ──
    if (onlineGame && !bypassCheck) {
      const { card } = gameState.selectedCard;
      if (card && card.id !== undefined) {
        netAction('placeCard', { cardId: card.id }).then(res => {
          if (!res.ok) toast(res.error || 'Cannot place', 'warning');
        });
        gameState.selectedCard = null;
        gameState.selectedCards = [];
        return;
      }
    }
    
    const { playerId, index, card } = gameState.selectedCard;
    
    // Validate expression rules (paren-aware)
    const placeCheck = clientCanPlaceCard(gameState.playfield, card);
    if (!placeCheck.ok) {
      toast(placeCheck.reason, 'error');
      return;
    }
    
    // Place card
    gameState.playfield.push({ ...card });
    
    // Remove from hand
    gameState.players[playerId - 1].hand.splice(index, 1);
    gameState.selectedCard = null;
    
    if (window.SFX) SFX.play('cardPlace');

    // Log placement (unless silent/bypass - bots log in their own phase)
    if (!bypassCheck) {
      const playerName = gameState.players[playerId - 1].name || `Player ${playerId}`;
      const cardDesc = card.type === CardType.Number ? card.value : 'OP';
      dbg(`[${playerName}] Placed card on playfield: ${cardDesc} (Playfield now: ${gameState.playfield.length} cards)`);
    }

    // Update UI
    renderHands();
    renderPlayfield();
    
    // Deselect
    clearSelection();
    writeGameState(); // Sync after placing card
  }

  function renderPlayfield() {
    expressionDisplay.innerHTML = '';
    
    // Remove old hint
    const oldHint = playfield.querySelector('.expression-hint');
    if (oldHint) oldHint.remove();

    if (gameState.playfield.length === 0) {
      playfield.classList.remove('has-expression');
      return;
    }
    
    playfield.classList.add('has-expression');
    gameState.playfield.forEach((card, idx) => {
      const cardEl = document.createElement('div');
      cardEl.className = 'playfield-card';
      cardEl.dataset.playfieldIndex = idx;
      cardEl.style.cursor = 'pointer';
      cardEl.title = 'Click to pick up back to hand';
      
      if (card.type === CardType.Number) {
        cardEl.textContent = card.value;
      } else if (card.type === CardType.Paren) {
        cardEl.textContent = card.parenKind === ParenKind.Open ? '(' : ')';
        cardEl.classList.add('playfield-paren');
      } else {
        const opSymbols = { add: '+', sub: '−', mul: '×', div: '÷', mod: '%', pow: '^' };
        cardEl.textContent = opSymbols[card.operatorKind] || '?';
      }
      
      // QoL: Right-click or double-click playfield card to pick it up back to hand
      // Single click conflicts with hover-to-show-target, so use alternative interaction
      let clickTimeout = null;
      cardEl.addEventListener('click', (e) => {
        e.stopPropagation(); // Prevent playfield click handler from firing
        
        // Double-click to pick up
        if (clickTimeout) {
          clearTimeout(clickTimeout);
          clickTimeout = null;
          
          // Double-click detected
          if (gameState.gameOver) return;
          if (!canMakeMove()) {
            toast('Not your turn', 'warning');
            return;
          }
          
          // Online mode: use undo via server
          if (onlineGame) {
            netAction('undoCard').then(res => {
              if (!res.ok) toast(res.error || 'Cannot undo', 'warning');
            });
            return;
          }

          const playfieldIdx = parseInt(cardEl.dataset.playfieldIndex);
          if (playfieldIdx >= 0 && playfieldIdx < gameState.playfield.length) {
            const pickedCard = gameState.playfield.splice(playfieldIdx, 1)[0];
            gameState.players[gameState.activePlayer - 1].hand.push(pickedCard);
            renderHands();
            renderPlayfield();
            writeGameState();
            toast('Picked up card', 'info');
          }
        } else {
          // Single click - wait for potential double-click
          clickTimeout = setTimeout(() => {
            clickTimeout = null;
          }, 300);
        }
      });
      
      // Right-click to pick up
      cardEl.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        if (gameState.gameOver) return;
        if (!canMakeMove()) {
          toast('Not your turn', 'warning');
          return;
        }
        
        // Online mode: use undo via server
        if (onlineGame) {
          netAction('undoCard').then(res => {
            if (!res.ok) toast(res.error || 'Cannot undo', 'warning');
          });
          return;
        }

        const playfieldIdx = parseInt(cardEl.dataset.playfieldIndex);
        if (playfieldIdx >= 0 && playfieldIdx < gameState.playfield.length) {
          const pickedCard = gameState.playfield.splice(playfieldIdx, 1)[0];
          gameState.players[gameState.activePlayer - 1].hand.push(pickedCard);
          renderHands();
          renderPlayfield();
          writeGameState();
          toast('Picked up card', 'info');
        }
      });
      
      // Update tooltip
      cardEl.title = 'Double-click or right-click to pick up';
      
      expressionDisplay.appendChild(cardEl);
    });

    // Show running expression value hint
    const showHint = localStorage.getItem('mmtp-show-expression-hint') === 'true';
    if (showHint && gameState.playfield.length >= 1) {
      const result = evaluateExpression();
      const hintEl = document.createElement('span');
      hintEl.className = 'expression-hint';
      if (result.ok) {
        hintEl.textContent = `= ${result.value}`;
        hintEl.classList.toggle('hint-match', result.value === gameState.target);
      } else if (gameState.playfield.length === 1 && gameState.playfield[0].type === CardType.Number) {
        hintEl.textContent = `= ${gameState.playfield[0].value}`;
        hintEl.classList.toggle('hint-match', gameState.playfield[0].value === gameState.target);
      } else {
        hintEl.textContent = '= ?';
      }
      expressionDisplay.appendChild(hintEl);
    }
  }

  function undoLastPlayfieldCard() {
    if (gameState.gameOver) return;
    if (!canMakeMove()) {
      toast('Not your turn', 'warning');
      return;
    }
    // ── Online: send to server ──
    if (onlineGame) {
      netAction('undoCard').then(res => {
        if (!res.ok) toast(res.error || 'Cannot undo', 'warning');
      });
      return;
    }
    if (gameState.playfield.length === 0) {
      toast('Nothing to undo', 'info');
      return;
    }
    // Remove last card and return it to active player's hand
    const card = gameState.playfield.pop();
    gameState.players[gameState.activePlayer - 1].hand.push(card);
    renderHands();
    renderPlayfield();
    if (window.SFX) SFX.play('undo');
    toast('Undid last card', 'info');
    writeGameState(); // Sync after undo
  }

  function clearPlayfieldOnly() {
    if (gameState.gameOver) return;
    if (!canMakeMove()) {
      toast('Not your turn', 'warning');
      return;
    }
    // ── Online: send to server ──
    if (onlineGame) {
      netAction('clearPlayfield').then(res => {
        if (!res.ok) toast(res.error || 'Cannot clear', 'warning');
      });
      return;
    }
    if (gameState.playfield.length === 0) {
      toast('Nothing to clear', 'info');
      return;
    }
    // Clear playfield - all cards go to discard pile (non-scorable expression)
    dbg(`[clearPlayfield] Discarding ${gameState.playfield.length} cards from playfield`);
    gameState.playfield.forEach((card) => gameState.discardPile.push(card));
    gameState.playfield = [];
    renderPlayfield();
    renderDiscardPile(); // Update discard pile visualization - includes all cleared cards
    toast('Cleared expression', 'info');
    writeGameState(); // Sync after clear
  }

  // Player names from lobby (localStorage)
  try {
    const storedName = (typeof localStorage !== 'undefined' && localStorage.getItem('mmtp-player-name')) || null;
    if (storedName) {
      gameState.players[0].name = storedName;
      const handP1Label = document.querySelector('#hand-p1 .hand-label');
      if (handP1Label) handP1Label.textContent = storedName;
    }
    if (gameRules.allowBots) {
      gameState.players[1].name = 'Bot';
    }
    const handP2Label = document.querySelector('#hand-p2 .hand-label');
    if (handP2Label) handP2Label.textContent = gameState.players[1].name;

    const scoreLabels = document.querySelectorAll('.score-label');
    if (scoreLabels[0]) scoreLabels[0].textContent = (gameState.players[0].name || 'P1') + ':';
    if (scoreLabels[1]) scoreLabels[1].textContent = (gameState.players[1].name || 'P2') + ':';

    // Show win streak badge in HUD if player is on a streak
    const streakBadge = $('streak-badge');
    if (streakBadge) {
      const statsRaw = localStorage.getItem('mmtp-player-stats');
      if (statsRaw) {
        const pStats = JSON.parse(statsRaw);
        const streak = pStats.winStreak || 0;
        if (streak >= 2) {
          streakBadge.className = 'streak-badge streak-fire';
          streakBadge.textContent = `🔥 ${streak} streak`;
          streakBadge.title = `${streak} win streak (best: ${pStats.bestWinStreak || streak})`;
        }
      }
    }
  } catch (_) {}

  /**
   * BOT AI - COMPLETE REWRITE FOR SPEED & EFFICIENCY
   * 
   * GOAL: Finish matches under 5 minutes by making fast, efficient decisions
   * 
   * PHASE STRUCTURE (in priority order):
   * 1. IMMEDIATE SCORE - Can we score right now? (highest priority)
   * 2. SINGLE CARD SCORE - Can one card match target? (small targets only)
   * 3. BUILD/EXTEND - Build N/O/N or extend existing expression efficiently
   * 4. HAND MANAGEMENT - Draw to fill, discard worst, or rehand if terrible
   * 5. END TURN - If nothing else can be done
   * 
   * KEY OPTIMIZATIONS:
   * - Reduced delays (80-100ms instead of 150-300ms)
   * - Fewer re-evaluation attempts (1-2 instead of 2-3)
   * - Faster decision-making with clear cutoffs
   * - Prioritize scoring over building
   * - Always fill hand first (more cards = more options)
   */
  let botWatchdogTimer = null;
  let botTurnStartTime = 0;
  const BOT_WATCHDOG_MS = 8000;

  /** Check if a value matches the target (exact or within nearest-score threshold) */
  function valueMatchesTarget(value, target) {
    if (value === target) return true;
    if (gameRules.nearestScore && Math.abs(value - target) <= 2) return true;
    return false;
  }

  function runBotTurn(playerId = null) {
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
      setTimeout(() => endTurn(), 100);
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
        endTurn();
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
    toast(`${playerName} (Bot) thinking…`, 'info');

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
      
      dbg(`[BOT ${botName}] === TURN === Target: ${target}, Hand: ${currentHand.length}/${handLimit}, Playfield: ${gameState.playfield.length}, Timer: ${Math.ceil(gameState.turnTimer)}s`);
      
      // Safety: Force end turn if too many attempts
      if (gameState.botReevalAttempts[targetPlayer] >= maxReevalAttempts) {
        dbg(`[BOT ${botName}] SAFETY: Max attempts (${maxReevalAttempts}), ending turn`);
        setTimeout(() => {
          if (!gameState.gameOver && gameState.activePlayer === targetPlayer) {
            gameState.botReevalAttempts[targetPlayer] = 0;
            gameState.botDiscardCount[targetPlayer] = 0;
            endTurn();
          }
        }, getDelay(50));
        return;
      }
      
      // Additional safety: If hand is empty and no cards available, end turn immediately
      if (currentHand.length === 0 && gameState.deck.length === 0 && gameState.discardPile.length === 0) {
        dbg(`[BOT ${botName}] SAFETY: No cards available, ending turn`);
        setTimeout(() => {
          if (!gameState.gameOver && gameState.activePlayer === targetPlayer) {
            gameState.botReevalAttempts[targetPlayer] = 0;
            gameState.botDiscardCount[targetPlayer] = 0;
            endTurn();
          }
        }, getDelay(50));
        return;
      }
      
      // Safety: Always ensure bot ends turn - if nothing actionable, end immediately
      const hasActionableCards = currentHand.length > 0;
      const canDraw = gameState.drawsThisTurn < maxDraw && (gameState.deck.length > 0 || gameState.discardPile.length > 0);
      const hasPlayfield = gameState.playfield.length > 0;
      
      if (!hasActionableCards && !canDraw && !hasPlayfield) {
        dbg(`[BOT ${botName}] SAFETY: Nothing to do (no cards, can't draw, no playfield), ending turn`);
        setTimeout(() => {
          if (!gameState.gameOver && gameState.activePlayer === targetPlayer) {
            gameState.botReevalAttempts[targetPlayer] = 0;
            gameState.botDiscardCount[targetPlayer] = 0;
            endTurn();
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
            dbg(`[BOT ${botName}] PHASE 0: Using Double card before scoring`);
            const idx = currentHand.indexOf(doubleCard);
            setTimeout(() => {
              if (gameState.gameOver || gameState.activePlayer !== targetPlayer) return;
              useSpecialCard(targetPlayer, idx, doubleCard, 'double');
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
            dbg(`[BOT ${botName}] PHASE 0: Rerolling target (${target} too high, max number ${maxNum})`);
            const idx = currentHand.indexOf(rerollCard);
            setTimeout(() => {
              if (gameState.gameOver || gameState.activePlayer !== targetPlayer) return;
              useSpecialCard(targetPlayer, idx, rerollCard, 'reroll');
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
            dbg(`[BOT ${botName}] PHASE 0: Using Swap (no operators in hand)`);
            const idx = currentHand.indexOf(swapCard);
            setTimeout(() => {
              if (gameState.gameOver || gameState.activePlayer !== targetPlayer) return;
              useSpecialCard(targetPlayer, idx, swapCard, 'swap');
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
            dbg(`[BOT ${botName}] PHASE 0: Using Peek (opponent at ${oppScore}/${winPts})`);
            const idx = currentHand.indexOf(peekCard);
            setTimeout(() => {
              if (gameState.gameOver || gameState.activePlayer !== targetPlayer) return;
              useSpecialCard(targetPlayer, idx, peekCard, 'peek');
              setTimeout(() => runBotTurn(targetPlayer), getDelay(delay));
            }, getDelay(delay));
            return;
          }
        }
      }

      // ========== PHASE 1: IMMEDIATE SCORE CHECK ==========
      if (gameState.playfield.length > 0) {
        const currentResult = evaluateExpression();
        if (currentResult.ok && valueMatchesTarget(currentResult.value, target)) {
          if (canScore(gameState.playfield.length)) {
            dbg(`[BOT ${botName}] PHASE 1: SCORING! Expression = ${target} (length: ${gameState.playfield.length})`);
            tryScore();
            return;
          } else {
            dbg(`[BOT ${botName}] PHASE 1: Can score but too short (${gameState.playfield.length} < ${botMinExpressionLength}), extending...`);
            // Continue to extend expression instead of scoring
          }
        }
      }
      
      // ========== PHASE 2: SINGLE CARD SCORE ==========
      // Easy bot randomly misses single-card plays
      if (DIFF.missChance > 0 && Math.random() < DIFF.missChance && gameState.playfield.length === 0) {
        dbg(`[BOT ${botName}] EASY: Missed single-card opportunity (${(DIFF.missChance * 100).toFixed(0)}% miss)`);
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
            
            dbg(`[BOT ${botName}] PHASE 2: Single card ${card.value} matches!`);
            gameState.selectedCard = { playerId: targetPlayer, index: i, card: card };
            placeCardOnPlayfield(true);
            writeGameState();
            setTimeout(() => {
              if (!gameState.gameOver && gameState.activePlayer === targetPlayer) {
                const verifyResult = evaluateExpression();
                if (verifyResult.ok && valueMatchesTarget(verifyResult.value, target) && canScore(gameState.playfield.length)) {
                  tryScore();
                } else if (verifyResult.ok && valueMatchesTarget(verifyResult.value, target) && !canScore(gameState.playfield.length)) {
                  dbg(`[BOT ${botName}] PHASE 2: Can score but too short (${gameState.playfield.length} < ${botMinExpressionLength}), extending...`);
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
        const currentResult = evaluateExpression();
        if (!currentResult.ok) {
          // Invalid expression - clear and start over
          dbg(`[BOT ${botName}] PHASE 3A: Invalid expression, clearing`);
          clearPlayfieldOnly();
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
                const testResult = evaluateExpression();
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
                  const testResult = evaluateExpression();
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
                    placeCardOnPlayfield(true);
                    writeGameState();
                    setTimeout(() => {
                      if (!gameState.gameOver && gameState.activePlayer === targetPlayer) {
                        const finalHand = gameState.players[targetPlayer - 1].hand;
                        const finalNumIdx = finalHand.findIndex(c => 
                          c.type === CardType.Number && c.value === num.value
                        );
                        if (finalNumIdx !== -1) {
                          gameState.selectedCard = { playerId: targetPlayer, index: finalNumIdx, card: finalHand[finalNumIdx] };
                          placeCardOnPlayfield(true);
                          writeGameState();
                          setTimeout(() => {
                            if (!gameState.gameOver && gameState.activePlayer === targetPlayer) {
                              const verifyResult = evaluateExpression();
                              if (verifyResult.ok && valueMatchesTarget(verifyResult.value, target) && canScore(gameState.playfield.length)) {
                                tryScore();
                              } else if (verifyResult.ok && valueMatchesTarget(verifyResult.value, target) && !canScore(gameState.playfield.length)) {
                                dbg(`[BOT ${botName}] PHASE 3: Can score but too short (${gameState.playfield.length} < ${botMinExpressionLength}), extending...`);
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
            const testResult = evaluateExpression();
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
              
              dbg(`[BOT ${botName}] PHASE 3A: Found scoring card!`);
              gameState.selectedCard = { playerId: targetPlayer, index: i, card: currentHand[i] };
              placeCardOnPlayfield(true);
              writeGameState();
                  setTimeout(() => {
                    if (!gameState.gameOver && gameState.activePlayer === targetPlayer) {
                      const verifyResult = evaluateExpression();
                      if (verifyResult.ok && valueMatchesTarget(verifyResult.value, target) && canScore(gameState.playfield.length)) {
                        tryScore();
                      } else if (verifyResult.ok && valueMatchesTarget(verifyResult.value, target) && !canScore(gameState.playfield.length)) {
                        dbg(`[BOT ${botName}] PHASE 3A: Can score but too short (${gameState.playfield.length} < ${botMinExpressionLength}), extending...`);
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
          const diffMaxBonus = BOT_DIFFICULTY === 'hard' ? 2 : (BOT_DIFFICULTY === 'easy' ? -2 : 0);
          const maxLength = Math.max(3, (targetSize === 'small' ? 5 : (targetSize === 'medium' ? 7 : 9)) + diffMaxBonus);
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
              const testResult = evaluateExpression();
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
                  dbg(`[BOT ${botName}] PHASE 3A: Card no longer available, skipping extension`);
                  // Card was removed, end turn
                  setTimeout(() => {
                    if (!gameState.gameOver && gameState.activePlayer === targetPlayer) {
                      gameState.botReevalAttempts[targetPlayer] = 0;
                      endTurn();
                    }
                  }, getDelay(80));
                  return;
                }
                bestIdx = actualIdx;
                bestCard = freshHand[actualIdx];
              }
              
              dbg(`[BOT ${botName}] PHASE 3A: Extending (diff: ${currentDiff}→${bestNewDiff}, improvement: ${bestImprovement})`);
              gameState.selectedCard = { playerId: targetPlayer, index: bestIdx, card: bestCard };
              placeCardOnPlayfield(true);
              writeGameState();
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
            dbg(`[BOT ${botName}] PHASE 3A: Must extend to reach minimum length (${gameState.playfield.length} < ${botMinExpressionLength}), continuing...`);
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
              dbg(`[BOT ${botName}] PHASE 3A: Too many attempts forcing minimum length, ending turn (safety)`);
            }
          }
          
          // More aggressive: Don't end turn if we can still extend and target is large
          // isVeryLargeTarget already declared above (line 1656)
          if (currentDiff <= 5 && gameState.playfield.length >= 3 && gameState.turnTimer > 5 && !canExtend) {
            // Very close but can't extend - keep expression, end turn
            dbg(`[BOT ${botName}] PHASE 3A: Very close (diff: ${currentDiff}), keeping expression, ending turn`);
          } else if (currentDiff > clearThreshold && gameState.playfield.length >= 3 && !canExtend) {
            // Too far and can't extend - clear and try fresh approach
            dbg(`[BOT ${botName}] PHASE 3A: Too far (diff: ${currentDiff} > threshold ${clearThreshold}), clearing expression`);
            clearPlayfieldOnly();
            // Fall through to try building fresh
          } else if (currentDiff > 20 && gameState.playfield.length >= 7 && !canExtend) {
            // Expression is very long and can't extend - clear if moderately far
            dbg(`[BOT ${botName}] PHASE 3A: Very long expression (${gameState.playfield.length} cards) can't extend, clearing (diff: ${currentDiff})`);
            clearPlayfieldOnly();
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
              dbg(`[BOT ${botName}] PHASE 3A: Can extend (${gameState.playfield.length} < ${maxLength}), continuing for large target (diff: ${currentDiff})`);
              // Don't end turn - let it fall through to extension logic or retry
              setTimeout(() => {
                if (!gameState.gameOver && gameState.activePlayer === targetPlayer) {
                  runBotTurn(targetPlayer);
                }
              }, getDelay(80));
              return;
            } else {
              // Can extend but no useful cards - end turn
              dbg(`[BOT ${botName}] PHASE 3A: Can extend but no useful cards available, ending turn (diff: ${currentDiff})`);
            }
          } else if (!canExtend) {
            // Can't extend - end turn
            dbg(`[BOT ${botName}] PHASE 3A: Can't extend (${gameState.playfield.length} >= ${effectiveMaxLength}), ending turn (diff: ${currentDiff})`);
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
              endTurn();
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
              dbg(`[BOT ${botName}] HARD: Deep lookahead found 5-card combo = ${bestPlay.result}`);
            }
          }
          if (bestPlay && bestPlay.canScore && bestPlay.type === 'build' && bestPlay.cards?.length >= 3) {
            dbg(`[BOT ${botName}] HARD: BotAIv2 found scoring combo = ${bestPlay.result} (${bestPlay.cards.length} cards)`);
            const placeSequentially = (cardsToPlace, idx) => {
              if (idx >= cardsToPlace.length || gameState.gameOver || gameState.activePlayer !== targetPlayer) {
                if (!gameState.gameOver && gameState.activePlayer === targetPlayer) {
                  const vr = evaluateExpression();
                  if (vr.ok && valueMatchesTarget(vr.value, target) && canScore(gameState.playfield.length)) {
                    tryScore();
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
              placeCardOnPlayfield(true);
              writeGameState();
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
          dbg(`[BOT ${botName}] PHASE 3B: Can't build (${numbers.length} nums, ${operators.length} ops)`);
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
              dbg(`[BOT ${botName}] PHASE 3B: Starting number no longer available, skipping build`);
              // Can't build, skip to hand management
            } else {
              bestNumIdx = actualIdx;
              bestNum = freshHandForNum[actualIdx];
              dbg(`[BOT ${botName}] PHASE 3B: Building new expression with ${bestNum.value}`);
              gameState.selectedCard = { playerId: targetPlayer, index: bestNumIdx, card: bestNum };
              placeCardOnPlayfield(true);
              writeGameState();
            }
          } else {
            // Place starting number
            dbg(`[BOT ${botName}] PHASE 3B: Building new expression with ${bestNum.value}`);
            gameState.selectedCard = { playerId: targetPlayer, index: bestNumIdx, card: bestNum };
            placeCardOnPlayfield(true);
            writeGameState();
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
                if (!gameState.gameOver && gameState.activePlayer === targetPlayer) endTurn();
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
                  if (!gameState.gameOver && gameState.activePlayer === targetPlayer) endTurn();
                }, getDelay(80));
                return;
              }
              bestOpIdx = actualOpIdx;
              bestOp = freshHandForOp[actualOpIdx];
            }
            
            // Place operator
            gameState.selectedCard = { playerId: targetPlayer, index: bestOpIdx, card: bestOp };
            placeCardOnPlayfield(true);
            writeGameState();
            
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
                  if (!gameState.gameOver && gameState.activePlayer === targetPlayer) endTurn();
                }, getDelay(80));
                return;
              }
              
              // Place number
              gameState.selectedCard = { playerId: targetPlayer, index: finalNumIdx, card: finalHand[finalNumIdx] };
              placeCardOnPlayfield(true);
              writeGameState();
              
              // Check if we can score
              setTimeout(() => {
                if (gameState.gameOver || gameState.activePlayer !== targetPlayer) return;
                const finalResult = evaluateExpression();
                if (finalResult.ok && valueMatchesTarget(finalResult.value, target) && canScore(gameState.playfield.length)) {
                  tryScore();
                } else if (finalResult.ok && valueMatchesTarget(finalResult.value, target) && !canScore(gameState.playfield.length)) {
                  dbg(`[BOT ${botName}] PHASE 3B: Can score but too short (${gameState.playfield.length} < ${botMinExpressionLength}), extending...`);
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
                      dbg(`[BOT ${botName}] PHASE 3B: Must continue to reach minimum length (${currentLength} < ${botMinExpressionLength})`);
                    }
                    setTimeout(() => {
                      if (!gameState.gameOver && gameState.activePlayer === targetPlayer) {
                        runBotTurn(targetPlayer);
                      }
                    }, getDelay(80));
                  } else {
                    // Can't improve or max attempts, end turn
                    if (mustContinueForMinLength && gameState.botReevalAttempts[targetPlayer] >= maxAttemptsForMinLength) {
                      dbg(`[BOT ${botName}] PHASE 3B: Too many attempts forcing minimum length, ending turn (safety)`);
                    }
                    gameState.botReevalAttempts[targetPlayer] = 0;
                    setTimeout(() => {
                      if (!gameState.gameOver && gameState.activePlayer === targetPlayer) endTurn();
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
        dbg(`[BOT ${botName}] PHASE 4: Skipping hand management - must extend to reach minimum length (${gameState.playfield.length} < ${botMinExpressionLength})`);
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
          dbg(`[BOT ${botName}] PHASE 4: Too many attempts, proceeding to hand management (safety)`);
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
          dbg(`[BOT ${botName}] PHASE 4A: Drawing ${canDraw} card(s) (${currentHand.length}/${handLimit}, ${totalCardsAvailable} cards available)`);
          let actuallyDrawn = 0;
          for (let i = 0; i < canDraw; i++) {
            const drawn = drawCard(targetPlayer);
            if (drawn) {
              gameState.drawsThisTurn++;
              actuallyDrawn++;
            } else {
              // No more cards available, stop trying
              break;
            }
          }
          
          if (actuallyDrawn > 0) {
            writeGameState();
            renderHands();
            updateDeckCount();
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
            dbg(`[BOT ${botName}] PHASE 4B: Discarding worst card (score: ${worstScore})`);
            gameState.botDiscardCount[targetPlayer]++;
            discardCard(targetPlayer, worstIdx, true);
            writeGameState();
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
          dbg(`[BOT ${botName}] PHASE 4C: Rehanding - ${reason}`);
          doRehand(targetPlayer, true);
          writeGameState();
          return;
        }
      }
      
      // ========== PHASE 5: END TURN ==========
      // Final check: Can we score?
      if (gameState.playfield.length > 0) {
        const finalCheck = evaluateExpression();
        if (finalCheck.ok && valueMatchesTarget(finalCheck.value, target)) {
          if (canScore(gameState.playfield.length)) {
            dbg(`[BOT ${botName}] PHASE 5: Final check - SCORING! (length: ${gameState.playfield.length})`);
            tryScore();
            return;
          } else {
            dbg(`[BOT ${botName}] PHASE 5: Can score but too short (${gameState.playfield.length} < ${botMinExpressionLength}), ending turn (safety)`);
            // Safety: If we can't meet minimum length requirement and timer is low, end turn to prevent infinite loop
            if (gameState.turnTimer < 5 || gameState.botReevalAttempts[targetPlayer] >= maxReevalAttempts) {
              gameState.botReevalAttempts[targetPlayer] = 0;
              gameState.botDiscardCount[targetPlayer] = 0;
              setTimeout(() => {
                if (!gameState.gameOver && gameState.activePlayer === targetPlayer) {
                  endTurn();
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
        const finalCheck = evaluateExpression();
        if (finalCheck.ok) {
          const finalDiff = Math.abs(finalCheck.value - target);
          const hasCardsToImprove = currentHand.length >= 3; // At least 3 cards to potentially improve
          
          if (finalDiff <= 5 && hasCardsToImprove && gameState.turnTimer > 5) {
            // Very close and have cards - keep expression for next turn
            dbg(`[BOT ${botName}] PHASE 5: Keeping close expression (diff: ${finalDiff}) for next turn`);
          } else if (finalDiff > 30 && gameState.playfield.length >= 3) {
            // Too far - clear expression to start fresh next turn
            dbg(`[BOT ${botName}] PHASE 5: Clearing far expression (diff: ${finalDiff})`);
            clearPlayfieldOnly();
          }
        }
      }
      
      // Nothing else to do - end turn
      dbg(`[BOT ${botName}] PHASE 5: Ending turn (Hand: ${currentHand.length}, Playfield: ${gameState.playfield.length}, Timer: ${Math.ceil(gameState.turnTimer)}s)`);
      gameState.botReevalAttempts[targetPlayer] = 0;
      gameState.botDiscardCount[targetPlayer] = 0;
      setTimeout(() => {
        if (!gameState.gameOver && gameState.activePlayer === targetPlayer) {
          endTurn();
        }
      }, getDelay(80));
    }, delay);
  }

  // ── Expression evaluation — delegates to shared expression module ──
  function evaluateExpression() {
    if (gameState.playfield.length === 0) {
      dbg('[evaluateExpression] No cards on playfield');
      return { ok: false, value: 0, reason: 'No cards on playfield' };
    }

    const tokens = gameState.playfield;
    dbg(`[evaluateExpression] Evaluating ${tokens.length} cards:`, tokens.map(c => {
      if (c.type === CardType.Number) return c.value;
      if (c.type === CardType.Paren) return c.parenKind === ParenKind.Open ? '(' : ')';
      return 'OP';
    }));

    // Extra scorability check (end with number or ), balanced parens)
    const scoreCheck = sharedCanScore(tokens);
    if (!scoreCheck.ok) return { ok: false, value: 0, reason: scoreCheck.reason };

    const mode = gameRules.operatorPrecedence || 'left-to-right';
    const result = sharedEvaluate(tokens, mode, { allowNegative: gameRules.allowNegative });
    dbg(`[evaluateExpression] Result: ${result.value} (ok=${result.ok})`);
    return result;
  }

  function tryScore(silent = false) {
    if (botWatchdogTimer) { clearTimeout(botWatchdogTimer); botWatchdogTimer = null; }
    botTurnStartTime = 0;
    if (gameState.gameOver) {
      dbg('[tryScore] Game over, cannot score');
      return;
    }

    // ── Online: send to server ──
    if (onlineGame && !silent) {
      netAction('tryScore').then(res => {
        if (!res.ok) toast(res.error || 'Cannot score', 'warning');
      });
      return;
    }
    
    // Allow scoring for any active player (bots can score too)
    const result = evaluateExpression();
    
    if (!result.ok) {
      dbg(`[tryScore] Invalid expression: ${result.reason}`);
      if (!silent) {
        playfield.classList.add('playfield-miss');
        setTimeout(() => playfield.classList.remove('playfield-miss'), 400);
        if (window.SFX) SFX.play('miss');
        toast(`Invalid expression: ${result.reason}`, 'error');
      }
      return;
    }
    
    dbg(`[tryScore] Expression = ${result.value}, Target = ${gameState.target}, Match: ${result.value === gameState.target}`);

    // Determine scoring: exact match OR nearest-score rule
    const diff = Math.abs(result.value - gameState.target);
    const isExact = diff === 0;
    const nearestEnabled = !!gameRules.nearestScore;
    // Nearest scoring thresholds: off-by-1 = 0.5pt, off-by-2 = 0.25pt
    const isNearScore = nearestEnabled && !isExact && diff <= 2;

    if (isExact || isNearScore) {
      if (!silent) {
        const playerName = gameState.players[gameState.activePlayer - 1].name || `Player ${gameState.activePlayer}`;
        const exprStr = gameState.playfield.map(c => {
          if (c.type === CardType.Number) return c.value;
          if (c.type === CardType.Paren) return c.parenKind === ParenKind.Open ? '(' : ')';
          const syms = { add:'+', sub:'−', mul:'×', div:'÷', mod:'%', pow:'^' };
          return syms[c.operatorKind] || '?';
        }).join(' ');
        const tag = isExact ? 'SCORED!' : `NEAR SCORE (off by ${diff})`;
        dbg(`[${playerName}] ${tag} Expression: ${exprStr} = ${result.value} (target: ${gameState.target})`);
      }

      // Calculate points: exact = 1 (or 2 with double), near = 0.5 or 0.25
      let basePoints = isExact ? 1 : (diff === 1 ? 0.5 : 0.25);
      const doubleBuff = gameState.doubleNext[gameState.activePlayer];
      const pointsAwarded = doubleBuff ? basePoints * 2 : basePoints;

      const player = gameState.players[gameState.activePlayer - 1];
      const playerStats = gameState.matchStats.players[gameState.activePlayer - 1];
      player.score += pointsAwarded;
      if (doubleBuff) {
        gameState.doubleNext[gameState.activePlayer] = false;
        toast('×2 DOUBLE SCORE!', 'success');
      }
      
      // Track match statistics
      playerStats.cardsPlayed += gameState.playfield.length;
      playerStats.expressionsScored.push({
        expression: [...gameState.playfield],
        target: gameState.target,
        turn: turnNumber,
        timeRemaining: gameState.turnTimer,
        value: result.value,
        near: !isExact,
      });
      // Add to in-game expression history panel
      addExpressionToHistory(gameState.activePlayer, [...gameState.playfield], gameState.target, result.value, Math.floor(turnNumber / 2) + 1);

      if (!playerStats.bestExpression || result.value > playerStats.bestExpression.value) {
        playerStats.bestExpression = {
          value: result.value,
          expression: [...gameState.playfield],
          target: gameState.target,
        };
      }
      
      // Add to score pile with expression
      addToScorePile(gameState.activePlayer, gameState.playfield);
      
      updateScores();
      
      // Show XP notification
      const xpAmount = isExact ? 25 : (diff === 1 ? 15 : 10);
      const xpLabel = isExact ? 'Score!' : `Near! (±${diff})`;
      showXPNotification(xpAmount, xpLabel, 'score');
      
      // Check win
      if (player.score >= gameRules.winPoints) {
        endGame(gameState.activePlayer);
        return;
      }
      
      // New target
      gameState.target = randomTarget();
      updateTarget();
      
      gameState.playfield = [];
      renderPlayfield();
      renderDiscardPile();
      
      // Visual flash on score
      if (isExact) {
        playfield.classList.add('playfield-scored');
        setTimeout(() => playfield.classList.remove('playfield-scored'), 600);
      } else {
        playfield.classList.add('playfield-near-scored');
        setTimeout(() => playfield.classList.remove('playfield-near-scored'), 600);
      }
      if (window.SFX) SFX.play('score');

      const ptsLabel = Number.isInteger(pointsAwarded) ? pointsAwarded : pointsAwarded.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
      const scoreLabel = isExact
        ? `Score! +${ptsLabel}pt — New target: ${gameState.target}`
        : `Near score! ${result.value} ≈ target ${gameState.target} (off by ${diff}) +${ptsLabel}pt — New target: ${gameState.target}`;
      toast(scoreLabel, 'success');
      writeGameState();
      
      // Auto-end turn after scoring
      setTimeout(() => {
        if (!gameState.gameOver) {
          endTurn();
        }
      }, 500);
    } else {
      // Expression evaluated but doesn't match target
      dbg(`[tryScore] Expression = ${result.value}, target = ${gameState.target} - miss`);
      playfield.classList.add('playfield-miss');
      setTimeout(() => playfield.classList.remove('playfield-miss'), 400);
      if (window.SFX) SFX.play('miss');
      if (nearestEnabled && diff <= 5) {
        toast(`Expression = ${result.value}, target is ${gameState.target} (off by ${diff}, need ≤2 for near score)`, 'info');
      } else {
        toast(`Expression = ${result.value}, target is ${gameState.target}`, 'info');
      }
    }
  }

  function endTurn(silent = false) {
    if (botWatchdogTimer) { clearTimeout(botWatchdogTimer); botWatchdogTimer = null; }
    botTurnStartTime = 0;
    if (gameState.gameOver) return;

    // ── Online: send to server ──
    if (onlineGame && !silent) {
      netAction('endTurn').then(res => {
        if (!res.ok) toast(res.error || 'Cannot end turn', 'warning');
      });
      return;
    }
    
    if (!silent) {
      const previousPlayer = gameState.activePlayer === 1 ? 2 : 1;
      const playerName = gameState.players[previousPlayer - 1].name || `Player ${previousPlayer}`;
      const unusedTime = Math.floor(gameState.turnTimer);
      dbg(`[${playerName}] Ending turn (Time saved: ${unusedTime}s, Playfield cleared: ${gameState.playfield.length} cards)`);
    }
    
    // Track time saved (before resetting timer)
    const previousPlayer = gameState.activePlayer === 1 ? 2 : 1;
    const unusedTime = Math.floor(gameState.turnTimer);
    if (unusedTime > 0) {
      // Track time saved for both players
      gameState.matchStats.players[previousPlayer - 1].timeSaved += unusedTime;
      // Note: Time bonus XP is calculated and awarded at the end of the match
      // with diminishing returns to prevent it from dominating XP gains.
      // Per-turn notifications are removed to avoid confusion.
    }
    
    turnNumber++;
    updateRoundCounter();
    
    // Clear playfield - ALL cards that didn't score go to discard pile
    // This includes:
    // - Cards from expressions that were evaluated but didn't match target
    // - Cards from invalid expressions
    // - Cards that were placed but never scored
    if (gameState.playfield.length > 0) {
      dbg(`[endTurn] Discarding ${gameState.playfield.length} cards from playfield (non-scorable expression)`);
      gameState.playfield.forEach(card => {
        gameState.discardPile.push(card);
        // Track cards played
        gameState.matchStats.players[previousPlayer - 1].cardsPlayed++;
      });
    }
    gameState.playfield = [];
    renderPlayfield();
    renderDiscardPile(); // Update discard pile visualization after adding cards
    
    // Swap player
    gameState.activePlayer = gameState.activePlayer === 1 ? 2 : 1;
    if (!silent && window.SFX) SFX.play('turnChange');
    
    // Reset re-evaluation attempts and discard count for new player
    if (gameState.botReevalAttempts) {
      gameState.botReevalAttempts[gameState.activePlayer] = 0;
    }
    if (gameState.botDiscardCount) {
      gameState.botDiscardCount[gameState.activePlayer] = 0;
    }
    
    // Draw for new active player
    if (gameRules.drawMode === 'always') {
      drawCard(gameState.activePlayer);
    }
    
    // Reset timer & draw count for new turn
    // NOTE: endTurn() does several important things:
    // 1. Clears playfield (discards cards on playfield)
    // 2. Swaps active player
    // 3. Draws card for new player (if drawMode is 'always')
    // 4. Resets timer to full duration
    // 5. Resets draw counter (drawsThisTurn = 0) - THIS is crucial for maxDrawPerTurn rule!
    gameState.turnTimer = gameRules.turnTimerSec;
    gameState.turnTimerStart = gameRules.turnTimerSec; // Reset start time
    gameState.actualTimeElapsed = 0; // Reset elapsed time
    gameState.drawsThisTurn = 0;
    updateTimer();
    
    // Restart timer interval for new turn
    startTimer();
    
    // Update UI
    updateTurn();
    renderHands();

    // Turn announcement
    if (!silent) {
      const isMyTurn = gameState.activePlayer === myPlayerId;
      const name = gameState.players[gameState.activePlayer - 1].name;
      showTurnBanner(isMyTurn ? 'Your Turn' : `${name}'s Turn`, isMyTurn);
    }

    // Clear selection (drawsThisTurn already reset above)
    gameState.selectedCard = null;
    document.querySelectorAll('.card.selected').forEach(el => el.classList.remove('selected'));

    writeGameState(); // Sync after turn end
    
    // If it's now bot's turn, run bot logic
    if (isHost) {
      if (gameRules.allowBots && gameState.activePlayer === 2) {
        runBotTurn(2);
      } else if (gameRules.botP1 && gameState.activePlayer === 1) {
        runBotTurn(1);
      }
    }
  }

  function endGame(winnerId) {
    if (botWatchdogTimer) { clearTimeout(botWatchdogTimer); botWatchdogTimer = null; }
    botTurnStartTime = 0;
    gameState.gameOver = true;
    gameState.winner = winnerId;
    gameState.matchStats.endTime = Date.now();
    
    if (gameState.timerInterval) {
      clearInterval(gameState.timerInterval);
      gameState.timerInterval = null;
    }
    if (syncInterval) {
      clearInterval(syncInterval);
      syncInterval = null;
    }

    // Update persistent stats in localStorage (PlayerPanel)
    let leveledUp = false;
    let newLevel = 1;
    try {
      const raw = localStorage.getItem('mmtp-player-stats');
      const stats = raw ? JSON.parse(raw) : {
        level: 1,
        xp: 0,
        xpToNext: 100,
        wins: 0,
        losses: 0,
        draws: 0,
        rating: 1000,
        lastPlayed: 0,
        winStreak: 0,
        bestWinStreak: 0,
      };

      const oldLevel = stats.level || 1;
      const isP1Winner = winnerId === 1;
      if (!stats.winStreak) stats.winStreak = 0;
      if (!stats.bestWinStreak) stats.bestWinStreak = 0;

      if (winnerId === 0) {
        stats.draws = (stats.draws || 0) + 1;
        stats.xp += 5;
        stats.winStreak = 0;
      } else {
        if (isP1Winner) {
          stats.wins += 1;
          stats.winStreak += 1;
          if (stats.winStreak > stats.bestWinStreak) stats.bestWinStreak = stats.winStreak;
          stats.xp += 25;
          stats.rating += 10;
          showXPNotification(25, 'Win Bonus', 'score');
          showXPNotification(50, 'Victory!', 'victory');
          if (stats.winStreak >= 3) {
            showXPNotification(stats.winStreak * 2, `${stats.winStreak} Win Streak!`, 'streak');
            stats.xp += stats.winStreak * 2;
          }
        } else {
          stats.losses += 1;
          stats.winStreak = 0;
          stats.xp += 10;
          stats.rating = Math.max(100, stats.rating - 5);
          showXPNotification(10, 'Loss', 'score');
        }
      }

      // Time bonus (educational - encourages fast thinking)
      // More generous: first 30s = 0.15 XP/s, next 30s = 0.10 XP/s, rest = 0.05 XP/s
      // Max 15 XP from time saved per match (encourages competitive play)
      const totalTimeSaved = gameState.matchStats.players[0].timeSaved;
      let timeBonus = 0;
      if (totalTimeSaved > 0) {
        const first30 = Math.min(30, totalTimeSaved);
        const next30 = Math.min(30, Math.max(0, totalTimeSaved - 30));
        const rest = Math.max(0, totalTimeSaved - 60);
        timeBonus = Math.floor(first30 * 0.15 + next30 * 0.10 + rest * 0.05);
        timeBonus = Math.min(15, timeBonus); // Cap at 15 XP per match
      }
      if (timeBonus > 0) {
        stats.xp += timeBonus;
        showXPNotification(timeBonus, 'Time Bonus', 'time');
      }

      // Level up loop
      while (stats.xp >= stats.xpToNext) {
        stats.xp -= stats.xpToNext;
        stats.level += 1;
        stats.xpToNext = Math.round(stats.xpToNext * 1.15);
        leveledUp = true;
        newLevel = stats.level;
      }
      stats.lastPlayed = Date.now();

      if (leveledUp) {
        showXPNotification(0, `LEVEL ${newLevel}!`, 'levelup');
      }

      localStorage.setItem('mmtp-player-stats', JSON.stringify(stats));

      // Update streak badge in HUD
      const streakBadge = $('streak-badge');
      if (streakBadge) {
        if (stats.winStreak >= 2) {
          streakBadge.className = 'streak-badge streak-fire';
          streakBadge.textContent = `🔥 ${stats.winStreak} streak`;
          streakBadge.title = `${stats.winStreak} win streak (best: ${stats.bestWinStreak || stats.winStreak})`;
        } else {
          streakBadge.className = 'streak-badge streak-none';
          streakBadge.textContent = '';
        }
      }
      
      // Save P2 bot stats if P2 is a bot (simulated or bot-enabled)
      const p2IsBot = gameRules.allowBots || gameRules.botP1;
      if (p2IsBot) {
        try {
          const botStatsKey = 'mmtp-bot-stats';
          const botStats = JSON.parse(localStorage.getItem(botStatsKey) || '{}');
          
          // Initialize defaults if needed
          if (!botStats.wins) botStats.wins = 0;
          if (!botStats.losses) botStats.losses = 0;
          if (!botStats.rating) botStats.rating = 1000;
          if (!botStats.level) botStats.level = 1;
          
          if (winnerId === 2) {
            // P2 bot won
            botStats.wins = (botStats.wins || 0) + 1;
            botStats.rating = (botStats.rating || 1000) + 10;
          } else if (winnerId === 1) {
            // P2 bot lost
            botStats.losses = (botStats.losses || 0) + 1;
            botStats.rating = Math.max(100, (botStats.rating || 1000) - 5);
          }
          // Draw: no change to wins/losses, but update lastPlayed
          
          botStats.lastPlayed = Date.now();
          localStorage.setItem(botStatsKey, JSON.stringify(botStats));
          dbg('[endGame] Saved bot stats:', botStats);
        } catch (e) {
          console.warn('Failed to save bot stats', e);
        }
      }
      
      // Save match result for PlayerPanel
      const p1Stats = gameState.matchStats.players[0];
      const p2Stats = gameState.matchStats.players[1];
      const matchResult = {
        timestamp: Date.now(),
        winner: winnerId,
        duration: Math.floor((gameState.matchStats.endTime - gameState.matchStats.startTime) / 1000),
        scores: {
          p1: gameState.players[0].score,
          p2: gameState.players[1].score,
        },
        stats: {
          p1: {
            cardsPlayed: p1Stats.cardsPlayed || 0,
            cardsDrawn: p1Stats.cardsDrawn || 0,
            cardsDiscarded: p1Stats.cardsDiscarded || 0,
            expressionsScored: p1Stats.expressionsScored || [],
            timeSaved: p1Stats.timeSaved || 0,
            rehandsUsed: p1Stats.rehandsUsed || 0,
            bestExpression: p1Stats.bestExpression || null,
          },
          p2: {
            cardsPlayed: p2Stats.cardsPlayed || 0,
            cardsDrawn: p2Stats.cardsDrawn || 0,
            cardsDiscarded: p2Stats.cardsDiscarded || 0,
            expressionsScored: p2Stats.expressionsScored || [],
            timeSaved: p2Stats.timeSaved || 0,
            rehandsUsed: p2Stats.rehandsUsed || 0,
            bestExpression: p2Stats.bestExpression || null,
          },
        },
      };
      
      // Save to localStorage (keep last 10 matches)
      try {
        const matchHistory = JSON.parse(localStorage.getItem('mmtp-match-history') || '[]');
        matchHistory.push(matchResult);
        // Keep only last 10
        if (matchHistory.length > 10) {
          matchHistory.shift();
        }
        localStorage.setItem('mmtp-match-history', JSON.stringify(matchHistory));
      } catch (e) {
        console.warn('Failed to save match history', e);
      }

      // Auto-save profile to server if a profile code exists
      try {
        const profileCode = localStorage.getItem('mmtp-profile-code');
        if (profileCode && profileCode.length === 6) {
          const stats = JSON.parse(localStorage.getItem('mmtp-player-stats') || '{}');
          const name = localStorage.getItem('mmtp-player-name') || 'Player';
          const history = JSON.parse(localStorage.getItem('mmtp-match-history') || '[]');
          fetch('/api/profile/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code: profileCode, name, stats, matchHistory: history.slice(-20) }),
          }).then(r => r.json()).then(res => {
            if (res.ok) console.log('[Profile] Auto-saved to server');
            else console.warn('[Profile] Auto-save failed:', res.error);
          }).catch(e => console.warn('[Profile] Auto-save error:', e.message));
        }
      } catch (e) {
        // Silent fail — auto-save is best-effort
      }
    } catch (e) {
      console.warn('Failed to update stats', e);
    }

    // Show game over modal
    const banner = $('game-over-banner');
    const message = $('game-over-message');
    const finalScoreP1 = $('final-score-p1');
    const finalScoreP2 = $('final-score-p2');
    const matchDuration = $('match-duration');
    const matchTurns = $('match-turns');
    const matchTotalCards = $('match-total-cards');
    const matchTotalExpressions = $('match-total-expressions');

    if (banner) {
      banner.className = 'game-over-banner';
      if (winnerId === 0) {
        banner.textContent = 'DRAW';
        banner.classList.add('banner-draw');
        if (window.SFX) SFX.play('gameDraw');
      } else if (winnerId === 1) {
        banner.textContent = 'VICTORY';
        banner.classList.add('banner-win');
        if (window.SFX) SFX.play('gameWin');
      } else {
        banner.textContent = 'DEFEAT';
        banner.classList.add('banner-loss');
        if (window.SFX) SFX.play('gameLose');
      }
    }

    if (message) {
      if (winnerId === 0) {
        message.textContent = 'Both players tied!';
      } else {
        const winnerName = gameState.players[winnerId - 1]?.name || `Player ${winnerId}`;
        const loserName = gameState.players[winnerId === 1 ? 1 : 0]?.name || `Player ${winnerId === 1 ? 2 : 1}`;
        message.textContent = `${winnerName} defeats ${loserName}`;
      }
    }
    if (finalScoreP1) finalScoreP1.textContent = formatScore(gameState.players[0].score);
    if (finalScoreP2) finalScoreP2.textContent = formatScore(gameState.players[1].score);

    const duration = Math.floor((gameState.matchStats.endTime - gameState.matchStats.startTime) / 1000);
    if (matchDuration) {
      const minutes = Math.floor(duration / 60);
      const seconds = duration % 60;
      matchDuration.textContent = `${minutes}m ${seconds}s`;
    }
    if (matchTurns) matchTurns.textContent = turnNumber;

    const p1Stats = gameState.matchStats.players[0];
    const p2Stats = gameState.matchStats.players[1];

    if (matchTotalCards) matchTotalCards.textContent = (p1Stats.cardsPlayed || 0) + (p2Stats.cardsPlayed || 0);
    if (matchTotalExpressions) matchTotalExpressions.textContent = (p1Stats.expressionsScored?.length || 0) + (p2Stats.expressionsScored?.length || 0);

    // Stats tab — set player names
    const statsP1Name = $('stats-p1-name');
    const statsP2Name = $('stats-p2-name');
    if (statsP1Name) statsP1Name.textContent = gameState.players[0].name || 'Player 1';
    if (statsP2Name) statsP2Name.textContent = gameState.players[1].name || 'Player 2';

    if ($('stat-p1-played')) $('stat-p1-played').textContent = p1Stats.cardsPlayed;
    if ($('stat-p1-drawn')) $('stat-p1-drawn').textContent = p1Stats.cardsDrawn;
    if ($('stat-p1-discarded')) $('stat-p1-discarded').textContent = p1Stats.cardsDiscarded;
    if ($('stat-p1-expressions')) $('stat-p1-expressions').textContent = p1Stats.expressionsScored.length;
    if ($('stat-p1-avg-length')) {
      const avg = p1Stats.expressionsScored.length > 0 
        ? (p1Stats.cardsPlayed / p1Stats.expressionsScored.length).toFixed(1)
        : '—';
      $('stat-p1-avg-length').textContent = avg;
    }
    if ($('stat-p1-best')) {
      if (p1Stats.bestExpression) {
        const expr = p1Stats.bestExpression.expression.map(c => 
          c.type === CardType.Number ? c.value : 
          (c.operatorKind === OperatorKind.Add ? '+' :
           c.operatorKind === OperatorKind.Sub ? '−' :
           c.operatorKind === OperatorKind.Mul ? '×' : '÷')
        ).join(' ');
        $('stat-p1-best').textContent = `${expr} = ${p1Stats.bestExpression.value}`;
      } else {
        $('stat-p1-best').textContent = '—';
      }
    }
    if ($('stat-p1-time-saved')) $('stat-p1-time-saved').textContent = `${p1Stats.timeSaved}s`;
    if ($('stat-p1-rehands')) $('stat-p1-rehands').textContent = p1Stats.rehandsUsed;

    if ($('stat-p2-played')) $('stat-p2-played').textContent = p2Stats.cardsPlayed;
    if ($('stat-p2-drawn')) $('stat-p2-drawn').textContent = p2Stats.cardsDrawn;
    if ($('stat-p2-discarded')) $('stat-p2-discarded').textContent = p2Stats.cardsDiscarded;
    if ($('stat-p2-expressions')) $('stat-p2-expressions').textContent = p2Stats.expressionsScored.length;
    if ($('stat-p2-avg-length')) {
      const avg = p2Stats.expressionsScored.length > 0 
        ? (p2Stats.cardsPlayed / p2Stats.expressionsScored.length).toFixed(1)
        : '—';
      $('stat-p2-avg-length').textContent = avg;
    }
    if ($('stat-p2-best')) {
      if (p2Stats.bestExpression) {
        const expr = p2Stats.bestExpression.expression.map(c => 
          c.type === CardType.Number ? c.value : 
          (c.operatorKind === OperatorKind.Add ? '+' :
           c.operatorKind === OperatorKind.Sub ? '−' :
           c.operatorKind === OperatorKind.Mul ? '×' : '÷')
        ).join(' ');
        $('stat-p2-best').textContent = `${expr} = ${p2Stats.bestExpression.value}`;
      } else {
        $('stat-p2-best').textContent = '—';
      }
    }
    if ($('stat-p2-time-saved')) $('stat-p2-time-saved').textContent = `${p2Stats.timeSaved}s`;
    if ($('stat-p2-rehands')) $('stat-p2-rehands').textContent = p2Stats.rehandsUsed;

    // Expressions tab
    const expressionsList = $('expressions-list');
    if (expressionsList) {
      expressionsList.innerHTML = '';
      const allExpressions = [...p1Stats.expressionsScored, ...p2Stats.expressionsScored]
        .sort((a, b) => a.turn - b.turn);
      allExpressions.forEach(expr => {
        const entry = document.createElement('div');
        entry.className = 'expression-entry';
        const exprText = expr.expression.map(c => 
          c.type === CardType.Number ? c.value : 
          (c.operatorKind === OperatorKind.Add ? '+' :
           c.operatorKind === OperatorKind.Sub ? '−' :
           c.operatorKind === OperatorKind.Mul ? '×' : '÷')
        ).join(' ');
        entry.innerHTML = `
          <div class="expression-entry-header">
            <span class="expression-entry-text">${exprText} = ${expr.value}</span>
            <span class="expression-entry-details">Target: ${expr.target}</span>
          </div>
          <div class="expression-entry-details">Turn ${expr.turn} · ${Math.floor(expr.timeRemaining)}s remaining</div>
        `;
        expressionsList.appendChild(entry);
      });
    }

    // XP Breakdown tab
    try {
      const raw = localStorage.getItem('mmtp-player-stats');
      const stats = raw ? JSON.parse(raw) : {};
      const baseXP = winnerId === 0 ? 5 : (winnerId === 1 ? 25 : 10);
      const winBonus = winnerId === 1 ? 25 : 0;
      // Time bonus (educational - encourages fast thinking, same calculation as in endGame)
      const totalTimeSaved = p1Stats.timeSaved || 0;
      let timeBonus = 0;
      if (totalTimeSaved > 0) {
        const first30 = Math.min(30, totalTimeSaved);
        const next30 = Math.min(30, Math.max(0, totalTimeSaved - 30));
        const rest = Math.max(0, totalTimeSaved - 60);
        timeBonus = Math.floor(first30 * 0.15 + next30 * 0.10 + rest * 0.05);
        timeBonus = Math.min(15, timeBonus); // Cap at 15 XP per match
      }
      const totalXP = baseXP + winBonus + timeBonus;
      
      if ($('xp-base')) $('xp-base').textContent = `+${baseXP}`;
      if ($('xp-win')) $('xp-win').textContent = `+${winBonus}`;
      if ($('xp-time')) $('xp-time').textContent = `+${timeBonus}`;
      if ($('xp-total')) $('xp-total').textContent = `+${totalXP}`;
      if ($('xp-progress')) {
        const level = stats.level || 1;
        const xp = stats.xp || 0;
        const xpToNext = stats.xpToNext || 100;
        $('xp-progress').textContent = `Level ${level}: ${xp}/${xpToNext} XP`;
      }
    } catch (e) {
      console.warn('Failed to load XP breakdown', e);
    }

    // Reset tabs to Summary on each game-over
    const tabs = gameOverModal.querySelectorAll('.game-over-tab');
    const tabContents = gameOverModal.querySelectorAll('.game-over-tab-content');
    tabs.forEach(t => t.classList.remove('active'));
    tabContents.forEach(c => c.classList.remove('active'));
    const summaryTab = gameOverModal.querySelector('.game-over-tab[data-tab="summary"]');
    const summaryContent = gameOverModal.querySelector('#tab-summary');
    if (summaryTab) summaryTab.classList.add('active');
    if (summaryContent) summaryContent.classList.add('active');

    if (gameOverModal) gameOverModal.classList.remove('hidden');
  }

  function updateTarget() {
    if (targetValue) targetValue.textContent = gameState.target;
    if (targetBig) {
      targetBig.textContent = gameState.target;
      if (localStorage.getItem('mmtp-target-highlight') !== 'false') {
        targetBig.classList.remove('target-pulse');
        void targetBig.offsetWidth; // force reflow to restart animation
        targetBig.classList.add('target-pulse');
      }
    }
  }

  function updateTimer() {
    // Calculate actual time remaining (real-world time, not affected by speed)
    // This is what the timer would be if running at 1x speed
    const actualTimeElapsed = gameState.actualTimeElapsed || 0;
    const actualTimeRemaining = Math.max(0, gameState.turnTimerStart - actualTimeElapsed);
    const actualSec = Math.ceil(actualTimeRemaining);
    const actualMinutes = Math.floor(actualSec / 60);
    const actualSeconds = actualSec % 60;
    const actualText = `${String(actualMinutes).padStart(2, '0')}:${String(actualSeconds).padStart(2, '0')}`;
    
    // Calculate estimated/game time remaining (affected by speed multiplier)
    // This is what turnTimer shows (game time, decremented by speed)
    const estimatedTimeRemaining = Math.max(0, gameState.turnTimer);
    const estimatedSec = Math.ceil(estimatedTimeRemaining);
    const estimatedMinutes = Math.floor(estimatedSec / 60);
    const estimatedSeconds = estimatedSec % 60;
    const estimatedText = `${String(estimatedMinutes).padStart(2, '0')}:${String(estimatedSeconds).padStart(2, '0')}`;
    
    // Display both times when speed is increased
    if (timerValue) {
      if (gameSpeedMultiplier > 1.0) {
        // Show both actual (real time) and estimated (game time) when speed is increased
        timerValue.textContent = `${actualText} (game: ${estimatedText})`;
        timerValue.title = `Actual (real time): ${actualText} | Game time: ${estimatedText} | Speed: ${gameSpeedMultiplier.toFixed(1)}x`;
      } else {
        // Normal speed: just show actual time (they're the same)
        timerValue.textContent = actualText;
        timerValue.title = `Time remaining: ${actualText}`;
      }
    }
    
    if (timerFloating) {
      const valueEl = timerFloating.querySelector('.timer-floating-value');
      if (valueEl) {
        if (gameSpeedMultiplier > 1.0) {
          valueEl.textContent = `${actualText} (game: ${estimatedText})`;
        } else {
          valueEl.textContent = actualText;
        }
      }
    }

    // Timer tick sounds (only once per second, only for human player's turn)
    if (window.SFX && !timerInfinite && gameState.activePlayer === myPlayerId) {
      const prevSec = Math.ceil(Math.max(0, gameState.turnTimerStart - (actualTimeElapsed - 0.1)));
      if (actualSec !== prevSec && actualSec > 0) {
        if (actualSec <= 5) {
          SFX.play('timerUrgent');
        } else if (actualSec <= 10) {
          SFX.play('timerTick');
        }
      }
    }

    // Colour warnings based on actual time
    const root = document.body;
    root.classList.remove('timer-warning', 'timer-danger');
    if (actualSec <= 5) {
      root.classList.add('timer-danger');
    } else if (actualSec <= 15) {
      root.classList.add('timer-warning');
    }
  }

  function updateTurn() {
    if (turnText) {
      turnText.textContent = `Turn: ${gameState.players[gameState.activePlayer - 1].name}`;
    }

    // Highlight active player's hand + big arrow
    if (handP1El) handP1El.classList.toggle('active', gameState.activePlayer === 1);
    if (handP2El) handP2El.classList.toggle('active', gameState.activePlayer === 2);
    
    // Update turn arrow position
    if (turnArrow) {
      turnArrow.classList.remove('turn-arrow-up', 'turn-arrow-down');
      if (gameState.activePlayer === 1) {
        turnArrow.classList.add('turn-arrow-down');
      } else {
        turnArrow.classList.add('turn-arrow-up');
      }
    }

    // Skip bot button (fast testing) - show for any bot turn
    if (btnSkipBot) {
      const isBotTurn = (gameRules.botP1 && gameState.activePlayer === 1) || 
                       (gameRules.allowBots && gameState.activePlayer === 2);
      btnSkipBot.classList.toggle('hidden', !isBotTurn || gameState.gameOver);
    }

    // Reposition arrow (simple triangle between playfield and active hand)
    try {
      if (turnArrow && playfield) {
        const pf = playfield.getBoundingClientRect();
        const h1 = handP1El?.getBoundingClientRect();
        const h2 = handP2El?.getBoundingClientRect();
        const cx = pf.left + pf.width / 2;

        let y = pf.top + pf.height / 2;
        if (gameState.activePlayer === 1 && h1) {
          y = (pf.bottom + h1.top) / 2;
        } else if (gameState.activePlayer === 2 && h2) {
          y = (h2.bottom + pf.top) / 2;
        }

        turnArrow.style.left = `${cx}px`;
        turnArrow.style.top = `${y}px`;
      }
    } catch (_) {}
  }

  function formatScore(score) {
    // Display fractional scores nicely: 2.5 → "2.5", 3.25 → "3.25", 4 → "4"
    if (Number.isInteger(score)) return String(score);
    // Show at most 2 decimal places, strip trailing zeros
    return score.toFixed(2).replace(/\.?0+$/, '');
  }

  function updateScores() {
    if (scoreP1) {
      scoreP1.textContent = formatScore(gameState.players[0].score);
      scoreP1.classList.toggle('double-active', !!gameState.doubleNext[1]);
    }
    if (scoreP2) {
      scoreP2.textContent = formatScore(gameState.players[1].score);
      scoreP2.classList.toggle('double-active', !!gameState.doubleNext[2]);
    }

    // Render ALL piles inside each player's hand score zone (shows all 5+ piles)
    function renderAllPiles(zoneEl, player) {
      if (!zoneEl) return;
      zoneEl.innerHTML = '';
      const piles = player.scorePile || [];

      piles.forEach((pileEntry) => {
        const mini = document.createElement('div');
        mini.className = 'mini-pile';

        const exprCard = document.createElement('div');
        exprCard.className = 'score-pile-card expression-card';
        const rotate1 = (Math.random() * 10 - 5).toFixed(1);
        exprCard.style.setProperty('--card-rotate', `${rotate1}deg`);
        exprCard.style.transform = `translate(${(Math.random() * 6 - 3).toFixed(1)}px, ${(Math.random() * 6 - 3).toFixed(1)}px) rotate(${rotate1}deg)`;
        exprCard.style.zIndex = '1';
        const exprText = (pileEntry.expression || []).map((c) =>
          c.type === CardType.Number ? c.value :
            (c.operatorKind === OperatorKind.Add ? '+' :
             c.operatorKind === OperatorKind.Sub ? '−' :
             c.operatorKind === OperatorKind.Mul ? '×' : '÷')
        ).join(' ');
        exprCard.textContent = exprText || 'OK';
        mini.appendChild(exprCard);

        const gold = document.createElement('div');
        gold.className = 'score-pile-card golden-target';
        gold.textContent = String(pileEntry.target ?? '');
        const rotate2 = (Math.random() * 6 - 3).toFixed(1);
        gold.style.setProperty('--card-rotate', `${rotate2}deg`);
        gold.style.transform = `translate(${(Math.random() * 4 - 2).toFixed(1)}px, ${(Math.random() * 4 - 2).toFixed(1)}px) rotate(${rotate2}deg)`;
        gold.style.zIndex = '2';
        mini.appendChild(gold);

        zoneEl.appendChild(mini);
      });
    }

    renderAllPiles(scoreZoneP1, gameState.players[0]);
    renderAllPiles(scoreZoneP2, gameState.players[1]);
  }
  
  function addToScorePile(playerId, expression) {
    if (playerId < 1 || playerId > 2) {
      console.error(`[addToScorePile] Invalid playerId: ${playerId}`);
      return;
    }
    const player = gameState.players[playerId - 1];
    if (!player) {
      console.error(`[addToScorePile] Player ${playerId} not found`);
      return;
    }
    if (!player.scorePile) player.scorePile = [];
    if (!expression || expression.length === 0) {
      console.warn(`[addToScorePile] Empty expression for player ${playerId}`);
      return;
    }
    player.scorePile.push({ expression: [...expression], target: gameState.target });
    updateScores();
  }

  function updateDeckCount() {
    if (deckCount) {
      const total = gameState.deck.length + gameState.discardPile.length;
      deckCount.textContent = total > 0 ? total : '0';
    }
    // Update discard pile visualization
    renderDiscardPile();
  }
  
  function renderDiscardPile() {
    // Render discarded cards scattered over the playfield
    if (!playfield) {
      console.warn('[Discard Pile] Playfield element not found!');
      return;
    }
    
    // Remove existing discard cards from playfield
    const existingDiscards = playfield.querySelectorAll('.discard-pile-card');
    existingDiscards.forEach(el => el.remove());
    
    if (gameState.discardPile.length === 0) {
      return;
    }
    
    // Get discard amount from settings (default to 15, or use showAllDiscards from cheat panel)
    const discardAmountSetting = localStorage.getItem('mmtp-discard-amount') || '15';
    const maxDiscardCards = showAllDiscards ? gameState.discardPile.length : 
      (discardAmountSetting === 'all' ? gameState.discardPile.length : parseInt(discardAmountSetting, 10));
    const visibleCards = gameState.discardPile.slice(-maxDiscardCards);
    const playfieldRect = playfield.getBoundingClientRect();
    
    // Calculate center area to avoid (where target-big is displayed)
    const centerX = playfieldRect.width / 2;
    const centerY = playfieldRect.height / 2;
    // Larger avoid radius to ensure target is never blocked (40% of smaller dimension)
    const avoidRadius = Math.min(playfieldRect.width, playfieldRect.height) * 0.4;
    
    visibleCards.forEach((card, idx) => {
      const cardEl = document.createElement('div');
      cardEl.className = 'card discard-pile-card';
      cardEl.setAttribute('data-player-id', 'discard');
      cardEl.setAttribute('data-index', idx);
      
      // Random position within playfield, but AVOID center area (where target is)
      const padding = 40;
      let x, y;
      let attempts = 0;
      do {
        x = padding + Math.random() * (playfieldRect.width - padding * 2);
        y = padding + Math.random() * (playfieldRect.height - padding * 2);
        attempts++;
        // Check if position is too close to center (target area)
        const distFromCenter = Math.sqrt(Math.pow(x - centerX, 2) + Math.pow(y - centerY, 2));
        // Break if far enough from center (NOT too close) or give up after 50 tries
        if (distFromCenter >= avoidRadius || attempts > 50) break;
      } while (attempts < 50);
      
      // Random rotation (some face up, some face down)
      const isFlipped = Math.random() > 0.5;
      const rotation = (Math.random() * 60 - 30); // -30 to +30 degrees
      
      cardEl.style.position = 'absolute';
      cardEl.style.left = `${x}px`;
      cardEl.style.top = `${y}px`;
      cardEl.style.transform = `rotate(${rotation}deg) ${isFlipped ? 'scaleY(-1)' : ''}`;
      cardEl.style.zIndex = idx;
      // Get opacity from settings (default to 0.4)
      const discardOpacity = localStorage.getItem('mmtp-discard-opacity') !== 'false';
      cardEl.style.opacity = discardOpacity ? '0.4' : '0.6'; // Semi-transparent or slightly more visible
      cardEl.style.pointerEvents = 'none'; // Don't block clicks
      
      // Use same card styling as hand cards
      if (card.type === CardType.Number) {
        cardEl.textContent = card.value;
        cardEl.classList.add('card-number');
      } else {
        const opSymbol = card.operatorKind === OperatorKind.Add ? '+' :
                        card.operatorKind === OperatorKind.Sub ? '−' :
                        card.operatorKind === OperatorKind.Mul ? '×' : '÷';
        cardEl.textContent = opSymbol;
        cardEl.classList.add('card-operator');
      }
      
      playfield.appendChild(cardEl);
    });
    
    dbg(`[Discard Pile] Rendered ${visibleCards.length}/${gameState.discardPile.length} cards`);
  }

  function startTimer() {
    if (gameState.timerInterval) {
      clearInterval(gameState.timerInterval);
    }
    
    gameState.timerInterval = setInterval(() => {
      if (timerPaused) return;
      gameState.actualTimeElapsed += 0.1;
      if (!timerInfinite) {
        gameState.turnTimer -= 0.1 * gameSpeedMultiplier;
        if (gameState.turnTimer < 0) gameState.turnTimer = 0;
      }
      updateTimer();
      if (!timerInfinite && gameState.turnTimer <= 0) {
        endTurn();
      }
    }, 100);
  }

  function toggleHelp() {
    if (helpPanel) {
      helpPanel.classList.toggle('hidden');
    }
  }

  // Event listeners
  playfield.addEventListener('click', (e) => {
    // Don't handle if clicking on a playfield card (handled by card's own click handler)
    if (e.target.classList.contains('playfield-card')) {
      return;
    }
    
    dbg('[Playfield Click] Selected cards:', gameState.selectedCards?.length || 0, 'Selected card:', !!gameState.selectedCard, 'Playfield:', gameState.playfield.length);
    if ((gameState.selectedCards && gameState.selectedCards.length > 0) || gameState.selectedCard) {
      dbg('[Playfield Click] Placing selected cards');
      placeSelectedCardsOnPlayfield();
    } else if (gameState.playfield.length > 0) {
      dbg('[Playfield Click] Attempting to score');
      tryScore();
    } else {
      dbg('[Playfield Click] Nothing to do (no selection, no playfield)');
    }
  });

  playfield.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && gameState.playfield.length > 0) {
      tryScore();
    }
  });

  // Rehand feature - hold deck button
  btnDraw.addEventListener('mousedown', () => {
    if (gameState.activePlayer === 1 && !gameState.gameOver) {
      gameState.rehandHolding = true;
      btnDraw.classList.add('holding');
      if (deckLoading) deckLoading.classList.remove('hidden');
      
      gameState.rehandTimeout = setTimeout(() => {
        if (gameState.rehandHolding) {
          doRehand(1);
        }
      }, 1500); // Hold for 1.5 seconds
    }
  });
  
  btnDraw.addEventListener('mouseup', () => {
    if (gameState.rehandTimeout) {
      clearTimeout(gameState.rehandTimeout);
      gameState.rehandTimeout = null;
    }
    gameState.rehandHolding = false;
    btnDraw.classList.remove('holding');
    if (deckLoading) deckLoading.classList.add('hidden');
  });
  
  btnDraw.addEventListener('mouseleave', () => {
    if (gameState.rehandTimeout) {
      clearTimeout(gameState.rehandTimeout);
      gameState.rehandTimeout = null;
    }
    gameState.rehandHolding = false;
    btnDraw.classList.remove('holding');
    if (deckLoading) deckLoading.classList.add('hidden');
  });
  
  btnDraw.addEventListener('click', () => {
    if (gameState.activePlayer === 1 && !gameState.gameOver && !gameState.rehandHolding) {
      handleDrawClick();
    }
  });
  
  function doRehand(playerId, bypassCheck = false) {
    if (gameState.gameOver) return;
    if (!bypassCheck && (!canMakeMove() || playerId !== gameState.activePlayer)) {
      if (playerId === myPlayerId) toast('Not your turn', 'warning');
      return;
    }
    // ── Online: send to server ──
    if (onlineGame && playerId === myPlayerId) {
      netAction('rehand').then(res => {
        if (!res.ok) toast(res.error || 'Cannot rehand', 'warning');
      });
      return;
    }
    
    const player = gameState.players[playerId - 1];
    const originalHandSize = player.hand.length;
    
    // Discard entire hand (instant, no animation)
    player.hand.forEach((card) => {
      gameState.discardPile.push(card);
      // Track cards discarded
      gameState.matchStats.players[playerId - 1].cardsDiscarded++;
    });
    player.hand = [];
    // Track rehand used
    gameState.matchStats.players[playerId - 1].rehandsUsed++;
    
    // Determine how many cards to draw on rehand
    let toDraw = gameRules.rehandDrawCount || 0;
    if (toDraw <= 0) {
      // 0 = refill to configured hand size
      toDraw = gameRules.handSize || originalHandSize || 5;
    }
    
    // Draw new hand
    for (let i = 0; i < toDraw; i++) {
      const c = drawCard(playerId);
      if (c) {
        // quick burst animation
        animateCardFly(btnDraw, playerId === 1 ? cardsP1 : cardsP2, c.type === CardType.Number ? String(c.value) : 'OP');
      }
    }
    
    if (localStorage.getItem('mmtp-auto-sort-hand') === 'true') {
      sortHand(playerId);
    }
    renderHands();
    updateDeckCount();
    clearSelection();
    
    // End turn immediately
    endTurn();
  }

  // Click timer to end turn
  if (timerFloating) {
    timerFloating.addEventListener('click', () => {
      if (!gameState.gameOver && gameState.activePlayer === 1) {
        endTurn();
      }
    });
  }
  
  // Discard zone drag and drop - REMOVED (no longer using visible discard zone)
  // Cards can still be discarded via keyboard shortcuts (Delete/D) or drag to bottom-right area
  
  // Playfield drag and drop
  playfield.addEventListener('dragover', (e) => {
    if (gameState.isDragging) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    }
  });
  
  playfield.addEventListener('drop', (e) => {
    e.preventDefault();
    gameState.dragValidDrop = true; // Mark as valid drop
    const json = e.dataTransfer.getData('application/json');
    if (json) {
      try {
        const payload = JSON.parse(json);
        if (payload.type === 'multi' && Array.isArray(payload.cards)) {
          // build selection by card reference and place
          gameState.selectedCards = payload.cards
            .map((c) => {
              const player = gameState.players[c.playerId - 1];
              const card = player?.hand?.[c.index];
              return card ? { playerId: c.playerId, index: c.index, card } : null;
            })
            .filter(Boolean);
          placeSelectedCardsOnPlayfield();
          clearSelection();
          return;
        }
      } catch (_) {}
    }

    const data = e.dataTransfer.getData('text/plain');
    if (data) {
      const [playerId, index] = data.split('-').map(Number);
      const card = gameState.players[playerId - 1]?.hand?.[index];
      if (!card) return;
      gameState.selectedCard = { playerId, index, card };
      placeCardOnPlayfield();
    }
  });
  
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || e.key === '?') {
      toggleHelp();
    } else if (e.key === ' ' && gameState.activePlayer === 1 && !gameState.gameOver) {
      e.preventDefault();
      if (!gameState.rehandHolding) {
        btnDraw.click();
      }
    } else if ((e.key === 's' || e.key === 'S') && gameState.activePlayer === 1 && !gameState.gameOver) {
      e.preventDefault();
      sortHand(1);
    } else if ((e.key === 'u' || e.key === 'U') && !gameState.gameOver) {
      e.preventDefault();
      undoLastPlayfieldCard();
    } else if ((e.key === 'c' || e.key === 'C') && !gameState.gameOver) {
      e.preventDefault();
      clearPlayfieldOnly();
    } else if (e.key === 'Delete' || e.key === 'Backspace' || e.key.toLowerCase() === 'd') {
      if (gameState.gameOver) return;
      if (gameState.selectedCards && gameState.selectedCards.length > 0) {
        e.preventDefault();
        // Discard all selected cards for active player
        const toDiscard = [...gameState.selectedCards].filter(c => c.playerId === gameState.activePlayer);
        // discard from highest index down to avoid shifting
        toDiscard.sort((a, b) => b.index - a.index).forEach(({ playerId, index }) => {
          discardCard(playerId, index);
        });
        clearSelection();
      } else if (gameState.selectedCard) {
        e.preventDefault();
        const { playerId, index } = gameState.selectedCard;
        discardCard(playerId, index);
      }
    } else if (e.key === 'h' || e.key === 'H') {
      if (exprHistoryPanel) exprHistoryPanel.classList.toggle('collapsed');
    } else if (e.key === 't' || e.key === 'T') {
      if (chatPanel && !chatPanel.classList.contains('hidden')) {
        chatPanel.classList.toggle('collapsed');
        if (!chatPanel.classList.contains('collapsed') && chatInput) {
          chatUnreadCount = 0;
          if (chatBadge) { chatBadge.textContent = '0'; chatBadge.classList.add('hidden'); }
          chatInput.focus();
        }
      }
    }
  });

  if (btnSortHand) {
    btnSortHand.addEventListener('click', () => {
      if (gameState.activePlayer === 1 && !gameState.gameOver) sortHand(1);
    });
  }

  if (btnUndoPlayfield) {
    btnUndoPlayfield.addEventListener('click', () => {
      undoLastPlayfieldCard();
    });
  }

  if (btnClearPlayfield) {
    btnClearPlayfield.addEventListener('click', () => {
      clearPlayfieldOnly();
    });
  }

  function sortHand(playerId) {
    // ── Online: send to server ──
    if (onlineGame && playerId === myPlayerId) {
      netAction('sortHand');
      // Also sort locally for instant feedback
    }
    const player = gameState.players[playerId - 1];
    if (!player?.hand) return;
    // Numbers first (ascending), then operators, then parens, then specials
    const typeOrder = { [CardType.Number]: 0, [CardType.Operator]: 1, [CardType.Paren]: 2, [CardType.Special]: 3 };
    const opOrder = { [OperatorKind.Add]: 0, [OperatorKind.Sub]: 1, [OperatorKind.Mul]: 2, [OperatorKind.Div]: 3, [OperatorKind.Mod]: 4, [OperatorKind.Pow]: 5 };
    const specOrder = { [SpecialKind.Wild]: 0, [SpecialKind.Reroll]: 1, [SpecialKind.Double]: 2, [SpecialKind.Peek]: 3, [SpecialKind.Swap]: 4 };
    const parenOrder = { [ParenKind.Open]: 0, [ParenKind.Close]: 1 };
    player.hand.sort((a, b) => {
      if (a.type !== b.type) return (typeOrder[a.type] ?? 99) - (typeOrder[b.type] ?? 99);
      if (a.type === CardType.Number) return (a.value ?? 0) - (b.value ?? 0);
      if (a.type === CardType.Operator) return (opOrder[a.operatorKind] ?? 99) - (opOrder[b.operatorKind] ?? 99);
      if (a.type === CardType.Paren) return (parenOrder[a.parenKind] ?? 99) - (parenOrder[b.parenKind] ?? 99);
      return (specOrder[a.specialKind] ?? 99) - (specOrder[b.specialKind] ?? 99);
    });
    renderHands();
  }

  if (btnCloseHelp) {
    btnCloseHelp.addEventListener('click', toggleHelp);
    helpPanel.querySelector('.help-backdrop')?.addEventListener('click', toggleHelp);
  }

  if (btnHelpTrigger) {
    btnHelpTrigger.addEventListener('click', toggleHelp);
  }

  if (btnSkipBot) {
    btnSkipBot.addEventListener('click', () => {
      const isBotTurn = (gameRules.botP1 && gameState.activePlayer === 1) || 
                       (gameRules.allowBots && gameState.activePlayer === 2);
      if (!gameState.gameOver && isBotTurn) {
        endTurn();
        toast('Skipped bot turn', 'info');
      }
    });
  }

  function resetGameState() {
    if (gameState.timerInterval) { clearInterval(gameState.timerInterval); gameState.timerInterval = null; }
    if (syncInterval) { clearInterval(syncInterval); syncInterval = null; }
    if (botWatchdogTimer) { clearTimeout(botWatchdogTimer); botWatchdogTimer = null; }
    botTurnStartTime = 0;
    timerPaused = false;
    timerInfinite = false;

    gameState.players[0].score = 0;
    gameState.players[0].hand = [];
    gameState.players[0].scorePile = [];
    gameState.players[1].score = 0;
    gameState.players[1].hand = [];
    gameState.players[1].scorePile = [];
    gameState.activePlayer = 1;
    gameState.target = gameRules.fixedStartTarget ? 1 : randomTarget();
    gameState.turnTimer = gameRules.turnTimerSec;
    gameState.turnTimerStart = gameRules.turnTimerSec;
    gameState.actualTimeElapsed = 0;
    gameState.gameOver = false;
    gameState.winner = null;
    gameState.playfield = [];
    gameState.discardPile = [];
    gameState.selectedCards = [];
    gameState.dragSelectStart = null;
    gameState.rehandHolding = false;
    gameState.rehandTimeout = null;
    gameState.drawsThisTurn = 0;
    gameState.botReevalAttempts = {};
    gameState.botDiscardCount = {};
    gameState.matchStats = {
      startTime: Date.now(),
      endTime: null,
      players: [
        { cardsPlayed: 0, cardsDrawn: 0, cardsDiscarded: 0, expressionsScored: [], rehandsUsed: 0, timeSaved: 0, bestExpression: null },
        { cardsPlayed: 0, cardsDrawn: 0, cardsDiscarded: 0, expressionsScored: [], rehandsUsed: 0, timeSaved: 0, bestExpression: null },
      ],
    };
    turnNumber = 0;
    clearExpressionHistory();
    updateRoundCounter();

    gameState.deck = createDeck();
    dealInitialHands();

    updateTarget();
    updateTimer();
    updateTurn();
    updateScores();
    updateDeckCount();
    renderHands();
    renderDiscardPile();

    if (expressionDisplay) expressionDisplay.innerHTML = '';
    const playfieldEl = $('playfield');
    if (playfieldEl) playfieldEl.classList.remove('has-expression');
    if (scoreZoneP1) scoreZoneP1.innerHTML = '';
    if (scoreZoneP2) scoreZoneP2.innerHTML = '';

    // Reset cheat panel checkboxes to match cleared state
    const cheatPauseEl = $('cheat-pause-timer');
    const cheatInfiniteEl = $('cheat-infinite-timer');
    if (cheatPauseEl) cheatPauseEl.checked = false;
    if (cheatInfiniteEl) cheatInfiniteEl.checked = false;

    writeGameState();
    startTimer();

    if (roomCode && !isHost) {
      syncInterval = setInterval(() => {
        syncFromStorage();
      }, 200);
    }

    if (gameRules.allowBots && gameState.activePlayer === 2) {
      setTimeout(() => runBotTurn(2), 600);
    }
  }

  const btnRematch = $('btn-rematch');

  if (btnRematch) {
    btnRematch.addEventListener('click', () => {
      if (gameOverModal) gameOverModal.classList.add('hidden');
      resetGameState();
      toast('Rematch started!', 'success');
    });
  }

  if (btnBackToLobby) {
    btnBackToLobby.addEventListener('click', () => {
      window.location.href = 'index.html';
    });
  }

  // UI Size Toggle (same as lobby) - load from settings
  let uiSize = localStorage.getItem('mmtp-ui-size') || 'normal';
  function applyUiSize() {
    document.body.classList.remove('ui-large', 'ui-small');
    if (uiSize === 'large') {
      document.body.classList.add('ui-large');
    } else if (uiSize === 'small') {
      document.body.classList.add('ui-small');
    }
  }
  applyUiSize();
  
  // Listen for settings changes from lobby
  window.addEventListener('settingsChanged', (e) => {
    if (e.detail && e.detail.uiSize) {
      uiSize = e.detail.uiSize;
      applyUiSize();
    }
    // Update discard pile if amount changed
    if (e.detail && e.detail.discardAmount !== undefined) {
      renderDiscardPile();
    }
  });
  
  // Also listen to localStorage changes (in case settings changed in another tab)
  window.addEventListener('storage', (e) => {
    if (e.key === 'mmtp-ui-size') {
      uiSize = e.newValue || 'normal';
      applyUiSize();
    } else if (e.key === 'mmtp-discard-amount' || e.key === 'mmtp-discard-opacity') {
      renderDiscardPile();
    }
  });
  
  // Add UI size toggle button to gameplay HUD
  const btnUiSize = document.createElement('button');
  btnUiSize.id = 'btn-ui-size-gameplay';
  btnUiSize.className = 'btn-ui-size';
  btnUiSize.type = 'button';
  btnUiSize.setAttribute('aria-label', 'Toggle UI size');
  btnUiSize.title = 'Toggle UI Size (Larger/Smaller)';
  btnUiSize.textContent = uiSize === 'large' ? '🔍+' : uiSize === 'small' ? '🔍-' : '🔍';
  btnUiSize.addEventListener('click', () => {
    if (uiSize === 'normal') {
      uiSize = 'large';
      btnUiSize.textContent = '🔍+';
      btnUiSize.title = 'UI Size: Large (click for Small)';
    } else if (uiSize === 'large') {
      uiSize = 'small';
      btnUiSize.textContent = '🔍-';
      btnUiSize.title = 'UI Size: Small (click for Normal)';
    } else {
      uiSize = 'normal';
      btnUiSize.textContent = '🔍';
      btnUiSize.title = 'UI Size: Normal (click for Large)';
    }
    applyUiSize();
    localStorage.setItem('mmtp-ui-size', uiSize);
  });
  const hudTop = $('hud-top');
  if (hudTop && hudTop.querySelector('.hud-right')) {
    hudTop.querySelector('.hud-right').appendChild(btnUiSize);
  }
  
  // Initialize game
  if (isHost) {
    // Host: create fresh game state
    gameState.deck = createDeck();
    dealInitialHands();
    writeGameState(); // Initial sync
  } else {
    // Client: try to sync from host
    const syncState = readGameState();
    if (syncState) {
      // Load from sync
      gameState.players = syncState.players.map(p => ({
        id: p.id,
        name: p.name,
        score: p.score,
        hand: p.hand,
        scorePile: p.scorePile,
      }));
      gameState.activePlayer = syncState.activePlayer;
      gameState.target = syncState.target;
      gameState.turnTimer = syncState.turnTimer;
    // Ensure timer tracking is initialized if not present
    if (gameState.turnTimerStart === undefined) {
      gameState.turnTimerStart = gameRules.turnTimerSec;
    }
    if (gameState.actualTimeElapsed === undefined) {
      gameState.actualTimeElapsed = 0;
    }
      gameState.deck = syncState.deck;
      gameState.discardPile = syncState.discardPile;
      gameState.playfield = syncState.playfield;
      gameState.gameOver = syncState.gameOver;
      gameState.winner = syncState.winner;
      gameState.drawsThisTurn = syncState.drawsThisTurn || 0;
      lastSyncVersion = syncState.version || 0;
    } else {
      // Fallback: create local game
      gameState.deck = createDeck();
      dealInitialHands();
    }
  }
  
    updateTarget();
    updateTimer();
    updateTurn();
    updateScores();
    updateDeckCount();
    renderHands();
    renderDiscardPile(); // Initial render of discard pile
  startTimer();

  // Game-over tab switching (one-time setup via delegation)
  if (gameOverModal) {
    gameOverModal.addEventListener('click', (e) => {
      const tab = e.target.closest('.game-over-tab');
      if (!tab) return;
      const tabName = tab.dataset.tab;
      gameOverModal.querySelectorAll('.game-over-tab').forEach(t => t.classList.remove('active'));
      gameOverModal.querySelectorAll('.game-over-tab-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      const content = gameOverModal.querySelector(`#tab-${tabName}`);
      if (content) content.classList.add('active');
    });
  }

  // Enable drop-anywhere reorder for both hands (prep allowed)
  enableHandDropReorder(1);
  enableHandDropReorder(2);
  
  // Make playfield focusable
  playfield.setAttribute('tabindex', '0');
  
  // Start multiplayer sync polling (client reads, host writes on actions)
  if (roomCode) {
    syncInterval = setInterval(() => {
      if (!isHost) {
        syncFromStorage();
      }
    }, 200); // Poll every 200ms
  }

  // Initialize cheat panel
  function initCheatPanel() {
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
        toast(`P1 Bot ${e.target.checked ? 'enabled' : 'disabled'}`, 'info');
        // If P1 bot enabled and it's P1's turn, start bot
        if (e.target.checked && gameState.activePlayer === 1 && !gameState.gameOver && isHost) {
          setTimeout(() => runBotTurn(1), 500);
        }
      });
    }

    if (cheatAutoSkipBot) {
      cheatAutoSkipBot.addEventListener('change', (e) => {
        autoSkipBotTurns = e.target.checked;
        toast(autoSkipBotTurns ? 'Auto-skip bot turns ON' : 'Auto-skip bot turns OFF', 'info');
      });
    }

    if (cheatSkipBot) {
      cheatSkipBot.addEventListener('change', (e) => {
        const activeBot = (gameRules.botP1 && gameState.activePlayer === 1) || 
                         (gameRules.allowBots && gameState.activePlayer === 2);
        if (e.target.checked && activeBot && !gameState.gameOver) {
          endTurn();
          e.target.checked = false;
        }
      });
    }

    if (cheatBotDifficulty) {
      cheatBotDifficulty.value = gameRules.botDifficulty || 'medium';
      cheatBotDifficulty.addEventListener('change', (e) => {
        gameRules.botDifficulty = e.target.value;
        toast(`Bot difficulty set to ${e.target.value}`, 'info');
      });
    }

    if (cheatForceEndTurn) {
      cheatForceEndTurn.addEventListener('click', () => {
        if (!gameState.gameOver) endTurn();
      });
    }

    if (cheatForceWinP1) {
      cheatForceWinP1.addEventListener('click', () => {
        if (!gameState.gameOver) endGame(1);
      });
    }

    if (cheatForceWinP2) {
      cheatForceWinP2.addEventListener('click', () => {
        if (!gameState.gameOver) endGame(2);
      });
    }

    if (cheatForceDraw) {
      cheatForceDraw.addEventListener('click', () => {
        if (!gameState.gameOver) endGame(0);
      });
    }

    if (cheatApplyTarget && cheatSetTarget) {
      cheatApplyTarget.addEventListener('click', () => {
        const val = parseInt(cheatSetTarget.value);
        if (val >= 1 && val <= 99) {
          gameState.target = val;
          updateTarget();
          toast(`Target set to ${val}`, 'info');
        }
      });
    }

    if (cheatApplyTimer && cheatSetTimer) {
      cheatApplyTimer.addEventListener('click', () => {
        const val = parseInt(cheatSetTimer.value);
        if (val >= 0) {
          gameState.turnTimer = val;
          updateTimer();
          toast(`Timer set to ${val}s`, 'info');
        }
      });
    }

    const cheatPauseTimer = $('cheat-pause-timer');
    const cheatInfiniteTimer = $('cheat-infinite-timer');
    if (cheatPauseTimer) {
      cheatPauseTimer.addEventListener('change', (e) => {
        timerPaused = e.target.checked;
        toast(timerPaused ? 'Timer paused' : 'Timer resumed', 'info');
      });
    }
    if (cheatInfiniteTimer) {
      cheatInfiniteTimer.addEventListener('change', (e) => {
        timerInfinite = e.target.checked;
        toast(timerInfinite ? 'Infinite timer ON' : 'Infinite timer OFF', 'info');
      });
    }

    // Game speed multiplier
    const cheatGameSpeed = $('cheat-game-speed');
    if (cheatGameSpeed) {
      cheatGameSpeed.value = '1';
      cheatGameSpeed.addEventListener('change', (e) => {
        gameSpeedMultiplier = parseFloat(e.target.value) || 1.0;
        toast(`Game speed: ${gameSpeedMultiplier}x`, 'info');
        dbg(`[Cheat Panel] Game speed set to ${gameSpeedMultiplier}x`);
      });
    }
    
    // Bot minimum expression length
    const cheatBotMinLength = $('cheat-bot-min-length');
    if (cheatBotMinLength) {
      cheatBotMinLength.value = '0';
      cheatBotMinLength.addEventListener('change', (e) => {
        botMinExpressionLength = parseInt(e.target.value) || 0;
        if (botMinExpressionLength > 0) {
          toast(`Bot minimum expression length: ${botMinExpressionLength} cards`, 'info');
          dbg(`[Cheat Panel] Bot minimum expression length set to ${botMinExpressionLength}`);
        } else {
          toast(`Bot minimum expression length: disabled`, 'info');
          dbg(`[Cheat Panel] Bot minimum expression length disabled`);
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
        renderDiscardPile();
        toast(`Cleared ${count} cards from discard pile`, 'info');
        dbg(`[Cheat Panel] Cleared ${count} cards from discard pile`);
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
        renderDiscardPile();
        toast(`Added 10 random cards to discard pile (total: ${gameState.discardPile.length})`, 'info');
        dbg(`[Cheat Panel] Added 10 cards to discard pile (total: ${gameState.discardPile.length})`);
      });
    }
    
    // Show all discards toggle
    const checkboxShowAllDiscards = cheatPanel.querySelector('#cheat-show-all-discards');
    if (checkboxShowAllDiscards) {
      checkboxShowAllDiscards.addEventListener('change', (e) => {
        showAllDiscards = e.target.checked;
        renderDiscardPile();
        toast(showAllDiscards ? 'Showing ALL discarded cards' : 'Showing last 15 discarded cards', 'info');
        dbg(`[Cheat Panel] Show all discards: ${showAllDiscards}`);
      });
    }
    
    if (cheatShowDiscardCount) {
      cheatShowDiscardCount.addEventListener('click', () => {
        const count = gameState.discardPile.length;
        const numbers = gameState.discardPile.filter(c => c.type === CardType.Number).length;
        const operators = gameState.discardPile.filter(c => c.type === CardType.Operator).length;
        toast(`Discard Pile: ${count} cards (${numbers} numbers, ${operators} operators)`, 'info');
        dbg(`[Cheat Panel] Discard Pile: ${count} total cards (${numbers} numbers, ${operators} operators)`);
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
              showXPNotification(0, `LEVEL ${stats.level}!`, 'levelup');
            }
            localStorage.setItem('mmtp-player-stats', JSON.stringify(stats));
            showXPNotification(amount, 'XP Added', 'score');
            toast(`Added ${amount} XP`, 'success');
          } catch (e) {
            toast('Failed to add XP', 'error');
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
          toast('XP reset to 0', 'info');
        } catch (e) {
          toast('Failed to reset XP', 'error');
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
            toast(`Level set to ${level}`, 'success');
          } catch (e) {
            toast('Failed to set level', 'error');
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
          showXPNotification(0, `LEVEL ${stats.level}!`, 'levelup');
          toast(`Level up to ${stats.level}`, 'success');
        } catch (e) {
          toast('Failed to level up', 'error');
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
            toast(`Level down to ${stats.level}`, 'info');
          }
        } catch (e) {
          toast('Failed to level down', 'error');
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
            toast(`Added ${amount} win(s)`, 'success');
          } catch (e) {
            toast('Failed to add wins', 'error');
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
            toast(`Added ${amount} loss(es)`, 'info');
          } catch (e) {
            toast('Failed to add losses', 'error');
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
          toast(`Rating set to ${rating}`, 'success');
        } catch (e) {
          toast('Failed to set rating', 'error');
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
          toast(`Rating +50 (now ${stats.rating})`, 'success');
        } catch (e) {
          toast('Failed to update rating', 'error');
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
          toast(`Rating -50 (now ${stats.rating})`, 'info');
        } catch (e) {
          toast('Failed to update rating', 'error');
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
            toast('All stats reset', 'success');
          } catch (e) {
            toast('Failed to reset stats', 'error');
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
        renderHands();
        toast('Card added to P1 hand', 'success');
      });
    }

    if (cheatFillHandP1) {
      cheatFillHandP1.addEventListener('click', () => {
        const targetSize = gameRules.handSize || 7;
        while (gameState.players[0].hand.length < targetSize) {
          const card = drawCard(1);
          if (!card) break;
        }
        renderHands();
        toast('P1 hand filled', 'success');
      });
    }

    if (cheatEmptyDeck) {
      cheatEmptyDeck.addEventListener('click', () => {
        gameState.deck = [];
        updateDeckCount();
        toast('Deck emptied', 'info');
      });
    }

    if (cheatReshuffleDeck) {
      cheatReshuffleDeck.addEventListener('click', () => {
        gameState.deck = [...gameState.discardPile];
        gameState.discardPile = [];
        shuffleDeck();
        updateDeckCount();
        toast('Deck reshuffled', 'success');
      });
    }
  }

  initCheatPanel();
  
  // If P1 bot is enabled and it's P1's turn, start bot
  if (isHost && gameRules.botP1 && gameState.activePlayer === 1 && !gameState.gameOver) {
    setTimeout(() => runBotTurn(1), 1000);
  }

  // ══════════════════════════════════════════════════════════════
  // ── Online Multiplayer: WebSocket Integration ──
  // ══════════════════════════════════════════════════════════════

  // Wrapper functions used by online event handlers
  function showTurnTransition(activePlayer) {
    const name = gameState.players[activePlayer - 1]?.name || `Player ${activePlayer}`;
    const isYours = activePlayer === myPlayerId;
    showTurnBanner(isYours ? 'Your Turn!' : `${name}'s Turn`, isYours);
  }

  function showScoreFlash(playerId) {
    if (playfield) {
      playfield.classList.add('playfield-scored');
      setTimeout(() => playfield.classList.remove('playfield-scored'), 600);
    }
  }

  function showGameOverModal() {
    // In online mode, gameState.gameOver and gameState.winner are already set.
    // Call endGame to update local stats (XP, wins/losses) and show the modal.
    endGame(gameState.winner);
  }

  function initOnlineGame() {
    if (!onlineParam || onlineParam !== '1') return;
    if (!window.MMtpNet) {
      console.warn('[Online] MMtpNet not available');
      return;
    }

    MMtpNet.connect().then((ok) => {
      if (!ok) {
        console.warn('[Online] Could not connect to server — falling back to local');
        toast('Server unreachable — playing locally', 'warning');
        return;
      }

      onlineGame = true;
      console.log('[Online] Connected for gameplay — room:', roomCode);

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
        updateTimer();
      });

      // ── turnChanged: server says new turn ──
      MMtpNet.on('turnChanged', (data) => {
        gameState.activePlayer = data.activePlayer;
        if (data.turnNumber) turnNumber = data.turnNumber;
        updateRoundCounter();
        showTurnTransition(data.activePlayer);
        updateTurn();
        if (window.SFX) SFX.play('turnChange');
      });

      // ── scored: someone scored ──
      MMtpNet.on('scored', (data) => {
        const name = gameState.players[data.playerId - 1]?.name || `Player ${data.playerId}`;
        toast(`${name} scored! ${data.expression} = ${data.oldTarget}`, 'success');
        showScoreFlash(data.playerId);
        if (window.SFX) SFX.play('score');
        // Add to expression history from server (expression is a string here)
        addOnlineExpressionToHistory(data.playerId, data.expression, data.oldTarget);
      });

      // ── scoreMiss: missed expression ──
      MMtpNet.on('scoreMiss', (data) => {
        toast(`Miss: ${data.expression} = ${data.result} (target: ${data.target})`, 'warning');
      });

      // ── gameOver: game ended ──
      MMtpNet.on('gameOver', (data) => {
        gameState.gameOver = true;
        gameState.winner = data.winner;
        gameState.matchStats.endTime = Date.now();
        // Update scores
        for (let pid = 1; pid <= 2; pid++) {
          gameState.players[pid - 1].score = data.scores[pid] || 0;
        }
        // Populate local matchStats from server data
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
        toast(`Deck reshuffled (${data.deckCount} cards)`, 'info');
      });

      // ── targetRerolled: someone rerolled the target ──
      MMtpNet.on('targetRerolled', (data) => {
        const name = gameState.players[data.playerId - 1]?.name || `Player ${data.playerId}`;
        toast(`🎯 ${name} rerolled target! ${data.oldTarget} → ${data.newTarget}`, 'success');
        if (window.SFX) SFX.play('score');
      });

      // ── doubleActivated: someone activated ×2 ──
      MMtpNet.on('doubleActivated', (data) => {
        const name = gameState.players[data.playerId - 1]?.name || `Player ${data.playerId}`;
        toast(`×2 ${name} activated Double Score!`, 'success');
        if (window.SFX) SFX.play('turnChange');
      });

      // ── doubleDeactivated: ×2 was consumed ──
      MMtpNet.on('doubleDeactivated', (data) => {
        // Already handled by state update
      });

      // ── peekRevealed: we peeked at opponent's hand ──
      MMtpNet.on('peekRevealed', (data) => {
        showPeekOverlay(data.opponentHand, data.duration || 5000);
        toast('👁 Peeking at opponent\'s hand!', 'success');
        if (window.SFX) SFX.play('turnChange');
      });

      // ── peekUsed: someone used a Peek card ──
      MMtpNet.on('peekUsed', (data) => {
        if (data.playerId !== myPlayerId) {
          toast('👁 Opponent peeked at your hand!', 'warning');
        }
      });

      // ── cardSwapped: someone swapped cards ──
      MMtpNet.on('cardSwapped', (data) => {
        const name = gameState.players[data.playerId - 1]?.name || `Player ${data.playerId}`;
        toast(`🔄 ${name} swapped a card!`, 'info');
        if (window.SFX) SFX.play('cardDraw');
      });

      // ── rematch: server reset the game ──
      MMtpNet.on('rematch', () => {
        toast('Rematch starting!', 'info');
        // Server will send new gameState
      });

      // ── playerDisconnected ──
      MMtpNet.on('playerDisconnected', (data) => {
        toast('Opponent disconnected — waiting…', 'warning');
        appendSystemChatMessage('Opponent disconnected');
      });

      // ── playerLeft: opponent gone for good ──
      MMtpNet.on('playerLeft', (data) => {
        toast(`${data.name || 'Player'} left the game`, 'error');
        appendSystemChatMessage(`${data.name || 'Player'} left the game`);
      });

      // Note: net-client.js auto-reconnects using saved session token on connect,
      // so we don't need to manually rejoin here. Just log the room we expect.
      if (roomCode) {
        console.log('[Online] Expecting auto-reconnect to room:', roomCode);
      }
    });
  }

  /**
   * Apply authoritative server state to local gameState + re-render.
   */
  function applyServerState(serverState) {
    if (!serverState) return;
    dbg('[Online] Applying server state', serverState);

    // Update my player ID from server
    myPlayerId = serverState.myPlayerId;
    isHost = myPlayerId === 1;

    // My hand
    const me = gameState.players[myPlayerId - 1];
    me.hand = serverState.myHand || [];

    // Opponent hand (we only know count, create face-down cards)
    const oppId = myPlayerId === 1 ? 2 : 1;
    const opp = gameState.players[oppId - 1];
    const oppCount = serverState.opponentHandCount || 0;
    // Create placeholder cards for opponent
    opp.hand = [];
    for (let i = 0; i < oppCount; i++) {
      opp.hand.push({ type: CardType.Number, value: '?', faceDown: true });
    }

    // Playfield — show the active player's playfield
    if (serverState.activePlayer === myPlayerId) {
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
      // Adjust local deck array length for display purposes
      gameState.deck = new Array(deckCountDisplay).fill(null);
    }

    // Re-render everything
    renderHands();
    renderPlayfield();
    updateScores();
    updateTimer();
    updateTurn();
    updateDeckCount();
    updateExpressionHint();

    if (gameState.gameOver && gameState.winner) {
      showGameOverModal();
    }
  }

  // ── Back to Lobby (online aware) ──
  if (btnBackToLobby) {
    const origHandler = btnBackToLobby.onclick;
    btnBackToLobby.addEventListener('click', () => {
      if (onlineGame && window.MMtpNet) {
        MMtpNet.leaveRoom();
      }
    });
  }

  // ── Rematch (online aware) ──
  const btnRematchEl = document.getElementById('btn-rematch');
  if (btnRematchEl && onlineParam === '1') {
    btnRematchEl.addEventListener('click', (e) => {
      if (onlineGame && window.MMtpNet && MMtpNet.isOnline) {
        e.stopImmediatePropagation();
        MMtpNet.requestRematch().then(res => {
          if (!res.ok) toast(res.error || 'Cannot rematch', 'warning');
        });
      }
    }, true); // capture phase to run before existing handler
  }

  // Initialize online game if applicable
  initOnlineGame();

  // Initialize chat (only shows for multiplayer)
  initChat();

  // Initialize round counter
  updateRoundCounter();
})();
