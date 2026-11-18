// Port Solano — WebAudio synthesized SFX + procedural music. No audio files.
//
// Everything is oscillators and filtered noise. All methods no-op safely when
// the AudioContext is unavailable (or before the first user gesture unlocks
// it). main.js calls audio.init() from a user gesture (start button /
// first keypress) and assigns state.audio = audio.
//
// Music: five radio stations (RADIO_STATIONS in config.js), each with its
// own bpm / scale / waveform — the 16-step scheduler below reads the
// current station, so switching stations changes what actually plays, not
// just the label. N cycles stations (one listener, installed once by init,
// like M); M toggles music on/off. Station 0 (Solano FM) is the default.
import { RADIO_DJ_LINES, RADIO_STATIONS } from './config.js';

export const audio = {
  ctx: null,
  enabled: true,
  musicOn: true,
  stationIndex: 0,
  stationChangedAt: 0,
  _master: null,
  _sfx: null,
  _music: null,
  _engineOsc: null,
  _engineGain: null,
  _engineFilter: null,
  _sirenOsc: null,
  _sirenLfo: null,
  _sirenGain: null,
  _musicTimer: null,
  _nextStepTime: 0,
  _step: 0,
  _mBound: false,

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume?.().catch(() => {});
      return;
    }
    try {
      const AC = typeof window !== 'undefined'
        ? window.AudioContext || window.webkitAudioContext
        : null;
      if (!AC) return;
      this.ctx = new AC();
      this._master = this.ctx.createGain();
      this._master.gain.value = 0.9;
      this._master.connect(this.ctx.destination);
      this._sfx = this.ctx.createGain();
      this._sfx.gain.value = 0.9;
      this._sfx.connect(this._master);
      this._music = this.ctx.createGain();
      this._music.gain.value = 0.32;
      this._music.connect(this._master);
    } catch {
      // No context at all (headless / denied): every method below
      // no-ops on `!this.ctx`, so the game runs silent, never throws.
      this.ctx = null;
      this._master = this._sfx = this._music = null;
      return;
    }
    // Subsystems start in ISOLATION: one failing (a constructor that
    // throws on a particular browser, an oscillator that will not start)
    // must not take the others down. The old init ran everything in a
    // single try, so a failing engine start killed SFX and music too.
    try { this._startEngine(); } catch { this._engineOsc = null; }
    if (typeof window !== 'undefined' && !this._mBound) {
      this._mBound = true;
      window.addEventListener('keydown', (e) => {
        if (e.code === 'KeyM') this.setMusic(!this.musicOn);
        // N cycles the radio station (M still toggles music). The
        // station change is audible immediately: the scheduler reads
        // the station every step, so the next bar is the new station.
        if (e.code === 'KeyN') this.nextStation();
      });
    }
    if (this.musicOn) {
      try { this._startMusic(); } catch { this._stopMusic(); }
    }
  },

  /**
   * Full teardown: stop the music timer, silence and stop the engine and
   * siren oscillators, close the context. main.js calls this from
   * destroy(); without it a torn-down game left a running setInterval
   * and live oscillators behind.
   */
  shutdown() {
    this._stopMusic();
    try { this._engineOsc?.stop?.(); } catch { /* already stopped */ }
    try { this._sirenOsc?.stop?.(); } catch { /* already stopped */ }
    try { this._sirenLfo?.stop?.(); } catch { /* already stopped */ }
    this._engineOsc = this._engineGain = this._engineFilter = null;
    this._sirenOsc = this._sirenLfo = this._sirenGain = null;
    if (this.ctx) {
      try {
        const p = this.ctx.close?.();
        if (p && typeof p.catch === 'function') p.catch(() => {});
      } catch { /* already closed */ }
      this.ctx = null;
    }
    this._master = this._sfx = this._music = null;
  },

  setMuted(m) {
    this.enabled = !m;
    if (this._master && this.ctx) {
      try {
        this._master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.02);
      } catch {
        // Context closed mid-game: muting is moot, the game is not.
      }
    }
  },

  setMusic(on) {
    this.musicOn = !!on;
    if (!this.ctx) return;
    if (on) this._startMusic();
    else this._stopMusic();
  },

  // --- Radio stations ------------------------------------------------------
  // The station is state, not just a label: the scheduler reads it every
  // step (bpm, scale, waveform, bass pattern). Switching is instant and
  // safe with no AudioContext (the index still changes, so the HUD and
  // the save system see the new station even in a silent browser).

  /** The current station object (RADIO_STATIONS row). */
  currentStation() {
    return RADIO_STATIONS[this.stationIndex % RADIO_STATIONS.length];
  },

  /** "Solano FM — Harbour pop" (for the HUD radio badge). */
  stationLabel() {
    const st = this.currentStation();
    return `${st.name} — ${st.tag}`;
  },

  /**
   * The station ident: the line the DJ says when the station lands
   * ("You're listening to Solano FM — Harbour pop"). The HUD badge
   * shows the label; the ident is the spoken version, for the title
   * screen and for any surface that wants a sentence instead of a
   * label. It is built from the station's own name and tag, so a new
   * station gets its ident for free.
   */
  stationIdent() {
    const st = this.currentStation();
    return `You're listening to ${st.name} — ${st.tag}, Port Solano.`;
  },

  /** Set the station by index (wraps). Returns the station. */
  setStation(i) {
    const n = RADIO_STATIONS.length;
    this.stationIndex = ((i % n) + n) % n;
    this.stationChangedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    this._playJingle();
    return this.currentStation();
  },

  /** Next station (N key). */
  nextStation() {
    return this.setStation(this.stationIndex + 1);
  },

  /** Previous station. */
  prevStation() {
    return this.setStation(this.stationIndex - 1);
  },

  /**
   * The station's jingle: a 4-note motif from its own scale, played on
   * switch — so the ear knows which station landed before the eye reads
   * the badge. Guarded like every other audio path: no context, no
   * sound, no throw.
   */
  _playJingle() {
    if (!this.ctx || !this._sfx) return;
    try {
      const st = this.currentStation();
      const notes = [0, 2, 4, 1].map(
        (deg) => st.root * 4 * Math.pow(2, st.scale[deg % st.scale.length] / 12),
      );
      notes.forEach((f, i) => this._blip(f, f, 0.12, st.wave, 0.22, i * 0.09));
    } catch {
      // A jingle never breaks the game.
    }
  },

  /** Continuous engine hum; speed01 is 0 (parked) .. 1 (flat out). */
  engine(speed01) {
    if (!this.ctx || !this._engineOsc) return;
    try {
      const t = this.ctx.currentTime;
      const s = Math.max(0, Math.min(1, speed01 || 0));
      this._engineOsc.frequency.setTargetAtTime(55 + s * 165, t, 0.06);
      this._engineFilter.frequency.setTargetAtTime(320 + s * 900, t, 0.08);
      this._engineGain.gain.setTargetAtTime(s < 0.03 ? 0 : 0.045 + s * 0.05, t, 0.08);
    } catch {
      // The engine is ambience; a closed or failed context must never
      // throw into the per-frame game loop. The old code had no guard
      // here at all — it was the one audio path that could throw.
      this._engineOsc = null;
    }
  },

  /**
   * Siren loop gain by distance to the nearest cop. Pass null / Infinity to
   * fade it out. police.js calls this every frame while wanted > 0.
   */
  setSiren(dist) {
    if (!this.ctx) return;
    try {
      if (!this._sirenOsc) this._startSiren();
      const t = this.ctx.currentTime;
      const gain = dist == null || !Number.isFinite(dist)
        ? 0
        : Math.max(0, 1 - dist / 900) * 0.14;
      this._sirenGain.gain.setTargetAtTime(this.enabled ? gain : 0, t, 0.15);
    } catch {
      // Siren is ambience; never break the game.
    }
  },

  /** One-shot synthesized effect. Unknown names are ignored. */
  sfx(name) {
    if (!this.ctx || !this.enabled || !this._sfx) return;
    try {
      switch (name) {
        case 'shoot': {
          this._noise(0.09, 0.5, 2400);
          this._blip(220, 70, 0.09, 'square', 0.25);
          break;
        }
        case 'punch':
          this._blip(130, 55, 0.09, 'sine', 0.5);
          this._noise(0.05, 0.25, 900);
          break;
        case 'hit':
          this._noise(0.12, 0.4, 700);
          this._blip(90, 45, 0.14, 'sine', 0.5);
          break;
        case 'pickup':
          this._blip(660, 660, 0.07, 'sine', 0.3);
          this._blip(880, 880, 0.1, 'sine', 0.3, 0.07);
          break;
        case 'cash':
        case 'payout':
          this._blip(988, 988, 0.08, 'sine', 0.28);
          this._blip(1319, 1319, 0.08, 'sine', 0.28, 0.08);
          this._blip(1568, 1568, 0.14, 'sine', 0.28, 0.16);
          break;
        case 'event':
          // A street event appearing (missions.js): a dispatch-style
          // two-tone alert — distinct from the mission fanfare, so the
          // player learns that two tones mean trouble, not a job.
          this._blip(784, 784, 0.12, 'triangle', 0.3);
          this._blip(1047, 1047, 0.16, 'triangle', 0.3, 0.14);
          break;
        case 'click':
        case 'reload':
          this._blip(1200, 900, 0.04, 'square', 0.18);
          break;
        case 'mission':
          [523, 659, 784, 1047].forEach((f, i) => this._blip(f, f, 0.14, 'triangle', 0.3, i * 0.11));
          break;
        case 'fail':
          [392, 330, 262, 196].forEach((f, i) => this._blip(f, f, 0.2, 'sawtooth', 0.2, i * 0.14));
          break;
        case 'busted':
          this._blip(620, 620, 0.22, 'square', 0.22);
          this._blip(470, 470, 0.34, 'square', 0.22, 0.22);
          break;
        case 'explosion': {
          this._noise(0.6, 0.8, 500);
          this._blip(120, 28, 0.55, 'sine', 0.7);
          break;
        }
        case 'siren':
          this.setSiren(400);
          break;
        case 'honk':
          // A car horn: two short square-wave blasts a third apart.
          // Traffic honks when it has sat blocked for 2 s (traffic.js);
          // the sfx is rate-limited there, so this never spams.
          this._blip(370, 370, 0.14, 'square', 0.22);
          this._blip(466, 466, 0.14, 'square', 0.22, 0.16);
          break;
        case 'shout':
          // A gunman taunting (combat.js): a short rising yell, two
          // blasts — audible over the gunfire without being a gunshot.
          this._blip(180, 320, 0.12, 'sawtooth', 0.2);
          this._blip(220, 360, 0.1, 'sawtooth', 0.18, 0.12);
          break;
        case 'radio':
          // Station change (N key): a quick tuning blip, like the dial
          // landing on a new station.
          this._blip(900, 1400, 0.06, 'sine', 0.2);
          this._blip(1400, 900, 0.05, 'sine', 0.15, 0.06);
          break;
        case 'bounty':
          // A bounty collected: three rising notes, brighter than the
          // cash arpeggio — the board pays, and the street cheers.
          this._blip(784, 784, 0.1, 'triangle', 0.3);
          this._blip(1047, 1047, 0.1, 'triangle', 0.3, 0.1);
          this._blip(1319, 1319, 0.18, 'triangle', 0.3, 0.2);
          break;
        case 'achievement':
          // An achievement unlocked: a little fanfare, four notes up
          // the scale — it should sound like a door opening, not a
          // payout, so the ear learns the difference.
          [523, 659, 784, 1047].forEach((f, i) => this._blip(f, f, 0.12, 'sine', 0.28, i * 0.09));
          break;
        case 'garage':
          // A garage bought: a low thunk (the door) and a bright
          // chime (the keys) — the sound of a roof of your own.
          this._blip(180, 90, 0.14, 'sine', 0.5);
          this._blip(1319, 1319, 0.14, 'sine', 0.25, 0.14);
          break;
        default:
          break;
      }
    } catch {
      // SFX must never throw into the game loop.
    }
  },

  // --- internals ---------------------------------------------------------

  _blip(f0, f1, dur, type, vol, delay = 0) {
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t0);
    if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(g);
    g.connect(this._sfx);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  },

  _noise(dur, vol, filterFreq) {
    const t0 = this.ctx.currentTime;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(this._sfx);
    src.start(t0);
  },

  _startEngine() {
    this._engineOsc = this.ctx.createOscillator();
    this._engineOsc.type = 'sawtooth';
    this._engineOsc.frequency.value = 55;
    this._engineFilter = this.ctx.createBiquadFilter();
    this._engineFilter.type = 'lowpass';
    this._engineFilter.frequency.value = 320;
    this._engineGain = this.ctx.createGain();
    this._engineGain.gain.value = 0;
    this._engineOsc.connect(this._engineFilter);
    this._engineFilter.connect(this._engineGain);
    this._engineGain.connect(this._master);
    this._engineOsc.start();
  },

  _startSiren() {
    this._sirenOsc = this.ctx.createOscillator();
    this._sirenOsc.type = 'sine';
    this._sirenOsc.frequency.value = 800;
    this._sirenLfo = this.ctx.createOscillator();
    this._sirenLfo.type = 'square';
    this._sirenLfo.frequency.value = 0.55;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 150;
    this._sirenLfo.connect(lfoGain);
    lfoGain.connect(this._sirenOsc.frequency);
    this._sirenGain = this.ctx.createGain();
    this._sirenGain.gain.value = 0;
    this._sirenOsc.connect(this._sirenGain);
    this._sirenGain.connect(this._master);
    this._sirenOsc.start();
    this._sirenLfo.start();
  },

  // --- procedural music: 112 BPM, A minor, 16-step loop ------------------
  _startMusic() {
    if (this._musicTimer || !this.ctx) return;
    this._step = 0;
    this._nextStepTime = this.ctx.currentTime + 0.05;
    this._musicTimer = setInterval(() => this._scheduleMusic(), 25);
  },

  _stopMusic() {
    if (this._musicTimer) {
      clearInterval(this._musicTimer);
      this._musicTimer = null;
    }
  },

  _scheduleMusic() {
    // Runs on a setInterval: it must never throw, or the timer dies and
    // the music stops mid-game. A closed context mid-bar is the usual
    // cause — treat it as "music off" and stop the timer.
    if (!this.ctx) { this._stopMusic(); return; }
    try {
      // Station-driven: the tempo, scale, waveform and bass pattern all
      // come from the current station, so N actually changes the music.
      // The station is read every call, so a switch takes effect on the
      // next bar without restarting the timer.
      const st = this.currentStation();
      const BEAT = 60 / st.bpm;
      const STEP_DUR = BEAT / 4;
      // Bass: one note per beat (steps 0/4/8/12), from the station's
      // bass pattern (scale degrees) over its root. 0 = rest.
      const bassNotes = st.bass.map((deg) => st.root * Math.pow(2, st.scale[deg % st.scale.length] / 12));
      // Sparse lead (the station's scale, two octaves up), one note per
      // bar on steps 0/6/11 — the same rhythm as the old A-minor loop,
      // retuned to whatever the station plays.
      const LEAD = st.scale.map((deg) => st.root * 4 * Math.pow(2, deg / 12));
      while (this._nextStepTime < this.ctx.currentTime + 0.15) {
        const step = this._step % 16;
        const bar = Math.floor(this._step / 16);
        const t = this._nextStepTime;
        const bass = step % 4 === 0 ? bassNotes[(step / 4) | 0] : 0;
        if (bass) this._musicNote(bass, t, STEP_DUR * 1.8, st.wave, 0.5);
        if (step % 4 === 2) this._musicHat(t, 0.12); // off-beat hats
        if (step === 0 || step === 6 || step === 11) {
          const note = LEAD[(bar * 3 + step) % LEAD.length];
          this._musicNote(note, t, STEP_DUR * 2.4, 'sine', 0.16);
        }
        this._step += 1;
        this._nextStepTime += STEP_DUR;
      }
    } catch {
      this._stopMusic();
    }
  },

  _musicNote(freq, t, dur, type, vol) {
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g);
    g.connect(this._music);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  },

  _musicHat(t, vol) {
    const len = Math.floor(this.ctx.sampleRate * 0.03);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 6000;
    const g = this.ctx.createGain();
    g.gain.value = vol;
    src.connect(filter);
    filter.connect(g);
    g.connect(this._music);
    src.start(t);
  },
};

// The DJ line for the current station: the station's voice between
// songs. The line rotates once every 30 s of game time, so the badge
// can show it without flickering every frame — the ear learns which
// station landed before the eye reads the badge.
export function djLine(state) {
  const idx = state.radioStation || 0;
  const st = RADIO_STATIONS[idx];
  if (!st) return '';
  const lines = RADIO_DJ_LINES[st.id] || [];
  if (lines.length === 0) return '';
  return lines[Math.floor((state.time || 0) / 30) % lines.length];
}
