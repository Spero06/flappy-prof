import Phaser from "phaser";
import {
  DIFFICULTY,
  GAME,
  GROUND_HEIGHT,
  LIVES,
  MULTIPLIER,
  OBSTACLES,
  PHYSICS,
  POUTINE,
  POWERUPS,
  type PowerupKind,
  QUIZ,
  SCENES,
  SCORE_PER_PASS,
  SEGMENTS,
  SHIELD,
  DEFAULT_VOLUME,
  loadVolume,
  saveVolume,
} from "../config";
import { Rng, randomSeed } from "../systems/Rng";
import { QuestionManager, type Question } from "../systems/QuestionManager";
import { audio } from "../systems/AudioManager";
import { MusicBed } from "../systems/MusicBed";

interface GameInit {
  mode: "solo" | "multi";
  pseudo: string;
  seed?: number;
}

interface ObstaclePair {
  top: Phaser.GameObjects.Rectangle;
  bottom: Phaser.GameObjects.Rectangle;
  scored: boolean;
}

interface QuizGate {
  banner: Phaser.GameObjects.TileSprite;
  triggered: boolean;
}

/** What a single spawn slot drops into the level (Jetpack-Joyride-style segments). */
type Slot = "pipe" | "poutine" | "gate" | "powerup";

const TITLE_FONT = "Luckiest Guy, sans-serif";
const UI_FONT = "Fredoka, sans-serif";

/**
 * Core loop: bird physics + seeded segmented level (pillar runs, poutine collectibles, and
 * an unavoidable quiz gate). Difficulty ramps with elapsed run time (see config DIFFICULTY):
 * the scroll speed climbs and the pillar gap tightens so a typical run lands around 1–2 min.
 */
export class GameScene extends Phaser.Scene {
  private mode: GameInit["mode"] = "solo";
  private pseudo = "Anonyme";
  private seed = 0;

  private rng!: Rng;
  private music = new MusicBed();
  private questions!: QuestionManager;

  private bird!: Phaser.Physics.Arcade.Image;
  private obstacles!: Phaser.Physics.Arcade.Group;
  private poutines!: Phaser.Physics.Arcade.Group;
  private powerups!: Phaser.Physics.Arcade.Group;
  private pairs: ObstaclePair[] = [];
  private gates: QuizGate[] = [];
  private slotQueue: Slot[] = [];
  private startBob?: Phaser.Tweens.Tween;

  private currentSpeed: number = DIFFICULTY.speedStart;
  private lastGapCenter: number | null = null;
  /** Elapsed active-flight time (ms); drives the difficulty ramp. Quiz/grace pauses excluded. */
  private runTimeMs = 0;
  /** Distance scrolled since the last spawn (px); spawning is distance- not timer-based. */
  private distanceSinceSpawn = 0;

  private score = 0;
  private scoreText!: Phaser.GameObjects.Text;
  private combo = 0;
  private multiplierText!: Phaser.GameObjects.Text;
  private hypeTint!: Phaser.GameObjects.Rectangle;
  private sparks!: Phaser.GameObjects.Particles.ParticleEmitter;
  private started = false;
  private gameOver = false;
  private quizActive = false;

  private shielded = false;
  private invulnUntil = 0;
  private shieldRing?: Phaser.GameObjects.Arc;
  private graceUntil = 0;
  private lives: number = LIVES.count;
  private livesText!: Phaser.GameObjects.Text;
  private volume: number = DEFAULT_VOLUME;

  // Power-up effect timers (scene-clock timestamps; 0 = inactive).
  private slowmoUntil = 0;
  private invincibleUntil = 0;
  private magnetUntil = 0;
  // Edge-tracking so visuals/audio toggle once per transition.
  private fxSlowmo = false;
  private fxInvincible = false;
  private fxMagnet = false;
  private audioRate = 1;
  private slowmoTint!: Phaser.GameObjects.Rectangle;
  private aura?: Phaser.GameObjects.Arc;
  private magnetRing?: Phaser.GameObjects.Arc;
  private effectBars!: Phaser.GameObjects.Graphics;

  constructor() {
    super(SCENES.Game);
  }

  /** The bird is a dynamic Arcade image, so its body is always a (non-null) Body. */
  private get birdBody(): Phaser.Physics.Arcade.Body {
    return this.bird.body as Phaser.Physics.Arcade.Body;
  }

  /** Score multiplier derived from the current poutine combo (see config MULTIPLIER). */
  private get multiplier(): number {
    return Math.min(MULTIPLIER.max, 1 + Math.floor(this.combo / MULTIPLIER.poutinesPerTier));
  }

  /** Discrete difficulty step: 0 for the first firstStepMs, then +1 every stepMs (config). */
  private get difficultyStep(): number {
    if (this.runTimeMs < DIFFICULTY.firstStepMs) return 0;
    return 1 + Math.floor((this.runTimeMs - DIFFICULTY.firstStepMs) / DIFFICULTY.stepMs);
  }

  /** Pillar gap for the current step — tightens one notch per step, floored at gapMin. */
  private get currentGap(): number {
    return Math.max(
      DIFFICULTY.gapMin,
      DIFFICULTY.gapStart - this.difficultyStep * DIFFICULTY.gapPerStep,
    );
  }

  private get slowmoActive(): boolean {
    return this.time.now < this.slowmoUntil;
  }
  private get invincibleActive(): boolean {
    return this.time.now < this.invincibleUntil;
  }
  private get magnetActive(): boolean {
    return this.time.now < this.magnetUntil;
  }
  /** World/physics time scale: slowed during slow-mo, normal otherwise. */
  private get timeFactor(): number {
    return this.slowmoActive ? POWERUPS.slowmoFactor : 1;
  }

  init(data: Partial<GameInit>): void {
    this.mode = data.mode ?? "solo";
    this.pseudo = data.pseudo ?? "Anonyme";
    this.seed = data.seed ?? randomSeed();
  }

  create(): void {
    this.pairs = [];
    this.gates = [];
    this.slotQueue = [];
    this.score = 0;
    this.combo = 0;
    this.started = false;
    this.gameOver = false;
    this.quizActive = false;
    this.currentSpeed = DIFFICULTY.speedStart;
    this.lastGapCenter = null;
    this.runTimeMs = 0;
    this.distanceSinceSpawn = 0;
    this.shielded = false;
    this.invulnUntil = 0;
    this.shieldRing = undefined;
    this.graceUntil = 0;
    this.lives = LIVES.count;
    this.slowmoUntil = 0;
    this.invincibleUntil = 0;
    this.magnetUntil = 0;
    this.fxSlowmo = false;
    this.fxInvincible = false;
    this.fxMagnet = false;
    this.audioRate = 1;
    this.aura = undefined;
    this.magnetRing = undefined;
    this.rng = new Rng(this.seed);
    this.questions = new QuestionManager(
      (this.cache.json.get("questions") as Question[]) ?? [],
    );

    this.drawBackground();
    this.createGroundAndCeiling();
    this.createBird();

    this.obstacles = this.physics.add.group({ allowGravity: false, immovable: true });
    this.poutines = this.physics.add.group({ allowGravity: false, immovable: true });
    this.powerups = this.physics.add.group({ allowGravity: false, immovable: true });
    this.physics.add.overlap(this.bird, this.obstacles, () => this.onObstacleHit(), undefined, this);
    this.physics.add.overlap(
      this.bird,
      this.poutines,
      (_bird, poutine) => this.collectPoutine(poutine as Phaser.GameObjects.Image),
      undefined,
      this,
    );
    this.physics.add.overlap(
      this.bird,
      this.powerups,
      (_bird, pw) => this.collectPowerup(pw as Phaser.Physics.Arcade.Image),
      undefined,
      this,
    );

    this.createHypeFx();
    this.createHud();
    this.createStartPrompt();
    this.bindInput();

    // Apply the saved master volume to both audio systems.
    this.setVolume(loadVolume());

    // Make sure the music loop is torn down (and pitch reset) when the scene ends.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.music.setRate(1);
      audio.setRate(1);
      this.music.pause();
    });
  }

  // ---------------------------------------------------------------------------
  // Setup
  // ---------------------------------------------------------------------------

  private drawBackground(): void {
    const g = this.add.graphics().setDepth(-20);
    g.fillGradientStyle(0x2a3f8f, 0x2a3f8f, 0x0d1330, 0x0d1330, 1);
    g.fillRect(0, 0, GAME.width, GAME.height);
  }

  private createGroundAndCeiling(): void {
    this.add
      .rectangle(GAME.width / 2, GROUND_HEIGHT / 2, GAME.width, GROUND_HEIGHT, 0x6b4f2a)
      .setDepth(5);
    this.add
      .rectangle(
        GAME.width / 2,
        GAME.height - GROUND_HEIGHT / 2,
        GAME.width,
        GROUND_HEIGHT,
        0x6b4f2a,
      )
      .setDepth(5);
  }

  private createBird(): void {
    this.bird = this.physics.add
      .image(GAME.width * PHYSICS.birdX, GAME.height / 2, "bird")
      .setDepth(2);
    this.birdBody.setCircle(20, 8, 4);
    this.birdBody.setAllowGravity(false);

    // Gentle hover until the first flap.
    this.startBob = this.tweens.add({
      targets: this.bird,
      y: GAME.height / 2 - 16,
      duration: 600,
      yoyo: true,
      repeat: -1,
      ease: "Sine.InOut",
    });
  }

  private createHud(): void {
    this.scoreText = this.add
      .text(GAME.width / 2, 64, "0", {
        fontFamily: TITLE_FONT,
        fontSize: "56px",
        color: "#ffffff",
      })
      .setOrigin(0.5)
      .setDepth(10)
      .setStroke("#1d2b53", 8);

    // Multiplier badge, hidden until the combo lifts it above x1.
    this.multiplierText = this.add
      .text(GAME.width / 2, 108, "", {
        fontFamily: TITLE_FONT,
        fontSize: "30px",
        color: "#ffd23f",
      })
      .setOrigin(0.5)
      .setDepth(10)
      .setStroke("#1d2b53", 6)
      .setVisible(false);

    // Lives, shown as hearts in the top-left.
    this.livesText = this.add
      .text(18, 30, "", {
        fontFamily: UI_FONT,
        fontSize: "30px",
        color: "#ff5c7a",
      })
      .setOrigin(0, 0.5)
      .setDepth(10)
      .setStroke("#1d2b53", 5);
    this.updateLivesHud();

    this.createPauseButton();
  }

  private createPauseButton(): void {
    const r = 18;
    const c = this.add.container(GAME.width - 30, 32).setDepth(11);
    const g = this.add.graphics();
    g.fillStyle(0x1d2b53, 0.6);
    g.fillRoundedRect(-r, -r, r * 2, r * 2, 8);
    g.lineStyle(2, 0xffffff, 0.5);
    g.strokeRoundedRect(-r, -r, r * 2, r * 2, 8);
    g.fillStyle(0xffffff, 0.92);
    g.fillRoundedRect(-7, -8, 5, 16, 2);
    g.fillRoundedRect(2, -8, 5, 16, 2);
    c.add(g);
    c.setSize(r * 2, r * 2);
    c.setInteractive({ useHandCursor: true });
    c.on("pointerup", () => this.openPause());
  }

  /** Render remaining lives as filled hearts plus dimmed hearts for the ones lost. */
  private updateLivesHud(): void {
    const filled = "♥".repeat(Math.max(0, this.lives));
    const empty = "♡".repeat(Math.max(0, LIVES.count - this.lives));
    this.livesText.setText(filled + empty);
  }

  /** Warm full-screen tint + a spark emitter that both intensify with the multiplier. */
  private createHypeFx(): void {
    this.hypeTint = this.add
      .rectangle(GAME.width / 2, GAME.height / 2, GAME.width, GAME.height, 0xff8a3d, 0)
      .setDepth(8)
      .setBlendMode(Phaser.BlendModes.ADD);

    // Cool blue overlay shown during slow-mo.
    this.slowmoTint = this.add
      .rectangle(GAME.width / 2, GAME.height / 2, GAME.width, GAME.height, 0x1f9fd0, 0)
      .setDepth(8)
      .setBlendMode(Phaser.BlendModes.ADD);

    // Active-effect countdown bars (top-left, under the hearts).
    this.effectBars = this.add.graphics().setDepth(10);

    if (!this.textures.exists("spark")) {
      const g = this.make.graphics({ x: 0, y: 0 }, false);
      g.fillStyle(0xffffff, 1);
      g.fillCircle(6, 6, 6);
      g.generateTexture("spark", 12, 12);
      g.destroy();
    }

    this.sparks = this.add.particles(0, 0, "spark", {
      lifespan: 600,
      speed: { min: 60, max: 180 },
      scale: { start: 0.9, end: 0 },
      alpha: { start: 1, end: 0 },
      blendMode: Phaser.BlendModes.ADD,
      emitting: false,
    });
    this.sparks.setDepth(7);
  }

  private createStartPrompt(): void {
    const prompt = this.add
      .text(GAME.width / 2, GAME.height * 0.62, "Touche pour faire\nvoler le prof !", {
        fontFamily: UI_FONT,
        fontSize: "26px",
        color: "#ffffff",
        align: "center",
        fontStyle: "600",
      })
      .setOrigin(0.5)
      .setDepth(10);
    prompt.setShadow(0, 3, "#00000088", 4);
    prompt.setName("startPrompt");

    this.tweens.add({
      targets: prompt,
      alpha: { from: 1, to: 0.4 },
      duration: 700,
      yoyo: true,
      repeat: -1,
    });
  }

  private bindInput(): void {
    this.input.on("pointerdown", this.onPointerDown, this);
    this.input.keyboard?.on("keydown-SPACE", this.flap, this);
    this.input.keyboard?.on("keydown-ESC", this.openPause, this);
    this.input.keyboard?.on("keydown-P", this.openPause, this);
  }

  /** Pointer taps flap — unless they land on the pause button (top-right corner). */
  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    if (pointer.x > GAME.width - 56 && pointer.y < 56) return;
    this.flap();
  }

  private openPause(): void {
    // Works even before the first flap so you can set the volume before playing.
    if (this.gameOver || this.quizActive || this.graceUntil > 0) return;
    if (this.scene.isPaused()) return;
    this.scene.launch(SCENES.Pause, { volume: this.volume });
    this.scene.pause();
  }

  /** Master volume 0..1 — applies to music + sfx and persists. */
  setVolume(v: number): void {
    this.volume = Phaser.Math.Clamp(v, 0, 1);
    this.music.setMasterVolume(this.volume);
    audio.setMasterVolume(this.volume);
    saveVolume(this.volume);
  }

  // ---------------------------------------------------------------------------
  // Gameplay
  // ---------------------------------------------------------------------------

  private flap(): void {
    if (this.gameOver || this.quizActive) return;
    audio.unlock();

    if (!this.started) this.startRun();
    if (this.graceUntil > 0) this.endGrace();

    this.birdBody.setVelocityY(-PHYSICS.flapVelocity * this.timeFactor);
    audio.play("flap");
  }

  private startRun(): void {
    this.started = true;
    this.startBob?.stop();
    this.birdBody.setAllowGravity(true);
    this.birdBody.setGravityY(PHYSICS.gravity);

    this.children.getByName("startPrompt")?.destroy();

    this.music.start();
    this.recomputeSpeed();
    this.applyMultiplierFx();

    this.spawnSlot();
    this.distanceSinceSpawn = 0;
  }

  // --- Segment planner -------------------------------------------------------

  /** Pull the next slot, refilling the cycle when empty. */
  private nextSlot(): Slot {
    if (this.slotQueue.length === 0) this.slotQueue = this.buildCycle();
    return this.slotQueue.shift() as Slot;
  }

  /** A randomized cycle (seeded, so multiplayer stays fair): a shuffled mix of pillar runs,
   *  poutine stretches and power-ups, with exactly ONE quiz gate dropped at a random position.
   *  Varying the order + counts each cycle keeps the level from feeling like the same loop. */
  private buildCycle(): Slot[] {
    type Chunk = { t: Slot; n: number };
    const chunks: Chunk[] = [];

    // 2–3 pillar runs of varying length.
    const runs = this.rng.int(2, 3);
    for (let i = 0; i < runs; i++) {
      chunks.push({ t: "pipe", n: this.rng.int(SEGMENTS.pipeRunMin, SEGMENTS.pipeRunMax) });
    }
    // 1–2 open poutine stretches.
    const stretches = this.rng.int(1, 2);
    for (let i = 0; i < stretches; i++) {
      chunks.push({ t: "poutine", n: this.rng.int(2, SEGMENTS.poutineRun) });
    }
    // Power-ups (baseline POWERUPS.perCycle).
    for (let i = 0; i < POWERUPS.perCycle; i++) chunks.push({ t: "powerup", n: 1 });

    this.shuffleSeeded(chunks);

    // Exactly one quiz gate, never at the very start (keeps a little lead-in before the wall).
    const gateAt = this.rng.int(1, chunks.length);
    chunks.splice(gateAt, 0, { t: "gate", n: 1 });

    const slots: Slot[] = [];
    for (const c of chunks) for (let i = 0; i < c.n; i++) slots.push(c.t);
    return slots;
  }

  /** In-place Fisher–Yates using the seeded RNG (deterministic per seed). */
  private shuffleSeeded<T>(arr: T[]): void {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.rng.int(0, i);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }

  private spawnSlot(): void {
    const floorY = GAME.height - GROUND_HEIGHT;
    const minCenter = GROUND_HEIGHT + OBSTACLES.edgeMargin;
    const maxCenter = floorY - OBSTACLES.edgeMargin;

    // Smoothly drift the flight-path center; everything this slot sits on this line so
    // collectibles stay reachable and gaps never whip from floor to ceiling.
    let lo = minCenter;
    let hi = maxCenter;
    if (this.lastGapCenter !== null) {
      lo = Math.max(minCenter, this.lastGapCenter - OBSTACLES.maxGapDelta);
      hi = Math.min(maxCenter, this.lastGapCenter + OBSTACLES.maxGapDelta);
    }
    const gapCenter = this.rng.range(lo, hi);
    this.lastGapCenter = gapCenter;

    const x = GAME.width + OBSTACLES.width;

    switch (this.nextSlot()) {
      case "pipe":
        this.spawnPipes(x, gapCenter, floorY);
        break;
      case "poutine":
        this.spawnPoutine(x, gapCenter);
        break;
      case "powerup":
        this.spawnPowerup(x, gapCenter);
        break;
      case "gate":
        this.spawnGate(x, gapCenter, floorY);
        break;
    }
  }

  private spawnPipes(x: number, gapCenter: number, floorY: number): void {
    const gap = this.currentGap;
    const gapTop = gapCenter - gap / 2;
    const gapBottom = gapCenter + gap / 2;
    const topHeight = gapTop - GROUND_HEIGHT;
    const bottomHeight = floorY - gapBottom;

    const top = this.makePillar(x, GROUND_HEIGHT + topHeight / 2, topHeight);
    const bottom = this.makePillar(x, gapBottom + bottomHeight / 2, bottomHeight);

    this.pairs.push({ top, bottom, scored: false });
  }

  private makePillar(x: number, y: number, height: number): Phaser.GameObjects.Rectangle {
    const rect = this.add
      .rectangle(x, y, OBSTACLES.width, height, 0x3aa655)
      .setStrokeStyle(3, 0x1f5e30, 1)
      .setDepth(1);
    this.obstacles.add(rect);
    const body = rect.body as Phaser.Physics.Arcade.Body;
    body.setVelocityX(-this.currentSpeed);
    return rect;
  }

  private spawnPoutine(x: number, y: number): void {
    const poutine = this.poutines.create(x, y, "poutine") as Phaser.Physics.Arcade.Image;
    poutine.setDepth(2);
    const body = poutine.body as Phaser.Physics.Arcade.Body;
    body.setCircle(POUTINE.radius, 24 - POUTINE.radius, 24 - POUTINE.radius);
    body.setVelocityX(-this.currentSpeed);

    this.tweens.add({
      targets: poutine,
      y: y - 8,
      duration: 700,
      yoyo: true,
      repeat: -1,
      ease: "Sine.InOut",
    });
  }

  private pickPowerupKind(): PowerupKind {
    const w = POWERUPS.weights;
    const entries: [PowerupKind, number][] = [
      ["slowmo", w.slowmo],
      ["invincible", w.invincible],
      ["magnet", w.magnet],
      ["heart", w.heart],
    ];
    const total = entries.reduce((s, [, v]) => s + v, 0);
    let r = this.rng.range(0, total);
    for (const [kind, v] of entries) {
      if (r < v) return kind;
      r -= v;
    }
    return "slowmo";
  }

  private spawnPowerup(x: number, y: number): void {
    const kind = this.pickPowerupKind();
    const tex =
      kind === "slowmo" ? "pw_clock"
      : kind === "invincible" ? "pw_star"
      : kind === "heart" ? "pw_heart"
      : "pw_magnet";

    const pw = this.powerups.create(x, y, tex) as Phaser.Physics.Arcade.Image;
    pw.setDepth(3);
    pw.setData("kind", kind);
    const body = pw.body as Phaser.Physics.Arcade.Body;
    // Texture is 64×64; centre the (generous) pickup circle on the disc.
    body.setCircle(POWERUPS.radius, 32 - POWERUPS.radius, 32 - POWERUPS.radius);
    body.setVelocityX(-this.currentSpeed);

    this.tweens.add({
      targets: pw,
      y: y - 10,
      duration: 800,
      yoyo: true,
      repeat: -1,
      ease: "Sine.InOut",
    });
    this.tweens.add({
      targets: pw,
      angle: { from: -7, to: 7 },
      duration: 1300,
      yoyo: true,
      repeat: -1,
      ease: "Sine.InOut",
    });
    // Gentle breathing pulse so power-ups pop on the track.
    this.tweens.add({
      targets: pw,
      scale: { from: 0.9, to: 1.08 },
      duration: 650,
      yoyo: true,
      repeat: -1,
      ease: "Sine.InOut",
    });
  }

  private spawnGate(x: number, _gapCenter: number, floorY: number): void {
    const playH = floorY - GROUND_HEIGHT;
    const banner = this.add
      .tileSprite(x, GROUND_HEIGHT + playH / 2, 48, playH, "quizGate")
      .setDepth(1)
      .setAlpha(0.95);
    this.physics.add.existing(banner);
    const body = banner.body as Phaser.Physics.Arcade.Body;
    body.setAllowGravity(false);
    body.setVelocityX(-this.currentSpeed);

    this.gates.push({ banner, triggered: false });
  }

  update(_time: number, delta: number): void {
    if (!this.started || this.gameOver || this.quizActive) return;

    // During the post-quiz grace the bird hovers; let it drift back to center, then resume.
    // The difficulty clock does NOT advance here, so quiz/grace time is excluded from the ramp.
    if (this.graceUntil > 0) {
      this.bird.y = Phaser.Math.Linear(this.bird.y, GAME.height / 2, 0.04);
      this.bird.angle = Phaser.Math.Linear(this.bird.angle, 0, 0.1);
      if (this.shieldRing) this.shieldRing.setPosition(this.bird.x, this.bird.y);
      if (this.time.now >= this.graceUntil) this.endGrace();
      return;
    }

    // Advance the difficulty ramp and spawn by distance so spacing stays constant as we speed up.
    this.runTimeMs += delta;
    this.recomputeSpeed();
    // Slow-mo also slows the bird's gravity, so the whole world feels relaxed.
    this.birdBody.setGravityY(PHYSICS.gravity * this.timeFactor);
    this.updateEffects();

    this.distanceSinceSpawn += this.currentSpeed * (delta / 1000);
    if (this.distanceSinceSpawn >= OBSTACLES.spacing) {
      this.distanceSinceSpawn -= OBSTACLES.spacing;
      this.spawnSlot();
    }

    // Clamp fall speed and tilt the bird toward its velocity.
    const maxFall = PHYSICS.maxFallSpeed * this.timeFactor;
    const vy = this.birdBody.velocity.y;
    if (vy > maxFall) this.birdBody.setVelocityY(maxFall);
    const targetAngle = Phaser.Math.Clamp(vy / 12, -25, 80);
    this.bird.angle = Phaser.Math.Linear(this.bird.angle, targetAngle, 0.15);

    if (this.shieldRing) this.shieldRing.setPosition(this.bird.x, this.bird.y);

    // Floor / ceiling: counts as a crash (costs a life), then recenter so we don't double-hit.
    // Invincibility (or the post-crash invuln window) just clamps the bird inside the area.
    const topLimit = GROUND_HEIGHT + 18;
    const botLimit = GAME.height - GROUND_HEIGHT - 18;
    if (this.bird.y <= topLimit || this.bird.y >= botLimit) {
      if (!this.invincibleActive && this.time.now >= this.invulnUntil) {
        this.recenterBird();
        // A wall crash is absorbed by a shield first (consistent with obstacle hits).
        if (this.shielded) this.popShield();
        else this.loseLife(true);
        return;
      }
      // Recovering (invuln) or invincible: keep the bird in bounds but DON'T swallow flaps —
      // only cancel motion heading further INTO the wall, so an upward flap still lifts it off
      // the floor (otherwise it gets pinned and can't fly up again).
      const atFloor = this.bird.y >= botLimit;
      this.bird.y = Phaser.Math.Clamp(this.bird.y, topLimit, botLimit);
      const vy = this.birdBody.velocity.y;
      if (atFloor ? vy > 0 : vy < 0) this.birdBody.setVelocityY(0);
    }

    // Pillar scoring + recycling.
    for (let i = this.pairs.length - 1; i >= 0; i--) {
      const pair = this.pairs[i];
      if (!pair.scored && pair.top.x + OBSTACLES.width / 2 < this.bird.x) {
        pair.scored = true;
        this.applyScore(SCORE_PER_PASS);
        audio.play("pass");
        this.popScoreText();
      }
      if (pair.top.x < -OBSTACLES.width) {
        pair.top.destroy();
        pair.bottom.destroy();
        this.pairs.splice(i, 1);
      }
    }

    // Recycle off-screen poutine (kill its bob tween so nothing dangles).
    for (const obj of this.poutines.getChildren()) {
      const p = obj as Phaser.GameObjects.Image;
      if (p.x < -50) {
        this.tweens.killTweensOf(p);
        p.destroy();
      }
    }

    // Recycle off-screen power-ups.
    for (const obj of this.powerups.getChildren()) {
      const p = obj as Phaser.GameObjects.Image;
      if (p.x < -50) {
        this.tweens.killTweensOf(p);
        p.destroy();
      }
    }

    // Quiz gates: trigger when the banner reaches the bird, recycle off-screen.
    for (let i = this.gates.length - 1; i >= 0; i--) {
      const gate = this.gates[i];
      if (!gate.triggered && gate.banner.x <= this.bird.x) {
        this.triggerQuiz(gate);
        return;
      }
      if (gate.banner.x < -50) {
        gate.banner.destroy();
        this.gates.splice(i, 1);
      }
    }
  }

  private collectPoutine(poutine: Phaser.GameObjects.Image): void {
    if (!poutine.active) return;
    const x = poutine.x;
    const y = poutine.y;
    this.tweens.killTweensOf(poutine);
    poutine.destroy();

    const before = this.multiplier;
    this.combo += 1;
    this.applyScore(POUTINE.value);
    audio.play("pickup");
    this.popScoreText();

    // Spark burst — bigger at higher tiers; the whole field heats up if a new tier is hit.
    this.sparks.explode(6 + this.multiplier * 4, x, y);
    if (this.multiplier > before) this.applyMultiplierFx();
  }

  // --- Power-ups -------------------------------------------------------------

  private collectPowerup(pw: Phaser.Physics.Arcade.Image): void {
    if (!pw.active) return;
    const kind = pw.getData("kind") as PowerupKind;
    const x = pw.x;
    const y = pw.y;
    this.tweens.killTweensOf(pw);
    pw.destroy();
    this.sparks.explode(16, x, y);
    audio.play(kind); // slowmo / invincible (envoye donc!) / magnet / heart

    switch (kind) {
      case "slowmo":
        this.slowmoUntil = this.time.now + POWERUPS.slowmoMs;
        break;
      case "invincible":
        this.invincibleUntil = this.time.now + POWERUPS.invincibleMs;
        break;
      case "magnet":
        this.magnetUntil = this.time.now + POWERUPS.magnetMs;
        break;
      case "heart":
        this.collectHeart();
        break;
    }
  }

  private collectHeart(): void {
    if (this.lives < LIVES.count) {
      this.lives += 1;
      this.updateLivesHud();
      this.cameras.main.flash(140, 80, 220, 120);
    } else {
      // Already at full health — turn it into a small point reward instead of wasting it.
      this.applyScore(POUTINE.value);
      this.popScoreText();
    }
  }

  /** Per-frame: toggle effect visuals/audio on transitions, run the magnet, draw timer bars. */
  private updateEffects(): void {
    const slow = this.slowmoActive;
    const inv = this.invincibleActive;
    const mag = this.magnetActive;

    if (slow !== this.fxSlowmo) {
      this.fxSlowmo = slow;
      this.tweens.add({ targets: this.slowmoTint, alpha: slow ? 0.22 : 0, duration: 300 });
    }
    if (inv !== this.fxInvincible) {
      this.fxInvincible = inv;
      if (inv) this.startAura();
      else this.stopAura();
    }
    if (mag !== this.fxMagnet) {
      this.fxMagnet = mag;
      if (mag) this.startMagnetRing();
      else this.stopMagnetRing();
    }

    this.applyAudioRate();

    if (this.aura) this.aura.setPosition(this.bird.x, this.bird.y);
    if (this.magnetRing) this.magnetRing.setPosition(this.bird.x, this.bird.y);
    if (mag) this.autoCollectPoutines();

    this.drawEffectBars();
  }

  /** Push the audio pitch for the current effect (slow-mo deepens, invincible raises). */
  private applyAudioRate(): void {
    const rate = this.slowmoActive
      ? POWERUPS.slowmoRate
      : this.invincibleActive
        ? POWERUPS.invincibleRate
        : 1;
    if (rate !== this.audioRate) {
      this.audioRate = rate;
      this.music.setRate(rate);
      audio.setRate(rate);
    }
  }

  private startAura(): void {
    this.stopAura();
    this.aura = this.add.circle(this.bird.x, this.bird.y, 32).setStrokeStyle(4, 0xffd23f, 1).setDepth(3);
    this.tweens.add({
      targets: this.aura,
      scale: { from: 0.85, to: 1.15 },
      alpha: { from: 1, to: 0.5 },
      duration: 350,
      yoyo: true,
      repeat: -1,
    });
  }

  private stopAura(): void {
    this.aura?.destroy();
    this.aura = undefined;
  }

  private startMagnetRing(): void {
    this.stopMagnetRing();
    this.magnetRing = this.add
      .circle(this.bird.x, this.bird.y, POWERUPS.magnetRadius)
      .setStrokeStyle(2, 0x8b4fd0, 0.4)
      .setDepth(1);
  }

  private stopMagnetRing(): void {
    this.magnetRing?.destroy();
    this.magnetRing = undefined;
  }

  /** Auto-collect any poutine inside the (small) magnet radius — reliable and snappy, no pull. */
  private autoCollectPoutines(): void {
    const r2 = POWERUPS.magnetRadius * POWERUPS.magnetRadius;
    for (const obj of this.poutines.getChildren()) {
      const p = obj as Phaser.Physics.Arcade.Image;
      if (!p.active) continue;
      const dx = this.bird.x - p.x;
      const dy = this.bird.y - p.y;
      if (dx * dx + dy * dy <= r2) this.collectPoutine(p);
    }
  }

  /** Stacked countdown bars (top-left, under the hearts) for each active timed effect. */
  private drawEffectBars(): void {
    this.effectBars.clear();
    const now = this.time.now;
    let y = 52;
    const x = 18;
    const w = 96;
    const h = 9;

    const bar = (until: number, total: number, color: number) => {
      const frac = Phaser.Math.Clamp((until - now) / total, 0, 1);
      this.effectBars.fillStyle(0x000000, 0.4);
      this.effectBars.fillRoundedRect(x, y, w, h, 4);
      this.effectBars.fillStyle(color, 1);
      this.effectBars.fillRoundedRect(x, y, w * frac, h, 4);
      y += 14;
    };

    if (this.slowmoActive) bar(this.slowmoUntil, POWERUPS.slowmoMs, 0x46c7ff);
    if (this.invincibleActive) bar(this.invincibleUntil, POWERUPS.invincibleMs, 0xffd23f);
    if (this.magnetActive) bar(this.magnetUntil, POWERUPS.magnetMs, 0xb96bff);
  }

  // --- Quiz ------------------------------------------------------------------

  private triggerQuiz(gate: QuizGate): void {
    if (this.quizActive) return;
    this.quizActive = true;
    gate.triggered = true;
    gate.banner.destroy();
    const idx = this.gates.indexOf(gate);
    if (idx >= 0) this.gates.splice(idx, 1);

    audio.play("quiz_start");
    this.music.pause();
    const question = this.questions.next(this.score);
    this.scene.pause();
    this.scene.launch(SCENES.Quiz, {
      question,
      onResolved: (correct: boolean) => this.onQuizResolved(correct),
    });
  }

  private onQuizResolved(correct: boolean): void {
    this.quizActive = false;
    // Resume the scene first so timers run, but resolve the answer BEFORE resuming the music —
    // a wrong answer on the last life ends the run, and we don't want to restart the loop only
    // to immediately pause it again.
    this.scene.resume();
    if (correct) {
      audio.play("quiz_correct");
      this.applyScore(QUIZ.bonus);
      this.popScoreText();
      if (!this.shielded) this.grantShield();
    } else {
      // A wrong answer costs a life and also strips any shield earned earlier; loseLife breaks
      // the combo too. If that empties the last life, the game is already over — bail out.
      audio.play("quiz_wrong");
      if (this.shielded) this.clearShield();
      this.loseLife(false);
      if (this.gameOver) return;
    }
    this.music.resume();
    this.applyAudioRate();

    // Hold the bird in place and freeze the field briefly so it doesn't immediately drop or
    // hit a pipe while the player re-orients after reading the explanation. The first flap
    // (or the timeout) ends the grace.
    this.graceUntil = this.time.now + QUIZ.graceMs;
    this.birdBody.setVelocity(0, 0);
    this.birdBody.setAllowGravity(false);
    this.obstacles.setVelocityX(0);
    this.poutines.setVelocityX(0);
    this.powerups.setVelocityX(0);
    for (const gate of this.gates) {
      (gate.banner.body as Phaser.Physics.Arcade.Body).setVelocityX(0);
    }
  }

  private endGrace(): void {
    if (this.graceUntil === 0) return;
    this.graceUntil = 0;
    this.birdBody.setAllowGravity(true);
    this.birdBody.setGravityY(PHYSICS.gravity);
    this.recomputeSpeed();
  }

  // --- Shield ----------------------------------------------------------------

  private grantShield(): void {
    this.shielded = true;
    audio.play("shield");
    this.shieldRing = this.add
      .circle(this.bird.x, this.bird.y, 30)
      .setStrokeStyle(3, 0x43c463, 0.9)
      .setDepth(3);
    this.tweens.add({
      targets: this.shieldRing,
      alpha: { from: 0.9, to: 0.4 },
      duration: 500,
      yoyo: true,
      repeat: -1,
    });
  }

  /** Remove the shield ring without any of the hit/invuln side effects. */
  private clearShield(): void {
    this.shielded = false;
    this.shieldRing?.destroy();
    this.shieldRing = undefined;
  }

  /** A shield absorbs one obstacle hit: drop the shield, grant a short invuln, break combo. */
  private popShield(): void {
    this.clearShield();
    this.invulnUntil = this.time.now + SHIELD.invulnMs;
    this.combo = 0;
    this.applyMultiplierFx();
    this.cameras.main.flash(120, 80, 220, 120);
    this.blinkBird();
  }

  // --- Scoring ---------------------------------------------------------------

  /** All points scale by the current multiplier; difficulty is handled separately. */
  private applyScore(points: number): void {
    this.score += points * this.multiplier;
    this.scoreText.setText(String(this.score));
  }

  /** Speed is a purely TIME-DRIVEN, monotonic step ramp — it only ever climbs over a run and
   *  is independent of score/combo, so a wrong answer (combo reset) never changes difficulty.
   *  Called every frame; the multiplier is a reward layer only (score + music + visuals). */
  private recomputeSpeed(): void {
    const base = Math.min(
      DIFFICULTY.speedMax,
      DIFFICULTY.speedStart +
        DIFFICULTY.speedPerStep * Math.pow(this.difficultyStep, DIFFICULTY.speedAccel),
    );
    // Slow-mo scales the whole world (and the distance-based spawn) by timeFactor.
    this.currentSpeed = base * this.timeFactor;
    this.obstacles.setVelocityX(-this.currentSpeed);
    this.poutines.setVelocityX(-this.currentSpeed);
    this.powerups.setVelocityX(-this.currentSpeed);
    for (const gate of this.gates) {
      (gate.banner.body as Phaser.Physics.Arcade.Body).setVelocityX(-this.currentSpeed);
    }
  }

  /** Sync the music intensity, tint, and multiplier badge to the current tier. */
  private applyMultiplierFx(): void {
    const m = this.multiplier;
    const t = (m - 1) / (MULTIPLIER.max - 1); // 0 at x1, 1 at max
    this.music.setIntensity(t);

    this.tweens.add({
      targets: this.hypeTint,
      alpha: t * 0.18,
      duration: 400,
      ease: "Sine.Out",
    });

    if (m > 1) {
      this.multiplierText.setText(`x${m}`).setVisible(true);
      this.tweens.add({
        targets: this.multiplierText,
        scale: { from: 1.5, to: 1 },
        duration: 260,
        ease: "Back.Out",
      });
    } else {
      this.multiplierText.setVisible(false);
    }
  }

  private popScoreText(): void {
    this.tweens.add({
      targets: this.scoreText,
      scale: { from: 1.3, to: 1 },
      duration: 180,
      ease: "Back.Out",
    });
  }

  // --- Lives / crashes -------------------------------------------------------

  /** Bird touched an obstacle: a shield absorbs it, otherwise it costs a life. */
  private onObstacleHit(): void {
    if (this.gameOver || this.quizActive) return;
    if (this.graceUntil > 0) return; // post-quiz re-orientation window is protected
    if (this.invincibleActive) return; // étoile/castor: fly straight through
    if (this.time.now < this.invulnUntil) return;
    if (this.shielded) {
      this.popShield();
      return;
    }
    this.loseLife(true);
  }

  /** Spend one life. Breaks the combo; ends the run at zero. A crash also grants a brief
   *  invulnerability window so you don't instantly re-collide with the same obstacle. */
  private loseLife(fromCrash: boolean): void {
    this.lives -= 1;
    this.updateLivesHud();
    this.combo = 0;
    this.applyMultiplierFx();

    if (this.lives <= 0) {
      this.triggerGameOver();
      return;
    }

    if (fromCrash) this.invulnUntil = this.time.now + LIVES.hitInvulnMs;
    this.cameras.main.flash(120, 255, 110, 110);
    this.blinkBird();
  }

  /** Snap the bird back to the vertical center, stationary — used after a floor/ceiling crash. */
  private recenterBird(): void {
    this.bird.y = GAME.height / 2;
    this.bird.angle = 0;
    this.birdBody.setVelocity(0, 0);
    if (this.shieldRing) this.shieldRing.setPosition(this.bird.x, this.bird.y);
  }

  private blinkBird(): void {
    this.tweens.add({
      targets: this.bird,
      alpha: { from: 0.3, to: 1 },
      duration: 160,
      repeat: 3,
      yoyo: true,
      onComplete: () => this.bird.setAlpha(1),
    });
  }

  private triggerGameOver(): void {
    if (this.gameOver) return;
    this.gameOver = true;
    audio.setRate(1);
    audio.play("gameover");
    this.music.setRate(1);
    this.music.pause();
    this.stopAura();
    this.stopMagnetRing();

    this.birdBody.setVelocity(0, 0);
    this.birdBody.setAllowGravity(false);
    this.obstacles.setVelocityX(0);
    this.poutines.setVelocityX(0);
    this.powerups.setVelocityX(0);
    this.shieldRing?.destroy();

    this.cameras.main.shake(220, 0.012);
    this.cameras.main.flash(160, 255, 80, 80);

    this.time.delayedCall(650, () => {
      this.scene.start(SCENES.GameOver, {
        score: this.score,
        mode: this.mode,
        pseudo: this.pseudo,
        seed: this.seed,
      });
    });
  }
}
