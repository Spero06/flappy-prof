import Phaser from "phaser";
import { GAME, SCENES } from "../config";

/**
 * Loads assets and shows a progress bar. Real sprites/audio arrive in later phases;
 * for now we generate simple placeholder textures so gameplay scenes have something
 * to draw.
 */
export class PreloadScene extends Phaser.Scene {
  constructor() {
    super(SCENES.Preload);
  }

  preload(): void {
    this.drawLoadingBar();
    // Grammar bank (authored content — loaded, never modified). Served from public/.
    this.load.json("questions", "questions.json");
  }

  create(): void {
    this.generatePlaceholderTextures();
    this.waitForFonts().then(() => this.scene.start(SCENES.Menu));
  }

  /**
   * Phaser measures fonts at text-creation time and won't reflow if a web font
   * loads later, so make sure our display fonts are ready before the menu renders.
   * Falls back after a short timeout if the network is unavailable.
   */
  private async waitForFonts(): Promise<void> {
    const fonts = ['64px "Luckiest Guy"', '600 24px "Fredoka"', '400 20px "Fredoka"'];
    const ready = Promise.all(fonts.map((f) => document.fonts.load(f)))
      .then(() => document.fonts.ready)
      .then(() => undefined);
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, 2500));
    await Promise.race([ready, timeout]);
  }

  private drawLoadingBar(): void {
    const cx = GAME.width / 2;
    const cy = GAME.height / 2;
    const barWidth = GAME.width * 0.6;
    const barHeight = 18;

    const label = this.add
      .text(cx, cy - 40, "Chargement…", {
        fontFamily: "sans-serif",
        fontSize: "22px",
        color: "#ffffff",
      })
      .setOrigin(0.5);

    const border = this.add.graphics();
    border.lineStyle(2, 0xffffff, 0.8);
    border.strokeRect(cx - barWidth / 2, cy - barHeight / 2, barWidth, barHeight);

    const fill = this.add.graphics();
    this.load.on("progress", (value: number) => {
      fill.clear();
      fill.fillStyle(0xffcc00, 1);
      fill.fillRect(
        cx - barWidth / 2 + 2,
        cy - barHeight / 2 + 2,
        (barWidth - 4) * value,
        barHeight - 4,
      );
    });

    this.load.on("complete", () => {
      fill.destroy();
      border.destroy();
      label.destroy();
    });
  }

  /** Build a few reusable textures from Graphics so later phases can use keys. */
  private generatePlaceholderTextures(): void {
    // Bird (the prof) — a yellow circle with a beak, placeholder for the caricature.
    const bird = this.add.graphics();
    bird.fillStyle(0xffd23f, 1);
    bird.fillCircle(24, 24, 22);
    bird.fillStyle(0xff7a00, 1);
    bird.fillTriangle(44, 20, 44, 30, 56, 25);
    bird.fillStyle(0x000000, 1);
    bird.fillCircle(30, 18, 4);
    bird.generateTexture("bird", 60, 48);
    bird.destroy();

    // Obstacle segment — a green pillar (poutine-tower placeholder).
    const pipe = this.add.graphics();
    pipe.fillStyle(0x3aa655, 1);
    pipe.fillRect(0, 0, 70, 64);
    pipe.lineStyle(3, 0x1f5e30, 1);
    pipe.strokeRect(0, 0, 70, 64);
    pipe.generateTexture("obstacle", 70, 64);
    pipe.destroy();

    // Ground / ceiling strip.
    const ground = this.add.graphics();
    ground.fillStyle(0x6b4f2a, 1);
    ground.fillRect(0, 0, GAME.width, 32);
    ground.generateTexture("ground", GAME.width, 32);
    ground.destroy();

    // Poutine collectible — a little fries box with golden fries (placeholder).
    const pt = this.add.graphics();
    pt.fillStyle(0x000000, 0.25);
    pt.fillEllipse(24, 42, 34, 8); // shadow
    pt.fillStyle(0xffcf5c, 1); // fries poking out
    for (let i = 0; i < 5; i++) {
      pt.fillRect(10 + i * 6, 6 + (i % 2) * 4, 4, 22);
    }
    pt.fillStyle(0xb5651d, 1); // box
    pt.fillRoundedRect(8, 22, 32, 22, 4);
    pt.fillStyle(0x8a4b12, 1); // gravy line
    pt.fillRoundedRect(8, 22, 32, 7, 3);
    pt.generateTexture("poutine", 48, 48);
    pt.destroy();

    // Quiz gate — a Québec-flag tile (blue field, white cross, fleur-de-lis). Tiled
    // vertically into a full-height banner so the gate reads as an unavoidable wall.
    const flag = this.add.graphics();
    flag.fillStyle(0x0a3d91, 1);
    flag.fillRect(0, 0, 48, 64);
    flag.fillStyle(0xffffff, 1);
    flag.fillRect(21, 0, 6, 64); // cross — vertical arm
    flag.fillRect(0, 29, 48, 6); // cross — horizontal arm
    const fleur = (cx: number, cy: number) => {
      flag.fillStyle(0xffffff, 1);
      flag.fillEllipse(cx, cy - 3, 7, 18); // centre petal
      flag.fillEllipse(cx - 6, cy, 7, 13); // left petal
      flag.fillEllipse(cx + 6, cy, 7, 13); // right petal
      flag.fillRoundedRect(cx - 8, cy + 5, 16, 4, 2); // band
    };
    fleur(11, 15);
    fleur(37, 15);
    fleur(11, 49);
    fleur(37, 49);
    flag.generateTexture("quizGate", 48, 64);
    flag.destroy();

    this.generatePowerupTextures();
  }

  /** Power-up collectibles: a coloured disc + a simple symbol, so each kind reads at a glance. */
  private generatePowerupTextures(): void {
    const S = 48;
    const c = S / 2;

    // Helper: filled disc with a soft ring.
    const disc = (g: Phaser.GameObjects.Graphics, color: number) => {
      g.fillStyle(0x000000, 0.22);
      g.fillCircle(c, c + 2, 21);
      g.fillStyle(color, 1);
      g.fillCircle(c, c, 21);
      g.lineStyle(3, 0xffffff, 0.85);
      g.strokeCircle(c, c, 21);
    };

    // Horloge (slow-mo) — cyan clock with two hands.
    const clock = this.add.graphics();
    disc(clock, 0x1f9fd0);
    clock.lineStyle(3, 0xffffff, 1);
    clock.beginPath();
    clock.moveTo(c, c);
    clock.lineTo(c, c - 11);
    clock.strokePath();
    clock.beginPath();
    clock.moveTo(c, c);
    clock.lineTo(c + 8, c + 3);
    clock.strokePath();
    clock.fillStyle(0xffffff, 1);
    clock.fillCircle(c, c, 2.5);
    clock.generateTexture("pw_clock", S, S);
    clock.destroy();

    // Étoile (invincible) — gold star.
    const star = this.add.graphics();
    disc(star, 0xe0a92b);
    star.fillStyle(0xfff2b0, 1);
    star.fillPoints(this.starPoints(c, c, 5, 13, 6), true);
    star.generateTexture("pw_star", S, S);
    star.destroy();

    // Cœur (+1 vie) — red heart.
    const heart = this.add.graphics();
    disc(heart, 0xd23b53);
    heart.fillStyle(0xffffff, 1);
    heart.fillCircle(c - 5, c - 3, 5.5);
    heart.fillCircle(c + 5, c - 3, 5.5);
    heart.fillTriangle(c - 10, c - 1, c + 10, c - 1, c, c + 12);
    heart.generateTexture("pw_heart", S, S);
    heart.destroy();

    // Aimant à poutine (magnet) — purple horseshoe magnet.
    const magnet = this.add.graphics();
    disc(magnet, 0x8b4fd0);
    magnet.lineStyle(7, 0xffffff, 1);
    magnet.beginPath();
    magnet.arc(c, c - 2, 9, Phaser.Math.DegToRad(180), Phaser.Math.DegToRad(360), false);
    magnet.strokePath();
    magnet.fillStyle(0xffffff, 1);
    magnet.fillRect(c - 12.5, c - 2, 7, 11);
    magnet.fillRect(c + 5.5, c - 2, 7, 11);
    magnet.fillStyle(0xff5c5c, 1);
    magnet.fillRect(c - 12.5, c + 6, 7, 4);
    magnet.fillRect(c + 5.5, c + 6, 7, 4);
    magnet.generateTexture("pw_magnet", S, S);
    magnet.destroy();
  }

  private starPoints(
    cx: number,
    cy: number,
    spikes: number,
    outer: number,
    inner: number,
  ): Phaser.Geom.Point[] {
    const points: Phaser.Geom.Point[] = [];
    const step = Math.PI / spikes;
    let rot = -Math.PI / 2;
    for (let i = 0; i < spikes; i++) {
      points.push(new Phaser.Geom.Point(cx + Math.cos(rot) * outer, cy + Math.sin(rot) * outer));
      rot += step;
      points.push(new Phaser.Geom.Point(cx + Math.cos(rot) * inner, cy + Math.sin(rot) * inner));
      rot += step;
    }
    return points;
  }
}
