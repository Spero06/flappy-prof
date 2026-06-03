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
import type {
  GhostPosition,
  PeerEvent,
  RoomHandle,
  RoomMember,
  RoomResult,
  RoomRow,
} from "../systems/Net";

interface GameInit {
  mode: "solo" | "multi";
  pseudo: string;
  seed?: number;
  /** Room id for a multi run (used for room-scoped scoring later). */
  roomId?: string;
  /** Live Realtime room handle, handed over from the lobby (multi only). */
  room?: RoomHandle;
  /** Full room row, carried so "Rejouer" can hand it back to the lobby for another round. */
  roomRow?: RoomRow;
}

/** A remote player rendered as a low-opacity ghost (multi). */
interface Ghost {
  sprite: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
  targetY: number;
  pseudo: string;
  score: number;
  alive: boolean;
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
  private roomId?: string;

  // Multiplayer (ghost mode).
  private room: RoomHandle | null = null;
  private ghosts = new Map<string, Ghost>();
  private results = new Map<string, { pseudo: string; score: number; finished: boolean }>();
  private countdownActive = false;
  private multiEnded = false;
  /** Picks that arrived before the local quiz for that question opened (entry-skew buffer). */
  private pendingPicks = new Map<string, { pseudo: string; option: string }[]>();
  private currentQuestionId: string | null = null;
  private posInterval?: number;
  private roomRow?: RoomRow;
  /** True while transitioning back to the lobby for another round — keeps the room alive. */
  private rejoining = false;
  /** Eliminated but watching the others race (multi). */
  private spectating = false;
  private spectateBoard?: Phaser.GameObjects.Text;
  private spectateCount?: Phaser.GameObjects.Text;
  /** Whether we currently hold the room lead — so taking it is announced once, not every frame. */
  private hasLead = false;
  private lastLeadAt = 0;
  /** Throttle for incoming peer-event sounds (don't stack when many fire at once). */
  private lastPeerSoundAt = 0;

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
    this.roomId = data.roomId;
    this.room = data.room ?? null;
    this.roomRow = data.roomRow;
    this.rejoining = false;
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
    this.ghosts.clear();
    this.results.clear();
    this.pendingPicks.clear();
    this.currentQuestionId = null;
    this.countdownActive = false;
    this.multiEnded = false;
    this.spectating = false;
    this.hasLead = false;
    this.lastLeadAt = 0;
    this.lastPeerSoundAt = 0;
    this.spectateBoard = undefined;
    this.spectateCount = undefined;
    this.scoreboardText = undefined;
    this.rng = new Rng(this.seed);
    // In multiplayer, seed the question stream too (from the shared seed, but a separate
    // sub-seed so it doesn't consume the obstacle RNG) → everyone gets the SAME questions in
    // the same order with the same option layout (needed for the synchronized quiz + fair scores).
    const questionRng = this.mode === "multi" ? new Rng((this.seed ^ 0x9e3779b9) >>> 0) : undefined;
    this.questions = new QuestionManager(
      (this.cache.json.get("questions") as Question[]) ?? [],
      questionRng,
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
    this.bindInput();

    // Apply the saved master volume to both audio systems.
    this.setVolume(loadVolume());

    // Make sure the music loop is torn down (and pitch reset) when the scene ends.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.music.setRate(1);
      audio.setRate(1);
      this.music.pause();
      this.stopPosBroadcast();
      // Keep the room channel alive when heading back to the lobby for another round.
      if (!this.rejoining) this.room?.leave();
    });

    // Multiplayer: a 3-2-1 countdown plays ON the game screen (everyone is already here, ready),
    // then the run auto-starts for all. Solo keeps the "tap to start" prompt.
    if (this.mode === "multi") {
      this.setupMulti();
      this.startMultiCountdown();
    } else {
      this.createStartPrompt();
    }
  }

  /** Begin the run immediately: start the world + a free initial flap so the bird is aloft and
   *  identical across clients, instead of waiting for a tap. */
  private autoStart(): void {
    audio.unlock();
    this.startRun();
    this.birdBody.setVelocityY(-PHYSICS.flapVelocity);
    audio.play("flap");
  }

  // ---------------------------------------------------------------------------
  // Multiplayer (ghost mode)
  // ---------------------------------------------------------------------------

  /** Take over the room channel from the lobby + start the ~12 Hz position broadcast. */
  private setupMulti(): void {
    if (!this.room) return;
    this.results.set("self", { pseudo: this.pseudo, score: 0, finished: false });
    this.room.setHandlers({
      onPresence: (m) => this.onGhostPresence(m),
      onPosition: (p) => this.onGhostPosition(p),
      onPick: (p) => this.forwardPick(p),
      onResult: (r) => this.onGhostResult(r),
      onPeerEvent: (e) => this.onPeerEvent(e),
    });
    // Broadcast our position ~12×/sec for ghosts + the live scoreboard. Uses a window timer
    // (NOT a scene timer) so it keeps firing while OUR game is paused for a quiz — otherwise our
    // ghost would freeze and then jump on everyone else's screen. Stops on death/shutdown.
    this.posInterval = window.setInterval(() => {
      if (!this.started || this.gameOver || !this.room) return;
      this.room.broadcastPosition({
        y: this.bird.y,
        alive: true,
        score: this.score,
        pseudo: this.pseudo,
      });
    }, 83);
  }

  private stopPosBroadcast(): void {
    if (this.posInterval !== undefined) {
      window.clearInterval(this.posInterval);
      this.posInterval = undefined;
    }
  }

  /** On-screen 3-2-1-GO, then auto-start the run (everyone is already on the game screen). */
  private startMultiCountdown(): void {
    this.countdownActive = true;
    const cx = GAME.width / 2;
    const num = this.add
      .text(cx, GAME.height * 0.42, "3", {
        fontFamily: TITLE_FONT,
        fontSize: "120px",
        color: "#ffd23f",
      })
      .setOrigin(0.5)
      .setStroke("#1d2b53", 10)
      .setDepth(30);
    const pump = (label: string) => {
      num.setText(label).setScale(1.6);
      this.tweens.add({ targets: num, scale: 1, duration: 350, ease: "Back.Out" });
    };
    pump("3");
    const steps = ["2", "1", "GO !"];
    steps.forEach((label, i) => {
      this.time.delayedCall(800 * (i + 1), () => pump(label));
    });
    this.time.delayedCall(800 * steps.length + 300, () => {
      num.destroy();
      this.countdownActive = false;
      this.autoStart();
    });
  }

  private onGhostPresence(members: RoomMember[]): void {
    const ids = new Set(members.map((m) => m.id));
    for (const [id, ghost] of this.ghosts) {
      if (!ids.has(id)) {
        ghost.sprite.destroy();
        ghost.label.destroy();
        this.ghosts.delete(id);
        // Keep a player's FINAL result on the board even after they leave (don't erase the
        // winner as everyone navigates away); only drop still-playing leavers.
        if (!this.results.get(id)?.finished) this.results.delete(id);
      }
    }
  }

  private onGhostPosition(p: GhostPosition): void {
    let ghost = this.ghosts.get(p.id);
    if (!ghost) {
      const sprite = this.add
        .image(GAME.width * PHYSICS.birdX, p.y, "bird")
        .setAlpha(0.4)
        .setTint(0x9fd0ff)
        .setDepth(1);
      const label = this.add
        .text(GAME.width * PHYSICS.birdX, p.y - 24, p.pseudo, {
          fontFamily: UI_FONT,
          fontSize: "12px",
          color: "#cfe6ff",
        })
        .setOrigin(0.5)
        .setAlpha(0.7)
        .setDepth(1);
      ghost = { sprite, label, targetY: p.y, pseudo: p.pseudo, score: p.score, alive: p.alive };
      this.ghosts.set(p.id, ghost);
    }
    ghost.targetY = p.y;
    ghost.score = p.score;
    ghost.alive = p.alive;
    ghost.sprite.setAlpha(p.alive ? 0.4 : 0.18);
    // Never downgrade a finalized result back to "still playing" (a late position can arrive
    // after the result broadcast).
    if (!this.results.get(p.id)?.finished) {
      this.results.set(p.id, { pseudo: p.pseudo, score: p.score, finished: !p.alive });
    }
  }

  private onGhostResult(r: RoomResult): void {
    this.results.set(r.id, { pseudo: r.pseudo, score: r.score, finished: true });
    if (this.multiEnded) this.renderScoreboard();
  }

  /** A shared dramatic moment from another player: a peer was eliminated / took the lead. Plays a
   *  short room-wide sound (throttled so simultaneous events don't stack) + a brief toast. Keeps
   *  flap/pass/etc. local — only these rare beats are shared (so 20 players ≠ 20 overlapping flaps). */
  private onPeerEvent(e: PeerEvent): void {
    if (this.scoreboardText) return; // final results are up; stay quiet
    const sound = e.kind === "eliminated" ? "peer_out" : "peer_lead";
    if (this.time.now - this.lastPeerSoundAt > 250) {
      this.lastPeerSoundAt = this.time.now;
      audio.play(sound);
    }
    if (e.kind === "eliminated") {
      this.showToast(`💀  ${e.pseudo} est éliminé !`, "#ff8a8a");
    } else {
      // A peer overtook everyone — if it was us they just passed, we no longer hold the lead.
      if (this.score <= (e.score ?? 0)) this.hasLead = false;
      this.showToast(`👑  ${e.pseudo} prend la tête !`, "#ffd23f");
    }
  }

  /** Brief top-of-screen notice that floats up and fades (used for shared multiplayer moments). */
  private showToast(text: string, color: string): void {
    const t = this.add
      .text(GAME.width / 2, GAME.height * 0.14, text, {
        fontFamily: UI_FONT,
        fontSize: "19px",
        color,
        fontStyle: "700",
        align: "center",
        stroke: "#1d2b53",
        strokeThickness: 4,
      })
      .setOrigin(0.5)
      .setDepth(36)
      .setScale(0.8);
    this.tweens.add({ targets: t, scale: 1, duration: 180, ease: "Back.Out" });
    this.tweens.add({
      targets: t,
      y: t.y - 34,
      alpha: 0,
      delay: 1100,
      duration: 700,
      ease: "Sine.In",
      onComplete: () => t.destroy(),
    });
  }

  /** Route a remote pick: live to the open quiz if it's for the same question, else buffer it
   *  (the receiver may not have reached this gate yet — entry skew). */
  private forwardPick(p: { id: string; pseudo: string; option: string; questionId: string }): void {
    if (
      this.quizActive &&
      p.questionId === this.currentQuestionId &&
      this.scene.isActive(SCENES.Quiz)
    ) {
      this.scene.get(SCENES.Quiz)?.events.emit("remotePick", p);
      return;
    }
    const list = this.pendingPicks.get(p.questionId) ?? [];
    list.push({ pseudo: p.pseudo, option: p.option });
    this.pendingPicks.set(p.questionId, list);
  }

  /** Smoothly move ghosts toward their last broadcast y; called from update(). */
  private updateGhosts(): void {
    for (const ghost of this.ghosts.values()) {
      ghost.sprite.y = Phaser.Math.Linear(ghost.sprite.y, ghost.targetY, 0.25);
      ghost.label.y = ghost.sprite.y - 24;
    }
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
    // Hitbox centered on the bird's body disc (texture is 60×48, body circle ~r22 at 24,24),
    // slightly smaller than the art so collisions feel fair (not biased to one side).
    this.birdBody.setCircle(19, 5, 5);
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

    // No manual pause in a live multiplayer race (it would desync / let you cheat-think).
    if (this.mode !== "multi") this.createPauseButton();
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
    if (this.mode === "multi") return; // no pausing a live race
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
    if (this.gameOver || this.quizActive || this.countdownActive) return;
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
    if (this.spectating) {
      this.updateGhosts();
      this.refreshSpectate();
      return;
    }
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
    if (this.mode === "multi") this.updateGhosts();

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
    this.currentQuestionId = question.id;
    // Picks for this question that arrived before we opened the quiz (entry skew).
    const initialPicks = this.pendingPicks.get(question.id) ?? [];
    this.pendingPicks.delete(question.id);
    this.scene.pause();
    this.scene.launch(SCENES.Quiz, {
      question,
      onResolved: (correct: boolean) => this.onQuizResolved(correct),
      // Multiplayer: the quiz is a SYNCHRONIZED, timed shared moment with everyone's picks shown.
      timed: this.mode === "multi",
      initialPicks,
      broadcastPick:
        this.mode === "multi"
          ? (option: string) =>
              this.room?.broadcastPick({ pseudo: this.pseudo, option, questionId: question.id })
          : undefined,
    });
  }

  private onQuizResolved(correct: boolean): void {
    this.quizActive = false;
    this.currentQuestionId = null;
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
    const before = this.score;
    this.score += points * this.multiplier;
    this.scoreText.setText(String(this.score));
    // Encouragement clip every 10 points ("continue, c'est bon ça !", CLAUDE.md 5.3).
    if (Math.floor(this.score / 10) > Math.floor(before / 10)) audio.play("milestone");
    this.checkLeadChange();
  }

  /** Multiplayer: announce to the whole room (once) when we overtake everyone to take the lead. */
  private checkLeadChange(): void {
    if (this.mode !== "multi" || this.ghosts.size === 0 || this.score <= 0) return;
    let othersMax = 0;
    for (const g of this.ghosts.values()) othersMax = Math.max(othersMax, g.score);
    if (this.score > othersMax) {
      // Newly in front (and not spamming): tell the room + give ourselves a local crown toast.
      if (!this.hasLead && this.time.now - this.lastLeadAt > 4000) {
        this.hasLead = true;
        this.lastLeadAt = this.time.now;
        this.room?.broadcastPeerEvent({ pseudo: this.pseudo, kind: "lead", score: this.score });
        this.showToast("👑  Tu prends la tête !", "#ffd23f");
      }
    } else if (this.score < othersMax) {
      this.hasLead = false; // someone passed us — we can re-claim the lead later
    }
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

    if (this.mode === "multi") {
      // Multiplayer scores are EPHEMERAL — never written to the DB. Broadcast our final score
      // and show the live room scoreboard (top 5) in-scene.
      this.multiEnded = true;
      this.stopPosBroadcast();
      this.results.set("self", { pseudo: this.pseudo, score: this.score, finished: true });
      this.room?.broadcastResult({ pseudo: this.pseudo, score: this.score });
      // Tell the room one of us just went down (shared dramatic moment).
      this.room?.broadcastPeerEvent({ pseudo: this.pseudo, kind: "eliminated" });
      this.time.delayedCall(650, () => this.enterSpectate());
      return;
    }

    this.time.delayedCall(650, () => {
      this.scene.start(SCENES.GameOver, {
        score: this.score,
        mode: this.mode,
        pseudo: this.pseudo,
        seed: this.seed,
        roomId: this.roomId,
      });
    });
  }

  // --- Multiplayer results (ephemeral room scoreboard) -----------------------

  private scoreboardText?: Phaser.GameObjects.Text;

  private showMultiResults(): void {
    if (this.scoreboardText) return; // already showing (avoid re-entry from refreshSpectate)
    this.spectating = false;
    const cx = GAME.width / 2;
    this.add.rectangle(0, 0, GAME.width, GAME.height, 0x0a0f24, 0.92).setOrigin(0).setDepth(40);
    this.add
      .text(cx, GAME.height * 0.16, "Résultats", {
        fontFamily: TITLE_FONT,
        fontSize: "44px",
        color: "#ffd23f",
      })
      .setOrigin(0.5)
      .setDepth(41)
      .setStroke("#1d2b53", 7);

    // Winner highlight (top scorer), once everyone is done.
    const winner = [...this.results.values()].sort((a, b) => b.score - a.score)[0];
    if (winner && this.stillRacing() === 0) {
      this.add
        .text(cx, GAME.height * 0.24, `🏆 Vainqueur : ${winner.pseudo} !`, {
          fontFamily: UI_FONT,
          fontSize: "20px",
          color: "#ffd23f",
          fontStyle: "700",
        })
        .setOrigin(0.5)
        .setDepth(41);
    }

    this.scoreboardText = this.add
      .text(cx, GAME.height * 0.3, "", {
        fontFamily: UI_FONT,
        fontSize: "22px",
        color: "#ffffff",
        align: "left",
        fontStyle: "600",
        lineSpacing: 12,
      })
      .setOrigin(0.5, 0)
      .setDepth(41);
    this.renderScoreboard();

    // Keep refreshing while other players are still finishing.
    this.time.addEvent({ delay: 500, loop: true, callback: () => this.renderScoreboard() });

    // Rejouer → back to THIS room's lobby (keep the channel) to play another round together.
    if (this.room && this.roomRow) {
      this.resultButton(cx, GAME.height * 0.82, "↻  Rejouer", 0x2fa84f, 0x43c463, () => {
        this.rejoining = true;
        this.scene.start(SCENES.Lobby, {
          pseudo: this.pseudo,
          room: this.room ?? undefined,
          roomRow: this.roomRow,
          rejoin: true,
        });
      });
    }
    this.resultButton(cx, GAME.height * 0.91, "Menu", 0x3f6fd1, 0x5a8dee, () => {
      this.scene.start(SCENES.Menu); // SHUTDOWN leaves the room (rejoining stays false)
    });
  }

  private renderScoreboard(): void {
    if (!this.scoreboardText) return;
    this.scoreboardText.setText(this.scoreboardLines());
  }

  /** Top-5 standings as text (🥇/🥈/🥉 + 4./5., "…" = still racing). */
  private scoreboardLines(): string {
    const entries = [...this.results.values()].sort((a, b) => b.score - a.score).slice(0, 5);
    const medals = ["🥇", "🥈", "🥉", "4.", "5."];
    const lines = entries.map((e, i) => {
      const tag = e.finished ? "" : "  …";
      const me = e.pseudo === this.pseudo ? "  (toi)" : "";
      return `${medals[i]}  ${e.pseudo}${me} — ${e.score}${tag}`;
    });
    return lines.join("\n") || "—";
  }

  /** Number of remote players still racing (not finished). */
  private stillRacing(): number {
    let n = 0;
    for (const [k, v] of this.results) if (k !== "self" && !v.finished) n += 1;
    return n;
  }

  // --- Spectating (eliminated, watching the others) --------------------------

  private enterSpectate(): void {
    // If everyone is already done, skip straight to the final results.
    if (this.stillRacing() === 0) {
      this.showMultiResults();
      return;
    }
    this.spectating = true;
    const cx = GAME.width / 2;

    // Clear the frozen track so the focus is the ghosts + standings (your own run is over).
    this.bird.setVisible(false);
    this.obstacles.setVisible(false);
    this.poutines.setVisible(false);
    this.powerups.setVisible(false);
    for (const gt of this.gates) gt.banner.setVisible(false);

    // Top banner + live standings panel; ghosts stay visible in the middle.
    this.add.rectangle(cx, GAME.height * 0.14, GAME.width, GAME.height * 0.28, 0x0a0f24, 0.72).setDepth(35);
    this.add
      .text(cx, GAME.height * 0.05, "Tu es éliminé — tu regardes !", {
        fontFamily: TITLE_FONT,
        fontSize: "24px",
        color: "#ff7a7a",
      })
      .setOrigin(0.5)
      .setDepth(36)
      .setStroke("#1d2b53", 5);
    this.spectateCount = this.add
      .text(cx, GAME.height * 0.1, "", {
        fontFamily: UI_FONT,
        fontSize: "15px",
        color: "#9fd0ff",
        fontStyle: "600",
      })
      .setOrigin(0.5)
      .setDepth(36);
    this.spectateBoard = this.add
      .text(cx, GAME.height * 0.14, "", {
        fontFamily: UI_FONT,
        fontSize: "18px",
        color: "#ffffff",
        align: "left",
        fontStyle: "600",
        lineSpacing: 6,
      })
      .setOrigin(0.5, 0)
      .setDepth(36);

    this.resultButton(cx, GAME.height * 0.92, "Voir les résultats", 0x3f6fd1, 0x5a8dee, () =>
      this.showMultiResults(),
    );
    this.refreshSpectate();
  }

  private refreshSpectate(): void {
    const racing = this.stillRacing();
    this.spectateCount?.setText(
      racing <= 1 ? `${racing} joueur encore en course` : `${racing} joueurs encore en course`,
    );
    this.spectateBoard?.setText(this.scoreboardLines());
    if (racing === 0) {
      this.spectating = false;
      this.showMultiResults();
    }
  }

  private resultButton(
    cx: number,
    cy: number,
    label: string,
    colorBottom: number,
    colorTop: number,
    onClick: () => void,
  ): void {
    const width = GAME.width * 0.6;
    const height = 50;
    const c = this.add.container(cx, cy).setDepth(41);
    const bg = this.add.graphics();
    bg.fillStyle(0x000000, 0.25);
    bg.fillRoundedRect(-width / 2, -height / 2 + 4, width, height, 15);
    bg.fillGradientStyle(colorTop, colorTop, colorBottom, colorBottom, 1);
    bg.fillRoundedRect(-width / 2, -height / 2, width, height, 15);
    const t = this.add
      .text(0, 0, label, { fontFamily: UI_FONT, fontSize: "21px", color: "#ffffff", fontStyle: "600" })
      .setOrigin(0.5);
    c.add([bg, t]);
    c.setSize(width, height);
    c.setInteractive({ useHandCursor: true });
    c.on("pointerup", onClick);
  }
}
