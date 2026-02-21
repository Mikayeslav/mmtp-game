/**
 * MMtp — MainMenu (enhanced lobby)
 * Press Any Key → PlayerPanel (top) + LobbyPanel (bottom).
 * Host/join, room code (4-digit = port), rules, ready/start. localStorage cross-tab.
 * 
 * ENHANCEMENTS:
 * - Room expiration (30 min timeout)
 * - Host badge indicators
 * - Connection status
 * - Better error handling
 * - Loading states
 * - Keyboard shortcuts
 * - IP validation
 * - Better accessibility
 * - Visual polish
 */

(function () {
  'use strict';
  
  // Global error handler to prevent white screen
  window.addEventListener('error', function(e) {
    console.error('Global error caught:', e.error, e.message, e.filename, e.lineno);
    // Try to show the press any key screen even if there's an error
    try {
      const pressAnyKey = document.getElementById('press-any-key');
      if (pressAnyKey) {
        pressAnyKey.classList.remove('hidden');
      }
    } catch (err) {
      console.error('Failed to show fallback screen:', err);
    }
  });
  
  // Catch unhandled promise rejections
  window.addEventListener('unhandledrejection', function(e) {
    console.error('Unhandled promise rejection:', e.reason);
  });

  const STORAGE_NAME = 'mmtp-player-name';
  const STORAGE_STATS = 'mmtp-player-stats';
  const STORAGE_BOT_STATS = 'mmtp-bot-stats'; // Persistent bot/P2 stats
  const STORAGE_LAST_IP = 'mmtp-last-ip';
  const STORAGE_LAST_RULES = 'mmtp-last-rules'; // Save host rules
  const STORAGE_LOBBY_STATE = 'mmtp-lobby-state'; // Save full lobby state (player ready, etc.)
  const STORAGE_PROFILE_CODE = 'mmtp-profile-code'; // Server-synced profile code
  const STORAGE_PRESETS = 'mmtp-rule-presets'; // Custom rule presets
  const STORAGE_ACHIEVEMENTS = 'mmtp-achievements'; // Achievement unlock data
  const ROOM_PREFIX = 'mmtp-lobby-';
  const TAB_ID_KEY = 'mmtp-tab-id';
  const ROOM_EXPIRY_MS = 30 * 60 * 1000; // 30 minutes
  const DEFAULTS = {
    handSize: 7, timer: 20, targetMin: 1, targetMax: 10, winPoints: 5,
    botDifficulty: 'medium', nearestScore: false,
    allowedOperators: ['add', 'sub', 'mul', 'div'],        // default: basic 4
    allowedSpecials: ['wild', 'reroll', 'double', 'peek', 'swap'],  // default: all
  };

  // ── Online multiplayer flag ──
  // When connected to WebSocket server: online mode for real multiplayer.
  // Falls back to localStorage sync for bot/offline play.
  let onlineMode = false;
  let serverLanUrl = ''; // Filled from /api/server-info
  const RULES_CLAMP = { 
    handSize: [1, 20], // Reduced from 30 to prevent UI breaking
    timer: [5, 60], // Reduced from 300 to keep turns snappy
    targetMin: [-50, 50], // Reduced from 99 for more feasible targets
    targetMax: [-50, 50], // Reduced from 99 for more feasible targets
    winPoints: [1, 15], // Reduced from 20 to prevent extremely long matches
    rehandDrawCount: [0, 20], // Reduced from 30
    minDrawPerClick: [1, 5], // Reduced from 10
    maxDrawPerTurn: [0, 20], // Reduced from 50
  };

  let tabId = sessionStorage.getItem(TAB_ID_KEY);
  if (!tabId) {
    tabId = 'tab-' + Math.random().toString(36).slice(2, 10);
    sessionStorage.setItem(TAB_ID_KEY, tabId);
  }

  let state = {
    started: false,
    mode: 'lobby',
    isHost: false,
    roomCode: null,
    players: [],
    rules: { ...DEFAULTS },
    simulateP2: false,
    simulatedP2Ready: false,
    startRequested: false,
    joinPending: false,
    copyFeedbackUntil: 0,
    roomCreatedAt: null,
    stats: { level: 1, xp: 0, xpToNext: 100, wins: 0, losses: 0, draws: 0, rating: 1000, lastPlayed: null, winStreak: 0, bestWinStreak: 0 },
    statusType: 'info', // 'info', 'success', 'error', 'warning'
    isOnlineRoom: false, // true when current room was created on the WebSocket server
  };

  const $ = (id) => document.getElementById(id);

  // ── Early App namespace init (needed before renderLobby can be called) ──
  // Full property assignments happen at the bottom of this IIFE.
  const App = {};
  window.App = App;
  // Stubs for functions provided by external modules (app-online.js, app-cheat.js)
  App.getInviteUrl = null;
  App.updateInviteLinkPreview = null;
  App.fetchServerInfo = null;
  App.handleAutoJoin = null;
  App.initOnline = null;

  function timeAgo(ts) {
    const sec = Math.floor((Date.now() - ts) / 1000);
    if (sec < 60) return 'just now';
    if (sec < 3600) return Math.floor(sec / 60) + 'm ago';
    if (sec < 86400) return Math.floor(sec / 3600) + 'h ago';
    return Math.floor(sec / 86400) + 'd ago';
  }
  const VERSION = '1.0.0'; // Game version
  const pressAnyKey = $('press-any-key');
  const menuRoot = $('menu-root');
  const playerNameDisplay = $('player-name-display');
  const connectionStatus = $('connection-status');
  const statXp = $('stat-xp');
  const statWins = $('stat-wins');
  const statLosses = $('stat-losses');
  const statDraws = $('stat-draws');
  const statGames = $('stat-games');
  const statWinrate = $('stat-winrate');
  const statStreak = $('stat-streak');
  const statBestStreak = $('stat-best-streak');
  const statRating = $('stat-rating');
  const statStatus = $('stat-status');
  const statLast = $('stat-last');
  const playerNameInput = $('player-name-input');

  // Profile card DOM elements
  const profileAvatar = $('btn-avatar-pick');
  const profileTitle = $('btn-title-pick');
  const profileRankBadge = $('profile-rank-badge');
  const profileBioInput = $('profile-bio-input');
  const barLabelLevel = $('bar-label-level');
  const barLabelRank = $('bar-label-rank');
  const rankFill = $('rank-fill');
  const avatarPicker = $('avatar-picker');
  const avatarGrid = $('avatar-grid');
  const titlePicker = $('title-picker');
  const titleList = $('title-list');

  // Profile state (avatar, title, bio persisted in localStorage)
  const STORAGE_AVATAR = 'mmtp-player-avatar';
  const STORAGE_TITLE = 'mmtp-player-title';
  const STORAGE_BIO = 'mmtp-player-bio';

  const joinRoomCode = $('join-room-code');
  const hostRoomBlock = $('host-room-block');
  const hostRoomCode = $('host-room-code');
  const roomAge = $('room-age');
  const btnCopyRoom = $('btn-copy-room');
  const btnCopyInvite = $('btn-copy-invite');
  const inviteLinkPreview = $('invite-link-preview');
  const shareSection = $('share-section');
  const qrCodeEl = $('qr-code');
  const tunnelPasswordHint = $('tunnel-password-hint');
  const xpFill = $('xp-fill');
  const readySummary = $('ready-summary');
  const player1Line = $('player-1-line');
  const player2Line = $('player-2-line');
  const player1Badges = $('player-1-badges');
  const player2Badges = $('player-2-badges');
  const simP2Control = $('sim-p2-control');
  const botDifficultySelect = $('bot-difficulty');
  const botDifficultyRow = $('bot-difficulty-row');
  const simulateP2Checkbox = $('simulate-p2');
  const ruleHand = $('rule-hand');
  const ruleTimer = $('rule-timer');
  const ruleMin = $('rule-min');
  const ruleMax = $('rule-max');
  const ruleWin = $('rule-win');
  const ruleRehandDraw = $('rule-rehand-draw');
  const ruleMinDraw = $('rule-min-draw');
  const ruleMaxDrawTurn = $('rule-max-draw-turn');
  const ruleNearestScore = $('rule-nearest-score');
  const operatorCheckboxes = document.getElementById('operator-checkboxes');
  const specialCheckboxes = document.getElementById('special-checkboxes');
  const rulesError = $('rules-error');
  const btnResetRules = $('btn-reset-rules');
  const presetSelect = $('rule-preset-select');
  const btnSavePreset = $('btn-save-preset');
  const btnDeletePreset = $('btn-delete-preset');
  const btnExportPresets = $('btn-export-presets');
  const btnImportPresets = $('btn-import-presets');
  const btnAchievements = $('btn-achievements');
  const achievementsPanel = $('achievements-panel');
  const btnCloseAchievements = $('btn-close-achievements');
  const achievementsList = $('achievements-list');
  const achievementsCount = $('achievements-count');
  const achievementsProgressFill = $('achievements-progress-fill');
  const btnHost = $('btn-host');
  const btnJoin = $('btn-join');
  const btnReady = $('btn-ready');
  const btnStart = $('btn-start');
  const btnLeave = $('btn-leave');
  const btnHelp = $('btn-help');
  const btnCloseHelp = $('btn-close-help');
  const helpModal = $('help-modal');
  const loadingSpinner = $('loading-spinner');
  // btnBack removed — game navigates to /play
  const statusEl = $('status');
  const btnToggleHintsInline = $('btn-toggle-hints-inline');
  const hintsInlineContent = $('hints-inline-content');

  // Room cleanup interval
  let roomCleanupInterval = null;
  let roomAgeInterval = null;

  function roomKey(code) {
    return ROOM_PREFIX + (code || state.roomCode || '');
  }

  function isValidIP(ip) {
    if (!ip || ip.trim() === '') return true; // Empty is valid (uses default)
    const parts = ip.trim().split('.');
    if (parts.length !== 4) return false;
    return parts.every(part => {
      const num = parseInt(part, 10);
      return !isNaN(num) && num >= 0 && num <= 255;
    });
  }

  function generateUniqueRoomCode() {
    let attempts = 0;
    let code;
    do {
      code = String(1000 + Math.floor(Math.random() * 9000));
      attempts++;
      if (attempts > 100) {
        console.warn('Failed to generate unique room code after 100 attempts');
        break;
      }
    } while (readRoom(code) !== null && isRoomActive(code));
    return code;
  }

  function isRoomActive(code) {
    const room = readRoom(code);
    if (!room) return false;
    const age = Date.now() - (room.createdAt || room.updatedAt || 0);
    return age < ROOM_EXPIRY_MS;
  }

  function cleanupExpiredRooms() {
    try {
      const keys = Object.keys(localStorage);
      let cleaned = 0;
      keys.forEach(key => {
        if (key.startsWith(ROOM_PREFIX)) {
          try {
            const room = JSON.parse(localStorage.getItem(key));
            const age = Date.now() - (room.createdAt || room.updatedAt || 0);
            if (age >= ROOM_EXPIRY_MS) {
              localStorage.removeItem(key);
              cleaned++;
            }
          } catch (_) {
            // Invalid room data, remove it
            localStorage.removeItem(key);
            cleaned++;
          }
        }
      });
      if (cleaned > 0) {
        console.log(`Cleaned up ${cleaned} expired room(s)`);
      }
    } catch (e) {
      console.error('Error cleaning up rooms:', e);
    }
  }

  function updateRoomAge() {
    if (!state.roomCode || !state.isHost || !roomAge) return;
    const room = readRoom();
    if (!room) return;
    const createdAt = room.createdAt || state.roomCreatedAt;
    if (!createdAt) return;
    const age = Date.now() - createdAt;
    const minutes = Math.floor(age / 60000);
    const seconds = Math.floor((age % 60000) / 1000);
    if (minutes > 0) {
      roomAge.textContent = `${minutes}m ${seconds}s`;
      roomAge.title = `Room created ${minutes} minute${minutes !== 1 ? 's' : ''} ago`;
    } else {
      roomAge.textContent = `${seconds}s`;
      roomAge.title = `Room created ${seconds} second${seconds !== 1 ? 's' : ''} ago`;
    }
    roomAge.classList.remove('hidden');
  }

  function loadName() {
    try {
      let n = localStorage.getItem(STORAGE_NAME) || '';
      if (!n.trim()) {
        n = 'Player' + String(Math.floor(Math.random() * 10000)).padStart(4, '0');
        localStorage.setItem(STORAGE_NAME, n);
      }
      return n;
    } catch (e) {
      console.error('Error loading name:', e);
      return 'Player' + String(Math.floor(Math.random() * 10000)).padStart(4, '0');
    }
  }

  function saveName(s) {
    try {
      const t = (s || '').trim();
      if (t.length) localStorage.setItem(STORAGE_NAME, t.slice(0, 24));
    } catch (e) {
      console.error('Error saving name:', e);
      setStatus('Warning: Could not save name to storage', 'warning');
    }
  }

  function loadLastIp() {
    try {
      return localStorage.getItem(STORAGE_LAST_IP) || '';
    } catch (e) {
      return '';
    }
  }

  function saveLastIp(ip) {
    try {
      const t = (ip || '').trim();
      if (t.length) localStorage.setItem(STORAGE_LAST_IP, t);
    } catch (e) {
      // Ignore storage errors for IP
    }
  }

  function loadStats() {
    try {
      const raw = localStorage.getItem(STORAGE_STATS);
      if (raw) {
        const o = JSON.parse(raw);
        state.stats = {
          level: o.level ?? 1,
          xp: o.xp ?? 0,
          xpToNext: o.xpToNext ?? 100,
          wins: o.wins ?? 0,
          losses: o.losses ?? 0,
          draws: o.draws ?? 0,
          rating: o.rating ?? 1000,
          lastPlayed: o.lastPlayed ?? null,
          winStreak: o.winStreak ?? 0,
          bestWinStreak: o.bestWinStreak ?? 0,
        };
      }
    } catch (e) {
      console.error('Error loading stats:', e);
    }
  }

  function saveStats() {
    try {
      localStorage.setItem(STORAGE_STATS, JSON.stringify(state.stats));
    } catch (e) {
      console.error('Error saving stats:', e);
      setStatus('Warning: Could not save stats', 'warning');
    }
  }

  function loadBotStats() {
    try {
      const raw = localStorage.getItem(STORAGE_BOT_STATS);
      if (raw) {
        return JSON.parse(raw);
      }
    } catch (e) {
      console.error('Error loading bot stats:', e);
    }
    // Default bot stats
    return {
      wins: 0,
      losses: 0,
      rating: 1000,
      level: 1,
      lastPlayed: null,
    };
  }

  function saveBotStats(botStats) {
    try {
      localStorage.setItem(STORAGE_BOT_STATS, JSON.stringify(botStats));
    } catch (e) {
      console.error('Error saving bot stats:', e);
    }
  }

  function updateBotStatsFromMatchHistory() {
    try {
      const matchHistory = JSON.parse(localStorage.getItem('mmtp-match-history') || '[]');
      const botStats = loadBotStats();
      
      // Count wins/losses from match history
      botStats.wins = matchHistory.filter(m => m.winner === 2).length;
      botStats.losses = matchHistory.filter(m => m.winner === 1).length;
      
      // Update last played from most recent match
      if (matchHistory.length > 0) {
        const lastMatch = matchHistory[matchHistory.length - 1];
        botStats.lastPlayed = lastMatch.endTime || lastMatch.startTime || Date.now();
      }
      
      saveBotStats(botStats);
      return botStats;
    } catch (e) {
      console.error('Error updating bot stats from match history:', e);
      return loadBotStats();
    }
  }

  function clampRules(r) {
    const o = { ...r };
    o.handSize = Math.max(RULES_CLAMP.handSize[0], Math.min(RULES_CLAMP.handSize[1], +o.handSize || DEFAULTS.handSize));
    o.timer = Math.max(RULES_CLAMP.timer[0], Math.min(RULES_CLAMP.timer[1], +o.timer || DEFAULTS.timer));
    o.targetMin = Math.max(RULES_CLAMP.targetMin[0], Math.min(RULES_CLAMP.targetMin[1], +o.targetMin ?? DEFAULTS.targetMin));
    o.targetMax = Math.max(o.targetMin, Math.min(RULES_CLAMP.targetMax[1], +o.targetMax ?? DEFAULTS.targetMax));
    o.winPoints = Math.max(RULES_CLAMP.winPoints[0], Math.min(RULES_CLAMP.winPoints[1], +o.winPoints || DEFAULTS.winPoints));
    o.rehandDrawCount = Math.max(RULES_CLAMP.rehandDrawCount[0], Math.min(RULES_CLAMP.rehandDrawCount[1], +o.rehandDrawCount ?? 5));
    o.minDrawPerClick = Math.max(RULES_CLAMP.minDrawPerClick[0], Math.min(RULES_CLAMP.minDrawPerClick[1], +o.minDrawPerClick || 1));
    o.maxDrawPerTurn = Math.max(RULES_CLAMP.maxDrawPerTurn[0], Math.min(RULES_CLAMP.maxDrawPerTurn[1], +o.maxDrawPerTurn || 0));
    // Pass through array fields (validated, not clamped)
    const validOps = ['add', 'sub', 'mul', 'div', 'mod', 'pow'];
    const validSpecials = ['wild', 'reroll', 'double', 'peek', 'swap'];
    o.allowedOperators = Array.isArray(o.allowedOperators)
      ? o.allowedOperators.filter(op => validOps.includes(op))
      : DEFAULTS.allowedOperators;
    if (o.allowedOperators.length === 0) o.allowedOperators = ['add']; // at least one
    o.allowedSpecials = Array.isArray(o.allowedSpecials)
      ? o.allowedSpecials.filter(s => validSpecials.includes(s))
      : DEFAULTS.allowedSpecials;
    // Sync legacy specialCards boolean
    o.specialCards = o.allowedSpecials.length > 0;
    return o;
  }

  function validateRules() {
    const r = state.rules;
    if (r.targetMin > r.targetMax) {
      if (rulesError) {
        rulesError.textContent = 'Target min must be ≤ target max';
        rulesError.classList.remove('hidden');
      }
      return false;
    }
    if (rulesError) {
      rulesError.classList.add('hidden');
    }
    return true;
  }

  function readRoom(code) {
    try {
      const raw = localStorage.getItem(roomKey(code || state.roomCode));
      if (!raw) return null;
      const room = JSON.parse(raw);
      // Check if expired
      const age = Date.now() - (room.createdAt || room.updatedAt || 0);
      if (age >= ROOM_EXPIRY_MS) {
        removeRoom(code || state.roomCode);
        return null;
      }
      return room;
    } catch (e) {
      console.error('Error reading room:', e);
      return null;
    }
  }

  function writeRoom(data) {
    try {
      const key = roomKey(data.roomCode);
      const roomData = {
        ...data,
        updatedAt: Date.now(),
        createdAt: data.createdAt || data.updatedAt || Date.now(),
      };
      localStorage.setItem(key, JSON.stringify(roomData));
    } catch (e) {
      console.error('Error writing room:', e);
      if (e.name === 'QuotaExceededError') {
        setStatus('Error: Storage full. Please clear some data.', 'error');
      } else {
        setStatus('Error: Could not save room data', 'error');
      }
    }
  }

  function removeRoom(code) {
    try {
      localStorage.removeItem(roomKey(code));
    } catch (e) {
      console.error('Error removing room:', e);
    }
  }

  function setStatus(msg, type = 'info') {
    if (!statusEl) return;
    state.statusType = type;
    statusEl.textContent = msg || '';
    statusEl.className = 'status status-' + type;
    if (msg) {
      statusEl.setAttribute('aria-live', 'polite');
    }
  }

  function showLoading(show = true) {
    if (loadingSpinner) {
      loadingSpinner.classList.toggle('hidden', !show);
    }
  }

  /**
   * Consolidated connection status indicator.
   * Shows Online (green), Local Only (orange), or Disconnected (red).
   */
  function updateConnectionStatus(online) {
    if (!connectionStatus) return;
    connectionStatus.classList.remove('hidden', 'connected', 'disconnected', 'local-only');
    const dot = connectionStatus.querySelector('.status-dot');
    const text = connectionStatus.querySelector('.status-text');
    if (online) {
      connectionStatus.classList.add('connected');
      if (dot) dot.removeAttribute('style');
      if (text) text.textContent = 'Online';
    } else {
      connectionStatus.classList.add('local-only');
      if (dot) dot.removeAttribute('style');
      if (text) text.textContent = 'Local Only';
    }
  }

  function getEffectivePlayers() {
    let list = [...state.players];
    if (state.simulateP2 && state.mode === 'lobby') {
      const has = list.some((p) => p.tabId === 'simulated');
      if (!has) list.push({ tabId: 'simulated', name: 'Guest (Simulated)', ready: state.simulatedP2Ready, isHost: false });
      else list = list.map((p) => (p.tabId === 'simulated' ? { ...p, ready: state.simulatedP2Ready } : p));
    }
    return list;
  }

  function persistRoom() {
    if (!state.roomCode || state.mode !== 'lobby') return;
    const players = getEffectivePlayers()
      .filter((p) => p.tabId !== 'simulated')
      .map((p) => ({ tabId: p.tabId, name: p.name, ready: p.ready, isHost: p.isHost }));
    writeRoom({
      roomCode: state.roomCode,
      hostTabId: state.isHost ? tabId : undefined,
      players,
      rules: state.rules,
      startRequested: false,
      createdAt: state.roomCreatedAt || Date.now(),
    });
  }

  function updatePlayerPanel() {
    try {
      const name = (playerNameInput && playerNameInput.value.trim()) || loadName();
      if (playerNameDisplay) playerNameDisplay.textContent = name || '—';
      const s = state.stats;
      const games = (s.wins || 0) + (s.losses || 0) + (s.draws || 0);
      const wr = games ? Math.round((100 * (s.wins || 0)) / games) : null;

      // ── Profile card updates (uses MMProfile library) ──
      if (typeof MMProfile !== 'undefined') {
        const rating = s.rating ?? 1000;
        const rank = MMProfile.getRank(rating);
        const rankProg = MMProfile.getRankProgress(rating);
        const xp = s.xp ?? 0;
        const xpNext = s.xpToNext ?? 100;
        const xpPct = xpNext > 0 ? Math.min(100, Math.round(100 * xp / xpNext)) : 0;

        // Avatar
        const savedAvatar = localStorage.getItem(STORAGE_AVATAR) || '🃏';
        if (profileAvatar) profileAvatar.textContent = savedAvatar;

        // Title
        const savedTitle = localStorage.getItem(STORAGE_TITLE);
        if (profileTitle) {
          if (savedTitle) {
            profileTitle.textContent = savedTitle;
          } else {
            const titles = MMProfile.getUnlockedTitles(s);
            profileTitle.textContent = titles.length > 0 ? titles[titles.length - 1].label : 'Newcomer';
          }
        }

        // Rank badge
        if (profileRankBadge) {
          const ri = profileRankBadge.querySelector('.rank-icon');
          const rn = profileRankBadge.querySelector('.rank-name');
          if (ri) ri.textContent = rank.icon;
          if (rn) rn.textContent = rank.name;
          profileRankBadge.style.color = rank.color;
          profileRankBadge.title = rank.name;
        }

        // XP bar
        if (barLabelLevel) barLabelLevel.textContent = 'Lv.' + (s.level ?? 1);
        if (statXp) statXp.textContent = xp + '/' + xpNext + ' XP';
        if (xpFill) xpFill.style.width = xpPct + '%';

        // Rank bar
        if (barLabelRank) barLabelRank.textContent = rank.icon;
        if (statRating) statRating.textContent = rating + ' SR';
        if (rankFill) {
          rankFill.style.width = Math.round(rankProg * 100) + '%';
          rankFill.style.background = rank.color;
        }
      } else {
        // Fallback: no MMProfile lib
        const xp = s.xp ?? 0;
        const xpNext = s.xpToNext ?? 100;
        if (statXp) statXp.textContent = xp + '/' + xpNext + ' XP';
        if (xpFill) {
          const pct = xpNext > 0 ? Math.min(100, Math.round((100 * xp) / xpNext)) : 0;
          xpFill.style.width = pct + '%';
        }
        if (statRating) statRating.textContent = String(s.rating ?? 1000);
      }

      // ── Profile card stat cells ──
      if (statWins) statWins.textContent = String(s.wins ?? 0);
      if (statLosses) statLosses.textContent = String(s.losses ?? 0);
      if (statDraws) statDraws.textContent = String(s.draws ?? 0);
      if (statGames) statGames.textContent = String(games);
      if (statWinrate) statWinrate.textContent = wr != null ? wr + '%' : '—';
      if (statStreak) statStreak.textContent = String(s.winStreak ?? 0);
      if (statBestStreak) statBestStreak.textContent = String(s.bestWinStreak ?? 0);
      if (statStatus) statStatus.textContent = state.roomCode ? 'In Lobby' : 'Idle';
      
        // Show recent match result and detailed stats if available
      const matchStatsSection = $('match-stats-section');
      try {
          const matchHistory = JSON.parse(localStorage.getItem('mmtp-match-history') || '[]');
        if (matchHistory.length > 0) {
          const lastMatch = matchHistory[matchHistory.length - 1];
          
          const duration = Math.floor(lastMatch.duration / 60) + 'm ' + (lastMatch.duration % 60) + 's';
          const result = lastMatch.winner === 1 ? 'Won' : lastMatch.winner === 2 ? 'Lost' : 'Draw';
          const score = `${lastMatch.scores.p1}-${lastMatch.scores.p2}`;
          if (statLast) {
            statLast.textContent = `${result} ${score} (${duration})`;
          }
          
          // Show match summary section
          const matchSummarySection = $('match-summary-section');
          if (matchSummarySection) {
            matchSummarySection.classList.remove('hidden');
            const summaryResult = $('match-summary-result');
            const summaryDetails = $('match-summary-details');
            if (summaryResult) {
              summaryResult.textContent = `${result} ${score}`;
              summaryResult.className = `match-summary-result ${result.toLowerCase()}`;
            }
            if (summaryDetails) {
              const p1Stats = lastMatch.stats?.p1 || {};
              const p2Stats = lastMatch.stats?.p2 || {};
              summaryDetails.innerHTML = `
                <div>Duration: ${duration}</div>
                <div>Expressions: ${p1Stats.expressionsScored?.length || 0} scored</div>
                <div>Cards: ${p1Stats.cardsPlayed || 0} played, ${p1Stats.cardsDrawn || 0} drawn</div>
              `;
            }
          }
          
          // Show detailed match stats for P1
          if (matchStatsSection) {
            const p1Stats = lastMatch.stats?.p1 || {};
            // Remove hidden class to show the section
            matchStatsSection.classList.remove('hidden');
            
            // Populate all stat fields
            const statPlayed = $('stat-match-played');
            const statDrawn = $('stat-match-drawn');
            const statDiscarded = $('stat-match-discarded');
            const statExpressions = $('stat-match-expressions');
            const statTimeSaved = $('stat-match-time-saved');
            const statRehands = $('stat-match-rehands');
            
            if (statPlayed) statPlayed.textContent = p1Stats.cardsPlayed || 0;
            if (statDrawn) statDrawn.textContent = p1Stats.cardsDrawn || 0;
            if (statDiscarded) statDiscarded.textContent = p1Stats.cardsDiscarded || 0;
            if (statExpressions) {
              const exprCount = Array.isArray(p1Stats.expressionsScored) ? p1Stats.expressionsScored.length : (p1Stats.expressionsScored || 0);
              statExpressions.textContent = exprCount;
            }
            if (statTimeSaved) statTimeSaved.textContent = `${p1Stats.timeSaved || 0}s`;
            if (statRehands) statRehands.textContent = p1Stats.rehandsUsed || 0;
          }
        } else {
          if (statLast) statLast.textContent = s.lastPlayed ? new Date(s.lastPlayed).toLocaleString() : '—';
          if (matchStatsSection) {
            matchStatsSection.classList.add('hidden');
          }
          // Hide match summary too
          const matchSummarySection = $('match-summary-section');
          if (matchSummarySection) {
            matchSummarySection.classList.add('hidden');
          }
        }
      } catch (e) {
        console.error('[updatePlayerPanel] Error loading match history:', e);
        if (statLast) statLast.textContent = s.lastPlayed ? new Date(s.lastPlayed).toLocaleString() : '—';
        if (matchStatsSection) matchStatsSection.classList.add('hidden');
      }
      
      updateConnectionStatus(onlineMode);

      // Match history list
      try {
        const historySection = $('match-history-section');
        const historyList = $('match-history-list');
        if (historySection && historyList) {
          const history = JSON.parse(localStorage.getItem('mmtp-match-history') || '[]');
          if (history.length > 0) {
            historySection.classList.remove('hidden');
            historyList.innerHTML = '';
            const recent = history.slice(-10).reverse();
            recent.forEach(m => {
              const el = document.createElement('div');
              el.className = 'match-history-item';
              const resultText = m.winner === 1 ? 'W' : m.winner === 2 ? 'L' : 'D';
              const resultClass = m.winner === 1 ? 'result-win' : m.winner === 2 ? 'result-loss' : 'result-draw';
              const dur = m.duration ? `${Math.floor(m.duration / 60)}m ${m.duration % 60}s` : '—';
              const ago = m.timestamp ? timeAgo(m.timestamp) : '';
              const opponent = m.opponent || 'Player 2';
              const modeIcon = m.mode === 'online' ? '🌐' : m.mode === 'bot' ? '🤖' : '🏠';
              const myStats = m.stats?.p1;
              const bestExpr = myStats?.bestExpression || '';
              const exprCount = myStats?.expressionsScored?.length || 0;
              const cardsPlayed = myStats?.cardsPlayed || 0;
              el.innerHTML = `<div class="history-row-main">`
                + `<span class="history-result ${resultClass}">${resultText}</span>`
                + `<span class="history-info">`
                  + `<span class="history-vs">${modeIcon} vs ${opponent}</span>`
                  + `<span class="history-meta">${m.scores?.p1 ?? 0}–${m.scores?.p2 ?? 0} · ${dur} · ${ago}</span>`
                + `</span>`
                + `</div>`
                + (bestExpr || exprCount ? `<div class="history-row-detail">`
                  + (bestExpr ? `<span class="history-best" title="Best expression">★ ${bestExpr}</span>` : '')
                  + `<span class="history-extra">${exprCount} expr · ${cardsPlayed} cards</span>`
                  + `</div>` : '');
              historyList.appendChild(el);
            });
          } else {
            historySection.classList.add('hidden');
          }
        }
      } catch (_) {}

      // Update P2 stats panel if P2 exists (show in PlayerPanel)
      try {
        const p2Panel = $('player-p2-panel');
        if (!p2Panel) {
          // Element doesn't exist yet, skip P2 panel update
        } else {
          const players = getEffectivePlayers();
          const p2 = players[1] || null;
          const isBot = p2 && p2.tabId === 'simulated';
          
          // Show P2 panel when P2 exists (including simulated/bot players) OR when simulateP2 is enabled
          const shouldShowP2 = (p2 && state.roomCode) || (state.simulateP2 && state.isHost && state.roomCode);
          
          if (shouldShowP2) {
            p2Panel.classList.remove('hidden');
            
            // Update bot stats from match history (keeps them in sync)
            let botStats;
            try {
              botStats = updateBotStatsFromMatchHistory();
            } catch (e) {
              console.warn('Failed to update bot stats, using defaults:', e);
              botStats = loadBotStats();
            }
            
            // Try to get P2 stats from match history and persistent bot stats
            try {
              const matchHistory = JSON.parse(localStorage.getItem('mmtp-match-history') || '[]');
              const lastMatch = matchHistory.length > 0 ? matchHistory[matchHistory.length - 1] : null;
              const p2MatchStats = lastMatch?.stats?.p2;
              
              // Show persistent bot stats (wins/losses/rating)
              const statP2Level = $('stat-p2-level');
              const statP2Wins = $('stat-p2-wins');
              const statP2Losses = $('stat-p2-losses');
              const statP2Rating = $('stat-p2-rating');
              
              if (statP2Level) statP2Level.textContent = String(botStats.level || 1);
              if (statP2Wins) statP2Wins.textContent = String(botStats.wins || 0);
              if (statP2Losses) statP2Losses.textContent = String(botStats.losses || 0);
              if (statP2Rating) statP2Rating.textContent = String(botStats.rating || 1000);
              
              // Show P2 match stats from last match if available
              const p2MatchStatsSection = $('p2-match-stats-section');
              if (p2MatchStatsSection) {
                if (p2MatchStats) {
                  p2MatchStatsSection.classList.remove('hidden');
                  const statP2MatchPlayed = $('stat-p2-match-played');
                  const statP2MatchDrawn = $('stat-p2-match-drawn');
                  const statP2MatchDiscarded = $('stat-p2-match-discarded');
                  const statP2MatchExpressions = $('stat-p2-match-expressions');
                  const statP2MatchTimeSaved = $('stat-p2-match-time-saved');
                  const statP2MatchRehands = $('stat-p2-match-rehands');
                  
                  if (statP2MatchPlayed) statP2MatchPlayed.textContent = p2MatchStats.cardsPlayed || 0;
                  if (statP2MatchDrawn) statP2MatchDrawn.textContent = p2MatchStats.cardsDrawn || 0;
                  if (statP2MatchDiscarded) statP2MatchDiscarded.textContent = p2MatchStats.cardsDiscarded || 0;
                  if (statP2MatchExpressions) statP2MatchExpressions.textContent = p2MatchStats.expressionsScored?.length || 0;
                  if (statP2MatchTimeSaved) statP2MatchTimeSaved.textContent = `${p2MatchStats.timeSaved || 0}s`;
                  if (statP2MatchRehands) statP2MatchRehands.textContent = p2MatchStats.rehandsUsed || 0;
                } else {
                  p2MatchStatsSection.classList.add('hidden');
                }
              }
              
              // Show bot indicator if simulated
              const p2Title = p2Panel.querySelector('.player-p2-title');
              if (p2Title) {
                if (isBot || (state.simulateP2 && state.isHost)) {
                  p2Title.textContent = 'Player 2 Stats (Bot)';
                } else {
                  p2Title.textContent = 'Player 2 Stats';
                }
              }
            } catch (e) {
              console.warn('Failed to load P2 stats', e);
              const statP2Level = $('stat-p2-level');
              const statP2Wins = $('stat-p2-wins');
              const statP2Losses = $('stat-p2-losses');
              const statP2Rating = $('stat-p2-rating');
              if (statP2Level) statP2Level.textContent = '—';
              if (statP2Wins) statP2Wins.textContent = '—';
              if (statP2Losses) statP2Losses.textContent = '—';
              if (statP2Rating) statP2Rating.textContent = '—';
            }
          } else {
            p2Panel.classList.add('hidden');
          }
        }
      } catch (e) {
        console.warn('Error updating P2 panel:', e);
        // Don't break the whole function if P2 panel update fails
      }
    } catch (e) {
      console.error('Error in updatePlayerPanel:', e);
      // Don't throw - just log the error so the page doesn't break
    }
    // Check achievements after stats display update
    try { checkAchievements(true); } catch {}
  }

  function applyRulesToInputs() {
    const r = state.rules;
    if (ruleHand) ruleHand.value = r.handSize;
    if (ruleTimer) ruleTimer.value = r.timer;
    if (ruleMin) ruleMin.value = r.targetMin;
    if (ruleMax) ruleMax.value = r.targetMax;
    if (ruleWin) ruleWin.value = r.winPoints;
    if (ruleRehandDraw) ruleRehandDraw.value = r.rehandDrawCount ?? 5;
    if (ruleMinDraw) ruleMinDraw.value = r.minDrawPerClick ?? 1;
    if (ruleMaxDrawTurn) ruleMaxDrawTurn.value = r.maxDrawPerTurn ?? 0;
    if (ruleNearestScore) ruleNearestScore.checked = !!r.nearestScore;

    // Operator checkboxes
    const ops = r.allowedOperators || DEFAULTS.allowedOperators;
    if (operatorCheckboxes) {
      operatorCheckboxes.querySelectorAll('input[data-op]').forEach(cb => {
        cb.checked = ops.includes(cb.dataset.op);
      });
    }

    // Special card checkboxes
    const specs = r.allowedSpecials || DEFAULTS.allowedSpecials;
    if (specialCheckboxes) {
      specialCheckboxes.querySelectorAll('input[data-special]').forEach(cb => {
        cb.checked = specs.includes(cb.dataset.special);
      });
    }

    validateRules();
  }

  function readRulesFromInputs() {
    // Read operator checkboxes
    const allowedOperators = [];
    if (operatorCheckboxes) {
      operatorCheckboxes.querySelectorAll('input[data-op]:checked').forEach(cb => {
        allowedOperators.push(cb.dataset.op);
      });
    }
    // Require at least one operator
    if (allowedOperators.length === 0) allowedOperators.push('add');

    // Read special card checkboxes
    const allowedSpecials = [];
    if (specialCheckboxes) {
      specialCheckboxes.querySelectorAll('input[data-special]:checked').forEach(cb => {
        allowedSpecials.push(cb.dataset.special);
      });
    }

    state.rules = clampRules({
      handSize: ruleHand?.value,
      timer: ruleTimer?.value,
      targetMin: ruleMin?.value,
      targetMax: ruleMax?.value,
      winPoints: ruleWin?.value,
      rehandDrawCount: ruleRehandDraw?.value,
      minDrawPerClick: ruleMinDraw?.value,
      maxDrawPerTurn: ruleMaxDrawTurn?.value,
      specialCards: allowedSpecials.length > 0,
      nearestScore: !!ruleNearestScore?.checked,
      allowedOperators,
      allowedSpecials,
    });
    validateRules();
  }

  function renderPlayerBadges(badgeEl, player) {
    if (!badgeEl || !player) {
      if (badgeEl) badgeEl.innerHTML = '';
      return;
    }
    let html = '';
    if (player.isHost) {
      html += '<span class="badge badge-host" title="Room host">HOST</span>';
    }
    if (player.tabId === tabId) {
      html += '<span class="badge badge-you" title="You">YOU</span>';
    }
    if (player.tabId === 'simulated') {
      html += '<span class="badge badge-sim" title="Simulated player">SIM</span>';
    }
    badgeEl.innerHTML = html;
  }

  function renderLobby() {
    try {
      updatePlayerPanel();
    } catch (e) {
      console.error('Error in updatePlayerPanel during renderLobby:', e);
    }
    const players = getEffectivePlayers();
    const p1 = players[0] || null;
    const p2 = players[1] || null;
    const isHost = state.isHost;
    const me = players.find((p) => p.tabId === tabId) || (state.simulateP2 && players.length === 1 ? players[0] : null);

    const fmt = (p, i) => {
      if (!p) return { name: '(empty)', ready: false, isYou: false, isHost: false, avatar: '', title: '', rating: 0 };
      return {
        name: (p.name || '').trim() || 'Player ' + i,
        ready: p.ready,
        isYou: p.tabId === tabId,
        isHost: p.isHost || false,
        tabId: p.tabId,
        avatar: p.avatar || '🃏',
        title: p.title || '',
        rating: p.rating || 1000,
      };
    };
    const d1 = fmt(p1, 1);
    const d2 = fmt(p2, 2);

    const up = (el, d, badgeEl) => {
      if (!el) return;
      const v = el.querySelector('.value');
      if (!v) return;
      if (!d || d.name === '(empty)') {
        v.innerHTML = '<span class="player-name-text">(empty)</span>';
        v.className = 'value';
        el.classList.remove('you', 'host');
        renderPlayerBadges(badgeEl, null);
        return;
      }
      const avatarHtml = d.avatar ? '<span class="player-avatar">' + d.avatar + '</span>' : '';
      const readyTag = d.ready ? '<span class="ready-tag ready">READY</span>' : '<span class="ready-tag not-ready">NOT READY</span>';
      const subtitle = [];
      if (d.title) subtitle.push(d.title);
      if (d.rating) subtitle.push('⭐ ' + d.rating);
      const subtitleHtml = subtitle.length ? '<span class="player-subtitle">' + subtitle.join(' · ') + '</span>' : '';
      v.innerHTML = avatarHtml +
        '<span class="player-info-col">' +
          '<span class="player-name-text">' + d.name + '</span>' +
          subtitleHtml +
        '</span>' +
        readyTag;
      v.className = 'value ' + (d.ready ? 'ready' : 'not-ready');
      el.classList.toggle('you', d.isYou);
      el.classList.toggle('host', d.isHost);
      renderPlayerBadges(badgeEl, d);
    };
    up(player1Line, d1, player1Badges);
    up(player2Line, d2, player2Badges);

    const hostEdits = isHost;
    [ruleHand, ruleTimer, ruleMin, ruleMax, ruleWin].forEach((inp) => {
      if (inp) inp.disabled = !hostEdits;
    });
    if (btnResetRules) {
      btnResetRules.classList.toggle('hidden', !hostEdits);
    }
    applyRulesToInputs();

    if (btnReady) {
      btnReady.disabled = !state.roomCode || !me;
      btnReady.classList.toggle('ready', !!me && me.ready);
      btnReady.textContent = me && me.ready ? 'Not ready' : 'Ready';
    }
    
    // Calculate if can start (with simulate P2 support)
    let canStart = false;
    if (isHost) {
      if (state.simulateP2) {
        // With simulate: need at least 1 real player + simulated P2, both ready
        const realPlayers = players.filter(p => p.tabId !== 'simulated');
        const simulatedReady = state.simulatedP2Ready;
        const allRealReady = realPlayers.length >= 1 && realPlayers.every(p => p.ready);
        canStart = allRealReady && simulatedReady;
        console.log('[renderLobby] canStart calc: isHost=' + isHost + ' simulateP2=' + state.simulateP2 + ' realPlayers=' + realPlayers.length + ' allRealReady=' + allRealReady + ' simulatedReady=' + simulatedReady + ' canStart=' + canStart + ' players=' + JSON.stringify(players.map(p => ({tabId:p.tabId,ready:p.ready}))));
      } else {
        // Without simulate: need 2+ real players, all ready
        canStart = players.length >= 2 && players.every((p) => p.ready);
      }
    } else {
      console.log('[renderLobby] canStart: NOT host');
    }
    
    if (btnStart) {
      btnStart.disabled = !canStart;
      if (!canStart && isHost) {
        if (state.simulateP2) {
          btnStart.title = 'You and simulated P2 must be ready';
        } else if (players.length >= 2) {
          btnStart.title = 'All players must be ready';
        } else {
          btnStart.title = 'Need 2 players to start';
        }
      } else {
        btnStart.title = 'Start the game';
      }
    }

    const inLobby = state.mode === 'lobby' && (state.roomCode || state.players.length > 0);
    if (btnLeave) {
      btnLeave.classList.toggle('hidden', !inLobby);
    }

    if (simP2Control) simP2Control.classList.toggle('hidden', !(isHost && state.roomCode));
    if (botDifficultyRow) botDifficultyRow.classList.toggle('hidden', !state.simulateP2);

    if (readySummary) {
      if (!state.roomCode) {
        readySummary.textContent = '';
      } else {
        const n = players.length;
        const r = players.filter((p) => p.ready).length;
        readySummary.textContent = '(' + r + '/' + n + ' ready)';
      }
    }

    if (hostRoomBlock) {
      hostRoomBlock.classList.toggle('hidden', !state.isHost || !state.roomCode);
    }
    if (hostRoomCode && state.isHost && state.roomCode) {
      hostRoomCode.textContent = state.roomCode;
    }
    if (App.updateInviteLinkPreview) App.updateInviteLinkPreview();

    if (state.roomCode && statusEl && !state.joinPending && Date.now() >= state.copyFeedbackUntil) {
      const effectiveCount = state.simulateP2 ? players.length + 1 : players.length;
      let allReady = false;
      if (state.simulateP2) {
        const realReady = players.length >= 1 && players.every((p) => p.ready);
        allReady = realReady && state.simulatedP2Ready;
      } else {
        allReady = players.length >= 2 && players.every((p) => p.ready);
      }
      
      if (allReady) {
        setStatus(state.isHost ? 'All ready! Start when you are.' : 'All ready! Waiting for host to start.', 'success');
      } else if (effectiveCount < 2) {
        setStatus(state.isHost ? 'Waiting for player 2…' : 'Waiting for host…', 'info');
      } else {
        setStatus((state.isHost ? 'Room ' + state.roomCode + ' · Host' : 'Room ' + state.roomCode + ' · Joined'), 'info');
      }
    }
  }

  function syncFromStorage() {
    if (state.mode !== 'lobby' || !state.roomCode) return;
    const room = readRoom();
    if (!room) {
      // Room expired or removed
      if (state.roomCode) {
        setStatus('Room expired or no longer exists', 'error');
        onLeave();
      }
      return;
    }
    state.players = room.players || [];
    state.rules = clampRules(room.rules || DEFAULTS);
    state.startRequested = !!room.startRequested;
    
    // Restore rules to inputs if host
    if (state.isHost) {
      applyRulesToInputs();
    }
    
    // Restore ready status if we have a saved one
    try {
      const savedLobbyState = localStorage.getItem(STORAGE_LOBBY_STATE);
      if (savedLobbyState) {
        const parsed = JSON.parse(savedLobbyState);
        const me = state.players.find(p => p.tabId === tabId);
        if (me && parsed.readyStatus !== undefined && me.ready !== parsed.readyStatus) {
          // Update ready status in room
          me.ready = parsed.readyStatus;
          persistRoom();
        }
      }
    } catch (e) {
      console.warn('Failed to restore ready status in sync:', e);
    }
    if (state.startRequested) {
      state.startRequested = false;
      const rulesJson = JSON.stringify(room.rules || state.rules);
      const rulesEncoded = encodeURIComponent(rulesJson);
      const role = state.isHost ? 'host' : 'client';
      const roomCode = state.roomCode || '';
      window.location.href = `/play?rules=${rulesEncoded}&role=${role}&room=${roomCode}`;
      return;
    }
    renderLobby();
  }

  function onPressAnyKey() {
    if (state.started) return;
    state.started = true;
    if (pressAnyKey) pressAnyKey.classList.add('hidden');
    if (menuRoot) menuRoot.classList.remove('hidden');
    // Remember that we've passed the splash (skip next time)
    sessionStorage.setItem('mmtp-splash-seen', '1');
    
    // Restore saved lobby state (player name, ready status, rules)
    try {
      const savedLobbyState = localStorage.getItem(STORAGE_LOBBY_STATE);
      if (savedLobbyState) {
        const parsed = JSON.parse(savedLobbyState);
        // Restore player name
        if (parsed.playerName && playerNameInput) {
          playerNameInput.value = parsed.playerName;
          saveName(parsed.playerName);
        }
      }
      
      // Restore saved rules if returning from gameplay
      const savedRules = localStorage.getItem(STORAGE_LAST_RULES);
      if (savedRules && state.isHost) {
        const parsed = JSON.parse(savedRules);
        state.rules = { ...DEFAULTS, ...parsed };
        applyRulesToInputs();
      }
    } catch (e) {
      console.warn('Failed to restore lobby state:', e);
    }
    
    // Ensure bot checkbox matches state (prevent browser form autofill issues)
    if (simulateP2Checkbox) simulateP2Checkbox.checked = state.simulateP2;
    if (botDifficultyRow) botDifficultyRow.classList.toggle('hidden', !state.simulateP2);

    updatePlayerPanel();
    renderLobby();
    // Focus name input for accessibility
    if (playerNameInput) playerNameInput.focus();
  }

  // Auto-skip splash if returning from gameplay or already seen this session
  if (sessionStorage.getItem('mmtp-splash-seen') === '1') {
    onPressAnyKey();
  }

  async function onHost() {
    if (window.SFX) SFX.play('click');
    const name = (playerNameInput && playerNameInput.value.trim()) || loadName();
    if (!name || name.trim().length === 0) {
      setStatus('Name is required', 'error');
      if (playerNameInput) {
        playerNameInput.focus();
        playerNameInput.classList.add('error');
        setTimeout(() => playerNameInput.classList.remove('error'), 2000);
      }
      return;
    }
    saveName(name);
    
    // Restore saved rules if available
    try {
      const savedRules = localStorage.getItem(STORAGE_LAST_RULES);
      if (savedRules) {
        const parsed = JSON.parse(savedRules);
        state.rules = { ...DEFAULTS, ...parsed };
        applyRulesToInputs();
      }
    } catch (e) {
      console.warn('Failed to restore rules on host:', e);
    }
    
    // Read rules from inputs (may have been restored above)
    readRulesFromInputs();
    state.rules = clampRules(state.rules);

    // ── Try online host first (skip if bot/simulateP2 is active — bots are local-only) ──
    const wantBot = state.simulateP2 || (simulateP2Checkbox && simulateP2Checkbox.checked);
    console.log('[onHost] onlineMode=' + onlineMode + ' isOnline=' + (window.MMtpNet ? MMtpNet.isOnline : 'N/A') + ' wantBot=' + wantBot);
    if (wantBot && onlineMode) {
      console.log('[onHost] Bot mode selected — using local room (uncheck bot for online multiplayer)');
    }
    if (onlineMode && window.MMtpNet && MMtpNet.isOnline && !wantBot) {
      showLoading(true);
      setStatus('Creating room on server…', 'info');
      const myProfile = {
        avatar: localStorage.getItem(STORAGE_AVATAR) || '🃏',
        title: localStorage.getItem(STORAGE_TITLE) || 'Newcomer',
        rating: state.stats.rating || 1000,
        level: state.stats.level || 1,
      };
      const res = await MMtpNet.createRoom(name, state.rules, myProfile);
      showLoading(false);
      if (res.ok) {
        state.mode = 'lobby';
        state.isHost = true;
        state.isOnlineRoom = true;
        state.roomCode = res.roomCode;
        state.roomCreatedAt = Date.now();
        state.players = (res.room.players || []).map(p => ({
          tabId: p.isHost ? tabId : ('remote-' + p.playerId),
          name: p.name,
          ready: p.ready,
          isHost: p.isHost,
          playerId: p.playerId,
          connected: p.connected,
          avatar: p.avatar || '🃏',
          title: p.title || '',
          rating: p.rating || 1000,
        }));
        setStatus('Hosting · Room ' + res.roomCode + ' (online)', 'success');
        updatePlayerPanel();
        applyRulesToInputs();
        renderLobby();
        if (roomAgeInterval) clearInterval(roomAgeInterval);
        roomAgeInterval = setInterval(updateRoomAge, 1000);
        updateRoomAge();
        return;
      } else {
        setStatus('Server error: ' + (res.error || 'Unknown') + ' — falling back to local', 'warning');
      }
    }

    // ── Fallback: localStorage host (bot / offline play) ──
    // If we were in an online room, leave it first
    if (state.isOnlineRoom && window.MMtpNet && MMtpNet.isOnline) {
      try { await MMtpNet.leaveRoom(); } catch (e) { /* ignore */ }
    }
    state.isOnlineRoom = false;  // ensure local path is used from now on
    
    // Preserve the current checkbox state (user may have just toggled it)
    const userWantsBot = wantBot;
    
    // Restore simulateP2 state from last session (only if user hasn't explicitly changed it)
    try {
      const savedLobbyState = localStorage.getItem(STORAGE_LOBBY_STATE);
      if (savedLobbyState) {
        const parsed = JSON.parse(savedLobbyState);
        if (botDifficultySelect && state.rules.botDifficulty) {
          botDifficultySelect.value = state.rules.botDifficulty;
        }
      }
    } catch (e) {
      console.warn('Failed to restore simulateP2 state:', e);
    }
    
    // Always use the current checkbox state — don't let saved state override it
    state.simulateP2 = userWantsBot;
    state.simulatedP2Ready = userWantsBot; // Auto-ready bot when enabled
    if (simulateP2Checkbox) simulateP2Checkbox.checked = userWantsBot;
    
    const code = generateUniqueRoomCode();
    state.mode = 'lobby';
    state.isHost = true;
    state.roomCode = code;
    state.roomCreatedAt = Date.now();
    const myAvatar = localStorage.getItem(STORAGE_AVATAR) || '🃏';
    const myTitle = localStorage.getItem(STORAGE_TITLE) || '';
    const myRating = state.stats ? state.stats.rating : 1000;
    state.players = [{ tabId, name, ready: false, isHost: true, avatar: myAvatar, title: myTitle, rating: myRating }];
    
    // Save lobby state (including simulateP2)
    saveLobbyState();
    writeRoom({
      roomCode: code,
      hostTabId: tabId,
      players: state.players,
      rules: state.rules,
      startRequested: false,
      createdAt: state.roomCreatedAt,
    });
    setStatus('Hosting · Room ' + code + ' (local)', 'success');
    updatePlayerPanel();
    applyRulesToInputs();
    renderLobby();
    
    // Start room age updates
    if (roomAgeInterval) clearInterval(roomAgeInterval);
    roomAgeInterval = setInterval(updateRoomAge, 1000);
    updateRoomAge();
  }

  function saveLobbyState() {
    try {
      const me = state.players.find(p => p.tabId === tabId);
      const lobbyState = {
        playerName: (playerNameInput && playerNameInput.value.trim()) || loadName(),
        readyStatus: me ? me.ready : false,
        simulateP2: state.simulateP2 || false,
        simulatedP2Ready: state.simulatedP2Ready || false,
        timestamp: Date.now(),
      };
      localStorage.setItem(STORAGE_LOBBY_STATE, JSON.stringify(lobbyState));
    } catch (e) {
      console.warn('Failed to save lobby state:', e);
    }
  }

  async function onJoin() {
    if (window.SFX) SFX.play('click');
    const name = (playerNameInput && playerNameInput.value.trim()) || loadName();
    if (!name || name.trim().length === 0) {
      setStatus('Name is required', 'error');
      if (playerNameInput) {
        playerNameInput.focus();
        playerNameInput.classList.add('error');
        setTimeout(() => playerNameInput.classList.remove('error'), 2000);
      }
      return;
    }
    saveName(name);
    const code = (joinRoomCode && joinRoomCode.value.trim()) || '';
    if (!/^\d{4}$/.test(code)) {
      setStatus('Invalid room code (must be 4 digits)', 'error');
      if (joinRoomCode) {
        joinRoomCode.focus();
        joinRoomCode.classList.add('error');
        setTimeout(() => joinRoomCode.classList.remove('error'), 2000);
      }
      return;
    }

    // ── Try online join first ──
    if (onlineMode && window.MMtpNet && MMtpNet.isOnline) {
      showLoading(true);
      if (btnJoin) btnJoin.disabled = true;
      setStatus('Joining room on server…', 'info');
      const joinProfile = {
        avatar: localStorage.getItem(STORAGE_AVATAR) || '🃏',
        title: localStorage.getItem(STORAGE_TITLE) || 'Newcomer',
        rating: state.stats.rating || 1000,
        level: state.stats.level || 1,
      };
      const res = await MMtpNet.joinRoom(code, name, joinProfile);
      showLoading(false);
      if (btnJoin) btnJoin.disabled = false;
      if (res.ok) {
        state.mode = 'lobby';
        state.isHost = false;
        state.isOnlineRoom = true;
        state.roomCode = res.roomCode;
        state.roomCreatedAt = Date.now();
        state.rules = clampRules(res.room.rules || DEFAULTS);
        state.players = (res.room.players || []).map(p => ({
          tabId: p.isHost ? ('remote-host') : tabId,
          name: p.name,
          ready: p.ready,
          isHost: p.isHost,
          playerId: p.playerId,
          connected: p.connected,
          avatar: p.avatar || '🃏',
          title: p.title || '',
          rating: p.rating || 1000,
        }));
        setStatus('Joined room ' + res.roomCode + ' (online)', 'success');
        updatePlayerPanel();
        applyRulesToInputs();
        renderLobby();
        return;
      } else {
        setStatus('Server error: ' + (res.error || 'Unknown'), 'error');
        return;
      }
    }

    // ── Fallback: localStorage join ──
    const ip = '127.0.0.1';
    state.joinPending = true;
    setStatus('Joining…', 'info');
    showLoading(true);
    if (btnJoin) btnJoin.disabled = true;
    setTimeout(function () {
      state.joinPending = false;
      showLoading(false);
      if (btnJoin) btnJoin.disabled = false;
      const room = readRoom(code);
      if (!room) {
        setStatus('Room not found or expired', 'error');
        renderLobby();
        return;
      }
      const players = room.players || [];
      if (players.length >= 2) {
        setStatus('Room is full', 'error');
        renderLobby();
        return;
      }
      state.mode = 'lobby';
      state.isHost = false;
      state.roomCode = code;
      state.rules = clampRules(room.rules || DEFAULTS);
      
      // Restore ready status if we have a saved one
      let readyStatus = false;
      try {
        const savedLobbyState = localStorage.getItem(STORAGE_LOBBY_STATE);
        if (savedLobbyState) {
          const parsed = JSON.parse(savedLobbyState);
          readyStatus = parsed.readyStatus || false;
        }
      } catch (e) {
        console.warn('Failed to restore ready status:', e);
      }
      
      const jAvatar = localStorage.getItem(STORAGE_AVATAR) || '🃏';
      const jTitle = localStorage.getItem(STORAGE_TITLE) || '';
      const jRating = state.stats ? state.stats.rating : 1000;
      state.players = [...players, { tabId, name, ready: readyStatus, isHost: false, avatar: jAvatar, title: jTitle, rating: jRating }];
      writeRoom({
        roomCode: code,
        hostTabId: room.hostTabId,
        players: state.players,
        rules: state.rules,
        startRequested: false,
        createdAt: room.createdAt,
      });
      saveLobbyState(); // Save lobby state after joining
      setStatus('Joined room ' + code + ' (local)', 'success');
      updatePlayerPanel();
      applyRulesToInputs();
      renderLobby();
    }, 400);
  }

  async function onLeave() {
    const wasOnlineRoom = state.isOnlineRoom;
    // ── Online mode ──
    if (wasOnlineRoom && window.MMtpNet && MMtpNet.isOnline) {
      await MMtpNet.leaveRoom();
    }

    const code = state.roomCode;
    const wasHost = state.isHost;
    state.isHost = false;
    state.isOnlineRoom = false;
    state.roomCode = null;
    state.players = [];
    state.roomCreatedAt = null;
    if (!wasOnlineRoom && wasHost) removeRoom(code);
    setStatus('Left lobby', 'info');
    renderLobby();
    if (roomAgeInterval) {
      clearInterval(roomAgeInterval);
      roomAgeInterval = null;
    }
    if (roomAge) roomAge.classList.add('hidden');
  }

  async function onReady() {
    if (window.SFX) SFX.play('click');
    // ── Online mode ──
    if (state.isOnlineRoom && window.MMtpNet && MMtpNet.isOnline) {
      const me = state.players.find(p => p.tabId === tabId || (!p.isHost && !state.isHost) || (p.isHost && state.isHost));
      const newReady = me ? !me.ready : true;
      const res = await MMtpNet.setReady(newReady);
      if (!res.ok) setStatus('Failed to set ready: ' + (res.error || ''), 'error');
      return;
    }

    // ── Local mode ──
    const players = getEffectivePlayers();
    const me = players.find((p) => p.tabId === tabId);
    if (!me) return;
    me.ready = !me.ready;
    state.players = state.players.map((p) => (p.tabId === tabId ? { ...p, ready: me.ready } : p));
    saveLobbyState(); // Save ready status
    persistRoom();
    renderLobby();
  }

  async function onStart() {
    if (window.SFX) SFX.play('click');
    console.log('[onStart] state.isOnlineRoom=' + state.isOnlineRoom + ' isHost=' + state.isHost + ' simulateP2=' + state.simulateP2 + ' simulatedP2Ready=' + state.simulatedP2Ready + ' mode=' + state.mode);
    // ── Online mode (skip when playing with bot — bots are local-only) ──
    if (state.isOnlineRoom && window.MMtpNet && MMtpNet.isOnline && !state.simulateP2) {
      const players = state.players;
      console.log('[onStart] Online path: players=' + JSON.stringify(players));
      if (!state.isHost || players.length < 2 || !players.every(p => p.ready)) {
        setStatus('Cannot start: need 2 ready players', 'warning');
        return;
      }
      showLoading(true);
      setStatus('Starting game…', 'info');
      const res = await MMtpNet.startGame();
      showLoading(false);
      if (!res.ok) {
        setStatus('Failed to start: ' + (res.error || ''), 'error');
      }
      // gameStarting event handler navigates to /play
      return;
    }

    // ── Local mode ──
    // Force local state when playing with bot (user may have toggled bot
    // on an existing online room without re-hosting)
    if (state.simulateP2 && state.isOnlineRoom) {
      console.log('[onStart] Bot active on online room — switching to local');
      state.isOnlineRoom = false;
      if (window.MMtpNet && MMtpNet.isOnline) {
        try { MMtpNet.leaveRoom(); } catch (e) { /* ignore */ }
      }
    }

    const players = getEffectivePlayers();
    console.log('[onStart] Local path: players=' + JSON.stringify(players));
    if (!state.isHost) {
      console.log('[onStart] BLOCKED: not host');
      setStatus('Only the host can start the game', 'warning');
      return;
    }
    if (players.length < 2) {
      console.log('[onStart] BLOCKED: need 2 players');
      setStatus('Need 2 players — enable bot or wait for someone to join', 'warning');
      return;
    }
    if (!players.every((p) => p.ready)) {
      console.log('[onStart] BLOCKED: not all ready');
      setStatus('All players must be ready before starting', 'warning');
      return;
    }
    if (!validateRules()) {
      console.log('[onStart] BLOCKED: rules invalid');
      setStatus('Please fix rule errors before starting', 'error');
      return;
    }
    let room = readRoom();
    // If no room in localStorage (e.g. bot toggled on an online room), create one now
    if (!room && state.simulateP2) {
      console.log('[onStart] No local room found — creating ephemeral room for bot game');
      const code = state.roomCode || generateUniqueRoomCode();
      state.roomCode = code;
      room = {
        roomCode: code,
        hostTabId: tabId,
        players: players.filter(p => p.tabId !== 'simulated').map(p => ({
          tabId: p.tabId, name: p.name, ready: p.ready, isHost: p.isHost,
        })),
        rules: state.rules,
        startRequested: false,
        createdAt: state.roomCreatedAt || Date.now(),
      };
      writeRoom(room);
    }
    console.log('[onStart] room=' + (room ? 'exists' : 'NULL'));
    if (!room) return;
    state.stats.lastPlayed = Date.now();
    saveStats();
    // Save latest rules plus bot flag (use simulateP2 as simple bot toggle for now)
    const mergedRules = { 
      ...state.rules, 
      allowBots: !!state.simulateP2,
      botDifficulty: state.rules.botDifficulty || 'medium'
    };
    writeRoom({ ...room, rules: mergedRules, startRequested: true });
    
    // Save rules to localStorage for restoration when returning
    try {
      localStorage.setItem(STORAGE_LAST_RULES, JSON.stringify(state.rules));
    } catch (e) {
      console.warn('Failed to save rules:', e);
    }
    
    // Navigate to gameplay scene with rules, role, and room code
    const rulesJson = JSON.stringify(mergedRules);
    const rulesEncoded = encodeURIComponent(rulesJson);
    const role = state.isHost ? 'host' : 'client';
    const roomCode = state.roomCode || '';
    window.location.href = `/play?rules=${rulesEncoded}&role=${role}&room=${roomCode}`;
  }

  function onRulesChange() {
    if (!state.isHost) return;
    readRulesFromInputs();
    state.rules = clampRules(state.rules);
    if (validateRules()) {
      // ── Online: sync rules to server ──
      if (state.isOnlineRoom && window.MMtpNet && MMtpNet.isOnline) {
        MMtpNet.updateRules(state.rules);
      }
      persistRoom();
      // Save rules to localStorage for restoration
      try {
        localStorage.setItem(STORAGE_LAST_RULES, JSON.stringify(state.rules));
      } catch (e) {
        console.warn('Failed to save rules:', e);
      }
    }
  }

  function onResetRules() {
    if (!state.isHost) return;
    state.rules = { ...DEFAULTS };
    applyRulesToInputs();
    persistRoom();
    // Save reset rules to localStorage
    try {
      localStorage.setItem(STORAGE_LAST_RULES, JSON.stringify(state.rules));
    } catch (e) {
      console.warn('Failed to save rules:', e);
    }
    setStatus('Rules reset to defaults', 'info');
  }

  // ── Rule Presets System ──
  const BUILT_IN_PRESETS = [
    { name: '🎮 Standard', rules: { handSize: 7, timer: 20, targetMin: 1, targetMax: 10, winPoints: 5, rehandDrawCount: 5, minDrawPerClick: 1, maxDrawPerTurn: 0, specialCards: true, nearestScore: false, allowedOperators: ['add','sub','mul','div'], allowedSpecials: ['wild','reroll','double','peek','swap'] }, builtIn: true },
    { name: '⚡ Speed', rules: { handSize: 5, timer: 15, targetMin: 1, targetMax: 10, winPoints: 3, rehandDrawCount: 3, minDrawPerClick: 1, maxDrawPerTurn: 0, specialCards: true, nearestScore: false, allowedOperators: ['add','sub','mul'], allowedSpecials: ['wild','reroll','double','peek','swap'] }, builtIn: true },
    { name: '🏔️ Marathon', rules: { handSize: 10, timer: 45, targetMin: 1, targetMax: 50, winPoints: 10, rehandDrawCount: 7, minDrawPerClick: 1, maxDrawPerTurn: 0, specialCards: true, nearestScore: false, allowedOperators: ['add','sub','mul','div','mod','pow'], allowedSpecials: ['wild','reroll','double','peek','swap'] }, builtIn: true },
    { name: '🧮 Pure Math', rules: { handSize: 7, timer: 30, targetMin: 1, targetMax: 20, winPoints: 5, rehandDrawCount: 5, minDrawPerClick: 1, maxDrawPerTurn: 0, specialCards: false, nearestScore: false, allowedOperators: ['add','sub','mul','div'], allowedSpecials: [] }, builtIn: true },
    { name: '🔥 Chaos', rules: { handSize: 12, timer: 25, targetMin: -50, targetMax: 50, winPoints: 7, rehandDrawCount: 8, minDrawPerClick: 2, maxDrawPerTurn: 5, specialCards: true, nearestScore: true, allowedOperators: ['add','sub','mul','div','mod','pow'], allowedSpecials: ['wild','reroll','double','peek','swap'] }, builtIn: true },
    { name: '👶 Beginner', rules: { handSize: 9, timer: 60, targetMin: 1, targetMax: 10, winPoints: 3, rehandDrawCount: 7, minDrawPerClick: 1, maxDrawPerTurn: 0, specialCards: false, nearestScore: true, allowedOperators: ['add','sub','mul'], allowedSpecials: [] }, builtIn: true },
  ];

  function loadCustomPresets() {
    try {
      const raw = localStorage.getItem(STORAGE_PRESETS);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  }

  function saveCustomPresets(presets) {
    try { localStorage.setItem(STORAGE_PRESETS, JSON.stringify(presets)); } catch {}
  }

  function populatePresetDropdown() {
    if (!presetSelect) return;
    const custom = loadCustomPresets();
    presetSelect.innerHTML = '<option value="">— Custom —</option>';
    // Built-in
    const builtInGroup = document.createElement('optgroup');
    builtInGroup.label = 'Built-in Presets';
    BUILT_IN_PRESETS.forEach((p, i) => {
      const opt = document.createElement('option');
      opt.value = `builtin:${i}`;
      opt.textContent = p.name;
      builtInGroup.appendChild(opt);
    });
    presetSelect.appendChild(builtInGroup);
    // Custom
    if (custom.length > 0) {
      const customGroup = document.createElement('optgroup');
      customGroup.label = 'My Presets';
      custom.forEach((p, i) => {
        const opt = document.createElement('option');
        opt.value = `custom:${i}`;
        opt.textContent = p.name;
        customGroup.appendChild(opt);
      });
      presetSelect.appendChild(customGroup);
    }
  }

  function applyPreset(key) {
    if (!key) return;
    const [type, idxStr] = key.split(':');
    const idx = parseInt(idxStr, 10);
    let preset;
    if (type === 'builtin') preset = BUILT_IN_PRESETS[idx];
    else {
      const custom = loadCustomPresets();
      preset = custom[idx];
    }
    if (!preset) return;
    state.rules = clampRules({ ...DEFAULTS, ...preset.rules });
    applyRulesToInputs();
    onRulesChange();
    setStatus(`Loaded preset: ${preset.name}`, 'info');
  }

  function saveCurrentAsPreset() {
    const name = prompt('Preset name:');
    if (!name || !name.trim()) return;
    readRulesFromInputs();
    const custom = loadCustomPresets();
    custom.push({ name: name.trim(), rules: { ...state.rules } });
    saveCustomPresets(custom);
    populatePresetDropdown();
    // Select the newly saved preset
    presetSelect.value = `custom:${custom.length - 1}`;
    if (btnDeletePreset) btnDeletePreset.disabled = false;
    setStatus(`Saved preset: ${name.trim()}`, 'success');
  }

  function deleteSelectedPreset() {
    if (!presetSelect || !presetSelect.value) return;
    const [type, idxStr] = presetSelect.value.split(':');
    if (type !== 'custom') { setStatus('Cannot delete built-in presets', 'error'); return; }
    const idx = parseInt(idxStr, 10);
    const custom = loadCustomPresets();
    if (idx >= 0 && idx < custom.length) {
      const name = custom[idx].name;
      custom.splice(idx, 1);
      saveCustomPresets(custom);
      populatePresetDropdown();
      presetSelect.value = '';
      if (btnDeletePreset) btnDeletePreset.disabled = true;
      setStatus(`Deleted preset: ${name}`, 'info');
    }
  }

  if (presetSelect) {
    populatePresetDropdown();
    presetSelect.addEventListener('change', () => {
      if (presetSelect.value) {
        applyPreset(presetSelect.value);
        const [type] = presetSelect.value.split(':');
        if (btnDeletePreset) btnDeletePreset.disabled = type !== 'custom';
      } else {
        if (btnDeletePreset) btnDeletePreset.disabled = true;
      }
    });
  }
  function exportPresets() {
    const custom = loadCustomPresets();
    if (custom.length === 0) { setStatus('No custom presets to export', 'error'); return; }
    const json = JSON.stringify(custom, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'mmtp-presets.json';
    a.click();
    URL.revokeObjectURL(url);
    setStatus(`Exported ${custom.length} preset(s)`, 'success');
  }

  function importPresets() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const imported = JSON.parse(reader.result);
          if (!Array.isArray(imported)) throw new Error('Invalid format');
          const existing = loadCustomPresets();
          let added = 0;
          for (const p of imported) {
            if (p.name && p.rules && typeof p.rules === 'object') {
              // Avoid duplicates by name
              if (!existing.some(e => e.name === p.name)) {
                existing.push({ name: p.name, rules: p.rules });
                added++;
              }
            }
          }
          saveCustomPresets(existing);
          populatePresetDropdown();
          setStatus(`Imported ${added} new preset(s) (${imported.length - added} skipped as duplicates)`, 'success');
        } catch (e) {
          setStatus('Failed to import presets: invalid file', 'error');
        }
      };
      reader.readAsText(file);
    });
    input.click();
  }

  if (btnSavePreset) btnSavePreset.addEventListener('click', saveCurrentAsPreset);
  if (btnDeletePreset) btnDeletePreset.addEventListener('click', deleteSelectedPreset);
  if (btnExportPresets) btnExportPresets.addEventListener('click', exportPresets);
  if (btnImportPresets) btnImportPresets.addEventListener('click', importPresets);

  // ── Achievements System ──
  const ACHIEVEMENTS = [
    { id: 'first_win', name: 'First Victory', desc: 'Win your first game', icon: '🏆', check: s => s.wins >= 1 },
    { id: 'five_wins', name: 'Getting Good', desc: 'Win 5 games', icon: '⭐', check: s => s.wins >= 5 },
    { id: 'ten_wins', name: 'Veteran', desc: 'Win 10 games', icon: '🎖️', check: s => s.wins >= 10 },
    { id: 'fifty_wins', name: 'Champion', desc: 'Win 50 games', icon: '👑', check: s => s.wins >= 50 },
    { id: 'first_loss', name: 'Learning Experience', desc: 'Lose your first game', icon: '📚', check: s => s.losses >= 1 },
    { id: 'streak_3', name: 'On Fire', desc: 'Reach a 3-win streak', icon: '🔥', check: s => (s.bestWinStreak || 0) >= 3 },
    { id: 'streak_5', name: 'Unstoppable', desc: 'Reach a 5-win streak', icon: '💥', check: s => (s.bestWinStreak || 0) >= 5 },
    { id: 'streak_10', name: 'Legendary', desc: 'Reach a 10-win streak', icon: '🌟', check: s => (s.bestWinStreak || 0) >= 10 },
    { id: 'level_5', name: 'Rising Star', desc: 'Reach level 5', icon: '📈', check: s => s.level >= 5 },
    { id: 'level_10', name: 'Seasoned Player', desc: 'Reach level 10', icon: '🏅', check: s => s.level >= 10 },
    { id: 'level_25', name: 'Math Master', desc: 'Reach level 25', icon: '🧙', check: s => s.level >= 25 },
    { id: 'games_10', name: 'Dedicated', desc: 'Play 10 games', icon: '🎮', check: s => (s.wins + s.losses + (s.draws||0)) >= 10 },
    { id: 'games_50', name: 'Committed', desc: 'Play 50 games', icon: '💎', check: s => (s.wins + s.losses + (s.draws||0)) >= 50 },
    { id: 'games_100', name: 'Centurion', desc: 'Play 100 games', icon: '💯', check: s => (s.wins + s.losses + (s.draws||0)) >= 100 },
    { id: 'xp_1000', name: 'XP Hunter', desc: 'Earn 1,000 total XP', icon: '✨', check: s => (s.totalXpEarned || s.xp || 0) >= 1000 },
    { id: 'xp_10000', name: 'XP Legend', desc: 'Earn 10,000 total XP', icon: '💫', check: s => (s.totalXpEarned || s.xp || 0) >= 10000 },
    { id: 'rating_1200', name: 'Skilled', desc: 'Reach 1200 rating', icon: '📊', check: s => (s.rating || 1000) >= 1200 },
    { id: 'rating_1500', name: 'Expert', desc: 'Reach 1500 rating', icon: '🎯', check: s => (s.rating || 1000) >= 1500 },
    { id: 'first_draw', name: 'Even Match', desc: 'Draw a game', icon: '🤝', check: s => (s.draws || 0) >= 1 },
  ];

  function loadAchievementData() {
    try {
      const raw = localStorage.getItem(STORAGE_ACHIEVEMENTS);
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  }

  function saveAchievementData(data) {
    try { localStorage.setItem(STORAGE_ACHIEVEMENTS, JSON.stringify(data)); } catch {}
  }

  function checkAchievements(showToasts = true) {
    const stats = state.stats || {};
    const data = loadAchievementData();
    let newUnlocks = 0;
    ACHIEVEMENTS.forEach(a => {
      if (!data[a.id] && a.check(stats)) {
        data[a.id] = { unlockedAt: new Date().toISOString() };
        newUnlocks++;
        if (showToasts) {
          setStatus(`🏆 Achievement Unlocked: ${a.icon} ${a.name}`, 'success');
          if (window.SFX) SFX.play('levelUp');
        }
      }
    });
    if (newUnlocks > 0) saveAchievementData(data);
    return data;
  }

  function renderAchievements() {
    if (!achievementsList) return;
    const data = loadAchievementData();
    const total = ACHIEVEMENTS.length;
    const unlocked = ACHIEVEMENTS.filter(a => data[a.id]).length;
    if (achievementsCount) achievementsCount.textContent = `${unlocked}/${total}`;
    if (achievementsProgressFill) achievementsProgressFill.style.width = `${(unlocked / total) * 100}%`;
    achievementsList.innerHTML = '';
    // Show unlocked first, then locked
    const sorted = [...ACHIEVEMENTS].sort((a, b) => {
      const aU = data[a.id] ? 1 : 0;
      const bU = data[b.id] ? 1 : 0;
      return bU - aU;
    });
    sorted.forEach(a => {
      const isUnlocked = !!data[a.id];
      const item = document.createElement('div');
      item.className = `achievement-item${isUnlocked ? ' unlocked' : ''}`;
      const dateStr = isUnlocked ? new Date(data[a.id].unlockedAt).toLocaleDateString() : '';
      item.innerHTML = `
        <div class="achievement-icon">${a.icon}</div>
        <div class="achievement-info">
          <div class="achievement-name">${a.name}</div>
          <div class="achievement-desc">${a.desc}</div>
          ${isUnlocked ? `<div class="achievement-date">Unlocked ${dateStr}</div>` : ''}
        </div>
        <div class="achievement-check">${isUnlocked ? '✅' : '🔒'}</div>
      `;
      achievementsList.appendChild(item);
    });
  }

  function toggleAchievements() {
    if (!achievementsPanel) return;
    const isHidden = achievementsPanel.classList.contains('hidden');
    achievementsPanel.classList.toggle('hidden', !isHidden);
    if (isHidden) renderAchievements();
  }

  if (btnAchievements) btnAchievements.addEventListener('click', toggleAchievements);
  if (btnCloseAchievements) btnCloseAchievements.addEventListener('click', toggleAchievements);
  if (achievementsPanel) {
    achievementsPanel.addEventListener('click', (e) => {
      if (e.target.classList.contains('modal-backdrop')) toggleAchievements();
    });
  }

  // ══════════════════════════════════════════════════════════════
  // ── Leaderboard ──
  // ══════════════════════════════════════════════════════════════
  const leaderboardModal = $('leaderboard-modal');
  const btnLeaderboard = $('btn-leaderboard');
  const btnCloseLeaderboard = $('btn-close-leaderboard');
  const leaderboardBody = $('leaderboard-body');
  const leaderboardLoading = $('leaderboard-loading');
  const leaderboardEmpty = $('leaderboard-empty');
  const leaderboardTableWrapper = $('leaderboard-table-wrapper');
  const btnLbRefresh = $('btn-lb-refresh');
  const lbLastUpdated = $('lb-last-updated');

  let lbData = [];
  let lbSort = 'rating';

  async function fetchLeaderboard() {
    if (leaderboardLoading) leaderboardLoading.classList.remove('hidden');
    if (leaderboardEmpty) leaderboardEmpty.classList.add('hidden');
    if (leaderboardTableWrapper) leaderboardTableWrapper.classList.add('hidden');
    try {
      const res = await fetch('/api/leaderboard?limit=50');
      const json = await res.json();
      if (json.ok && Array.isArray(json.leaderboard)) {
        lbData = json.leaderboard;
      } else {
        lbData = [];
      }
    } catch (e) {
      console.warn('[Leaderboard] fetch failed:', e);
      lbData = [];
    }
    if (leaderboardLoading) leaderboardLoading.classList.add('hidden');
    renderLeaderboard();
  }

  function renderLeaderboard() {
    if (!leaderboardBody) return;

    // Sort data
    const sorted = [...lbData];
    switch (lbSort) {
      case 'wins':
        sorted.sort((a, b) => b.wins - a.wins || b.rating - a.rating);
        break;
      case 'winrate':
        sorted.sort((a, b) => (b.winrate ?? -1) - (a.winrate ?? -1) || b.wins - a.wins);
        break;
      case 'level':
        sorted.sort((a, b) => b.level - a.level || b.rating - a.rating);
        break;
      default: // 'rating'
        sorted.sort((a, b) => b.rating - a.rating || b.wins - a.wins);
    }

    if (sorted.length === 0) {
      if (leaderboardEmpty) leaderboardEmpty.classList.remove('hidden');
      if (leaderboardTableWrapper) leaderboardTableWrapper.classList.add('hidden');
      return;
    }

    if (leaderboardEmpty) leaderboardEmpty.classList.add('hidden');
    if (leaderboardTableWrapper) leaderboardTableWrapper.classList.remove('hidden');

    // Get local player's profile code to highlight their row
    const myCode = localStorage.getItem(STORAGE_PROFILE_CODE) || '';

    leaderboardBody.innerHTML = sorted.map((p, i) => {
      const rank = i + 1;
      const isMe = myCode && p.code === myCode.toUpperCase();
      const medalClass = rank === 1 ? 'lb-gold' : rank === 2 ? 'lb-silver' : rank === 3 ? 'lb-bronze' : '';
      const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : rank;
      // Get rank badge from MMProfile if available
      let rankBadge = '';
      if (typeof MMProfile !== 'undefined') {
        const r = MMProfile.getRank(p.rating);
        rankBadge = `<span class="lb-rank-badge" style="color:${r.color}" title="${r.name}">${r.icon}</span>`;
      }
      const wr = p.winrate != null ? p.winrate + '%' : '—';
      return `<tr class="${isMe ? 'lb-me' : ''} ${medalClass}">
        <td class="lb-col-rank">${medal}</td>
        <td class="lb-col-player">
          <span class="lb-avatar">${p.avatar}</span>
          <span class="lb-name">${escapeHtml(p.name)}</span>
          ${p.title ? `<span class="lb-title">${escapeHtml(p.title)}</span>` : ''}
        </td>
        <td class="lb-col-rating">${rankBadge} ${p.rating}</td>
        <td class="lb-col-level">${p.level}</td>
        <td class="lb-col-record">${p.wins}/${p.losses}/${p.draws}</td>
        <td class="lb-col-winrate">${wr}</td>
        <td class="lb-col-streak">${p.bestWinStreak}</td>
      </tr>`;
    }).join('');

    if (lbLastUpdated) {
      lbLastUpdated.textContent = 'Updated ' + new Date().toLocaleTimeString();
    }
  }

  function escapeHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function toggleLeaderboard() {
    if (!leaderboardModal) return;
    const isHidden = leaderboardModal.classList.contains('hidden');
    leaderboardModal.classList.toggle('hidden', !isHidden);
    if (isHidden) fetchLeaderboard();
  }

  if (btnLeaderboard) btnLeaderboard.addEventListener('click', toggleLeaderboard);
  if (btnCloseLeaderboard) btnCloseLeaderboard.addEventListener('click', toggleLeaderboard);
  if (leaderboardModal) {
    leaderboardModal.addEventListener('click', (e) => {
      if (e.target.classList.contains('modal-backdrop')) toggleLeaderboard();
    });
  }
  if (btnLbRefresh) btnLbRefresh.addEventListener('click', fetchLeaderboard);

  // Tab switching
  document.querySelectorAll('.lb-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.lb-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      lbSort = tab.dataset.sort || 'rating';
      renderLeaderboard();
    });
  });

  // ══════════════════════════════════════════════════════════════
  // ── Profile Card — Avatar / Title / Bio pickers ──
  // ══════════════════════════════════════════════════════════════
  (function initProfileCard() {
    if (typeof MMProfile === 'undefined') return;

    // ── Load persisted profile extras ──
    const savedAvatar = localStorage.getItem(STORAGE_AVATAR) || '🃏';
    const savedTitle = localStorage.getItem(STORAGE_TITLE) || '';
    const savedBio = localStorage.getItem(STORAGE_BIO) || '';
    if (profileAvatar) profileAvatar.textContent = savedAvatar;
    if (profileBioInput) profileBioInput.value = savedBio;

    // ── Avatar Picker ──
    function openAvatarPicker() {
      if (!avatarPicker || !avatarGrid) return;
      avatarGrid.innerHTML = '';
      const currentAvatar = localStorage.getItem(STORAGE_AVATAR) || '🃏';
      const unlocked = MMProfile.getUnlockedAvatars(state.stats);
      const unlockedIds = new Set(unlocked.map(a => a.id));

      MMProfile.AVATARS.forEach(a => {
        const isLocked = !unlockedIds.has(a.id);
        const isSelected = a.emoji === currentAvatar;
        const el = document.createElement('div');
        el.className = 'avatar-option' + (isSelected ? ' selected' : '') + (isLocked ? ' locked' : '');
        let reqText = '';
        if (a.req) {
          const val = a.req.value;
          switch (a.req.type) {
            case 'wins':   reqText = val + ' wins'; break;
            case 'level':  reqText = 'Lv.' + val; break;
            case 'streak': reqText = val + ' streak'; break;
            case 'rating': reqText = val + ' SR'; break;
            case 'games':  reqText = val + ' games'; break;
          }
        }
        el.innerHTML = `
          <span class="avatar-emoji">${a.emoji}</span>
          <span class="avatar-name">${a.name}</span>
          ${isLocked ? `<span class="avatar-lock">🔒 ${reqText}</span>` : ''}
        `;
        if (!isLocked) {
          el.addEventListener('click', () => {
            localStorage.setItem(STORAGE_AVATAR, a.emoji);
            if (profileAvatar) profileAvatar.textContent = a.emoji;
            avatarPicker.classList.add('hidden');
            if (window.SFX) SFX.play('click');
          });
        }
        avatarGrid.appendChild(el);
      });
      avatarPicker.classList.remove('hidden');
    }
    if (profileAvatar) profileAvatar.addEventListener('click', openAvatarPicker);
    if ($('btn-avatar-close')) $('btn-avatar-close').addEventListener('click', () => avatarPicker && avatarPicker.classList.add('hidden'));
    if (avatarPicker) avatarPicker.addEventListener('click', (e) => {
      if (e.target === avatarPicker) avatarPicker.classList.add('hidden');
    });

    // ── Title Picker ──
    function openTitlePicker() {
      if (!titlePicker || !titleList) return;
      titleList.innerHTML = '';
      const currentTitle = localStorage.getItem(STORAGE_TITLE) || '';
      const unlocked = MMProfile.getUnlockedTitles(state.stats);
      const unlockedIds = new Set(unlocked.map(t => t.id));

      MMProfile.TITLES.forEach(t => {
        const isLocked = !unlockedIds.has(t.id);
        const isSelected = t.label === currentTitle;
        const el = document.createElement('div');
        el.className = 'title-option' + (isSelected ? ' selected' : '') + (isLocked ? ' locked' : '');
        let reqText = '';
        if (t.req) {
          const val = t.req.value;
          switch (t.req.type) {
            case 'wins':   reqText = val + ' wins'; break;
            case 'level':  reqText = 'Lv.' + val; break;
            case 'games':  reqText = val + ' games'; break;
            case 'streak': reqText = val + ' streak'; break;
            case 'rating': reqText = val + ' SR'; break;
          }
        }
        el.innerHTML = `
          <span class="title-label">${t.label}</span>
          <span class="title-req">${isLocked ? '🔒 ' + reqText : (isSelected ? '✓' : '')}</span>
        `;
        if (!isLocked) {
          el.addEventListener('click', () => {
            localStorage.setItem(STORAGE_TITLE, t.label);
            if (profileTitle) profileTitle.textContent = t.label;
            titlePicker.classList.add('hidden');
            if (window.SFX) SFX.play('click');
          });
        }
        titleList.appendChild(el);
      });
      titlePicker.classList.remove('hidden');
    }
    if (profileTitle) profileTitle.addEventListener('click', openTitlePicker);
    if ($('btn-title-close')) $('btn-title-close').addEventListener('click', () => titlePicker && titlePicker.classList.add('hidden'));
    if (titlePicker) titlePicker.addEventListener('click', (e) => {
      if (e.target === titlePicker) titlePicker.classList.add('hidden');
    });

    // ── Bio Save (on blur) ──
    if (profileBioInput) {
      profileBioInput.addEventListener('blur', () => {
        const bio = profileBioInput.value.trim().slice(0, 80);
        localStorage.setItem(STORAGE_BIO, bio);
      });
      profileBioInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); profileBioInput.blur(); }
      });
    }
  })();

  // showGame/onBack removed — game navigates to /play directly

  function toggleHelp() {
    if (!helpModal) return;
    const isHidden = helpModal.classList.contains('hidden');
    helpModal.classList.toggle('hidden', !isHidden);
    // Focus close button when opening (accessibility)
    if (isHidden && btnCloseHelp) {
      btnCloseHelp.focus();
    }
  }

  // Event listeners
  if (pressAnyKey) {
    pressAnyKey.addEventListener('click', onPressAnyKey);
    pressAnyKey.addEventListener('keydown', onPressAnyKey);
    pressAnyKey.setAttribute('tabindex', '0');
  }
  document.addEventListener('keydown', function (e) {
    const ae = document.activeElement;
    const isTyping =
      ae &&
      (ae.tagName === 'INPUT' ||
        ae.tagName === 'TEXTAREA' ||
        ae.tagName === 'SELECT' ||
        ae.isContentEditable);

    // Allow help before the lobby is started (Press Any Key screen)
    if (!state.started) {
      if (e.key === '?') {
        e.preventDefault();
        toggleHelp();
        return;
      }
      onPressAnyKey();
      return;
    }

    if (e.key === '?') {
      e.preventDefault();
      toggleHelp();
      return;
    }

    if (e.key === 'Escape') {
      if (helpModal && !helpModal.classList.contains('hidden')) {
        toggleHelp();
      } else {
        const inRoom = state.roomCode || state.players.length > 0;
        if (inRoom && btnLeave && !btnLeave.classList.contains('hidden')) onLeave();
      }
    } else if ((e.key === 'H' || e.key === 'h') && !isTyping && !state.roomCode && btnHost && !btnHost.disabled) {
      e.preventDefault();
      onHost();
    } else if ((e.key === 'R' || e.key === 'r') && !isTyping && state.roomCode && btnReady && !btnReady.disabled) {
      e.preventDefault();
      onReady();
    } else if ((e.key === 'S' || e.key === 's') && !isTyping && state.isHost && btnStart && !btnStart.disabled) {
      e.preventDefault();
      onStart();
    }
  });

  if (joinRoomCode) {
    joinRoomCode.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (btnJoin && !btnJoin.disabled) onJoin();
      }
    });
  }

  window.addEventListener('storage', (e) => {
    if (!e.key || !e.key.startsWith(ROOM_PREFIX) || e.key !== roomKey()) return;
    syncFromStorage();
  });

  // Cleanup on page unload
  window.addEventListener('beforeunload', () => {
    if (state.isHost && state.roomCode) {
      // Optionally remove room on host disconnect
      // removeRoom(state.roomCode);
    }
    if (roomCleanupInterval) clearInterval(roomCleanupInterval);
    if (roomAgeInterval) clearInterval(roomAgeInterval);
  });

  btnHost.addEventListener('click', onHost);
  btnJoin.addEventListener('click', onJoin);
  if (btnCopyRoom) {
    btnCopyRoom.addEventListener('click', function () {
      const code = state.roomCode;
      if (!code) return;
      try {
        navigator.clipboard.writeText(code);
        state.copyFeedbackUntil = Date.now() + 2000;
        setStatus('Room code copied!', 'success');
        setTimeout(function () {
          state.copyFeedbackUntil = 0;
          renderLobby();
        }, 2000);
      } catch (_) {
        setStatus('Could not copy to clipboard', 'error');
      }
    });
  }

  // Copy invite link button
  if (btnCopyInvite) {
    btnCopyInvite.addEventListener('click', function () {
      const url = App.getInviteUrl ? App.getInviteUrl() : '';
      if (!url || !state.roomCode) return;
      try {
        navigator.clipboard.writeText(url);
        btnCopyInvite.textContent = '✅ Copied!';
        setStatus('Invite link copied — send it to your friend!', 'success');
        setTimeout(() => { btnCopyInvite.textContent = '📋 Copy Invite Link'; }, 2500);
      } catch (_) {
        // Fallback: show the link so they can copy manually
        prompt('Copy this invite link:', url);
      }
    });
  }


  btnLeave.addEventListener('click', onLeave);
  btnReady.addEventListener('click', onReady);
  btnStart.addEventListener('click', onStart);
  // btnBack removed — game navigates to /play
  if (btnHelp) btnHelp.addEventListener('click', toggleHelp);
  if (btnCloseHelp) {
    btnCloseHelp.addEventListener('click', toggleHelp);
    helpModal.querySelector('.modal-backdrop')?.addEventListener('click', toggleHelp);
  }
  if (btnResetRules) btnResetRules.addEventListener('click', onResetRules);

  // Lobby hints toggle
  if (btnToggleHintsInline) {
    btnToggleHintsInline.addEventListener('click', () => {
      const hintsPanel = $('lobby-hints-inline');
      if (hintsPanel) hintsPanel.classList.toggle('hidden');
    });
  }

  // ── Collapsible Section Toggles ──
  document.querySelectorAll('.section-toggle').forEach(toggle => {
    const targetId = toggle.id.replace('-toggle', '-body');
    const body = $(targetId);
    if (!body) return;
    // Initialize: if body has 'collapsed' class, set toggle state
    if (body.classList.contains('collapsed')) {
      toggle.classList.add('collapsed');
    }
    toggle.addEventListener('click', (e) => {
      // Don't toggle if clicking a button inside the header (e.g. Reset)
      if (e.target.closest('button') && e.target.closest('button') !== toggle) return;
      const isCollapsed = body.classList.toggle('collapsed');
      toggle.classList.toggle('collapsed', isCollapsed);
    });
  });

  // ── Sign Out ──
  const btnSignOut = $('btn-sign-out');
  if (btnSignOut) {
    btnSignOut.addEventListener('click', () => {
      if (!confirm('Sign out? This will clear your local profile data.')) return;
      // Clear all MMtp localStorage
      const keysToRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('mmtp-')) keysToRemove.push(key);
      }
      keysToRemove.forEach(k => localStorage.removeItem(k));
      sessionStorage.clear();
      // Reload
      window.location.reload();
    });
  }

  // Set version number on load (ensure DOM is ready)
  function setVersion() {
    const versionEl = $('version-number');
    if (versionEl) {
      versionEl.textContent = VERSION;
    } else {
      console.warn('[Version] Element not found, retrying...');
      setTimeout(setVersion, 100);
    }
  }
  
  // Set version when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setVersion);
  } else {
    setVersion();
  }
  
  // Settings Panel
  const settingsPanel = $('settings-panel');
  const btnSettings = $('btn-settings');
  const btnCloseSettings = $('btn-close-settings');
  
  // Load settings from localStorage
  const settings = {
    uiSize: localStorage.getItem('mmtp-ui-size') || 'normal',
    discardAmount: localStorage.getItem('mmtp-discard-amount') || '15',
    discardOpacity: localStorage.getItem('mmtp-discard-opacity') !== 'false',
    cardAnimations: localStorage.getItem('mmtp-card-animations') !== 'false',
    targetHighlight: localStorage.getItem('mmtp-target-highlight') !== 'false',
    autoSortHand: localStorage.getItem('mmtp-auto-sort-hand') === 'true',
    showExpressionHint: localStorage.getItem('mmtp-show-expression-hint') === 'true',
    soundEffects: localStorage.getItem('mmtp-sound-effects') !== 'false', // default ON
  };
  
  // Apply UI size
  function applyUiSize() {
    document.body.classList.remove('ui-large', 'ui-small');
    if (settings.uiSize === 'large') {
      document.body.classList.add('ui-large');
    } else if (settings.uiSize === 'small') {
      document.body.classList.add('ui-small');
    }
    localStorage.setItem('mmtp-ui-size', settings.uiSize);
  }
  applyUiSize();
  
  // Save settings
  function saveSettings() {
    localStorage.setItem('mmtp-ui-size', settings.uiSize);
    localStorage.setItem('mmtp-discard-amount', settings.discardAmount);
    localStorage.setItem('mmtp-discard-opacity', settings.discardOpacity.toString());
    localStorage.setItem('mmtp-card-animations', settings.cardAnimations.toString());
    localStorage.setItem('mmtp-target-highlight', settings.targetHighlight.toString());
    localStorage.setItem('mmtp-auto-sort-hand', settings.autoSortHand.toString());
    localStorage.setItem('mmtp-show-expression-hint', settings.showExpressionHint.toString());
    localStorage.setItem('mmtp-sound-effects', settings.soundEffects.toString());
    
    // Apply settings
    applyUiSize();
    
    // Notify gameplay page if it's open (via localStorage event or message)
    window.dispatchEvent(new CustomEvent('settingsChanged', { detail: settings }));
  }
  
  // Initialize settings panel
  if (settingsPanel && btnSettings) {
    // Load settings into UI
    const uiSizeSmall = $('ui-size-small');
    const uiSizeNormal = $('ui-size-normal');
    const uiSizeLarge = $('ui-size-large');
    const discardAmount = $('discard-amount');
    const discardOpacity = $('discard-opacity');
    const cardAnimations = $('card-animations');
    const targetHighlight = $('target-highlight');
    const autoSortHand = $('auto-sort-hand');
    const showExpressionHint = $('show-expression-hint');
    const soundEffects = $('sound-effects');
    
    // Set initial values
    if (uiSizeSmall) uiSizeSmall.checked = settings.uiSize === 'small';
    if (uiSizeNormal) uiSizeNormal.checked = settings.uiSize === 'normal';
    if (uiSizeLarge) uiSizeLarge.checked = settings.uiSize === 'large';
    if (discardAmount) discardAmount.value = settings.discardAmount;
    if (discardOpacity) discardOpacity.checked = settings.discardOpacity;
    if (cardAnimations) cardAnimations.checked = settings.cardAnimations;
    if (targetHighlight) targetHighlight.checked = settings.targetHighlight;
    if (autoSortHand) autoSortHand.checked = settings.autoSortHand;
    if (showExpressionHint) showExpressionHint.checked = settings.showExpressionHint;
    if (soundEffects) soundEffects.checked = settings.soundEffects;
    
    // Open/close settings panel
    btnSettings.addEventListener('click', () => {
      settingsPanel.classList.remove('hidden');
    });
    
    if (btnCloseSettings) {
      btnCloseSettings.addEventListener('click', () => {
        settingsPanel.classList.add('hidden');
      });
    }
    
    if (settingsPanel.querySelector('.settings-backdrop')) {
      settingsPanel.querySelector('.settings-backdrop').addEventListener('click', () => {
        settingsPanel.classList.add('hidden');
      });
    }
    
    // Handle settings changes
    if (uiSizeSmall) {
      uiSizeSmall.addEventListener('change', () => {
        if (uiSizeSmall.checked) {
          settings.uiSize = 'small';
          saveSettings();
        }
      });
    }
    if (uiSizeNormal) {
      uiSizeNormal.addEventListener('change', () => {
        if (uiSizeNormal.checked) {
          settings.uiSize = 'normal';
          saveSettings();
        }
      });
    }
    if (uiSizeLarge) {
      uiSizeLarge.addEventListener('change', () => {
        if (uiSizeLarge.checked) {
          settings.uiSize = 'large';
          saveSettings();
        }
      });
    }
    
    if (discardAmount) {
      discardAmount.addEventListener('change', (e) => {
        settings.discardAmount = e.target.value;
        saveSettings();
      });
    }
    
    if (discardOpacity) {
      discardOpacity.addEventListener('change', (e) => {
        settings.discardOpacity = e.target.checked;
        saveSettings();
      });
    }
    
    if (cardAnimations) {
      cardAnimations.addEventListener('change', (e) => {
        settings.cardAnimations = e.target.checked;
        saveSettings();
      });
    }
    
    if (targetHighlight) {
      targetHighlight.addEventListener('change', (e) => {
        settings.targetHighlight = e.target.checked;
        saveSettings();
      });
    }
    
    if (autoSortHand) {
      autoSortHand.addEventListener('change', (e) => {
        settings.autoSortHand = e.target.checked;
        saveSettings();
      });
    }
    
    if (showExpressionHint) {
      showExpressionHint.addEventListener('change', (e) => {
        settings.showExpressionHint = e.target.checked;
        saveSettings();
      });
    }
    
    if (soundEffects) {
      soundEffects.addEventListener('change', (e) => {
        settings.soundEffects = e.target.checked;
        saveSettings();
        if (window.SFX) SFX.setEnabled(e.target.checked);
        // Play a test sound when enabling
        if (e.target.checked && window.SFX) SFX.play('click');
      });
    }
  }
  
  simulateP2Checkbox.addEventListener('change', () => {
    state.simulateP2 = simulateP2Checkbox.checked;
    state.simulatedP2Ready = simulateP2Checkbox.checked; // Auto-ready bot when enabled
    if (botDifficultyRow) botDifficultyRow.classList.toggle('hidden', !state.simulateP2);
    saveLobbyState();
    renderLobby();
  });

  if (botDifficultySelect) {
    botDifficultySelect.addEventListener('change', () => {
      state.rules.botDifficulty = botDifficultySelect.value;
      saveLobbyState();
    });
  }

  [ruleHand, ruleTimer, ruleMin, ruleMax, ruleWin].forEach((inp) => {
    if (inp) {
      inp.addEventListener('change', onRulesChange);
      inp.addEventListener('blur', onRulesChange);
      inp.addEventListener('input', () => {
        inp.classList.remove('error');
      });
    }
  });
  if (ruleNearestScore) {
    ruleNearestScore.addEventListener('change', onRulesChange);
  }

  // ── Operator & Special card checkboxes ──
  if (operatorCheckboxes) {
    operatorCheckboxes.addEventListener('change', onRulesChange);
  }
  if (specialCheckboxes) {
    specialCheckboxes.addEventListener('change', onRulesChange);
  }

  // Operator presets
  const opsPresetBasic = $('ops-preset-basic');
  const opsPresetStandard = $('ops-preset-standard');
  const opsPresetAdvanced = $('ops-preset-advanced');
  function setOperatorPreset(ops) {
    if (!operatorCheckboxes) return;
    operatorCheckboxes.querySelectorAll('input[data-op]').forEach(cb => {
      cb.checked = ops.includes(cb.dataset.op);
    });
    onRulesChange();
  }
  if (opsPresetBasic) opsPresetBasic.addEventListener('click', () => setOperatorPreset(['add', 'sub', 'mul']));
  if (opsPresetStandard) opsPresetStandard.addEventListener('click', () => setOperatorPreset(['add', 'sub', 'mul', 'div']));
  if (opsPresetAdvanced) opsPresetAdvanced.addEventListener('click', () => setOperatorPreset(['add', 'sub', 'mul', 'div', 'mod', 'pow']));

  // Special card presets
  const specialsPresetNone = $('specials-preset-none');
  const specialsPresetAll = $('specials-preset-all');
  function setSpecialPreset(specs) {
    if (!specialCheckboxes) return;
    specialCheckboxes.querySelectorAll('input[data-special]').forEach(cb => {
      cb.checked = specs.includes(cb.dataset.special);
    });
    onRulesChange();
  }
  if (specialsPresetNone) specialsPresetNone.addEventListener('click', () => setSpecialPreset([]));
  if (specialsPresetAll) specialsPresetAll.addEventListener('click', () => setSpecialPreset(['wild', 'reroll', 'double', 'peek', 'swap']));

  if (playerNameInput) {
    playerNameInput.addEventListener('input', () => {
      updatePlayerPanel();
      playerNameInput.classList.remove('error');
    });
    playerNameInput.addEventListener('blur', () => saveName(playerNameInput.value));
  }

  // Initialize - wait for DOM to be ready
  function initializeApp() {
    try {
      loadStats();
      if (playerNameInput) {
        playerNameInput.value = loadName();
      }
      // joinIp field removed — server URL is auto-detected
      
      // Update player panel on page load (to show match stats if returning from gameplay)
      // Use setTimeout to ensure DOM is fully ready
      setTimeout(() => {
        try {
          if (typeof updatePlayerPanel === 'function') {
            updatePlayerPanel();
          }
          if (typeof applyRulesToInputs === 'function') {
            applyRulesToInputs();
          }
          if (typeof setVersion === 'function') {
            setVersion();
          }
        } catch (e) {
          console.error('Error during delayed initialization:', e);
        }
      }, 100);
    } catch (e) {
      console.error('Fatal error during initialization:', e);
      // Try to at least show the press any key screen
      try {
        if (pressAnyKey) {
          pressAnyKey.classList.remove('hidden');
        }
        if (menuRoot) {
          menuRoot.classList.add('hidden');
        }
      } catch (err) {
        console.error('Failed to show fallback UI:', err);
      }
    }
  }
  
  // Wait for DOM to be ready before initializing
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeApp);
  } else {
    // DOM is already ready
    initializeApp();
  }
  
  // Also update when page becomes visible (in case returning from gameplay)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) updatePlayerPanel();
  });
  
  window.addEventListener('focus', () => {
    updatePlayerPanel();
  });
  
  // Start room cleanup interval
  cleanupExpiredRooms();
  roomCleanupInterval = setInterval(cleanupExpiredRooms, 60000); // Every minute

  // ══════════════════════════════════════════════════════════════
  // ── Expose App namespace for modular scripts ──
  // ══════════════════════════════════════════════════════════════

  // State & constants
  App.state = state;
  App.STORAGE_STATS = STORAGE_STATS;
  App.STORAGE_PROFILE_CODE = STORAGE_PROFILE_CODE;
  App.STORAGE_LAST_RULES = STORAGE_LAST_RULES;
  App.STORAGE_AVATAR = STORAGE_AVATAR;
  App.STORAGE_TITLE = STORAGE_TITLE;
  App.STORAGE_BIO = STORAGE_BIO;
  App.DEFAULTS = DEFAULTS;
  App.RULES_CLAMP = RULES_CLAMP;
  App.tabId = tabId;

  // Mutable primitive access via getter/setter
  Object.defineProperty(App, 'onlineMode', {
    get() { return onlineMode; },
    set(v) { onlineMode = v; },
  });
  Object.defineProperty(App, 'serverLanUrl', {
    get() { return serverLanUrl; },
    set(v) { serverLanUrl = v; },
  });

  // DOM elements external modules may need
  App.dom = {
    playerNameInput,
    joinRoomCode,
    tunnelPasswordHint,
    shareSection,
    inviteLinkPreview,
    qrCodeEl,
  };

  // Functions
  App.$ = $;
  App.setStatus = setStatus;
  App.loadStats = loadStats;
  App.saveStats = saveStats;
  App.updatePlayerPanel = updatePlayerPanel;
  App.loadName = loadName;
  App.saveName = saveName;
  App.clampRules = clampRules;
  App.applyRulesToInputs = applyRulesToInputs;
  App.readRulesFromInputs = readRulesFromInputs;
  App.onRulesChange = onRulesChange;
  App.renderLobby = renderLobby;
  App.updateConnectionStatus = updateConnectionStatus;
  App.onJoin = onJoin;

  // Stubs — populated by external modules (app-cheat.js, app-online.js)
  App.getInviteUrl = null;
  App.updateInviteLinkPreview = null;
  App.fetchServerInfo = null;
  App.handleAutoJoin = null;
  App.initOnline = null;

  // ── Cheat panel, profile sync, server info, invite link, online init ──
  // These are now in separate modules: app-cheat.js, app-online.js

})();
