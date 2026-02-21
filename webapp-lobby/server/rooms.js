/**
 * MMtp — Room Manager
 * Manages creation, joining, leaving, and listing of game rooms.
 */

const ROOM_EXPIRY_MS = 30 * 60 * 1000; // 30 minutes

class RoomManager {
  constructor() {
    /** @type {Map<string, Room>} roomCode -> Room */
    this.rooms = new Map();
  }

  /**
   * Generate a unique 4-digit room code (1000–9999).
   */
  generateCode() {
    let code;
    let attempts = 0;
    do {
      code = String(Math.floor(1000 + Math.random() * 9000));
      attempts++;
      if (attempts > 100) throw new Error('Cannot generate unique room code');
    } while (this.rooms.has(code));
    return code;
  }

  /**
   * Create a new room. Returns the Room object.
   * @param {string} hostSocketId
   * @param {string} hostName
   * @param {Object} rules
   */
  createRoom(hostSocketId, hostName, rules = {}, profile = {}) {
    const code = this.generateCode();
    const room = new Room(code, hostSocketId, hostName, rules, profile);
    this.rooms.set(code, room);
    console.log(`[Rooms] Created room ${code} by "${hostName}" (${hostSocketId})`);
    return room;
  }

  /**
   * Get a room by code.
   */
  getRoom(code) {
    return this.rooms.get(code) || null;
  }

  /**
   * Find which room a socket is in.
   */
  findRoomBySocket(socketId) {
    for (const [code, room] of this.rooms) {
      if (room.hasPlayer(socketId)) return room;
    }
    return null;
  }

  /**
   * Remove a room.
   */
  removeRoom(code) {
    this.rooms.delete(code);
    console.log(`[Rooms] Removed room ${code}`);
  }

  /**
   * Clean up expired rooms.
   */
  cleanup() {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      if (now - room.createdAt > ROOM_EXPIRY_MS && !room.gameStarted) {
        this.removeRoom(code);
      }
    }
  }

  /**
   * Get all active room codes.
   */
  listRooms() {
    return Array.from(this.rooms.entries()).map(([code, room]) => ({
      code,
      players: room.players.length,
      maxPlayers: room.maxPlayers,
      gameStarted: room.gameStarted,
    }));
  }

  /**
   * Detailed room list for admin monitoring.
   */
  listRoomsDetailed() {
    return Array.from(this.rooms.entries()).map(([code, room]) => ({
      code,
      createdAt: room.createdAt,
      gameStarted: room.gameStarted,
      rules: room.rules,
      players: room.players.map(p => ({
        playerId: p.playerId,
        name: p.name,
        ready: p.ready,
        isHost: p.isHost,
        connected: p.connected,
        avatar: p.avatar,
        title: p.title,
        rating: p.rating,
      })),
    }));
  }
}

class Room {
  constructor(code, hostSocketId, hostName, rules = {}, hostProfile = {}) {
    this.code = code;
    this.hostSocketId = hostSocketId;
    this.maxPlayers = 2;
    this.createdAt = Date.now();
    this.gameStarted = false;

    // Helper: coerce to number, falling back to def if NaN/null/undefined
    const num = (v, def) => { const n = Number(v); return Number.isFinite(n) ? n : def; };

    this.rules = {
      handSize: num(rules.handSize, 7),
      turnTimerSec: num(rules.timer, num(rules.turnTimerSec, 20)),
      targetMin: num(rules.targetMin, 1),
      targetMax: num(rules.targetMax, 10),
      winPoints: num(rules.winPoints, 5),
      operatorPrecedence: ['left-to-right', 'standard'].includes(rules.operatorPrecedence) ? rules.operatorPrecedence : 'left-to-right',
      allowNegative: !!rules.allowNegative,
      nearestScore: !!rules.nearestScore,
      nearestThreshold: num(rules.nearestThreshold, 2),
      rehandDrawCount: num(rules.rehandDrawCount, 5),
      minDrawPerClick: num(rules.minDrawPerClick, 1),
      maxDrawPerTurn: num(rules.maxDrawPerTurn, 0),
      handLimit: num(rules.handLimit, 12),
      deckNumberPct: num(rules.deckNumberPct, 63),
      deckOperatorPct: num(rules.deckOperatorPct, 30),
      deckSpecialPct: num(rules.deckSpecialPct, 7),
      allowBots: rules.allowBots || false,
      botDifficulty: rules.botDifficulty || 'medium',
      // QoL: operator & special card selection
      allowedOperators: rules.allowedOperators || undefined,
      allowedSpecials: rules.allowedSpecials || undefined,
      specialCards: rules.specialCards !== undefined ? rules.specialCards : true,
    };

    // Session tokens for reconnection (must init before addPlayer)
    this.sessionTokens = new Map(); // token -> socketId

    /** @type {Array<{socketId: string, name: string, ready: boolean, playerId: number, sessionToken: string}>} */
    this.players = [];
    this.addPlayer(hostSocketId, hostName, true, hostProfile); // Host is player 1
  }

  addPlayer(socketId, name, isHost = false, profile = {}) {
    if (this.players.length >= this.maxPlayers) return null;
    const playerId = this.players.length + 1;
    const sessionToken = this._generateToken();
    const player = {
      socketId,
      name: name || `Player${playerId}`,
      ready: false,
      playerId,
      isHost,
      sessionToken,
      connected: true,
      disconnectedAt: null,
      // Profile data visible to other players
      avatar: profile.avatar || '🃏',
      title: profile.title || 'Newcomer',
      rating: profile.rating || 1000,
      level: profile.level || 1,
    };
    this.players.push(player);
    this.sessionTokens.set(sessionToken, socketId);
    return player;
  }

  removePlayer(socketId) {
    const idx = this.players.findIndex(p => p.socketId === socketId);
    if (idx === -1) return null;
    const removed = this.players.splice(idx, 1)[0];
    // Remove session token
    for (const [token, sid] of this.sessionTokens) {
      if (sid === socketId) { this.sessionTokens.delete(token); break; }
    }
    return removed;
  }

  getPlayer(socketId) {
    return this.players.find(p => p.socketId === socketId) || null;
  }

  getPlayerById(playerId) {
    return this.players.find(p => p.playerId === playerId) || null;
  }

  hasPlayer(socketId) {
    return this.players.some(p => p.socketId === socketId);
  }

  isFull() {
    return this.players.length >= this.maxPlayers;
  }

  allReady() {
    return this.players.length === this.maxPlayers && this.players.every(p => p.ready);
  }

  isHost(socketId) {
    return this.hostSocketId === socketId;
  }

  setRules(rules) {
    Object.assign(this.rules, rules);
  }

  markDisconnected(socketId) {
    const player = this.getPlayer(socketId);
    if (player) {
      player.connected = false;
      player.disconnectedAt = Date.now();
    }
    return player;
  }

  reconnect(sessionToken, newSocketId) {
    // Find the player by session token
    for (const player of this.players) {
      if (player.sessionToken === sessionToken) {
        const oldSocketId = player.socketId;
        player.socketId = newSocketId;
        player.connected = true;
        player.disconnectedAt = null;
        this.sessionTokens.set(sessionToken, newSocketId);
        console.log(`[Room ${this.code}] Player "${player.name}" reconnected (${oldSocketId} -> ${newSocketId})`);
        return player;
      }
    }
    return null;
  }

  getPublicState() {
    return {
      code: this.code,
      players: this.players.map(p => ({
        playerId: p.playerId,
        name: p.name,
        ready: p.ready,
        isHost: p.isHost,
        connected: p.connected,
        avatar: p.avatar || '🃏',
        title: p.title || 'Newcomer',
        rating: p.rating || 1000,
        level: p.level || 1,
      })),
      rules: this.rules,
      gameStarted: this.gameStarted,
    };
  }

  _generateToken() {
    return 'tok-' + Math.random().toString(36).slice(2, 14) + Date.now().toString(36);
  }
}

module.exports = { RoomManager, Room };
