/**
 * MMtp — Lobby Cheat Panel + Profile Sync (extracted from app.js)
 * Stat manipulation (XP, level, wins, losses, rating) and server profile
 * create/save/load via 6-character profile codes.
 * Depends on window.App namespace exposed by app.js.
 */
(function (App) {
  'use strict';
  if (!App) { console.error('[app-cheat] window.App not found'); return; }

  const $ = App.$;
  const STORAGE_STATS = App.STORAGE_STATS;
  const STORAGE_PROFILE_CODE = App.STORAGE_PROFILE_CODE;
  const state = App.state;
  const loadStats = App.loadStats;
  const saveStats = App.saveStats;
  const updatePlayerPanel = App.updatePlayerPanel;
  const setStatus = App.setStatus;
  const loadName = App.loadName;
  const saveName = App.saveName;
  const playerNameInput = App.dom.playerNameInput;

  // ══════════════════════════════════════════════════════════════
  // ── Cheat Panel (Stat Manipulation) ──
  // ══════════════════════════════════════════════════════════════

  const cheatPanel = $('cheat-panel');
  const btnCheatPanel = $('btn-cheat-panel');
  const btnCloseCheat = $('btn-close-cheat');

  if (cheatPanel && btnCheatPanel) {
    btnCheatPanel.addEventListener('click', () => {
      cheatPanel.classList.toggle('hidden');
    });
    if (btnCloseCheat) {
      btnCloseCheat.addEventListener('click', () => {
        cheatPanel.classList.add('hidden');
      });
    }
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

    // Stat manipulation
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
            const raw = localStorage.getItem(STORAGE_STATS);
            const stats = raw ? JSON.parse(raw) : { level: 1, xp: 0, xpToNext: 100 };
            stats.xp = (stats.xp || 0) + amount;
            while (stats.xp >= stats.xpToNext) {
              stats.xp -= stats.xpToNext;
              stats.level = (stats.level || 1) + 1;
              stats.xpToNext = Math.round((stats.xpToNext || 100) * 1.15);
            }
            localStorage.setItem(STORAGE_STATS, JSON.stringify(stats));
            loadStats();
            updatePlayerPanel();
            setStatus(`Added ${amount} XP`, 'success');
          } catch (e) {
            setStatus('Failed to add XP', 'error');
          }
        }
      });
    }

    if (cheatResetXP) {
      cheatResetXP.addEventListener('click', () => {
        try {
          const raw = localStorage.getItem(STORAGE_STATS);
          const stats = raw ? JSON.parse(raw) : { level: 1, xp: 0, xpToNext: 100 };
          stats.xp = 0;
          localStorage.setItem(STORAGE_STATS, JSON.stringify(stats));
          loadStats();
          updatePlayerPanel();
          setStatus('XP reset to 0', 'info');
        } catch (e) {
          setStatus('Failed to reset XP', 'error');
        }
      });
    }

    if (cheatApplyLevel && cheatSetLevel) {
      cheatApplyLevel.addEventListener('click', () => {
        const level = parseInt(cheatSetLevel.value) || 1;
        if (level >= 1) {
          try {
            const raw = localStorage.getItem(STORAGE_STATS);
            const stats = raw ? JSON.parse(raw) : { level: 1, xp: 0, xpToNext: 100 };
            stats.level = level;
            stats.xp = 0;
            stats.xpToNext = 100;
            for (let i = 1; i < level; i++) {
              stats.xpToNext = Math.round(stats.xpToNext * 1.15);
            }
            localStorage.setItem(STORAGE_STATS, JSON.stringify(stats));
            loadStats();
            updatePlayerPanel();
            setStatus(`Level set to ${level}`, 'success');
          } catch (e) {
            setStatus('Failed to set level', 'error');
          }
        }
      });
    }

    if (cheatLevelUp) {
      cheatLevelUp.addEventListener('click', () => {
        try {
          const raw = localStorage.getItem(STORAGE_STATS);
          const stats = raw ? JSON.parse(raw) : { level: 1, xp: 0, xpToNext: 100 };
          stats.level = (stats.level || 1) + 1;
          stats.xp = 0;
          stats.xpToNext = Math.round((stats.xpToNext || 100) * 1.15);
          localStorage.setItem(STORAGE_STATS, JSON.stringify(stats));
          loadStats();
          updatePlayerPanel();
          setStatus(`Level up to ${stats.level}`, 'success');
        } catch (e) {
          setStatus('Failed to level up', 'error');
        }
      });
    }

    if (cheatLevelDown) {
      cheatLevelDown.addEventListener('click', () => {
        try {
          const raw = localStorage.getItem(STORAGE_STATS);
          const stats = raw ? JSON.parse(raw) : { level: 1, xp: 0, xpToNext: 100 };
          if (stats.level > 1) {
            stats.level = stats.level - 1;
            stats.xp = 0;
            stats.xpToNext = 100;
            for (let i = 1; i < stats.level; i++) {
              stats.xpToNext = Math.round(stats.xpToNext * 1.15);
            }
            localStorage.setItem(STORAGE_STATS, JSON.stringify(stats));
            loadStats();
            updatePlayerPanel();
            setStatus(`Level down to ${stats.level}`, 'info');
          }
        } catch (e) {
          setStatus('Failed to level down', 'error');
        }
      });
    }

    if (cheatApplyWins && cheatAddWins) {
      cheatApplyWins.addEventListener('click', () => {
        const amount = parseInt(cheatAddWins.value) || 0;
        if (amount > 0) {
          try {
            const raw = localStorage.getItem(STORAGE_STATS);
            const stats = raw ? JSON.parse(raw) : { wins: 0 };
            stats.wins = (stats.wins || 0) + amount;
            localStorage.setItem(STORAGE_STATS, JSON.stringify(stats));
            loadStats();
            updatePlayerPanel();
            setStatus(`Added ${amount} win(s)`, 'success');
          } catch (e) {
            setStatus('Failed to add wins', 'error');
          }
        }
      });
    }

    if (cheatApplyLosses && cheatAddLosses) {
      cheatApplyLosses.addEventListener('click', () => {
        const amount = parseInt(cheatAddLosses.value) || 0;
        if (amount > 0) {
          try {
            const raw = localStorage.getItem(STORAGE_STATS);
            const stats = raw ? JSON.parse(raw) : { losses: 0 };
            stats.losses = (stats.losses || 0) + amount;
            localStorage.setItem(STORAGE_STATS, JSON.stringify(stats));
            loadStats();
            updatePlayerPanel();
            setStatus(`Added ${amount} loss(es)`, 'info');
          } catch (e) {
            setStatus('Failed to add losses', 'error');
          }
        }
      });
    }

    if (cheatApplyRating && cheatSetRating) {
      cheatApplyRating.addEventListener('click', () => {
        const rating = parseInt(cheatSetRating.value) || 1000;
        try {
          const raw = localStorage.getItem(STORAGE_STATS);
          const stats = raw ? JSON.parse(raw) : { rating: 1000 };
          stats.rating = rating;
          localStorage.setItem(STORAGE_STATS, JSON.stringify(stats));
          loadStats();
          updatePlayerPanel();
          setStatus(`Rating set to ${rating}`, 'success');
        } catch (e) {
          setStatus('Failed to set rating', 'error');
        }
      });
    }

    if (cheatRatingPlus) {
      cheatRatingPlus.addEventListener('click', () => {
        try {
          const raw = localStorage.getItem(STORAGE_STATS);
          const stats = raw ? JSON.parse(raw) : { rating: 1000 };
          stats.rating = (stats.rating || 1000) + 50;
          localStorage.setItem(STORAGE_STATS, JSON.stringify(stats));
          loadStats();
          updatePlayerPanel();
          setStatus(`Rating +50 (now ${stats.rating})`, 'success');
        } catch (e) {
          setStatus('Failed to update rating', 'error');
        }
      });
    }

    if (cheatRatingMinus) {
      cheatRatingMinus.addEventListener('click', () => {
        try {
          const raw = localStorage.getItem(STORAGE_STATS);
          const stats = raw ? JSON.parse(raw) : { rating: 1000 };
          stats.rating = Math.max(0, (stats.rating || 1000) - 50);
          localStorage.setItem(STORAGE_STATS, JSON.stringify(stats));
          loadStats();
          updatePlayerPanel();
          setStatus(`Rating -50 (now ${stats.rating})`, 'info');
        } catch (e) {
          setStatus('Failed to update rating', 'error');
        }
      });
    }

    if (cheatResetStats) {
      cheatResetStats.addEventListener('click', () => {
        if (confirm('Are you sure you want to reset ALL stats? This cannot be undone.')) {
          try {
            localStorage.setItem(STORAGE_STATS, JSON.stringify({
              level: 1, xp: 0, xpToNext: 100, wins: 0, losses: 0, draws: 0, rating: 1000, lastPlayed: null, winStreak: 0, bestWinStreak: 0
            }));
            loadStats();
            updatePlayerPanel();
            setStatus('All stats reset', 'success');
          } catch (e) {
            setStatus('Failed to reset stats', 'error');
          }
        }
      });
    }
  }

  // ══════════════════════════════════════════════════════════════
  // ── Profile Sync (save/load stats via server code) ──
  // ══════════════════════════════════════════════════════════════
  {
    const profileCodeInput = $('profile-code-input');
    const profileStatusEl = $('profile-status');
    const btnProfileCreate = $('btn-profile-create');
    const btnProfileSave = $('btn-profile-save');
    const btnProfileLoad = $('btn-profile-load');

    // Load saved profile code from localStorage
    const savedCode = localStorage.getItem(STORAGE_PROFILE_CODE) || '';
    if (profileCodeInput && savedCode) {
      profileCodeInput.value = savedCode;
    }

    function showProfileStatus(msg, type) {
      if (!profileStatusEl) return;
      profileStatusEl.textContent = msg;
      profileStatusEl.className = 'profile-status ' + type;
      profileStatusEl.classList.remove('hidden');
      clearTimeout(profileStatusEl._timer);
      profileStatusEl._timer = setTimeout(() => {
        profileStatusEl.classList.add('hidden');
      }, 5000);
    }

    /** Gather current profile data from localStorage / state. */
    function gatherProfileData() {
      const name = (playerNameInput && playerNameInput.value.trim()) || loadName();
      const matchHistory = JSON.parse(localStorage.getItem('mmtp-match-history') || '[]');
      return {
        name,
        avatar: localStorage.getItem(App.STORAGE_AVATAR || 'mmtp-player-avatar') || '🃏',
        title: localStorage.getItem(App.STORAGE_TITLE || 'mmtp-player-title') || '',
        bio: localStorage.getItem(App.STORAGE_BIO || 'mmtp-player-bio') || '',
        stats: { ...state.stats },
        matchHistory: matchHistory.slice(-20),
      };
    }

    /** Apply loaded profile data into localStorage + state. */
    function applyProfileData(data) {
      if (data.name) {
        saveName(data.name);
        if (playerNameInput) playerNameInput.value = data.name;
      }
      // Apply avatar, title, bio
      if (data.avatar) {
        localStorage.setItem(App.STORAGE_AVATAR || 'mmtp-player-avatar', data.avatar);
      }
      if (data.title) {
        localStorage.setItem(App.STORAGE_TITLE || 'mmtp-player-title', data.title);
      }
      if (typeof data.bio === 'string') {
        localStorage.setItem(App.STORAGE_BIO || 'mmtp-player-bio', data.bio);
        const bioInput = document.getElementById('profile-bio-input');
        if (bioInput) bioInput.value = data.bio;
      }
      if (data.stats) {
        state.stats = {
          level: data.stats.level ?? 1,
          xp: data.stats.xp ?? 0,
          xpToNext: data.stats.xpToNext ?? 100,
          wins: data.stats.wins ?? 0,
          losses: data.stats.losses ?? 0,
          draws: data.stats.draws ?? 0,
          rating: data.stats.rating ?? 1000,
          lastPlayed: data.stats.lastPlayed ?? null,
          winStreak: data.stats.winStreak ?? 0,
          bestWinStreak: data.stats.bestWinStreak ?? 0,
        };
        saveStats();
      }
      if (Array.isArray(data.matchHistory)) {
        try {
          localStorage.setItem('mmtp-match-history', JSON.stringify(data.matchHistory.slice(-20)));
        } catch (e) { /* ignore */ }
      }
      updatePlayerPanel();
    }

    // ── Create New Profile ──
    if (btnProfileCreate) {
      btnProfileCreate.addEventListener('click', async () => {
        try {
          btnProfileCreate.disabled = true;
          btnProfileCreate.textContent = '…';
          const data = gatherProfileData();
          const res = await fetch('/api/profile/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
          });
          const result = await res.json();
          if (result.ok && result.code) {
            localStorage.setItem(STORAGE_PROFILE_CODE, result.code);
            if (profileCodeInput) profileCodeInput.value = result.code;
            showProfileStatus(`Profile created! Your code: ${result.code} — remember it!`, 'success');
            if (window.SFX) SFX.play('score');
          } else {
            showProfileStatus(result.error || 'Failed to create profile', 'error');
          }
        } catch (e) {
          showProfileStatus('Server unreachable — try again later', 'error');
        } finally {
          btnProfileCreate.disabled = false;
          btnProfileCreate.textContent = 'New';
        }
      });
    }

    // ── Save Profile ──
    if (btnProfileSave) {
      btnProfileSave.addEventListener('click', async () => {
        const code = (profileCodeInput?.value || '').toUpperCase().trim();
        if (!code || code.length !== 6) {
          showProfileStatus('Enter your 6-character profile code first, or click "New"', 'error');
          if (profileCodeInput) profileCodeInput.focus();
          return;
        }
        try {
          btnProfileSave.disabled = true;
          btnProfileSave.textContent = '…';
          const data = gatherProfileData();
          const res = await fetch('/api/profile/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code, ...data }),
          });
          const result = await res.json();
          if (result.ok) {
            localStorage.setItem(STORAGE_PROFILE_CODE, code);
            showProfileStatus('Profile saved to server ✓', 'success');
            if (window.SFX) SFX.play('click');
          } else {
            showProfileStatus(result.error || 'Failed to save', 'error');
          }
        } catch (e) {
          showProfileStatus('Server unreachable — try again later', 'error');
        } finally {
          btnProfileSave.disabled = false;
          btnProfileSave.textContent = 'Save';
        }
      });
    }

    // ── Load Profile ──
    if (btnProfileLoad) {
      btnProfileLoad.addEventListener('click', async () => {
        const code = (profileCodeInput?.value || '').toUpperCase().trim();
        if (!code || code.length !== 6) {
          showProfileStatus('Enter your 6-character profile code first', 'error');
          if (profileCodeInput) profileCodeInput.focus();
          return;
        }
        try {
          btnProfileLoad.disabled = true;
          btnProfileLoad.textContent = '…';
          const res = await fetch(`/api/profile/load/${encodeURIComponent(code)}`);
          const result = await res.json();
          if (result.ok && result.data) {
            applyProfileData(result.data);
            localStorage.setItem(STORAGE_PROFILE_CODE, code);
            if (profileCodeInput) profileCodeInput.value = code;
            showProfileStatus(`Profile loaded! Welcome back, ${result.data.name || 'Player'}`, 'success');
            if (window.SFX) SFX.play('score');
          } else {
            showProfileStatus(result.error || 'Profile not found', 'error');
          }
        } catch (e) {
          showProfileStatus('Server unreachable — try again later', 'error');
        } finally {
          btnProfileLoad.disabled = false;
          btnProfileLoad.textContent = 'Load';
        }
      });
    }

    // Auto-uppercase the code input
    if (profileCodeInput) {
      profileCodeInput.addEventListener('input', () => {
        profileCodeInput.value = profileCodeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
      });
    }
  }

})(window.App);
