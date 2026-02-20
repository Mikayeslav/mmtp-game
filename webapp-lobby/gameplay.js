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
        if (GP.runBotTurn) GP.runBotTurn(2);
      } else if (gameRules.botP1 && gameState.activePlayer === 1) {
        if (GP.runBotTurn) GP.runBotTurn(1);
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
    if (onlineParam === '1') {
      // Online mode: assign stored name to OUR player slot (myPlayerId), not always slot 0
      // Server will provide authoritative names via gameState updates
      if (storedName) {
        gameState.players[myPlayerId - 1].name = storedName;
      }
    } else {
      // Local / bot mode: P1 is always the local player
      if (storedName) {
        gameState.players[0].name = storedName;
      }
      if (gameRules.allowBots) {
        gameState.players[1].name = 'Bot';
      }
    }
    const handP1Label = document.querySelector('#hand-p1 .hand-label');
    if (handP1Label) handP1Label.textContent = gameState.players[0].name;
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
  // Bot state is managed by gameplay-bot.js via GP.bot namespace

  // valueMatchesTarget and runBotTurn are now in gameplay-bot.js


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
    if (GP.bot && GP.bot.watchdogTimer) { clearTimeout(GP.bot.watchdogTimer); GP.bot.watchdogTimer = null; }
    if (GP.bot) GP.bot.turnStartTime = 0;
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
    if (GP.bot && GP.bot.watchdogTimer) { clearTimeout(GP.bot.watchdogTimer); GP.bot.watchdogTimer = null; }
    if (GP.bot) GP.bot.turnStartTime = 0;
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
        if (GP.runBotTurn) GP.runBotTurn(2);
      } else if (gameRules.botP1 && gameState.activePlayer === 1) {
        if (GP.runBotTurn) GP.runBotTurn(1);
      }
    }
  }

  function endGame(winnerId) {
    if (GP.bot && GP.bot.watchdogTimer) { clearTimeout(GP.bot.watchdogTimer); GP.bot.watchdogTimer = null; }
    if (GP.bot) GP.bot.turnStartTime = 0;
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
    let displaySec, displayText;

    if (onlineGame) {
      // ── Online mode: use server-authoritative turnTimer directly ──
      displaySec = Math.max(0, Math.ceil(gameState.turnTimer || 0));
      const m = Math.floor(displaySec / 60);
      const s = displaySec % 60;
      displayText = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;

      if (timerValue) {
        timerValue.textContent = displayText;
        timerValue.title = `Time remaining: ${displayText}`;
      }
      if (timerFloating) {
        const valueEl = timerFloating.querySelector('.timer-floating-value');
        if (valueEl) valueEl.textContent = displayText;
      }
    } else {
      // ── Local mode: use local actualTimeElapsed calculation ──
      // Calculate actual time remaining (real-world time, not affected by speed)
      const actualTimeElapsed = gameState.actualTimeElapsed || 0;
      const actualTimeRemaining = Math.max(0, gameState.turnTimerStart - actualTimeElapsed);
      const actualSec = Math.ceil(actualTimeRemaining);
      const actualMinutes = Math.floor(actualSec / 60);
      const actualSeconds = actualSec % 60;
      const actualText = `${String(actualMinutes).padStart(2, '0')}:${String(actualSeconds).padStart(2, '0')}`;
      
      // Calculate estimated/game time remaining (affected by speed multiplier)
      const estimatedTimeRemaining = Math.max(0, gameState.turnTimer);
      const estimatedSec = Math.ceil(estimatedTimeRemaining);
      const estimatedMinutes = Math.floor(estimatedSec / 60);
      const estimatedSeconds = estimatedSec % 60;
      const estimatedText = `${String(estimatedMinutes).padStart(2, '0')}:${String(estimatedSeconds).padStart(2, '0')}`;
      
      // Display both times when speed is increased
      if (timerValue) {
        if (gameSpeedMultiplier > 1.0) {
          timerValue.textContent = `${actualText} (game: ${estimatedText})`;
          timerValue.title = `Actual (real time): ${actualText} | Game time: ${estimatedText} | Speed: ${gameSpeedMultiplier.toFixed(1)}x`;
        } else {
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
      displaySec = actualSec;
    }

    // Timer tick sounds (only once per second, only for human player's turn)
    if (window.SFX && !timerInfinite && gameState.activePlayer === myPlayerId) {
      if (displaySec <= 5) {
        SFX.play('timerUrgent');
      } else if (displaySec <= 10) {
        SFX.play('timerTick');
      }
    }

    // Colour warnings based on time remaining
    const root = document.body;
    root.classList.remove('timer-warning', 'timer-danger');
    if (displaySec <= 5) {
      root.classList.add('timer-danger');
    } else if (displaySec <= 15) {
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
    if (GP.bot && GP.bot.watchdogTimer) { clearTimeout(GP.bot.watchdogTimer); GP.bot.watchdogTimer = null; }
    if (GP.bot) GP.bot.turnStartTime = 0;
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
      setTimeout(() => { if (GP.runBotTurn) GP.runBotTurn(2); }, 600);
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
  // Only start local timer for non-online games (online timer is server-managed)
  if (onlineParam !== '1') {
    startTimer();
  }

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
  // Skip for online games — server handles sync via WebSocket
  if (roomCode && onlineParam !== '1') {
    syncInterval = setInterval(() => {
      if (!isHost) {
        syncFromStorage();
      }
    }, 200); // Poll every 200ms
  }

  // ══════════════════════════════════════════════════════════════
  // ── window.GP — GamePlay API namespace for extracted modules ──
  // Modules: gameplay-bot.js, gameplay-cheat.js, gameplay-online.js
  // ══════════════════════════════════════════════════════════════

  const GP = window.GP = {};

  // Objects (by-reference — mutations visible everywhere)
  GP.state = gameState;
  GP.rules = gameRules;

  // Mutable primitives via getter/setter for live binding
  Object.defineProperties(GP, {
    isHost:              { get() { return isHost; },              set(v) { isHost = v; } },
    myPlayerId:          { get() { return myPlayerId; },          set(v) { myPlayerId = v; } },
    onlineGame:          { get() { return onlineGame; },          set(v) { onlineGame = v; } },
    roomCode:            { get() { return roomCode; },            set(v) { roomCode = v; } },
    onlineParam:         { get() { return onlineParam; } },
    gameSpeedMultiplier: { get() { return gameSpeedMultiplier; }, set(v) { gameSpeedMultiplier = v; } },
    timerPaused:         { get() { return timerPaused; },         set(v) { timerPaused = v; } },
    timerInfinite:       { get() { return timerInfinite; },       set(v) { timerInfinite = v; } },
    autoSkipBotTurns:    { get() { return autoSkipBotTurns; },    set(v) { autoSkipBotTurns = v; } },
    botMinExpressionLength: { get() { return botMinExpressionLength; }, set(v) { botMinExpressionLength = v; } },
    showAllDiscards:     { get() { return showAllDiscards; },     set(v) { showAllDiscards = v; } },
    turnNumber:          { get() { return turnNumber; },          set(v) { turnNumber = v; } },
    chatUnreadCount:     { get() { return chatUnreadCount; },     set(v) { chatUnreadCount = v; } },
  });

  // Core functions (exposed for extracted modules)
  GP.dbg = dbg;
  GP.toast = toast;
  GP.showTurnBanner = showTurnBanner;
  GP.showXPNotification = showXPNotification;
  GP.netAction = netAction;

  // Deck & cards
  GP.createDeck = createDeck;
  GP.shuffleDeck = shuffleDeck;
  GP.randomTarget = randomTarget;
  GP.drawCard = drawCard;
  GP.dealInitialHands = dealInitialHands;
  GP.discardCard = discardCard;
  GP.selectCard = selectCard;
  GP.placeCardOnPlayfield = placeCardOnPlayfield;
  GP.clearPlayfieldOnly = clearPlayfieldOnly;
  GP.undoLastPlayfieldCard = undoLastPlayfieldCard;
  GP.handleSpecialCardClick = handleSpecialCardClick;
  GP.useSpecialCard = useSpecialCard;
  GP.doRehand = doRehand;
  GP.sortHand = sortHand;
  GP.canMakeMove = canMakeMove;

  // Evaluation & scoring
  GP.evaluateExpression = evaluateExpression;
  GP.tryScore = tryScore;

  // Turn & game flow
  GP.endTurn = endTurn;
  GP.endGame = endGame;
  GP.startTimer = startTimer;
  GP.resetGameState = resetGameState;
  GP.writeGameState = writeGameState;

  // Rendering
  GP.renderHands = renderHands;
  GP.renderPlayfield = renderPlayfield;
  GP.renderDiscardPile = renderDiscardPile;
  GP.updateScores = updateScores;
  GP.updateTimer = updateTimer;
  GP.updateTurn = updateTurn;
  GP.updateTarget = updateTarget;
  GP.updateDeckCount = updateDeckCount;
  GP.updateRoundCounter = updateRoundCounter;

  // Expression history & chat
  GP.addExpressionToHistory = addExpressionToHistory;
  GP.addOnlineExpressionToHistory = addOnlineExpressionToHistory;
  GP.clearExpressionHistory = clearExpressionHistory;
  GP.initChat = initChat;
  GP.appendSystemChatMessage = appendSystemChatMessage;
  GP.showPeekOverlay = showPeekOverlay;

  // If P1 bot is enabled and it's P1's turn, start bot
  // (GP.runBotTurn is set by gameplay-bot.js which loads right after)
  if (isHost && gameRules.botP1 && gameState.activePlayer === 1 && !gameState.gameOver) {
    setTimeout(() => { if (GP.runBotTurn) GP.runBotTurn(1); }, 1000);
  }

})();
