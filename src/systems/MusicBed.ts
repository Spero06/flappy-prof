/**
 * Procedural background music that BUILDS with the score multiplier (see memory: chosen
 * reward mechanic). The lead is a chiptune RECREATION of the Nyan Cat melody (square wave) —
 * not the copyrighted recording, which we don't ship. The melody plays from the start;
 * setIntensity(0..1) layers in bass -> kick -> hi-hat and pushes the tempo up, so a higher
 * multiplier feels more energetic. Swappable for real tracks later (CLAUDE.md Faz 7).
 */

const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD = 0.12; // seconds of audio scheduled in advance

// Nyan Cat main loop, as MIDI note numbers per 16th-note step (-1 = rest). Two bars that
// repeat — the recognizable bouncy G#-minor / B-major hook. Approximate chiptune transcription.
const MELODY: number[] = [
  // bar 1
  75, 78, 80, 75, 78, 76, 75, 73,
  71, 74, 73, 71, 70, 71, 73, 75,
  // bar 2
  78, 80, 82, 78, 80, 78, 76, 75,
  73, 76, 75, 73, 71, 73, 75, 76,
];

const midiToFreq = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

export class MusicBed {
  private ctx?: AudioContext;
  private master?: GainNode;
  private timer?: number;
  private playing = false;
  private intensity = 0;
  private step = 0;
  private nextNoteTime = 0;
  /** Global pitch/tempo multiplier (power-up audio FX): >1 faster+higher, <1 slower+deeper. */
  private rate = 1;
  /** Master volume 0..1 (player setting), multiplied into the intensity-driven gain. */
  private volume = 1;

  /** Unlock/create the context from a user gesture, then start the loop. */
  start(): void {
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    if (this.playing) return;

    this.playing = true;
    this.step = 0;
    this.nextNoteTime = this.ctx.currentTime + 0.05;
    this.timer = window.setInterval(() => this.scheduler(), LOOKAHEAD_MS);
  }

  /** 0 = calm, 1 = full energy. Drives layers, tempo, and (with volume) the gain. */
  setIntensity(level: number): void {
    this.intensity = Math.max(0, Math.min(1, level));
    this.applyGain(0.3);
  }

  /** Master volume 0..1 (player setting). */
  setMasterVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    this.applyGain(0.05);
  }

  /** Target gain = master volume × the intensity curve. */
  private applyGain(smoothing: number): void {
    if (this.master && this.ctx && this.playing) {
      const target = this.volume * (0.07 + this.intensity * 0.15);
      this.master.gain.setTargetAtTime(target, this.ctx.currentTime, smoothing);
    }
  }

  /** Stop scheduling but keep the context (game over / scene shutdown). */
  pause(): void {
    this.playing = false;
    if (this.timer !== undefined) {
      window.clearInterval(this.timer);
      this.timer = undefined;
    }
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
    }
  }

  /** Resume after a pause (e.g. returning from the quiz overlay). */
  resume(): void {
    if (this.playing || !this.ctx) return;
    if (this.ctx.state === "suspended") void this.ctx.resume();
    this.playing = true;
    this.nextNoteTime = this.ctx.currentTime + 0.05;
    this.timer = window.setInterval(() => this.scheduler(), LOOKAHEAD_MS);
    this.setIntensity(this.intensity);
  }

  /** Power-up pitch FX: scales both tempo and pitch like an audio playbackRate. */
  setRate(rate: number): void {
    this.rate = Math.max(0.25, Math.min(2.5, rate));
  }

  private get secondsPerStep(): number {
    // 120 bpm at calm up to ~168 bpm at full energy; 4 sixteenth-steps per beat.
    const bpm = 120 + this.intensity * 48;
    return 60 / bpm / 4 / this.rate;
  }

  private scheduler(): void {
    if (!this.ctx || !this.playing) return;
    while (this.nextNoteTime < this.ctx.currentTime + SCHEDULE_AHEAD) {
      this.scheduleStep(this.step, this.nextNoteTime);
      this.nextNoteTime += this.secondsPerStep;
      this.step += 1;
    }
  }

  private scheduleStep(step: number, time: number): void {
    const i = this.intensity;
    const beat = step % 4;

    // Lead: the Nyan Cat melody, always playing so the tune is recognizable from the start.
    const note = MELODY[step % MELODY.length];
    if (note >= 0) {
      this.tone(midiToFreq(note) * this.rate, time, 0.13, "square", 0.1 + i * 0.12);
    }
    // Bass pulse — roots/fifths an octave+ below the lead.
    if (i >= 0.2 && (step % 8 === 0 || step % 8 === 4)) {
      const root = MELODY[step % MELODY.length];
      this.tone(midiToFreq((root >= 0 ? root : 71) - 24) * this.rate, time, 0.2, "triangle", 0.45);
    }
    // Kick on the beat.
    if (i >= 0.12 && beat === 0) {
      this.kick(time, 0.9);
    }
    // Off-beat hi-hat at high energy.
    if (i >= 0.6 && step % 2 === 1) {
      this.hat(time, 0.1 + i * 0.1);
    }
  }

  private kick(time: number, gain: number): void {
    if (!this.ctx || !this.master) return;
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(150, time);
    osc.frequency.exponentialRampToValueAtTime(48, time + 0.12);
    env.gain.setValueAtTime(gain, time);
    env.gain.exponentialRampToValueAtTime(0.001, time + 0.16);
    osc.connect(env).connect(this.master);
    osc.start(time);
    osc.stop(time + 0.18);
  }

  private tone(
    hz: number,
    time: number,
    dur: number,
    type: OscillatorType,
    gain: number,
  ): void {
    if (!this.ctx || !this.master) return;
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(hz, time);
    env.gain.setValueAtTime(0, time);
    env.gain.linearRampToValueAtTime(gain, time + 0.01);
    env.gain.exponentialRampToValueAtTime(0.001, time + dur);
    osc.connect(env).connect(this.master);
    osc.start(time);
    osc.stop(time + dur + 0.02);
  }

  private hat(time: number, gain: number): void {
    if (!this.ctx || !this.master) return;
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    osc.type = "square";
    osc.frequency.setValueAtTime(7000, time);
    env.gain.setValueAtTime(gain * 0.3, time);
    env.gain.exponentialRampToValueAtTime(0.001, time + 0.04);
    osc.connect(env).connect(this.master);
    osc.start(time);
    osc.stop(time + 0.05);
  }
}
