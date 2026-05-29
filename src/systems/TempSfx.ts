/**
 * TEMPORARY placeholder sound effects for Faz 1. Frequent events like flap can't use
 * speechSynthesis (too laggy/spammy), so we emit short Web Audio beeps. This whole
 * module is replaced by AudioManager + the professor's clips in Faz 2.
 */
export class TempSfx {
  private ctx?: AudioContext;
  /** Global pitch multiplier (power-up FX): >1 higher/shorter, <1 deeper/longer. */
  private rate = 1;
  /** Master volume 0..1 (player setting). */
  private volume = 1;

  /** Power-up pitch FX, mirrors MusicBed.setRate. */
  setRate(rate: number): void {
    this.rate = Math.max(0.25, Math.min(2.5, rate));
  }

  /** Master volume 0..1 (player setting). */
  setMasterVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
  }

  /** Must be called from a user gesture so mobile browsers allow audio. */
  unlock(): void {
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctor();
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  private beep(freq: number, duration: number, type: OscillatorType, gain: number): void {
    if (!this.ctx || this.volume <= 0) return;
    const now = this.ctx.currentTime;
    freq *= this.rate;
    duration /= this.rate;
    gain *= this.volume;
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(gain, now + 0.01);
    env.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(env).connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + duration);
  }

  flap(): void {
    this.beep(420, 0.09, "square", 0.06);
  }

  pass(): void {
    this.beep(660, 0.12, "triangle", 0.08);
  }

  gameover(): void {
    this.beep(180, 0.4, "sawtooth", 0.09);
  }
}
