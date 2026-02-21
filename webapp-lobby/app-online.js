/**
 * MMtp — Server Info, Invite Links & Online WebSocket Lobby (extracted from app.js)
 * Handles fetching server info (LAN/tunnel URLs), invite link generation,
 * QR code display, auto-join from URL params, and WebSocket lobby events.
 * Depends on window.App namespace exposed by app.js.
 */
(function (App) {
  'use strict';
  if (!App) { console.error('[app-online] window.App not found'); return; }

  const $ = App.$;
  const state = App.state;
  const DEFAULTS = App.DEFAULTS;
  const STORAGE_LAST_RULES = App.STORAGE_LAST_RULES;
  const setStatus = App.setStatus;
  const loadName = App.loadName;
  const saveStats = App.saveStats;
  const clampRules = App.clampRules;
  const applyRulesToInputs = App.applyRulesToInputs;
  const renderLobby = App.renderLobby;
  const updateConnectionStatus = App.updateConnectionStatus;
  const onJoin = App.onJoin;

  // DOM elements from App namespace
  const playerNameInput = App.dom.playerNameInput;
  const joinRoomCode = App.dom.joinRoomCode;
  const tunnelPasswordHint = App.dom.tunnelPasswordHint;
  const shareSection = App.dom.shareSection;
  const inviteLinkPreview = App.dom.inviteLinkPreview;
  const qrCodeEl = App.dom.qrCodeEl;

  // ══════════════════════════════════════════════════════════════
  // ── Server Info / Invite Link helpers ──
  // ══════════════════════════════════════════════════════════════

  /** Fetch LAN IPs from the server and display in UI. */
  async function fetchServerInfo() {
    try {
      const res = await fetch('/api/server-info');
      if (!res.ok) return;
      const info = await res.json();

      // Determine the best shareable URL:
      // - If server reports a deployedUrl (Render sets RENDER_EXTERNAL_URL), use that
      // - If on a deployed domain (not localhost/LAN), always use window.location.origin
      // - If a tunnel URL is available, prefer that
      // - Otherwise fall back to LAN URL
      const isDeployed = !window.location.hostname.match(/^(localhost|127\.|192\.168\.|10\.)/);
      if (info.deployedUrl) {
        App.serverLanUrl = info.deployedUrl;
      } else if (isDeployed) {
        App.serverLanUrl = window.location.origin;
      } else {
        App.serverLanUrl = info.tunnelUrl || info.url || window.location.origin;
      }
      console.log('[Lobby] Server URL:', App.serverLanUrl, isDeployed ? '(deployed)' : '(local)');


      // Show tunnel password hint if present
      if (tunnelPasswordHint) {
        if (info.tunnelPassword && info.tunnelUrl && !isDeployed) {
          const strongEl = tunnelPasswordHint.querySelector('strong');
          if (strongEl) strongEl.textContent = info.tunnelPassword;
          tunnelPasswordHint.classList.remove('hidden');
        } else {
          tunnelPasswordHint.classList.add('hidden');
        }
      }
    } catch (e) {
      console.warn('[Lobby] Could not fetch server info:', e);
      App.serverLanUrl = window.location.origin;
    }
  }

  /** Build an invite URL for the current room. */
  function getInviteUrl() {
    const base = App.serverLanUrl || window.location.origin;
    if (!state.roomCode) return base;
    return `${base}/?join=${state.roomCode}`;
  }

  /** Update the share section (invite link + QR code) under the room code. */
  function updateInviteLinkPreview() {
    const hasRoom = state.isHost && state.roomCode && (App.serverLanUrl || App.onlineMode);
    if (shareSection) {
      if (hasRoom) {
        const url = getInviteUrl();
        if (inviteLinkPreview) inviteLinkPreview.textContent = url;
        // Generate QR code
        if (qrCodeEl && window.QR) {
          try {
            qrCodeEl.innerHTML = QR.toSVG(url, { size: 200, margin: 1 });
          } catch (e) {
            console.warn('[QR] Failed to generate:', e);
            qrCodeEl.innerHTML = '';
          }
        }
        shareSection.classList.remove('hidden');
      } else {
        shareSection.classList.add('hidden');
      }
    }
  }

  /** Check URL for ?join=XXXX and auto-join. */
  function handleAutoJoin() {
    const params = new URLSearchParams(window.location.search);
    const joinCode = params.get('join');
    if (!joinCode || !/^\d{4}$/.test(joinCode)) return;

    // Clean the URL (remove ?join=...) without reloading
    const cleanUrl = window.location.pathname;
    window.history.replaceState({}, '', cleanUrl);

    console.log('[Lobby] Auto-joining room from invite link:', joinCode);

    // Pre-fill the room code
    if (joinRoomCode) joinRoomCode.value = joinCode;

    // Wait a tick for the UI to settle, then trigger join
    setTimeout(() => {
      const name = (playerNameInput && playerNameInput.value.trim()) || loadName();
      if (!name) {
        setStatus('Enter your name first, then click Join!', 'warning');
        if (playerNameInput) playerNameInput.focus();
        return;
      }
      onJoin();
    }, 300);
  }

  // ══════════════════════════════════════════════════════════════
  // ── WebSocket Connection + Event Listeners ──
  // ══════════════════════════════════════════════════════════════

  function initOnline() {
    if (!window.MMtpNet) {
      console.log('[Lobby] MMtpNet not available — local mode only');
      updateConnectionStatus(false);
      return;
    }

    MMtpNet.connect().then((ok) => {
      App.onlineMode = ok;
      updateConnectionStatus(ok);
      if (ok) {
        console.log('[Lobby] WebSocket connected — online mode');
        // Fetch LAN IP info so we can show shareable URLs
        fetchServerInfo();
        // Auto-join from URL ?join=XXXX
        handleAutoJoin();
      } else {
        console.log('[Lobby] Server unreachable — local mode (bot only)');
      }
    });

    // ── Server → UI event handlers ──
    MMtpNet.on('lobbyUpdate', (roomState) => {
      if (!state.isOnlineRoom) return;
      // Update local state from server
      state.players = (roomState.players || []).map(p => ({
        tabId: p.isHost ? (state.isHost ? App.tabId : 'remote-host') : (!state.isHost ? App.tabId : 'remote-' + p.playerId),
        name: p.name,
        ready: p.ready,
        isHost: p.isHost,
        playerId: p.playerId,
        connected: p.connected,
        avatar: p.avatar || '🃏',
        title: p.title || '',
        rating: p.rating || 1000,
      }));
      state.rules = clampRules(roomState.rules || DEFAULTS);
      state.roomCode = roomState.code;
      applyRulesToInputs();
      renderLobby();
    });

    MMtpNet.on('gameStarting', (data) => {
      if (!state.isOnlineRoom) return;
      state.stats.lastPlayed = Date.now();
      saveStats();
      // Save rules for restoration
      try {
        localStorage.setItem(STORAGE_LAST_RULES, JSON.stringify(state.rules));
      } catch (e) { /* ignore */ }
      // Navigate to gameplay with online flag
      const rulesEncoded = encodeURIComponent(JSON.stringify(state.rules));
      const role = state.isHost ? 'host' : 'client';
      const roomCode = state.roomCode || data.roomCode || '';
      window.location.href = `/play?rules=${rulesEncoded}&role=${role}&room=${roomCode}&online=1`;
    });

    MMtpNet.on('playerLeft', (data) => {
      if (!state.isOnlineRoom) return;
      setStatus(`${data.name || 'Player'} left the room`, 'warning');
    });

    MMtpNet.on('playerDisconnected', (data) => {
      if (!state.isOnlineRoom) return;
      setStatus('A player disconnected — waiting for reconnect…', 'warning');
    });

    MMtpNet.on('disconnected', () => {
      updateConnectionStatus(false);
      if (App.onlineMode) {
        setStatus('Disconnected from server — reconnecting…', 'warning');
      }
    });

    MMtpNet.on('connected', () => {
      App.onlineMode = true;
      updateConnectionStatus(true);
    });
  }

  // Register on App namespace
  App.fetchServerInfo = fetchServerInfo;
  App.getInviteUrl = getInviteUrl;
  App.updateInviteLinkPreview = updateInviteLinkPreview;
  App.handleAutoJoin = handleAutoJoin;
  App.initOnline = initOnline;

  // Auto-initialize online connection
  initOnline();

})(window.App);
