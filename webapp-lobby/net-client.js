/**
 * MMtp — Network Client
 * Socket.io wrapper for lobby + gameplay multiplayer.
 * Exposes window.MMtpNet for use by app.js and gameplay.js.
 *
 * Usage:
 *   MMtpNet.connect()        → connect to server
 *   MMtpNet.createRoom(...)  → host a room
 *   MMtpNet.joinRoom(...)    → join a room
 *   MMtpNet.setReady(...)    → toggle ready
 *   MMtpNet.startGame()      → host starts game
 *   MMtpNet.gameAction(...)  → send game action
 *   MMtpNet.on(event, fn)    → subscribe to server events
 *   MMtpNet.off(event, fn)   → unsubscribe
 *   MMtpNet.isConnected      → boolean
 *   MMtpNet.isOnline         → true if server is reachable
 */

(function () {
  'use strict';

  const SESSION_TOKEN_KEY = 'mmtp-session-token';
  const ROOM_CODE_KEY = 'mmtp-ws-room-code';

  let socket = null;
  let connected = false;
  let serverAvailable = false;
  let sessionToken = null;
  let currentRoomCode = null;

  // Event listeners (simple pub/sub)
  const listeners = {};
  // Buffer for events that arrive before any handler is registered.
  // Critical for gameState which the server sends during reconnection —
  // it can arrive before gameplay-online.js registers its handler.
  const eventBuffer = {};

  function emit(event, ...args) {
    const fns = listeners[event];
    if (fns && fns.length > 0) {
      fns.forEach(fn => { try { fn(...args); } catch (e) { console.error(`[MMtpNet] listener error on ${event}:`, e); } });
    } else {
      // No handler yet — buffer this event for replay when a handler is registered
      if (!eventBuffer[event]) eventBuffer[event] = [];
      eventBuffer[event].push(args);
      // Keep buffer small (only last event matters for most cases)
      if (eventBuffer[event].length > 5) eventBuffer[event].shift();
    }
  }

  /**
   * Try to connect to the server.
   * @param {string} [url] - Server URL (defaults to current origin)
   * @returns {Promise<boolean>} - true if connected
   */
  function connect(url) {
    return new Promise((resolve) => {
      if (socket && connected) {
        resolve(true);
        return;
      }

      // Check if Socket.io is loaded
      if (typeof io === 'undefined') {
        console.warn('[MMtpNet] Socket.io not loaded — offline mode');
        serverAvailable = false;
        resolve(false);
        return;
      }

      // If opened via file:// protocol, origin is useless — fall back to localhost
      let serverUrl = url || window.location.origin;
      if (!serverUrl || serverUrl === 'null' || serverUrl === 'file://' || window.location.protocol === 'file:') {
        serverUrl = 'http://localhost:3000';
        console.warn('[MMtpNet] Opened via file:// — falling back to', serverUrl);
        console.warn('[MMtpNet] For best experience, open http://localhost:3000 in your browser');
      }
      console.log(`[MMtpNet] Connecting to ${serverUrl}...`);

      try {
        socket = io(serverUrl, {
          reconnection: true,
          reconnectionAttempts: 5,
          reconnectionDelay: 1000,
          timeout: 5000,
          transports: ['websocket', 'polling'],
        });
      } catch (e) {
        console.warn('[MMtpNet] Failed to create socket:', e);
        serverAvailable = false;
        resolve(false);
        return;
      }

      const timeout = setTimeout(() => {
        console.warn('[MMtpNet] Connection timeout');
        serverAvailable = false;
        resolve(false);
      }, 6000);

      socket.on('connect', () => {
        clearTimeout(timeout);
        connected = true;
        serverAvailable = true;
        console.log('[MMtpNet] Connected:', socket.id);
        emit('connected');

        // Auto-reconnect to room if we have a session token
        const savedToken = sessionStorage.getItem(SESSION_TOKEN_KEY);
        const savedRoom = sessionStorage.getItem(ROOM_CODE_KEY);
        if (savedToken && savedRoom) {
          sessionToken = savedToken;
          currentRoomCode = savedRoom;
          // Try silent reconnect
          socket.emit('joinRoom', {
            roomCode: savedRoom,
            playerName: '',
            sessionToken: savedToken,
          }, (res) => {
            if (res.ok && res.reconnected) {
              console.log('[MMtpNet] Reconnected to room', savedRoom);
              emit('reconnected', res);
            }
          });
        }

        resolve(true);
      });

      socket.on('disconnect', (reason) => {
        connected = false;
        console.log('[MMtpNet] Disconnected:', reason);
        emit('disconnected', reason);
      });

      socket.on('connect_error', (err) => {
        console.warn('[MMtpNet] Connection error:', err.message);
        // Don't resolve here — let the timeout handle final failure.
        // The socket may still connect via a fallback transport (polling).
      });

      // ── Server events → local pub/sub ──
      const serverEvents = [
        'lobbyUpdate',
        'gameStarting',
        'gameState',
        'turnChanged',
        'timerUpdate',
        'scored',
        'scoreMiss',
        'gameOver',
        'rematch',
        'rematchRequested',
        'deckReshuffled',
        'targetRerolled',
        'doubleActivated',
        'doubleDeactivated',
        'peekRevealed',
        'peekUsed',
        'cardSwapped',
        'playerDisconnected',
        'playerLeft',
        'chat',
      ];
      serverEvents.forEach(evt => {
        socket.on(evt, (data) => emit(evt, data));
      });
    });
  }

  /**
   * Create (host) a room.
   */
  function createRoom(playerName, rules, profile) {
    return new Promise((resolve) => {
      if (!socket || !connected) return resolve({ ok: false, error: 'Not connected' });
      socket.emit('createRoom', { playerName, rules, profile }, (res) => {
        if (res.ok) {
          sessionToken = res.sessionToken;
          currentRoomCode = res.roomCode;
          sessionStorage.setItem(SESSION_TOKEN_KEY, sessionToken);
          sessionStorage.setItem(ROOM_CODE_KEY, currentRoomCode);
        }
        resolve(res);
      });
    });
  }

  /**
   * Join a room by code.
   */
  function joinRoom(roomCode, playerName, profile) {
    return new Promise((resolve) => {
      if (!socket || !connected) return resolve({ ok: false, error: 'Not connected' });
      socket.emit('joinRoom', { roomCode, playerName, profile }, (res) => {
        if (res.ok) {
          sessionToken = res.sessionToken;
          currentRoomCode = res.roomCode;
          sessionStorage.setItem(SESSION_TOKEN_KEY, sessionToken);
          sessionStorage.setItem(ROOM_CODE_KEY, currentRoomCode);
        }
        resolve(res);
      });
    });
  }

  /**
   * Set ready state.
   */
  function setReady(ready) {
    return new Promise((resolve) => {
      if (!socket || !connected) return resolve({ ok: false, error: 'Not connected' });
      socket.emit('setReady', { ready }, (res) => resolve(res));
    });
  }

  /**
   * Update rules (host only).
   */
  function updateRules(rules) {
    return new Promise((resolve) => {
      if (!socket || !connected) return resolve({ ok: false, error: 'Not connected' });
      socket.emit('updateRules', { rules }, (res) => resolve(res));
    });
  }

  /**
   * Start the game (host only).
   */
  function startGame() {
    return new Promise((resolve) => {
      if (!socket || !connected) return resolve({ ok: false, error: 'Not connected' });
      socket.emit('startGame', {}, (res) => resolve(res));
    });
  }

  /**
   * Send a game action.
   */
  function gameAction(action, data) {
    return new Promise((resolve) => {
      if (!socket || !connected) return resolve({ ok: false, error: 'Not connected' });
      socket.emit('gameAction', { action, data: data || {} }, (res) => resolve(res));
    });
  }

  /**
   * Request rematch.
   */
  function requestRematch() {
    return new Promise((resolve) => {
      if (!socket || !connected) return resolve({ ok: false, error: 'Not connected' });
      socket.emit('rematch', {}, (res) => resolve(res));
    });
  }

  /**
   * Leave the room.
   */
  function leaveRoom() {
    return new Promise((resolve) => {
      if (!socket || !connected) return resolve({ ok: false, error: 'Not connected' });
      sessionStorage.removeItem(SESSION_TOKEN_KEY);
      sessionStorage.removeItem(ROOM_CODE_KEY);
      sessionToken = null;
      currentRoomCode = null;
      socket.emit('leaveRoom', {}, (res) => resolve(res));
    });
  }

  /**
   * Send chat message.
   */
  function sendChat(message) {
    if (!socket || !connected) return;
    socket.emit('chat', { message });
  }

  /**
   * Subscribe to an event.
   */
  function on(event, fn) {
    if (!listeners[event]) listeners[event] = [];
    listeners[event].push(fn);
    // Replay any buffered events that arrived before this handler was registered
    if (eventBuffer[event] && eventBuffer[event].length > 0) {
      console.log(`[MMtpNet] Replaying ${eventBuffer[event].length} buffered ${event} event(s)`);
      const buffered = eventBuffer[event];
      delete eventBuffer[event];
      buffered.forEach(args => { try { fn(...args); } catch (e) { console.error(`[MMtpNet] replay error on ${event}:`, e); } });
    }
  }

  /**
   * Unsubscribe from an event.
   */
  function off(event, fn) {
    if (!listeners[event]) return;
    if (!fn) { listeners[event] = []; return; }
    listeners[event] = listeners[event].filter(f => f !== fn);
  }

  /**
   * Disconnect from server.
   */
  function disconnect() {
    if (socket) {
      socket.disconnect();
      socket = null;
    }
    connected = false;
    sessionToken = null;
    currentRoomCode = null;
  }

  // Expose global
  window.MMtpNet = {
    connect,
    createRoom,
    joinRoom,
    setReady,
    updateRules,
    startGame,
    gameAction,
    requestRematch,
    leaveRoom,
    sendChat,
    on,
    off,
    disconnect,
    get isConnected() { return connected; },
    get isOnline() { return serverAvailable && connected; },
    get roomCode() { return currentRoomCode; },
    get sessionToken() { return sessionToken; },
  };
})();
