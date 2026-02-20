/**
 * MMtp — Player Profile Storage
 * Simple JSON-file-based profile system.
 * Each profile has a 6-char alphanumeric code that acts as the "account ID".
 *
 * Usage:
 *   const profiles = require('./profiles');
 *   profiles.save('ABC123', { name: 'Player', stats: {...}, settings: {...} });
 *   const data = profiles.load('ABC123');
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DB_PATH = path.join(__dirname, 'profiles.json');

// In-memory cache, persisted to disk
let db = {};

// Load from disk on startup
function loadDB() {
  try {
    if (fs.existsSync(DB_PATH)) {
      const raw = fs.readFileSync(DB_PATH, 'utf8');
      db = JSON.parse(raw);
      console.log(`[Profiles] Loaded ${Object.keys(db).length} profiles from disk`);
    }
  } catch (e) {
    console.warn('[Profiles] Could not load profiles.json:', e.message);
    db = {};
  }
}

// Save to disk
function saveDB() {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
  } catch (e) {
    console.warn('[Profiles] Could not save profiles.json:', e.message);
  }
}

// Generate a unique 6-char code (A-Z, 0-9)
function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/1/0 to avoid confusion
  let code;
  let attempts = 0;
  do {
    code = '';
    const bytes = crypto.randomBytes(6);
    for (let i = 0; i < 6; i++) {
      code += chars[bytes[i] % chars.length];
    }
    attempts++;
  } while (db[code] && attempts < 100);
  return code;
}

/**
 * Create a new profile and return its code.
 * @param {object} data - { name, stats, matchHistory, settings }
 * @returns {{ code: string }}
 */
function create(data) {
  const code = generateCode();
  db[code] = {
    ...sanitize(data),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  saveDB();
  return { code };
}

/**
 * Save/update an existing profile.
 * @param {string} code
 * @param {object} data - { name, stats, matchHistory, settings }
 * @returns {{ ok: boolean, error?: string }}
 */
function save(code, data) {
  code = (code || '').toUpperCase().trim();
  if (!code || code.length !== 6) return { ok: false, error: 'Invalid profile code' };
  if (!db[code]) return { ok: false, error: 'Profile not found. Use "Create New" first.' };
  
  db[code] = {
    ...db[code],
    ...sanitize(data),
    updatedAt: Date.now(),
  };
  saveDB();
  return { ok: true };
}

/**
 * Load a profile by code.
 * @param {string} code
 * @returns {{ ok: boolean, data?: object, error?: string }}
 */
function load(code) {
  code = (code || '').toUpperCase().trim();
  if (!code || code.length !== 6) return { ok: false, error: 'Invalid profile code' };
  if (!db[code]) return { ok: false, error: 'Profile not found' };

  // Update last accessed
  db[code].lastAccessed = Date.now();
  saveDB();

  return { ok: true, data: db[code] };
}

/**
 * Check if a profile code exists.
 */
function exists(code) {
  code = (code || '').toUpperCase().trim();
  return !!db[code];
}

/**
 * Sanitize incoming data — only keep allowed fields.
 */
function sanitize(data) {
  const clean = {};
  if (data.name && typeof data.name === 'string') {
    clean.name = data.name.slice(0, 30);
  }
  if (data.stats && typeof data.stats === 'object') {
    clean.stats = {
      level: Number(data.stats.level) || 1,
      xp: Number(data.stats.xp) || 0,
      xpToNext: Number(data.stats.xpToNext) || 100,
      wins: Number(data.stats.wins) || 0,
      losses: Number(data.stats.losses) || 0,
      draws: Number(data.stats.draws) || 0,
      rating: Number(data.stats.rating) || 1000,
      winStreak: Number(data.stats.winStreak) || 0,
      bestWinStreak: Number(data.stats.bestWinStreak) || 0,
    };
  }
  if (Array.isArray(data.matchHistory)) {
    // Keep last 20 matches max
    clean.matchHistory = data.matchHistory.slice(-20);
  }
  if (data.settings && typeof data.settings === 'object') {
    clean.settings = {
      uiSize: data.settings.uiSize || 'normal',
      cardAnimations: !!data.settings.cardAnimations,
      targetHighlight: !!data.settings.targetHighlight,
      autoSortHand: !!data.settings.autoSortHand,
      showExpressionHint: !!data.settings.showExpressionHint,
      soundEffects: !!data.settings.soundEffects,
    };
  }
  return clean;
}

// Initialize
loadDB();

module.exports = { create, save, load, exists, generateCode };
