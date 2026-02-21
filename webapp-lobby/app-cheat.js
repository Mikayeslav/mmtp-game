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
  // ── Dev Mode Gate ──
  // ══════════════════════════════════════════════════════════════
  // Cheats button is hidden by default. It is shown when:
  // 1. ?dev=1 or ?dev=mmtp-dev-2026 is in URL → sets localStorage flag
  // 2. localStorage 'mmtp-dev-mode' is set
  // 3. Ctrl+Shift+C keyboard shortcut (always works, but only opens panel)
  const DEV_STORAGE_KEY = 'mmtp-dev-mode';
  function checkDevMode() {
    // URL param check
    const params = new URLSearchParams(window.location.search);
    const devParam = params.get('dev');
    if (devParam === '1' || devParam === 'mmtp-dev-2026') {
      localStorage.setItem(DEV_STORAGE_KEY, '1');
      // Clean the URL
      params.delete('dev');
      const cleanUrl = window.location.pathname + (params.toString() ? '?' + params.toString() : '');
      window.history.replaceState({}, '', cleanUrl);
    }
    return localStorage.getItem(DEV_STORAGE_KEY) === '1';
  }
  const isDevMode = checkDevMode();

  // ══════════════════════════════════════════════════════════════
  // ── Cheat Panel (Stat Manipulation) ──
  // ══════════════════════════════════════════════════════════════

  const cheatPanel = $('cheat-panel');
  const btnCheatPanel = $('btn-cheat-panel');
  const btnCloseCheat = $('btn-close-cheat');

  // Show cheat button only in dev mode
  if (btnCheatPanel && isDevMode) {
    btnCheatPanel.classList.remove('hidden');
  }

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

    // Keyboard shortcut — also enables dev mode if not already
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'C') {
        e.preventDefault();
        localStorage.setItem(DEV_STORAGE_KEY, '1');
        if (btnCheatPanel) btnCheatPanel.classList.remove('hidden');
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
  // ── Profile Sync (now handled by app.js account system) ──
  // ══════════════════════════════════════════════════════════════
  // Keep backward compat: sync hidden code input
  {
    const profileCodeInput = $('profile-code-input');
    const savedCode = localStorage.getItem(STORAGE_PROFILE_CODE) || '';
    if (profileCodeInput && savedCode) {
      profileCodeInput.value = savedCode;
    }
  }

})(window.App);
