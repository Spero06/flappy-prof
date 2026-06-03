/**
 * Manifest-driven sound system (CLAUDE.md section 5). Loads public/audio.json (event -> list
 * of clip URLs), preloads each clip as an AudioBuffer, and plays a RANDOM clip per event so
 * repeated events (flap, pass) feel varied instead of robotic. The professor's recorded voice
 * is the star; swapping/adding sounds is just editing audio.json + dropping files in
 * public/audio/ — no code change.
 *
 * - AudioContext is created lazily and unlocked on the first user gesture (mobile autoplay).
 * - playbackRate is exposed (setRate) for the power-up pitch FX: slow-mo deepens, invincible
 *   raises — applied to both real clips and the synth fallback.
 * - Events whose manifest list is empty fall back to a subtle synth blip, so nothing is silent
 *   until the matching clip is recorded.
 */

import { loadVolume } from "../config";

type Manifest = Record<string, string[]>;

interface Blip {
  f: number;
  d: number;
  t: OscillatorType;
  g: number;
}

/** Subtle synth cues for events that don't have a real clip yet. */
const FALLBACK: Record<string, Blip> = {
  flap: { f: 420, d: 0.09, t: "square", g: 0.05 },
  pass: { f: 660, d: 0.12, t: "triangle", g: 0.08 },
  pickup: { f: 760, d: 0.1, t: "triangle", g: 0.07 },
  quiz_start: { f: 520, d: 0.16, t: "sine", g: 0.07 },
  quiz_correct: { f: 880, d: 0.16, t: "triangle", g: 0.08 },
  quiz_wrong: { f: 200, d: 0.3, t: "sawtooth", g: 0.08 },
  shield: { f: 600, d: 0.18, t: "sine", g: 0.07 },
  slowmo: { f: 320, d: 0.2, t: "sine", g: 0.07 },
  invincible: { f: 990, d: 0.18, t: "triangle", g: 0.08 },
  magnet: { f: 700, d: 0.14, t: "sine", g: 0.07 },
  heart: { f: 980, d: 0.16, t: "triangle", g: 0.08 },
  milestone: { f: 1040, d: 0.2, t: "triangle", g: 0.08 },
  gameover: { f: 180, d: 0.4, t: "sawtooth", g: 0.09 },
};
const DEFAULT_BLIP: Blip = { f: 500, d: 0.12, t: "sine", g: 0.06 };

class AudioManager {
  private ctx?: AudioContext;
  private master?: GainNode;
  private manifest: Manifest = {};
  private buffers = new Map<string, AudioBuffer>();
  private rate = 1;
  private volume = 1;

  /** Wire the manifest and start preloading clips. Safe to call before any user gesture. */
  init(manifest: Manifest): void {
    this.manifest = manifest ?? {};
    this.ensureContext();
    this.setMasterVolume(loadVolume());
    void this.preload();
  }

  private ensureContext(): void {
    if (this.ctx) return;
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);
  }

  /** Resume the context from a user gesture (mobile autoplay policy). */
  unlock(): void {
    this.ensureContext();
    if (this.ctx && this.ctx.state === "suspended") void this.ctx.resume();
  }

  /** Fetch + decode every unique clip referenced by the manifest. */
  private async preload(): Promise<void> {
    if (!this.ctx) return;
    const urls = new Set<string>();
    for (const list of Object.values(this.manifest)) {
      if (Array.isArray(list)) for (const u of list) urls.add(u);
    }
    await Promise.all(
      [...urls].map(async (url) => {
        if (this.buffers.has(url)) return;
        try {
          const res = await fetch(url);
          const data = await res.arrayBuffer();
          const buf = await this.ctx!.decodeAudioData(data);
          this.buffers.set(url, buf);
        } catch (err) {
          console.warn(`[Audio] failed to load ${url}:`, err);
        }
      }),
    );
  }

  /** Play a random clip for the event, or a subtle synth blip if none is loaded. */
  play(event: string): void {
    this.ensureContext();
    if (!this.ctx || !this.master) return;

    const list = this.manifest[event];
    if (list && list.length > 0) {
      const url = list[Math.floor(Math.random() * list.length)];
      const buffer = this.buffers.get(url);
      if (buffer) {
        const src = this.ctx.createBufferSource();
        src.buffer = buffer;
        src.playbackRate.value = this.rate;
        src.connect(this.master);
        src.start();
        return;
      }
      // Clip listed but not decoded yet (still loading) → fall through to a blip.
    }
    this.blip(FALLBACK[event] ?? DEFAULT_BLIP);
  }

  /** Power-up pitch FX (mirrors MusicBed.setRate): scales clip playbackRate + blip pitch. */
  setRate(rate: number): void {
    this.rate = Math.max(0.25, Math.min(2.5, rate));
  }

  /** Master volume 0..1 (player setting). */
  setMasterVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.02);
    }
  }

  private blip(b: Blip): void {
    if (!this.ctx || !this.master || this.volume <= 0) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    osc.type = b.t;
    osc.frequency.setValueAtTime(b.f * this.rate, now);
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(b.g, now + 0.01);
    env.gain.exponentialRampToValueAtTime(0.0001, now + b.d / this.rate);
    osc.connect(env).connect(this.master);
    osc.start(now);
    osc.stop(now + b.d / this.rate + 0.02);
  }
}

/** Shared singleton — buffers persist across scene restarts (decoded once). */
export const audio = new AudioManager();
