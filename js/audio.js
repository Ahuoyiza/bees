/* =========================================================
   BEES — audio.js
   All sound is generated live with the Web Audio API, so the
   project needs no audio files. It has two parts:
   - Cozy ambience: soft chord pad, a gentle music-box melody,
     a far-away bee hum and the odd bird chirp.
   - Sound effects: catch, sting, level up and game over.
   Browsers only allow audio after a user gesture, so
   BeeAudio.start() is called from the "Start" button.
   ========================================================= */

const BeeAudio = (() => {
  let ctx = null;          // the AudioContext
  let master = null;       // master volume (used for mute)
  let musicBus = null;     // everything ambient goes through here
  let sfxBus = null;       // sound effects go through here
  let echo = null;         // small echo for the melody
  let muted = false;
  const timers = [];       // setTimeout/setInterval ids so we can stop loops

  // Musical building blocks (frequencies in Hz)
  const NOTE = {
    C3: 130.81, E3: 164.81, F3: 174.61, G3: 196.0, A3: 220.0, B3: 246.94,
    C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.0, A4: 440.0,
    C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99, A5: 880.0,
  };

  // A slow, warm chord progression: Cmaj7 → Am7 → Fmaj7 → G6
  const CHORDS = [
    [NOTE.C3, NOTE.E4, NOTE.G4, NOTE.B3],
    [NOTE.A3, NOTE.C4, NOTE.E4, NOTE.G4],
    [NOTE.F3, NOTE.A3, NOTE.C4, NOTE.E4],
    [NOTE.G3, NOTE.B3, NOTE.D4, NOTE.E4],
  ];

  // Pentatonic notes always sound nice together, perfect for random melodies
  const MELODY_NOTES = [NOTE.C5, NOTE.D5, NOTE.E5, NOTE.G5, NOTE.A5];

  /* ---------- Setup: create the audio graph once ---------- */
  function init() {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return false; // very old browser: play silently

    ctx = new AudioCtx();

    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.9;
    master.connect(ctx.destination);

    musicBus = ctx.createGain();
    musicBus.gain.value = 0.55;
    musicBus.connect(master);

    sfxBus = ctx.createGain();
    sfxBus.gain.value = 0.7;
    sfxBus.connect(master);

    // Echo: delay → feedback loop → back into the music bus
    echo = ctx.createDelay();
    echo.delayTime.value = 0.38;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.32;
    echo.connect(feedback);
    feedback.connect(echo);
    echo.connect(musicBus);

    return true;
  }

  /* ---------- Helper: play one enveloped tone ---------- */
  function tone({
    freq,
    endFreq = null,      // optional pitch slide
    type = 'sine',
    start = ctx.currentTime,
    attack = 0.01,
    duration = 0.3,
    volume = 0.2,
    destination = sfxBus,
  }) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, start + duration);

    // Envelope: fade in quickly, fade out smoothly (no clicks)
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    osc.connect(gain);
    gain.connect(destination);
    osc.start(start);
    osc.stop(start + duration + 0.05);
    return gain;
  }

  /* ---------- Ambience pieces ---------- */

  // Soft pad: plays each chord with long fade in/out, through a warm low-pass filter
  function startPad() {
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900;
    filter.connect(musicBus);

    let index = 0;
    const playChord = () => {
      const now = ctx.currentTime;
      CHORDS[index].forEach((freq) => {
        tone({ freq, type: 'triangle', start: now, attack: 1.8, duration: 5.5, volume: 0.035, destination: filter });
      });
      index = (index + 1) % CHORDS.length;
    };

    playChord();
    timers.push(setInterval(playChord, 4500));
  }

  // Music-box melody: random pentatonic notes at a relaxed, uneven pace
  function startMelody() {
    const playNote = () => {
      const freq = MELODY_NOTES[Math.floor(Math.random() * MELODY_NOTES.length)];
      const gain = tone({ freq, type: 'sine', attack: 0.01, duration: 1.4, volume: 0.05, destination: musicBus });
      gain.connect(echo); // also send to the echo for a dreamy tail
      timers.push(setTimeout(playNote, 500 + Math.random() * 1200));
    };
    timers.push(setTimeout(playNote, 1500));
  }

  // Distant bee hum: a filtered buzzy oscillator whose volume gently pulses
  function startHum() {
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 210;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;

    const gain = ctx.createGain();
    gain.gain.value = 0.012;

    // LFO (low frequency oscillator) wobbles the volume like wings flapping
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.35;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 0.009;
    lfo.connect(lfoDepth);
    lfoDepth.connect(gain.gain);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(musicBus);
    osc.start();
    lfo.start();
  }

  // Bird chirps: a couple of quick high pitch-slides every so often
  function startBirds() {
    const chirp = () => {
      const now = ctx.currentTime;
      const count = 2 + Math.floor(Math.random() * 3);
      for (let i = 0; i < count; i++) {
        const base = 2400 + Math.random() * 900;
        tone({ freq: base, endFreq: base * 1.35, start: now + i * 0.13, duration: 0.09, volume: 0.018, destination: musicBus });
      }
      timers.push(setTimeout(chirp, 6000 + Math.random() * 9000));
    };
    timers.push(setTimeout(chirp, 4000));
  }

  /* ---------- Public API ---------- */
  return {
    // Start the ambience (safe to call more than once)
    start() {
      if (ctx) {
        if (ctx.state === 'suspended') ctx.resume();
        return;
      }
      if (!init()) return;
      startPad();
      startMelody();
      startHum();
      startBirds();
    },

    // Mute / unmute with a short fade
    setMuted(value) {
      muted = value;
      if (!ctx) return;
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setTargetAtTime(muted ? 0 : 0.9, ctx.currentTime, 0.1);
    },

    isMuted() {
      return muted;
    },

    // Pause/resume audio when the tab is hidden or shown
    suspend() { if (ctx) ctx.suspend(); },
    resume() { if (ctx) ctx.resume(); },

    // Sound effects
    catch() {
      if (!ctx) return;
      const now = ctx.currentTime;
      tone({ freq: NOTE.E5, type: 'triangle', start: now, duration: 0.15, volume: 0.25 });
      tone({ freq: NOTE.A5, type: 'triangle', start: now + 0.08, duration: 0.25, volume: 0.22 });
    },

    swish() {
      if (!ctx) return;
      tone({ freq: 500, endFreq: 260, type: 'sine', duration: 0.12, volume: 0.06 });
    },

    warn() {
      if (!ctx) return;
      tone({ freq: 320, endFreq: 360, type: 'sawtooth', duration: 0.35, volume: 0.05 });
    },

    sting() {
      if (!ctx) return;
      const now = ctx.currentTime;
      tone({ freq: 880, endFreq: 140, type: 'square', start: now, duration: 0.3, volume: 0.12 });
      tone({ freq: 90, type: 'sine', start: now, duration: 0.25, volume: 0.3 });
    },

    levelUp() {
      if (!ctx) return;
      const now = ctx.currentTime;
      [NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C5 * 2].forEach((freq, i) => {
        tone({ freq, type: 'triangle', start: now + i * 0.12, duration: 0.4, volume: 0.2 });
      });
    },

    gameOver() {
      if (!ctx) return;
      const now = ctx.currentTime;
      [NOTE.G4, NOTE.E4, NOTE.C4, NOTE.G3].forEach((freq, i) => {
        tone({ freq, type: 'triangle', start: now + i * 0.22, duration: 0.5, volume: 0.18 });
      });
    },
  };
})();
