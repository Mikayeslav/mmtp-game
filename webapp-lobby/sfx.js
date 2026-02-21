/**
 * MMtp — Sound Effects Module (Web Audio API)
 * All sounds are generated procedurally — no audio files needed.
 *
 * Usage:
 *   SFX.play('cardPlace');
 *   SFX.setEnabled(true/false);
 */
const SFX = (() => {
  let ctx = null;
  let enabled = false;
  let volume = 0.35;

  function getCtx() {
    if (!ctx) {
      try {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
      } catch (e) {
        console.warn('[SFX] Web Audio API not supported');
        return null;
      }
    }
    // Resume if suspended (browser autoplay policy)
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function setEnabled(v) { enabled = !!v; }
  function isEnabled() { return enabled; }
  function setVolume(v) { volume = Math.max(0, Math.min(1, v)); }

  // ── Utility helpers ──

  function osc(ac, type, freq, startTime, duration, gainVal, detune) {
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = type;
    o.frequency.value = freq;
    if (detune) o.detune.value = detune;
    g.gain.setValueAtTime(gainVal * volume, startTime);
    g.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
    o.connect(g).connect(ac.destination);
    o.start(startTime);
    o.stop(startTime + duration);
  }

  function noise(ac, startTime, duration, gainVal) {
    const bufferSize = ac.sampleRate * duration;
    const buffer = ac.createBuffer(1, bufferSize, ac.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    const src = ac.createBufferSource();
    src.buffer = buffer;
    const g = ac.createGain();
    g.gain.setValueAtTime(gainVal * volume, startTime);
    g.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

    // Bandpass filter for softer noise
    const filter = ac.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1000;
    filter.Q.value = 0.5;

    src.connect(filter).connect(g).connect(ac.destination);
    src.start(startTime);
    src.stop(startTime + duration);
  }

  // ── Sound definitions ──

  const sounds = {
    // Card selected — soft click
    cardSelect() {
      const ac = getCtx(); if (!ac) return;
      const t = ac.currentTime;
      osc(ac, 'sine', 800, t, 0.06, 0.3);
      osc(ac, 'sine', 1200, t + 0.01, 0.04, 0.15);
    },

    // Card placed on playfield — satisfying snap
    cardPlace() {
      const ac = getCtx(); if (!ac) return;
      const t = ac.currentTime;
      osc(ac, 'triangle', 440, t, 0.08, 0.35);
      osc(ac, 'sine', 660, t + 0.02, 0.06, 0.2);
      noise(ac, t, 0.04, 0.15);
    },

    // Card drawn from deck — whoosh
    cardDraw() {
      const ac = getCtx(); if (!ac) return;
      const t = ac.currentTime;
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(300, t);
      o.frequency.exponentialRampToValueAtTime(600, t + 0.1);
      g.gain.setValueAtTime(0.2 * volume, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
      o.connect(g).connect(ac.destination);
      o.start(t); o.stop(t + 0.12);
      noise(ac, t, 0.06, 0.1);
    },

    // Discard card — soft thud
    cardDiscard() {
      const ac = getCtx(); if (!ac) return;
      const t = ac.currentTime;
      osc(ac, 'sine', 200, t, 0.1, 0.25);
      noise(ac, t, 0.05, 0.12);
    },

    // Score! Expression matches target — triumphant ding
    score() {
      const ac = getCtx(); if (!ac) return;
      const t = ac.currentTime;
      osc(ac, 'sine', 523, t, 0.15, 0.4);       // C5
      osc(ac, 'sine', 659, t + 0.08, 0.15, 0.35); // E5
      osc(ac, 'sine', 784, t + 0.16, 0.25, 0.4);  // G5
      osc(ac, 'triangle', 1047, t + 0.24, 0.3, 0.2); // C6
    },

    // Miss — expression doesn't match — buzzy thud
    miss() {
      const ac = getCtx(); if (!ac) return;
      const t = ac.currentTime;
      osc(ac, 'sawtooth', 150, t, 0.15, 0.2);
      osc(ac, 'square', 100, t + 0.02, 0.12, 0.1);
      noise(ac, t, 0.08, 0.15);
    },

    // Turn change — gentle chime
    turnChange() {
      const ac = getCtx(); if (!ac) return;
      const t = ac.currentTime;
      osc(ac, 'sine', 880, t, 0.1, 0.2);
      osc(ac, 'sine', 1100, t + 0.08, 0.15, 0.15);
    },

    // Timer warning (< 10s) — tick
    timerTick() {
      const ac = getCtx(); if (!ac) return;
      const t = ac.currentTime;
      osc(ac, 'sine', 1000, t, 0.03, 0.15);
    },

    // Timer critical (< 5s) — urgent tick
    timerUrgent() {
      const ac = getCtx(); if (!ac) return;
      const t = ac.currentTime;
      osc(ac, 'square', 800, t, 0.04, 0.2);
      osc(ac, 'square', 1000, t + 0.05, 0.03, 0.15);
    },

    // Game win — fanfare
    gameWin() {
      const ac = getCtx(); if (!ac) return;
      const t = ac.currentTime;
      osc(ac, 'sine', 523, t, 0.2, 0.35);          // C5
      osc(ac, 'sine', 659, t + 0.15, 0.2, 0.35);   // E5
      osc(ac, 'sine', 784, t + 0.3, 0.2, 0.35);    // G5
      osc(ac, 'sine', 1047, t + 0.45, 0.4, 0.4);   // C6
      osc(ac, 'triangle', 1047, t + 0.45, 0.5, 0.15); // shimmer
      osc(ac, 'sine', 1319, t + 0.6, 0.4, 0.25);   // E6
    },

    // Game lose — descending sad tone
    gameLose() {
      const ac = getCtx(); if (!ac) return;
      const t = ac.currentTime;
      osc(ac, 'sine', 440, t, 0.25, 0.3);       // A4
      osc(ac, 'sine', 370, t + 0.2, 0.25, 0.25); // F#4
      osc(ac, 'sine', 330, t + 0.4, 0.35, 0.2);  // E4
      osc(ac, 'sine', 262, t + 0.6, 0.5, 0.2);   // C4
    },

    // Game draw — neutral
    gameDraw() {
      const ac = getCtx(); if (!ac) return;
      const t = ac.currentTime;
      osc(ac, 'sine', 440, t, 0.2, 0.25);
      osc(ac, 'sine', 440, t + 0.25, 0.3, 0.2);
    },

    // Button click — subtle pop
    click() {
      const ac = getCtx(); if (!ac) return;
      const t = ac.currentTime;
      osc(ac, 'sine', 600, t, 0.04, 0.15);
    },

    // Undo — reverse swoosh
    undo() {
      const ac = getCtx(); if (!ac) return;
      const t = ac.currentTime;
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(600, t);
      o.frequency.exponentialRampToValueAtTime(300, t + 0.1);
      g.gain.setValueAtTime(0.2 * volume, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
      o.connect(g).connect(ac.destination);
      o.start(t); o.stop(t + 0.12);
    },

    // Deck reshuffle — shuffling cards sound
    reshuffle() {
      const ac = getCtx(); if (!ac) return;
      const t = ac.currentTime;
      for (let i = 0; i < 6; i++) {
        noise(ac, t + i * 0.04, 0.06, 0.12 + i * 0.02);
      }
      osc(ac, 'triangle', 300, t + 0.2, 0.15, 0.15);
    },

    // XP gain — sparkle
    xpGain() {
      const ac = getCtx(); if (!ac) return;
      const t = ac.currentTime;
      osc(ac, 'sine', 1200, t, 0.08, 0.15);
      osc(ac, 'sine', 1500, t + 0.06, 0.08, 0.12);
      osc(ac, 'sine', 1800, t + 0.12, 0.1, 0.1);
    },

    // Level up / achievement — ascending triumphant arpeggio
    levelUp() {
      const ac = getCtx(); if (!ac) return;
      const t = ac.currentTime;
      osc(ac, 'sine', 523, t, 0.12, 0.3);          // C5
      osc(ac, 'sine', 659, t + 0.1, 0.12, 0.3);    // E5
      osc(ac, 'sine', 784, t + 0.2, 0.12, 0.3);    // G5
      osc(ac, 'sine', 1047, t + 0.3, 0.2, 0.35);   // C6
      osc(ac, 'triangle', 1319, t + 0.4, 0.3, 0.2); // E6 shimmer
      osc(ac, 'sine', 1568, t + 0.5, 0.35, 0.15);  // G6
    },

    // Rehand — shuffling scatter sound
    rehand() {
      const ac = getCtx(); if (!ac) return;
      const t = ac.currentTime;
      // Quick scatter noise
      for (let i = 0; i < 4; i++) {
        noise(ac, t + i * 0.05, 0.08, 0.15 - i * 0.02);
      }
      // Descending tone (cards leaving)
      osc(ac, 'sine', 500, t, 0.12, 0.2);
      osc(ac, 'sine', 350, t + 0.1, 0.12, 0.15);
      // Pause then ascending tone (new cards arriving)
      osc(ac, 'sine', 400, t + 0.35, 0.1, 0.2);
      osc(ac, 'sine', 600, t + 0.45, 0.1, 0.2);
      osc(ac, 'sine', 800, t + 0.55, 0.15, 0.15);
    },

    // Opponent disconnected — warning tone
    disconnect() {
      const ac = getCtx(); if (!ac) return;
      const t = ac.currentTime;
      osc(ac, 'sine', 440, t, 0.15, 0.25);
      osc(ac, 'sine', 370, t + 0.15, 0.2, 0.2);
      osc(ac, 'square', 330, t + 0.35, 0.25, 0.1);
    },

    // Reconnected — hopeful ascending
    reconnected() {
      const ac = getCtx(); if (!ac) return;
      const t = ac.currentTime;
      osc(ac, 'sine', 440, t, 0.1, 0.2);
      osc(ac, 'sine', 554, t + 0.1, 0.1, 0.2);
      osc(ac, 'sine', 659, t + 0.2, 0.15, 0.25);
    },

    // Chat message received — soft notification
    chatMessage() {
      const ac = getCtx(); if (!ac) return;
      const t = ac.currentTime;
      osc(ac, 'sine', 900, t, 0.05, 0.12);
      osc(ac, 'sine', 1100, t + 0.04, 0.06, 0.1);
    },
  };

  // ── Public API ──

  function play(name) {
    if (!enabled) return;
    if (sounds[name]) {
      try { sounds[name](); } catch (e) { /* ignore audio errors */ }
    }
  }

  return { play, setEnabled, isEnabled, setVolume };
})();

// Auto-load setting from localStorage
// Default to enabled if user hasn't explicitly set a preference
if (typeof localStorage !== 'undefined') {
  const pref = localStorage.getItem('mmtp-sound-effects');
  if (pref === null) {
    // First visit: enable by default
    SFX.setEnabled(true);
    localStorage.setItem('mmtp-sound-effects', 'true');
  } else {
    SFX.setEnabled(pref === 'true');
  }
}
