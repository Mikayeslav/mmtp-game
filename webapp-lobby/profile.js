/**
 * MMtp — Profile Library
 * Centralised account/profile definitions: ranks, titles, avatars, badges,
 * stat helpers, and XP curves. Used by both lobby (app.js) and server.
 *
 * Usage (browser):
 *   <script src="profile.js"></script>
 *   // window.MMProfile is available
 *
 * Usage (Node):
 *   const MMProfile = require('./profile');
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();           // Node / CommonJS
  } else {
    root.MMProfile = factory();           // Browser global
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ════════════════════════════════════════════════════════════════
  // ── Default Stats (canonical shape) ──
  // ════════════════════════════════════════════════════════════════
  const DEFAULT_STATS = Object.freeze({
    level: 1,
    xp: 0,
    xpToNext: 100,
    wins: 0,
    losses: 0,
    draws: 0,
    rating: 1000,
    lastPlayed: null,
    winStreak: 0,
    bestWinStreak: 0,
    totalXpEarned: 0,
    gamesPlayed: 0,
  });

  // ════════════════════════════════════════════════════════════════
  // ── Default Profile (canonical shape) ──
  // ════════════════════════════════════════════════════════════════
  const DEFAULT_PROFILE = Object.freeze({
    name: '',
    avatar: '🃏',         // emoji avatar
    title: '',            // custom title (unlockable)
    bio: '',              // short bio (max 80 chars)
    favouriteOp: null,    // +, −, ×, ÷ — set after games
    stats: { ...DEFAULT_STATS },
    settings: {
      uiSize: 'normal',
      cardAnimations: true,
      targetHighlight: true,
      autoSortHand: false,
      showExpressionHint: true,
      soundEffects: true,
    },
    matchHistory: [],
    achievements: {},
    createdAt: null,
    updatedAt: null,
  });

  // ════════════════════════════════════════════════════════════════
  // ── Avatars ──
  // ════════════════════════════════════════════════════════════════
  /** Available avatar choices. id → { emoji, name, unlockReq } */
  const AVATARS = [
    // ── Free (always available) ──
    { id: 'joker',     emoji: '🃏', name: 'Joker',        req: null },
    { id: 'fox',       emoji: '🦊', name: 'Fox',          req: null },
    { id: 'cat',       emoji: '🐱', name: 'Cat',          req: null },
    { id: 'dog',       emoji: '🐶', name: 'Dog',          req: null },
    { id: 'panda',     emoji: '🐼', name: 'Panda',        req: null },
    { id: 'owl',       emoji: '🦉', name: 'Owl',          req: null },
    { id: 'robot',     emoji: '🤖', name: 'Robot',        req: null },
    { id: 'alien',     emoji: '👽', name: 'Alien',        req: null },
    { id: 'ghost',     emoji: '👻', name: 'Ghost',        req: null },
    { id: 'wizard',    emoji: '🧙', name: 'Wizard',       req: null },
    { id: 'ninja',     emoji: '🥷', name: 'Ninja',        req: null },
    { id: 'astronaut', emoji: '🧑‍🚀', name: 'Astronaut',  req: null },

    // ── Unlockable (achievement / level gated) ──
    { id: 'crown',     emoji: '👑', name: 'Crown',        req: { type: 'wins',   value: 10 } },
    { id: 'dragon',    emoji: '🐉', name: 'Dragon',       req: { type: 'level',  value: 10 } },
    { id: 'fire',      emoji: '🔥', name: 'Flame',        req: { type: 'streak', value: 5  } },
    { id: 'diamond',   emoji: '💎', name: 'Diamond',      req: { type: 'rating', value: 1300 } },
    { id: 'star',      emoji: '⭐', name: 'Star',         req: { type: 'games',  value: 50 } },
    { id: 'unicorn',   emoji: '🦄', name: 'Unicorn',      req: { type: 'rating', value: 1500 } },
    { id: 'trophy',    emoji: '🏆', name: 'Champion',     req: { type: 'wins',   value: 50 } },
    { id: 'rocket',    emoji: '🚀', name: 'Rocket',       req: { type: 'level',  value: 20 } },
  ];

  // ════════════════════════════════════════════════════════════════
  // ── Ranks  (rating-based tiers) ──
  // ════════════════════════════════════════════════════════════════
  const RANKS = [
    { id: 'bronze_3',   name: 'Bronze III',    minRating: 0,    icon: '🥉', color: '#cd7f32' },
    { id: 'bronze_2',   name: 'Bronze II',     minRating: 800,  icon: '🥉', color: '#cd7f32' },
    { id: 'bronze_1',   name: 'Bronze I',      minRating: 900,  icon: '🥉', color: '#cd7f32' },
    { id: 'silver_3',   name: 'Silver III',    minRating: 1000, icon: '🥈', color: '#c0c0c0' },
    { id: 'silver_2',   name: 'Silver II',     minRating: 1100, icon: '🥈', color: '#c0c0c0' },
    { id: 'silver_1',   name: 'Silver I',      minRating: 1200, icon: '🥈', color: '#c0c0c0' },
    { id: 'gold_3',     name: 'Gold III',      minRating: 1300, icon: '🥇', color: '#ffd700' },
    { id: 'gold_2',     name: 'Gold II',       minRating: 1400, icon: '🥇', color: '#ffd700' },
    { id: 'gold_1',     name: 'Gold I',        minRating: 1500, icon: '🥇', color: '#ffd700' },
    { id: 'platinum_3', name: 'Platinum III',  minRating: 1600, icon: '💠', color: '#00e5ff' },
    { id: 'platinum_2', name: 'Platinum II',   minRating: 1700, icon: '💠', color: '#00e5ff' },
    { id: 'platinum_1', name: 'Platinum I',    minRating: 1800, icon: '💠', color: '#00e5ff' },
    { id: 'diamond',    name: 'Diamond',       minRating: 1900, icon: '💎', color: '#b9f2ff' },
    { id: 'master',     name: 'Master',        minRating: 2100, icon: '👑', color: '#ff6f00' },
    { id: 'grandmaster',name: 'Grandmaster',   minRating: 2400, icon: '🏆', color: '#ff1744' },
  ];

  // ════════════════════════════════════════════════════════════════
  // ── Titles (unlockable display titles) ──
  // ════════════════════════════════════════════════════════════════
  const TITLES = [
    { id: 'newcomer',       label: 'Newcomer',         req: null },
    { id: 'card_player',    label: 'Card Player',      req: { type: 'games', value: 5 } },
    { id: 'strategist',     label: 'Strategist',       req: { type: 'wins',  value: 10 } },
    { id: 'math_whiz',      label: 'Math Whiz',        req: { type: 'level', value: 5 } },
    { id: 'number_cruncher',label: 'Number Cruncher',  req: { type: 'games', value: 25 } },
    { id: 'veteran',        label: 'Veteran',           req: { type: 'games', value: 50 } },
    { id: 'sharpshooter',   label: 'Sharpshooter',     req: { type: 'streak', value: 5 } },
    { id: 'calculator',     label: 'Human Calculator',  req: { type: 'level', value: 10 } },
    { id: 'unstoppable',    label: 'Unstoppable',       req: { type: 'streak', value: 10 } },
    { id: 'champion',       label: 'Champion',          req: { type: 'wins',  value: 50 } },
    { id: 'legend',         label: 'Legend',             req: { type: 'rating', value: 1500 } },
    { id: 'elite',          label: 'Elite',              req: { type: 'rating', value: 1800 } },
    { id: 'grandmaster',    label: 'Grandmaster',        req: { type: 'rating', value: 2100 } },
    { id: 'centurion',      label: 'Centurion',          req: { type: 'games', value: 100 } },
  ];

  // ════════════════════════════════════════════════════════════════
  // ── XP Curve ──
  // ════════════════════════════════════════════════════════════════
  /** XP needed to reach a given level. Slightly exponential. */
  function xpForLevel(level) {
    if (level <= 1) return 0;
    // 100, 120, 145, 175, 210, … grows ~20% per level
    return Math.round(100 * Math.pow(1.2, level - 2));
  }

  /** Given total XP earned, return { level, xp (current), xpToNext }. */
  function levelFromXp(totalXp) {
    let level = 1;
    let remaining = totalXp;
    while (true) {
      const needed = xpForLevel(level + 1);
      if (remaining < needed) {
        return { level, xp: remaining, xpToNext: needed };
      }
      remaining -= needed;
      level++;
      if (level > 999) break; // safety cap
    }
    return { level, xp: remaining, xpToNext: xpForLevel(level + 1) };
  }

  // ════════════════════════════════════════════════════════════════
  // ── Helpers ──
  // ════════════════════════════════════════════════════════════════

  /** Get rank object for a rating value. */
  function getRank(rating) {
    let rank = RANKS[0];
    for (const r of RANKS) {
      if (rating >= r.minRating) rank = r;
    }
    return rank;
  }

  /** Get rank progress toward next tier (0..1). */
  function getRankProgress(rating) {
    const rank = getRank(rating);
    const idx = RANKS.indexOf(rank);
    if (idx >= RANKS.length - 1) return 1; // already top
    const next = RANKS[idx + 1];
    const range = next.minRating - rank.minRating;
    return range > 0 ? Math.min(1, (rating - rank.minRating) / range) : 1;
  }

  /** Get all unlocked titles for given stats. */
  function getUnlockedTitles(stats) {
    return TITLES.filter(t => isUnlocked(t.req, stats));
  }

  /** Get all unlocked avatars for given stats. */
  function getUnlockedAvatars(stats) {
    return AVATARS.filter(a => isUnlocked(a.req, stats));
  }

  /** Check if a requirement is met. null req = always unlocked. */
  function isUnlocked(req, stats) {
    if (!req) return true;
    const s = stats || {};
    const games = (s.wins || 0) + (s.losses || 0) + (s.draws || 0);
    switch (req.type) {
      case 'wins':   return (s.wins || 0) >= req.value;
      case 'losses': return (s.losses || 0) >= req.value;
      case 'games':  return games >= req.value;
      case 'level':  return (s.level || 1) >= req.value;
      case 'rating': return (s.rating || 1000) >= req.value;
      case 'streak': return (s.bestWinStreak || 0) >= req.value;
      case 'xp':     return (s.totalXpEarned || s.xp || 0) >= req.value;
      default:       return false;
    }
  }

  /** Winrate percentage (0–100) or null if no games. */
  function winrate(stats) {
    const games = (stats.wins || 0) + (stats.losses || 0) + (stats.draws || 0);
    return games > 0 ? Math.round(100 * (stats.wins || 0) / games) : null;
  }

  /** Total games played. */
  function totalGames(stats) {
    return (stats.wins || 0) + (stats.losses || 0) + (stats.draws || 0);
  }

  /** Create a clean new profile with defaults merged. */
  function createProfile(overrides) {
    const now = Date.now();
    return {
      ...structuredClone(DEFAULT_PROFILE),
      ...overrides,
      stats: { ...DEFAULT_STATS, ...(overrides && overrides.stats) },
      settings: { ...DEFAULT_PROFILE.settings, ...(overrides && overrides.settings) },
      createdAt: now,
      updatedAt: now,
    };
  }

  /** Sanitise raw profile data — only keep allowed fields, clamp values. */
  function sanitize(data) {
    const clean = {};
    if (data.name && typeof data.name === 'string') {
      clean.name = data.name.trim().slice(0, 30);
    }
    if (data.avatar && typeof data.avatar === 'string') {
      // Must be a valid avatar id or emoji (max 10 chars for compound emoji)
      const validId = AVATARS.find(a => a.id === data.avatar || a.emoji === data.avatar);
      if (validId) clean.avatar = validId.emoji;
      else clean.avatar = data.avatar.slice(0, 10);
    }
    if (data.title && typeof data.title === 'string') {
      clean.title = data.title.slice(0, 30);
    }
    if (data.bio && typeof data.bio === 'string') {
      clean.bio = data.bio.slice(0, 80);
    }
    if (data.favouriteOp && typeof data.favouriteOp === 'string') {
      if (['+', '−', '×', '÷', '%', '^'].includes(data.favouriteOp)) {
        clean.favouriteOp = data.favouriteOp;
      }
    }
    if (data.stats && typeof data.stats === 'object') {
      clean.stats = {};
      for (const key of Object.keys(DEFAULT_STATS)) {
        if (key === 'lastPlayed') {
          clean.stats[key] = data.stats[key] ?? null;
        } else {
          clean.stats[key] = Number(data.stats[key]) || DEFAULT_STATS[key];
        }
      }
    }
    if (data.settings && typeof data.settings === 'object') {
      clean.settings = { ...DEFAULT_PROFILE.settings };
      if (typeof data.settings.uiSize === 'string') clean.settings.uiSize = data.settings.uiSize;
      for (const boolKey of ['cardAnimations', 'targetHighlight', 'autoSortHand', 'showExpressionHint', 'soundEffects']) {
        if (typeof data.settings[boolKey] === 'boolean') clean.settings[boolKey] = data.settings[boolKey];
      }
    }
    if (Array.isArray(data.matchHistory)) {
      clean.matchHistory = data.matchHistory.slice(-20);
    }
    if (data.achievements && typeof data.achievements === 'object') {
      clean.achievements = { ...data.achievements };
    }
    return clean;
  }

  /**
   * Build a "profile card" data object for display.
   * Combines stats into a neat summary for rendering.
   */
  function buildProfileCard(profile) {
    const stats = profile.stats || DEFAULT_STATS;
    const rank = getRank(stats.rating || 1000);
    const games = totalGames(stats);
    const wr = winrate(stats);
    const unlockedTitles = getUnlockedTitles(stats);
    const unlockedAvatars = getUnlockedAvatars(stats);
    const displayTitle = profile.title || (unlockedTitles.length > 0 ? unlockedTitles[unlockedTitles.length - 1].label : 'Newcomer');

    return {
      name: profile.name || 'Unknown',
      avatar: profile.avatar || '🃏',
      title: displayTitle,
      bio: profile.bio || '',
      rank: rank,
      rankProgress: getRankProgress(stats.rating || 1000),
      level: stats.level || 1,
      xp: stats.xp || 0,
      xpToNext: stats.xpToNext || 100,
      wins: stats.wins || 0,
      losses: stats.losses || 0,
      draws: stats.draws || 0,
      games: games,
      winrate: wr,
      rating: stats.rating || 1000,
      winStreak: stats.winStreak || 0,
      bestWinStreak: stats.bestWinStreak || 0,
      unlockedTitles,
      unlockedAvatars,
      favouriteOp: profile.favouriteOp || null,
    };
  }

  /**
   * Render a profile card as an HTML string.
   * Can be inserted into any container element.
   */
  function renderProfileCardHTML(profile) {
    const card = buildProfileCard(profile);
    const xpPct = card.xpToNext > 0 ? Math.min(100, Math.round(100 * card.xp / card.xpToNext)) : 0;
    const rankPct = Math.round(card.rankProgress * 100);
    const wrDisplay = card.winrate != null ? card.winrate + '%' : '—';

    return `
      <div class="profile-card">
        <div class="profile-card-header">
          <div class="profile-avatar" title="Avatar">${card.avatar}</div>
          <div class="profile-identity">
            <div class="profile-name">${escapeHtml(card.name)}</div>
            <div class="profile-title">${escapeHtml(card.title)}</div>
          </div>
          <div class="profile-rank-badge" style="color:${card.rank.color}" title="${card.rank.name}">
            <span class="rank-icon">${card.rank.icon}</span>
            <span class="rank-name">${card.rank.name}</span>
          </div>
        </div>
        ${card.bio ? `<div class="profile-bio">${escapeHtml(card.bio)}</div>` : ''}
        <div class="profile-card-bars">
          <div class="profile-bar-row">
            <span class="bar-label">Lv.${card.level}</span>
            <div class="profile-bar">
              <div class="profile-bar-fill xp-bar-fill" style="width:${xpPct}%"></div>
            </div>
            <span class="bar-value">${card.xp}/${card.xpToNext} XP</span>
          </div>
          <div class="profile-bar-row">
            <span class="bar-label">${card.rank.icon}</span>
            <div class="profile-bar">
              <div class="profile-bar-fill rank-bar-fill" style="width:${rankPct}%;background:${card.rank.color}"></div>
            </div>
            <span class="bar-value">${card.rating} SR</span>
          </div>
        </div>
        <div class="profile-card-stats">
          <div class="pcs-item"><span class="pcs-val">${card.wins}</span><span class="pcs-lbl">Wins</span></div>
          <div class="pcs-item"><span class="pcs-val">${card.losses}</span><span class="pcs-lbl">Losses</span></div>
          <div class="pcs-item"><span class="pcs-val">${card.draws}</span><span class="pcs-lbl">Draws</span></div>
          <div class="pcs-item"><span class="pcs-val">${wrDisplay}</span><span class="pcs-lbl">Winrate</span></div>
          <div class="pcs-item"><span class="pcs-val">${card.games}</span><span class="pcs-lbl">Games</span></div>
          <div class="pcs-item"><span class="pcs-val">${card.bestWinStreak}</span><span class="pcs-lbl">Best Streak</span></div>
        </div>
        ${card.favouriteOp ? `<div class="profile-fav-op" title="Favourite operator">${card.favouriteOp}</div>` : ''}
      </div>`;
  }

  /** Simple HTML escape. */
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ════════════════════════════════════════════════════════════════
  // ── Public API ──
  // ════════════════════════════════════════════════════════════════
  return Object.freeze({
    // Schema / defaults
    DEFAULT_STATS,
    DEFAULT_PROFILE,

    // Data tables
    AVATARS,
    RANKS,
    TITLES,

    // XP helpers
    xpForLevel,
    levelFromXp,

    // Rank helpers
    getRank,
    getRankProgress,

    // Unlock helpers
    isUnlocked,
    getUnlockedTitles,
    getUnlockedAvatars,

    // Stat helpers
    winrate,
    totalGames,

    // Profile CRUD
    createProfile,
    sanitize,

    // Display
    buildProfileCard,
    renderProfileCardHTML,
  });
});
