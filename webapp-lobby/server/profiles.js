/**
 * MMtp — Player Profile Storage
 * Simple JSON-file-based profile system.
 * Each profile has a 6-char alphanumeric code that acts as the "account ID".
 * Uses the shared MMProfile library for schema & sanitisation.
 *
 * Usage:
 *   const profiles = require('./profiles');
 *   profiles.save('ABC123', { name: 'Player', avatar: '🦊', stats: {...}, settings: {...} });
 *   const data = profiles.load('ABC123');
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const MMProfile = require('../profile');

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
 * @param {object} data - { name, avatar, title, bio, stats, matchHistory, settings }
 * @returns {{ code: string }}
 */
function create(data) {
  const code = generateCode();
  db[code] = {
    ...MMProfile.sanitize(data || {}),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  saveDB();
  return { code };
}

/**
 * Save/update an existing profile.
 * @param {string} code
 * @param {object} data - { name, avatar, title, bio, stats, matchHistory, settings }
 * @returns {{ ok: boolean, error?: string }}
 */
function save(code, data) {
  code = (code || '').toUpperCase().trim();
  if (!code || code.length !== 6) return { ok: false, error: 'Invalid profile code' };
  if (!db[code]) return { ok: false, error: 'Profile not found. Use "Create New" first.' };
  
  db[code] = {
    ...db[code],
    ...MMProfile.sanitize(data),
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
 * List all profiles (admin). Returns array of { code, name, avatar, stats, updatedAt }.
 */
function listAll() {
  return Object.entries(db).map(([code, data]) => ({
    code,
    name: data.name || 'Unknown',
    avatar: data.avatar || '🃏',
    title: data.title || '',
    stats: data.stats || {},
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    lastAccessed: data.lastAccessed,
  }));
}

/**
 * Delete a profile (admin).
 */
function remove(code) {
  code = (code || '').toUpperCase().trim();
  if (!db[code]) return { ok: false, error: 'Profile not found' };
  delete db[code];
  saveDB();
  return { ok: true };
}

// Initialize
loadDB();

/**
 * Get leaderboard: top players sorted by rating, then by wins.
 * @param {number} limit - max entries (default 50)
 * @returns {Array<{ rank, code, name, avatar, title, rating, level, wins, losses, draws, winrate, games }>}
 */
function leaderboard(limit = 50) {
  const entries = Object.entries(db)
    .map(([code, data]) => {
      const s = data.stats || {};
      const games = (s.wins || 0) + (s.losses || 0) + (s.draws || 0);
      return {
        code,
        name: data.name || 'Unknown',
        avatar: data.avatar || '🃏',
        title: data.title || '',
        rating: s.rating || 1000,
        level: s.level || 1,
        wins: s.wins || 0,
        losses: s.losses || 0,
        draws: s.draws || 0,
        games,
        winrate: games > 0 ? Math.round(100 * (s.wins || 0) / games) : null,
        bestWinStreak: s.bestWinStreak || 0,
      };
    })
    // Only include players who have played at least 1 game
    .filter(e => e.games > 0)
    .sort((a, b) => {
      if (b.rating !== a.rating) return b.rating - a.rating;
      if (b.wins !== a.wins) return b.wins - a.wins;
      return b.games - a.games;
    })
    .slice(0, limit);

  // Add rank position
  entries.forEach((e, i) => { e.rank = i + 1; });
  return entries;
}

module.exports = { create, save, load, exists, generateCode, listAll, remove, leaderboard };
