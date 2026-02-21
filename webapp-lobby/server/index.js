/**
 * MMtp — Multiplayer Server
 * Express static file server + Socket.io WebSocket for real-time multiplayer.
 *
 * Usage:
 *   node server/index.js              → LAN only (same WiFi)
 *   node server/index.js --public     → creates a public tunnel (any network)
 *
 * Env:
 *   PORT       → server port (default 3000)
 *   NODE_ENV   → 'production' for cloud deployment
 *
 * Serves ../webapp-lobby on http://localhost:3000
 */

const http = require('http');
const os = require('os');
const path = require('path');
const express = require('express');
const { Server } = require('socket.io');
const { RoomManager } = require('./rooms');
const { GameEngine } = require('./game-engine');
const profiles = require('./profiles');

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

/** Return the first non-internal IPv4 address (LAN IP). */
function getLanIPs() {
  const results = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        results.push(iface.address);
      }
    }
  }
  return results;
}

const PORT = parseInt(process.env.PORT, 10) || 3000;
const WANT_TUNNEL = !IS_PRODUCTION && (process.argv.includes('--public') || process.argv.includes('--tunnel'));
let tunnelUrl = null;   // Set when tunnel is active
let tunnelPassword = null; // localtunnel requires visitors to enter the host's public IP once

// ── Express ──
const app = express();
const server = http.createServer(app);

// Production: cache static assets; Dev: no-cache for fresh JS/CSS
if (IS_PRODUCTION) {
  app.use((req, res, next) => {
    if (req.path.match(/\.(png|jpg|svg|ico|woff2?)$/)) {
      // Images & fonts: cache 1 hour (rarely change)
      res.set('Cache-Control', 'public, max-age=3600');
    } else if (req.path.match(/\.(js|css)$/)) {
      // JS & CSS: always revalidate via ETag (no stale content after deploys)
      res.set('Cache-Control', 'no-cache');
    }
    next();
  });
} else {
  app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    next();
  });
}

// Trust proxy (for Render/Heroku behind reverse proxy)
if (IS_PRODUCTION) {
  app.set('trust proxy', 1);
}

// Serve the webapp-lobby static files
app.use(express.static(path.join(__dirname, '..'), {
  etag: IS_PRODUCTION,
  lastModified: IS_PRODUCTION,
}));

// Clean URL routes (/ already serves index.html via static)
app.get('/play', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'gameplay.html'));
});

// Health / info endpoint
app.get('/api/status', (req, res) => {
  res.json({
    ok: true,
    rooms: roomManager.listRooms(),
    uptime: process.uptime(),
  });
});

// Server info endpoint — returns LAN IPs + tunnel URL so clients can build invite links
app.get('/api/server-info', (req, res) => {
  const addresses = getLanIPs();
  const lanUrl = addresses.length ? `http://${addresses[0]}:${PORT}` : `http://localhost:${PORT}`;
  // Render sets RENDER_EXTERNAL_URL automatically (e.g. https://mmtp-server.onrender.com)
  const deployedUrl = process.env.RENDER_EXTERNAL_URL || null;
  res.json({
    port: PORT,
    addresses,
    // Primary URL: deployed URL > tunnel > LAN
    url: deployedUrl || tunnelUrl || lanUrl,
    lanUrl,
    tunnelUrl: tunnelUrl || null,
    tunnelPassword: tunnelPassword || null,
    deployedUrl,
  });
});

// ── Leaderboard API (public) ──
app.get('/api/leaderboard', (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
  res.json({ ok: true, leaderboard: profiles.leaderboard(limit) });
});

// ── Profile API ──
app.use(express.json()); // Parse JSON request bodies

// Create a new profile (returns code + pin)
app.post('/api/profile/create', (req, res) => {
  try {
    const { pin: chosenPin, ...profileData } = req.body;
    const result = profiles.create(profileData, chosenPin);
    res.json({ ok: true, code: result.code, pin: result.pin });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// Save profile (update existing)
app.post('/api/profile/save', (req, res) => {
  const { code, ...data } = req.body;
  const result = profiles.save(code, data);
  res.json(result);
});

// Load profile (no auth needed — returns data without pin)
app.get('/api/profile/load/:code', (req, res) => {
  const result = profiles.load(req.params.code);
  res.json(result);
});

// Login — verify code + pin, return full profile
app.post('/api/profile/login', (req, res) => {
  const { code, pin } = req.body;
  const result = profiles.login(code, pin);
  res.json(result);
});

// Lookup profiles by name (for account recovery)
app.get('/api/profile/lookup', (req, res) => {
  const name = req.query.name || '';
  const results = profiles.lookupByName(name);
  res.json({ ok: true, results });
});

// Check if profile exists
app.get('/api/profile/exists/:code', (req, res) => {
  res.json({ ok: true, exists: profiles.exists(req.params.code) });
});

// ══════════════════════════════════════════════════════════════
// ── Admin / Dev Monitor API ──
// ══════════════════════════════════════════════════════════════
const ADMIN_KEY = process.env.ADMIN_KEY || 'mmtp-dev-2026';

/** Simple admin auth middleware — checks ?key= query or X-Admin-Key header */
function requireAdmin(req, res, next) {
  const key = req.query.key || req.headers['x-admin-key'];
  if (key !== ADMIN_KEY) {
    return res.status(403).json({ ok: false, error: 'Unauthorized' });
  }
  next();
}

// Serve admin panel HTML
app.get('/admin', requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// Admin: server overview
app.get('/api/admin/status', requireAdmin, (req, res) => {
  res.json({
    ok: true,
    uptime: process.uptime(),
    rooms: roomManager.listRoomsDetailed(),
    activeGames: Array.from(activeGames.keys()),
    connectedSockets: io.engine.clientsCount,
    profileCount: profiles.listAll().length,
    memory: process.memoryUsage(),
    nodeVersion: process.version,
    env: IS_PRODUCTION ? 'production' : 'development',
  });
});

// Admin: list all profiles
app.get('/api/admin/profiles', requireAdmin, (req, res) => {
  res.json({ ok: true, profiles: profiles.listAll() });
});

// Admin: get single profile detail
app.get('/api/admin/profiles/:code', requireAdmin, (req, res) => {
  const result = profiles.load(req.params.code);
  res.json(result);
});

// Admin: update profile stats
app.post('/api/admin/profiles/:code/stats', requireAdmin, (req, res) => {
  const code = req.params.code.toUpperCase();
  const result = profiles.load(code);
  if (!result.ok) return res.json(result);
  const data = result.data;
  data.stats = { ...data.stats, ...req.body };
  const saveResult = profiles.save(code, data);
  res.json(saveResult);
});

// Admin: delete profile
app.delete('/api/admin/profiles/:code', requireAdmin, (req, res) => {
  const result = profiles.remove(req.params.code);
  res.json(result);
});

// Admin: list active rooms with detail
app.get('/api/admin/rooms', requireAdmin, (req, res) => {
  const rooms = roomManager.listRoomsDetailed();
  const gamesInfo = [];
  for (const [code, engine] of activeGames) {
    gamesInfo.push({
      code,
      gameOver: engine.gameOver || false,
      turnNumber: engine.turnNumber || 0,
      activePlayer: engine.activePlayer || null,
      target: engine.target || null,
      scores: engine.scores || {},
      winner: engine.winner || null,
      deckRemaining: engine.deck ? engine.deck.length : 0,
      elapsed: engine.startTime ? Math.floor((Date.now() - engine.startTime) / 1000) : 0,
      players: engine.room?.players?.map(p => ({
        playerId: p.playerId,
        name: p.name,
        handSize: engine.hands?.[p.playerId]?.length || 0,
        score: engine.scores?.[p.playerId] || 0,
      })) || [],
    });
  }
  res.json({ ok: true, rooms, games: gamesInfo });
});

// Admin: force-end a game in a room
app.post('/api/admin/rooms/:code/end', requireAdmin, (req, res) => {
  const engine = activeGames.get(req.params.code);
  if (!engine) return res.json({ ok: false, error: 'No active game in this room' });
  try {
    engine._endGame();
    activeGames.delete(req.params.code);
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// Admin: delete/close a room
app.delete('/api/admin/rooms/:code', requireAdmin, (req, res) => {
  const code = req.params.code;
  activeGames.delete(code);
  roomManager.removeRoom(code);
  res.json({ ok: true });
});

// ── Socket.io ──
const io = new Server(server, {
  cors: {
    origin: IS_PRODUCTION ? true : '*',   // In production, allow same-origin; dev: allow all
    methods: ['GET', 'POST'],
  },
  pingTimeout: 10000,
  pingInterval: 5000,
  // Allow both transports for cloud platforms that may not support WS upgrade
  transports: ['websocket', 'polling'],
});

const roomManager = new RoomManager();
/** @type {Map<string, GameEngine>} roomCode -> GameEngine */
const activeGames = new Map();

// Cleanup stale rooms every 5 minutes
setInterval(() => roomManager.cleanup(), 5 * 60 * 1000);

// Reconnection grace period (30s)
const RECONNECT_GRACE_MS = 30_000;

// ── Helpers ──
function broadcastToRoom(event, data, roomCode) {
  io.to(`room:${roomCode}`).emit(event, data);
}

function sendToSocket(socketId, event, data) {
  io.to(socketId).emit(event, data);
}

// ── Connection handler ──
io.on('connection', (socket) => {
  console.log(`[WS] Connected: ${socket.id}`);

  // ─── Lobby: Create Room ───
  socket.on('createRoom', ({ playerName, rules, profile }, callback) => {
    const cb = typeof callback === 'function' ? callback : () => {};
    try {
      // Leave any current room
      leaveCurrentRoom(socket);

      const room = roomManager.createRoom(socket.id, playerName, rules, profile);
      socket.join(`room:${room.code}`);
      console.log(`[ROOM] Created room ${room.code} by "${playerName}" (${socket.id})`);

      const me = room.getPlayer(socket.id);
      cb({
        ok: true,
        roomCode: room.code,
        sessionToken: me.sessionToken,
        room: room.getPublicState(),
      });
    } catch (err) {
      console.log(`[ROOM] Create failed: ${err.message} (${socket.id})`);
      cb({ ok: false, error: err.message });
    }
  });

  // ─── Lobby: Join Room ───
  socket.on('joinRoom', ({ roomCode, playerName, sessionToken, profile }, callback) => {
    const cb = typeof callback === 'function' ? callback : () => {};
    console.log(`[ROOM] Join attempt: code=${roomCode}, name="${playerName}", token=${sessionToken ? 'yes' : 'no'} (${socket.id})`);
    console.log(`[ROOM] Active rooms: [${roomManager.listRooms().map(r => r.code).join(', ')}]`);
    const room = roomManager.getRoom(roomCode);
    if (!room) {
      console.log(`[ROOM] Room ${roomCode} NOT FOUND`);
      return cb({ ok: false, error: 'Room not found' });
    }

    // Reconnection attempt?
    if (sessionToken) {
      const player = room.reconnect(sessionToken, socket.id);
      if (player) {
        socket.join(`room:${room.code}`);
        broadcastToRoom('lobbyUpdate', room.getPublicState(), room.code);

        // If game is active, send current game state
        const engine = activeGames.get(room.code);
        if (engine && room.gameStarted) {
          sendToSocket(socket.id, 'gameState', engine._buildStateFor(player.playerId));
        }

        return cb({
          ok: true,
          roomCode: room.code,
          sessionToken: player.sessionToken,
          room: room.getPublicState(),
          reconnected: true,
        });
      }
    }

    // Normal join
    if (room.isFull()) return cb({ ok: false, error: 'Room is full' });
    if (room.gameStarted) return cb({ ok: false, error: 'Game already in progress' });

    // Prevent same IP from being both players (multi-tab self-play)
    const joinerIP = socket.handshake.address;
    const hostPlayer = room.players.find(p => p.isHost && p.connected);
    if (hostPlayer) {
      const hostSocket = io.sockets.sockets.get(hostPlayer.socketId);
      if (hostSocket && hostSocket.handshake.address === joinerIP) {
        console.log(`[ROOM] Warning: Same IP joining own room ${roomCode} (${joinerIP}) — allowing but flagged`);
        // We allow it but send a warning (useful for testing, but discouraged)
      }
    }

    leaveCurrentRoom(socket);
    const player = room.addPlayer(socket.id, playerName, false, profile || {});
    if (!player) return cb({ ok: false, error: 'Could not join room' });

    socket.join(`room:${room.code}`);
    broadcastToRoom('lobbyUpdate', room.getPublicState(), room.code);

    cb({
      ok: true,
      roomCode: room.code,
      sessionToken: player.sessionToken,
      room: room.getPublicState(),
    });
  });

  // ─── Lobby: Set Ready ───
  socket.on('setReady', ({ ready }, callback) => {
    const cb = typeof callback === 'function' ? callback : () => {};
    const room = roomManager.findRoomBySocket(socket.id);
    if (!room) return cb({ ok: false, error: 'Not in a room' });

    const player = room.getPlayer(socket.id);
    if (!player) return cb({ ok: false, error: 'Player not found' });

    player.ready = !!ready;
    broadcastToRoom('lobbyUpdate', room.getPublicState(), room.code);
    cb({ ok: true });
  });

  // ─── Lobby: Update Rules (host only) ───
  socket.on('updateRules', ({ rules }, callback) => {
    const cb = typeof callback === 'function' ? callback : () => {};
    const room = roomManager.findRoomBySocket(socket.id);
    if (!room) return cb({ ok: false, error: 'Not in a room' });
    if (!room.isHost(socket.id)) return cb({ ok: false, error: 'Only host can change rules' });
    if (room.gameStarted) return cb({ ok: false, error: 'Game already started' });

    room.setRules(rules);
    broadcastToRoom('lobbyUpdate', room.getPublicState(), room.code);
    cb({ ok: true });
  });

  // ─── Lobby: Start Game (host only) ───
  socket.on('startGame', (_, callback) => {
    const cb = typeof callback === 'function' ? callback : () => {};
    const room = roomManager.findRoomBySocket(socket.id);
    if (!room) return cb({ ok: false, error: 'Not in a room' });
    if (!room.isHost(socket.id)) return cb({ ok: false, error: 'Only host can start' });
    if (!room.allReady()) return cb({ ok: false, error: 'All players must be ready' });
    if (room.gameStarted) return cb({ ok: false, error: 'Game already started' });

    room.gameStarted = true;
    const engine = new GameEngine(room, broadcastToRoom, sendToSocket);
    activeGames.set(room.code, engine);
    engine.start();

    broadcastToRoom('gameStarting', { roomCode: room.code }, room.code);
    cb({ ok: true });
  });

  // ─── Gameplay: Action ───
  socket.on('gameAction', ({ action, data }, callback) => {
    const cb = typeof callback === 'function' ? callback : () => {};
    const room = roomManager.findRoomBySocket(socket.id);
    if (!room) return cb({ ok: false, error: 'Not in a room' });

    const engine = activeGames.get(room.code);
    if (!engine) return cb({ ok: false, error: 'No active game' });

    const result = engine.handleAction(socket.id, action, data || {});
    cb(result);
  });

  // ─── Gameplay: Rematch ───
  socket.on('rematch', (_, callback) => {
    const cb = typeof callback === 'function' ? callback : () => {};
    const room = roomManager.findRoomBySocket(socket.id);
    if (!room) return cb({ ok: false, error: 'Not in a room' });

    const engine = activeGames.get(room.code);
    if (!engine) return cb({ ok: false, error: 'No active game' });
    if (!engine.gameOver) return cb({ ok: false, error: 'Game not over yet' });

    const player = room.getPlayer(socket.id);
    if (!player) return cb({ ok: false, error: 'Player not found' });

    // Track rematch requests per-room
    if (!room._rematchRequests) room._rematchRequests = new Set();
    room._rematchRequests.add(player.playerId);

    // Check if all connected players have requested rematch
    const connectedPlayers = room.players.filter(p => p.connected);
    const allReady = connectedPlayers.every(p => room._rematchRequests.has(p.playerId));

    if (connectedPlayers.length < 2) {
      // Opponent left — can't rematch
      room._rematchRequests.clear();
      return cb({ ok: false, error: 'Opponent has left — cannot rematch' });
    }

    if (!allReady) {
      // Notify opponent that this player wants to rematch
      broadcastToRoom('rematchRequested', {
        playerId: player.playerId,
        name: player.name,
        waiting: connectedPlayers.length - room._rematchRequests.size,
      }, room.code);
      return cb({ ok: true, waiting: true });
    }

    // Both players agreed — start rematch
    room._rematchRequests.clear();
    room.players.forEach(p => p.ready = false);
    engine.rematch();

    broadcastToRoom('rematch', { roomCode: room.code }, room.code);
    cb({ ok: true, started: true });
  });

  // ─── Lobby: Leave Room ───
  socket.on('leaveRoom', (_, callback) => {
    const cb = typeof callback === 'function' ? callback : () => {};
    leaveCurrentRoom(socket);
    cb({ ok: true });
  });

  // ─── Chat ───
  socket.on('chat', ({ message }) => {
    const room = roomManager.findRoomBySocket(socket.id);
    if (!room) return;
    const player = room.getPlayer(socket.id);
    if (!player) return;
    broadcastToRoom('chat', {
      playerId: player.playerId,
      name: player.name,
      message: String(message).slice(0, 200),
      timestamp: Date.now(),
    }, room.code);
  });

  // ─── Disconnect ───
  socket.on('disconnect', (reason) => {
    console.log(`[WS] Disconnected: ${socket.id} (${reason})`);
    const room = roomManager.findRoomBySocket(socket.id);
    if (!room) return;

    // Mark as disconnected (grace period for reconnection)
    room.markDisconnected(socket.id);
    broadcastToRoom('lobbyUpdate', room.getPublicState(), room.code);
    broadcastToRoom('playerDisconnected', {
      playerId: room.getPlayer(socket.id)?.playerId,
    }, room.code);

    // After grace period, fully remove if still disconnected
    setTimeout(() => {
      const player = room.getPlayer(socket.id);
      if (player && !player.connected) {
        console.log(`[WS] Grace period expired for ${socket.id} in room ${room.code}`);
        cleanupPlayerFromRoom(socket.id, room);
      }
    }, RECONNECT_GRACE_MS);
  });
});

// ── Leave / cleanup helpers ──
function leaveCurrentRoom(socket) {
  const room = roomManager.findRoomBySocket(socket.id);
  if (!room) return;
  socket.leave(`room:${room.code}`);
  cleanupPlayerFromRoom(socket.id, room);
}

function cleanupPlayerFromRoom(socketId, room) {
  const removed = room.removePlayer(socketId);
  if (!removed) return;

  console.log(`[WS] "${removed.name}" left room ${room.code}`);

  // If room is now empty, destroy it
  if (room.players.length === 0) {
    console.log(`[ROOM] Room ${room.code} is now empty — destroying`);
    const engine = activeGames.get(room.code);
    if (engine) { engine.destroy(); activeGames.delete(room.code); }
    roomManager.removeRoom(room.code);
    return;
  }

  // If the host left, promote next player
  if (removed.isHost && room.players.length > 0) {
    room.players[0].isHost = true;
    room.hostSocketId = room.players[0].socketId;
    console.log(`[WS] New host in room ${room.code}: "${room.players[0].name}"`);
  }

  // If game was active and a player left permanently, end the game
  const engine = activeGames.get(room.code);
  if (engine && room.gameStarted) {
    const remaining = room.players[0];
    engine._endGame(remaining.playerId);
    room.gameStarted = false;
    activeGames.delete(room.code);
  }

  broadcastToRoom('lobbyUpdate', room.getPublicState(), room.code);
  broadcastToRoom('playerLeft', { playerId: removed.playerId, name: removed.name }, room.code);
}

// ── Start ──
server.listen(PORT, '0.0.0.0', async () => {
  const lanIPs = getLanIPs();
  const mode = IS_PRODUCTION ? 'PRODUCTION' : 'DEVELOPMENT';
  console.log(`\n  ╔══════════════════════════════════════════╗`);
  console.log(`  ║  MMtp Server running on port ${String(PORT).padEnd(5)}        ║`);
  console.log(`  ║  Mode:    ${mode.padEnd(31)}║`);
  console.log(`  ║  Local:   http://localhost:${PORT}          ║`);
  if (!IS_PRODUCTION && lanIPs.length > 0) {
    lanIPs.forEach(ip => {
      const url = `http://${ip}:${PORT}`;
      const pad = ' '.repeat(Math.max(0, 30 - url.length));
      console.log(`  ║  Network: ${url}${pad}║`);
    });
  }
  console.log(`  ╚══════════════════════════════════════════╝\n`);

  // ── Public tunnel (--public flag) with auto-retry ──
  if (WANT_TUNNEL) {
    const localtunnel = require('localtunnel');
    let tunnelRetries = 0;
    const MAX_RETRIES = 10;
    const RETRY_DELAY = 5000; // 5 seconds

    async function openTunnel() {
      try {
        tunnelRetries++;
        console.log(`  ⏳ Opening public tunnel${tunnelRetries > 1 ? ` (attempt ${tunnelRetries})` : ''}...`);
        const tunnel = await localtunnel({ port: PORT });
        tunnelUrl = tunnel.url;
        tunnelRetries = 0; // Reset on success

        // Fetch the tunnel password (public IP of this machine)
        try {
          const https = require('https');
          tunnelPassword = await new Promise((resolve) => {
            https.get('https://loca.lt/mytunnelpassword', (res) => {
              let data = '';
              res.on('data', (chunk) => data += chunk);
              res.on('end', () => resolve(data.trim()));
            }).on('error', () => resolve(null));
          });
        } catch { tunnelPassword = null; }

        console.log(`\n  ╔══════════════════════════════════════════════════════╗`);
        console.log(`  ║  🌐 PUBLIC URL (share with anyone!):                 ║`);
        console.log(`  ║  ${tunnelUrl}`);
        if (tunnelPassword) {
          console.log(`  ║                                                      ║`);
          console.log(`  ║  ⚠ First-time visitors must enter this password:     ║`);
          console.log(`  ║    ${tunnelPassword}`);
        }
        console.log(`  ╚══════════════════════════════════════════════════════╝\n`);

        tunnel.on('close', () => {
          console.log('  ⚠ Tunnel closed unexpectedly.');
          tunnelUrl = null;
          tunnelPassword = null;
          if (tunnelRetries < MAX_RETRIES) {
            console.log(`  ↻ Auto-reconnecting in ${RETRY_DELAY / 1000}s...`);
            setTimeout(openTunnel, RETRY_DELAY);
          } else {
            console.log('  ✖ Max retries reached. Restart server to try again.');
          }
        });

        tunnel.on('error', (err) => {
          console.error('  ⚠ Tunnel error:', err.message);
        });
      } catch (err) {
        console.error('  ⚠ Could not open tunnel:', err.message);
        tunnelUrl = null;
        tunnelPassword = null;
        if (tunnelRetries < MAX_RETRIES) {
          console.log(`  ↻ Retrying in ${RETRY_DELAY / 1000}s... (attempt ${tunnelRetries}/${MAX_RETRIES})`);
          setTimeout(openTunnel, RETRY_DELAY);
        } else {
          console.log('  ✖ Max retries reached. Run: npm install localtunnel');
        }
      }
    }

    openTunnel();
  }
});
