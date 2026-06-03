// Central tunables. Physics values are expressed as fractions of screen HEIGHT so the
// game feels identical across phones of different sizes (see CLAUDE.md 4.2).

/** Logical design resolution. Phaser.Scale.FIT scales this to the real viewport. */
export const GAME = {
  width: 450,
  height: 800,
  backgroundColor: "#1d2b53",
} as const;

/** Scene keys, kept in one place to avoid typos across scene transitions. */
export const SCENES = {
  Boot: "BootScene",
  Preload: "PreloadScene",
  Menu: "MenuScene",
  Game: "GameScene",
  Quiz: "QuizScene",
  GameOver: "GameOverScene",
  Leaderboard: "LeaderboardScene",
  Lobby: "LobbyScene",
  Pause: "PauseScene",
} as const;

/** localStorage keys. */
export const STORAGE = {
  pseudo: "flappyprof.pseudo",
  seenIds: "flappyprof.seenIds",
  volume: "flappyprof.volume",
} as const;

/** Default master volume (0..1) if the player hasn't set one yet. */
export const DEFAULT_VOLUME = 0.25;

/** Read the saved master volume, falling back to DEFAULT_VOLUME when unset/invalid.
 *  (Guards the `Number(null) === 0` trap that otherwise started the game silent.) */
export function loadVolume(): number {
  try {
    const raw = localStorage.getItem(STORAGE.volume);
    if (raw !== null) {
      const n = Number(raw);
      if (Number.isFinite(n)) return Math.max(0, Math.min(1, n));
    }
  } catch {
    // storage unavailable
  }
  return DEFAULT_VOLUME;
}

export function saveVolume(volume: number): void {
  try {
    localStorage.setItem(STORAGE.volume, String(Math.max(0, Math.min(1, volume))));
  } catch {
    // storage unavailable; in-memory volume still applies for this session
  }
}

/**
 * Gameplay tunables, expressed in design-space pixels (GAME.width x GAME.height).
 * Phaser.Scale.FIT scales the whole canvas, so these stay consistent across devices.
 */
// Tuning note (see memory: design priority is fun over reflex difficulty): gentle
// gravity keeps the bird aloft longer so the player taps far less; difficulty is driven
// mainly by the scroll speed, which ramps slowly with score.
export const PHYSICS = {
  /** Downward acceleration (px/s²). Low = bird sinks slowly = fewer taps needed. */
  gravity: 1700,
  /** Upward velocity applied on each flap (px/s). */
  flapVelocity: 540,
  /** Max downward speed so falls stay controllable (px/s). */
  maxFallSpeed: 720,
  /** Bird resting horizontal position as a fraction of width. */
  birdX: 0.25,
} as const;

export const OBSTACLES = {
  /** Pillar column width (px). */
  width: 74,
  /** Horizontal distance between consecutive pairs (px). Spawning is distance-based, so this
   *  spatial spacing stays constant even as the scroll speed climbs over time. */
  spacing: 340,
  /** Keep gap centers away from the very top/bottom (px). */
  edgeMargin: 120,
  /** Max vertical shift of the gap center between consecutive pairs (px). Caps how
   *  far the player must climb/descend, avoiding top->bottom whiplash. */
  maxGapDelta: 160,
} as const;

/**
 * Stepped, ACCELERATING time-based difficulty. Difficulty rises in discrete steps as ELAPSED
 * RUN TIME accumulates (quiz/grace pauses excluded — the clock only advances during active
 * flight), not with score. The first step lands after `firstStepMs`, then one more every
 * `stepMs`. Speed at step n is `speedStart + speedPerStep * n^speedAccel` (capped at
 * `speedMax`): with `speedAccel` > 1 each step adds MORE than the last, so the run stays gentle
 * during the warmup but ramps up harder and harder later — the curve endless runners use
 * (Canabalt / Temple Run / Subway Surfers keep accelerating rather than holding a fixed rate).
 * The gap tightens linearly by `gapPerStep` (floored at `gapMin`). Speed is independent of the
 * score multiplier. All values are tunable — true calibration needs real playtesting.
 */
export const DIFFICULTY = {
  /** Scroll speed at the start of a run (px/s). */
  speedStart: 230,
  /** Time before the FIRST speed step kicks in (ms). */
  firstStepMs: 20000,
  /** Time between each subsequent speed step (ms). */
  stepMs: 30000,
  /** Base speed added at step 1 (px/s); later steps add more via speedAccel. */
  speedPerStep: 26,
  /** Acceleration exponent (>1). Higher = the speed-ups grow more sharply over time. */
  speedAccel: 1.7,
  /** Hard cap on the scroll speed (px/s). */
  speedMax: 700,
  /** Pillar gap at the start of a run (px) — generous, per the fun-not-reflex priority. */
  gapStart: 250,
  /** Gap removed at each step (px). */
  gapPerStep: 12,
  /** Tightest the pillar gap goes (px) — still clearable. */
  gapMin: 165,
} as const;

/** Poutine collectibles — easy-to-grab points placed on the flight path (replaces coins). */
export const POUTINE = {
  /** Points per poutine collected. */
  value: 2,
  /** Visual + pickup radius (generous, since reaching them must be effortless). */
  radius: 20,
} as const;

/**
 * Quiz gates — an unavoidable, full-height band that always opens QuizScene when reached.
 * Forcing the *encounter* (not a correct answer) keeps the French learning central without
 * punishing the player (see memory: design priorities + level direction).
 */
export const QUIZ = {
  /** Bonus points for a correct answer. */
  bonus: 5,
  /** After resuming, the bird hovers (gravity off) this long so it doesn't drop while the
   *  player re-orients; the first flap ends the grace early (ms). */
  graceMs: 1400,
} as const;

/**
 * Score multiplier driven by collecting poutines (see memory: chosen reward mechanic).
 * Each poutine grows the combo; the multiplier rises in tiers and scales ALL scoring.
 * It does NOT feed the speed ramp (difficulty), so grabbing poutines never makes the game
 * harder — it only makes it more rewarding and more hype (music/visuals escalate by tier).
 * Taking a hit (shield pop) resets the combo.
 */
export const MULTIPLIER = {
  /** Poutines collected to climb one tier (x1 -> x2 -> ...). */
  poutinesPerTier: 2,
  /** Highest multiplier reachable. */
  max: 5,
} as const;

/**
 * Collectible power-ups placed along the seeded track (CLAUDE.md 4.5). All HELP the player
 * (never punish), fitting the fun-over-reflex priority. Timed effects show a countdown bar.
 */
export const POWERUPS = {
  /** Visual + pickup radius (generous, since reaching them must be effortless). */
  radius: 22,

  /** Horloge — slow-mo: the whole world runs at this fraction of speed for slowmoMs, and
   *  audio drops to slowmoRate (deep, comedic voice). */
  slowmoMs: 5000,
  slowmoFactor: 0.5,
  slowmoRate: 0.6,

  /** Étoile/Castor — invincible: pass through obstacles for invincibleMs; audio rises to
   *  invincibleRate (chipmunk). */
  invincibleMs: 4500,
  invincibleRate: 1.5,

  /** Aimant à poutine — magnet: auto-collect any poutine within magnetRadius for magnetMs
   *  (combo booster). Small, snappy radius so it reads clearly and feels reliable. */
  magnetMs: 6000,
  magnetRadius: 150,

  /** Relative spawn weights when a power-up slot appears. Heart is rarer (it's strong). */
  weights: { slowmo: 3, invincible: 3, magnet: 3, heart: 1 },

  /** How many power-ups appear per level cycle (tunable; higher = more frequent). */
  perCycle: 1,
} as const;

/** Power-up kinds. */
export type PowerupKind = "slowmo" | "invincible" | "magnet" | "heart";

/** Shield granted by a correct quiz answer: absorbs one obstacle hit. */
export const SHIELD = {
  /** Invulnerability window after a shield pops, so you don't instantly re-collide (ms). */
  invulnMs: 1200,
} as const;

/** Health: the player starts with several lives and loses one per crash or wrong answer. */
export const LIVES = {
  /** Lives at the start of a run. */
  count: 3,
  /** Brief invulnerability granted after a crash costs a life, so you don't instantly
   *  re-collide with the same obstacle (ms). */
  hitInvulnMs: 1500,
} as const;

/** Jetpack-Joyride-style level rhythm: alternating runs of pillars, poutine, and a gate. */
export const SEGMENTS = {
  /** Pillars in the first run of a cycle (inclusive rng range). */
  pipeRunMin: 3,
  pipeRunMax: 4,
  /** Poutine collectibles in the open stretch between runs. */
  poutineRun: 3,
  /** Pillars between the poutine stretch and the quiz gate (inclusive rng range). */
  pipesBeforeGateMin: 2,
  pipesBeforeGateMax: 3,
} as const;

/** Height of the ground/ceiling strips (px). */
export const GROUND_HEIGHT = 32;

/** Points awarded per obstacle pair cleared. */
export const SCORE_PER_PASS = 1;
