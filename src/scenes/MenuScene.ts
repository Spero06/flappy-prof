import Phaser from "phaser";
import { GAME, SCENES, STORAGE } from "../config";

const MAX_PSEUDO = 24;

const TITLE_FONT = "Luckiest Guy, sans-serif";
const UI_FONT = "Fredoka, sans-serif";

// Funny, classroom-safe Québécois phrases that drift across the background.
const DRIFT_WORDS = [
  "Voyons donc !",
  "Tabarouette !",
  "Lâche pas la patate !",
  "Attache ta tuque !",
  "Envoye donc !",
  "Ç'a pas d'allure…",
  "Mets-en !",
  "Capote pas, là",
  "Tiguidou !",
  "C'est en plein ça !",
  "Ben voyons…",
  "Maudite poutine !",
  "On lâche pas !",
  "Pantoute",
];

type DrifterKind = "word" | "bird" | "star";

interface Drifter {
  obj: Phaser.GameObjects.Image | Phaser.GameObjects.Text;
  vx: number;
  baseY: number;
  phase: number;
  bobAmp: number;
  kind: DrifterKind;
  baseAlpha: number;
}

/** Modern title screen: animated hero bird, drifting Québécois background, card UI. */
export class MenuScene extends Phaser.Scene {
  private pseudoInput?: HTMLInputElement;
  private drifters: Drifter[] = [];

  constructor() {
    super(SCENES.Menu);
  }

  create(): void {
    const cx = GAME.width / 2;

    this.drifters = [];
    this.generateDecorTextures();
    this.drawBackground();
    this.createDriftingBackground();

    this.createTitle(cx, GAME.height * 0.16);
    this.createHeroBird(cx, GAME.height * 0.34);
    this.createCard(cx, GAME.height * 0.6);
    this.createButton(cx, GAME.height * 0.82, GAME.width * 0.62, "🏆  Classement", 0xd9912a, 0xf0b048, () =>
      this.scene.start(SCENES.Leaderboard),
    );
    this.createFooterHint(cx, GAME.height * 0.93);
  }

  // ---------------------------------------------------------------------------
  // Background
  // ---------------------------------------------------------------------------

  private drawBackground(): void {
    const g = this.add.graphics().setDepth(-20);
    // Vertical gradient: deep blue night → darker bottom.
    g.fillGradientStyle(0x2a3f8f, 0x2a3f8f, 0x0d1330, 0x0d1330, 1);
    g.fillRect(0, 0, GAME.width, GAME.height);

    // Soft glow behind the title area.
    const glow = this.add.graphics().setDepth(-19);
    glow.fillStyle(0xffd23f, 0.06);
    glow.fillCircle(GAME.width / 2, GAME.height * 0.22, GAME.width * 0.7);
  }

  /** Build small colourful decoration textures so they render reliably (not emoji). */
  private generateDecorTextures(): void {
    if (!this.textures.exists("star")) {
      const g = this.add.graphics();
      g.fillStyle(0xffd23f, 1);
      g.fillPoints(this.starPoints(20, 20, 5, 18, 8), true);
      g.generateTexture("star", 40, 40);
      g.destroy();
    }
    if (!this.textures.exists("sparkle")) {
      const g = this.add.graphics();
      g.fillStyle(0xffffff, 1);
      // 4-point sparkle.
      g.fillPoints(
        [
          new Phaser.Geom.Point(12, 0),
          new Phaser.Geom.Point(15, 9),
          new Phaser.Geom.Point(24, 12),
          new Phaser.Geom.Point(15, 15),
          new Phaser.Geom.Point(12, 24),
          new Phaser.Geom.Point(9, 15),
          new Phaser.Geom.Point(0, 12),
          new Phaser.Geom.Point(9, 9),
        ],
        true,
      );
      g.generateTexture("sparkle", 24, 24);
      g.destroy();
    }
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

  private createDriftingBackground(): void {
    // Funny phrases.
    for (let i = 0; i < 8; i++) {
      const baseY = Phaser.Math.Between(40, GAME.height - 40);
      const alpha = Phaser.Math.FloatBetween(0.08, 0.16);
      const text = this.add
        .text(Phaser.Math.Between(0, GAME.width), baseY, Phaser.Utils.Array.GetRandom(DRIFT_WORDS), {
          fontFamily: UI_FONT,
          fontSize: `${Phaser.Math.Between(18, 30)}px`,
          color: "#ffffff",
          fontStyle: "italic",
        })
        .setOrigin(0.5)
        .setAlpha(alpha)
        .setDepth(-10);
      this.pushDrifter(text, baseY, alpha, "word");
    }

    // Mini "ghost profs" flapping around in the background.
    for (let i = 0; i < 4; i++) {
      const baseY = Phaser.Math.Between(60, GAME.height - 60);
      const alpha = Phaser.Math.FloatBetween(0.12, 0.22);
      const bird = this.add
        .image(Phaser.Math.Between(0, GAME.width), baseY, "bird")
        .setScale(Phaser.Math.FloatBetween(0.5, 0.95))
        .setAlpha(alpha)
        .setDepth(-11);
      this.pushDrifter(bird, baseY, alpha, "bird");
    }

    // Twinkling stars + sparkles.
    for (let i = 0; i < 7; i++) {
      const baseY = Phaser.Math.Between(30, GAME.height - 30);
      const alpha = Phaser.Math.FloatBetween(0.2, 0.5);
      const key = Math.random() < 0.5 ? "star" : "sparkle";
      const star = this.add
        .image(Phaser.Math.Between(0, GAME.width), baseY, key)
        .setScale(Phaser.Math.FloatBetween(0.5, 1.1))
        .setAlpha(alpha)
        .setDepth(-12);
      this.pushDrifter(star, baseY, alpha, "star");
    }
  }

  private pushDrifter(
    obj: Phaser.GameObjects.Image | Phaser.GameObjects.Text,
    baseY: number,
    baseAlpha: number,
    kind: DrifterKind,
  ): void {
    const speed = Phaser.Math.FloatBetween(10, 34);
    this.drifters.push({
      obj,
      vx: Math.random() < 0.5 ? speed : -speed,
      baseY,
      phase: Phaser.Math.FloatBetween(0, Math.PI * 2),
      bobAmp: Phaser.Math.FloatBetween(6, 14),
      kind,
      baseAlpha,
    });
  }

  update(time: number, delta: number): void {
    const dt = delta / 1000;
    const margin = 90;
    const t = time / 1000;

    for (const d of this.drifters) {
      d.obj.x += d.vx * dt;
      d.obj.y = d.baseY + Math.sin(t + d.phase) * d.bobAmp;

      if (d.kind === "bird") {
        (d.obj as Phaser.GameObjects.Image).rotation = Math.sin(t * 2 + d.phase) * 0.18;
      } else if (d.kind === "star") {
        d.obj.setAlpha(d.baseAlpha * (0.55 + 0.45 * Math.sin(t * 2 + d.phase)));
        (d.obj as Phaser.GameObjects.Image).rotation += dt * 0.3;
      }

      if (d.vx > 0 && d.obj.x > GAME.width + margin) {
        d.obj.x = -margin;
        d.baseY = Phaser.Math.Between(40, GAME.height - 40);
      } else if (d.vx < 0 && d.obj.x < -margin) {
        d.obj.x = GAME.width + margin;
        d.baseY = Phaser.Math.Between(40, GAME.height - 40);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Foreground UI
  // ---------------------------------------------------------------------------

  private createTitle(cx: number, cy: number): void {
    const title = this.add
      .text(cx, cy, "FLAPPY PROF", {
        fontFamily: TITLE_FONT,
        fontSize: "62px",
        color: "#ffd23f",
      })
      .setOrigin(0.5)
      .setStroke("#1d2b53", 9);
    title.setShadow(0, 6, "#00000088", 8, true, true);

    this.add
      .text(cx, cy + 52, "le jeu le plus québécois de la classe", {
        fontFamily: UI_FONT,
        fontSize: "18px",
        color: "#cdd6f4",
        fontStyle: "500",
      })
      .setOrigin(0.5);

    // Subtle breathing wobble for life.
    this.tweens.add({
      targets: title,
      scaleX: { from: 1, to: 1.04 },
      scaleY: { from: 1, to: 1.04 },
      angle: { from: -1.5, to: 1.5 },
      duration: 1800,
      yoyo: true,
      repeat: -1,
      ease: "Sine.InOut",
    });
  }

  private createHeroBird(cx: number, cy: number): void {
    const bird = this.add.image(cx, cy, "bird").setScale(2.2).setDepth(1);

    // Bob up and down.
    this.tweens.add({
      targets: bird,
      y: cy - 14,
      duration: 900,
      yoyo: true,
      repeat: -1,
      ease: "Sine.InOut",
    });
    // Little flap tilt.
    this.tweens.add({
      targets: bird,
      angle: { from: -8, to: 8 },
      duration: 600,
      yoyo: true,
      repeat: -1,
      ease: "Sine.InOut",
    });

    this.createThoughtBubble(cx + 118, cy - 78);
  }

  /** A soft thought cloud that pops a short phrase, kept clear of the bird's head. */
  private createThoughtBubble(bx: number, by: number): void {
    const phrases = ["Benn !", "Voyons !", "Envoye !", "Hé là !", "Mets-en !"];

    const container = this.add.container(bx, by).setDepth(3).setAlpha(0);

    const cloud = this.add.graphics();
    const text = this.add
      .text(0, 0, "", {
        fontFamily: UI_FONT,
        fontSize: "20px",
        color: "#1d2b53",
        fontStyle: "600",
      })
      .setOrigin(0.5);
    container.add([cloud, text]);

    const drawCloud = (label: string) => {
      text.setText(label);
      const tw = text.width;
      const th = text.height;
      const w = tw + 44;
      const h = th + 30;
      cloud.clear();
      cloud.fillStyle(0xffffff, 0.96);
      // Main puffy body.
      cloud.fillEllipse(0, 0, w, h);
      // Bumps around the edge for a cloud silhouette.
      const bumps = Math.max(4, Math.round(w / 34));
      for (let i = 0; i < bumps; i++) {
        const px = -w / 2 + (w / (bumps - 1)) * i;
        cloud.fillCircle(px, -h / 2 + 4, h * 0.34);
        cloud.fillCircle(px, h / 2 - 4, h * 0.32);
      }
      cloud.fillCircle(-w / 2 + 4, 0, h * 0.34);
      cloud.fillCircle(w / 2 - 4, 0, h * 0.34);
      // Trailing thought dots leading down toward the bird's head.
      cloud.fillCircle(-w / 2 - 6, h / 2 + 12, 7);
      cloud.fillCircle(-w / 2 - 20, h / 2 + 30, 5);
      cloud.fillCircle(-w / 2 - 30, h / 2 + 44, 3);
    };
    drawCloud(phrases[0]);

    // Keep the cloud gently bobbing with the bird so they feel connected.
    this.tweens.add({
      targets: container,
      y: by - 10,
      duration: 900,
      yoyo: true,
      repeat: -1,
      ease: "Sine.InOut",
    });

    this.time.addEvent({
      delay: 3000,
      loop: true,
      callback: () => {
        drawCloud(Phaser.Utils.Array.GetRandom(phrases));
        this.tweens.add({
          targets: container,
          alpha: { from: 0, to: 1 },
          scale: { from: 0.7, to: 1 },
          duration: 220,
          yoyo: true,
          hold: 1100,
          ease: "Back.Out",
        });
      },
    });
  }

  private createCard(cx: number, cy: number): void {
    const w = GAME.width * 0.82;
    const h = 210;
    const x = cx - w / 2;
    const y = cy - h / 2;

    const card = this.add.graphics().setDepth(0);
    card.fillStyle(0x0e1430, 0.55);
    card.fillRoundedRect(x, y, w, h, 22);
    card.lineStyle(2, 0xffffff, 0.18);
    card.strokeRoundedRect(x, y, w, h, 22);

    this.createPseudoInput(cx, y + 42);

    this.createButton(cx, y + 108, w * 0.86, "►  Jouer (solo)", 0x2fa84f, 0x43c463, () =>
      this.startGame("solo"),
    );
    this.createButton(cx, y + 170, w * 0.86, "Multijoueur", 0x3f6fd1, 0x5a8dee, () => {
      console.log("[Menu] Multijoueur cliqué (à venir, Faz 6)");
      this.flashNotice("Bientôt disponible !");
    });
  }

  private createFooterHint(cx: number, cy: number): void {
    this.add
      .text(cx, cy, "Touche · clique · Espace  pour faire voler le prof", {
        fontFamily: UI_FONT,
        fontSize: "15px",
        color: "#8893c0",
      })
      .setOrigin(0.5);
  }

  private createPseudoInput(cx: number, cy: number): void {
    const saved = localStorage.getItem(STORAGE.pseudo) ?? "";
    const element = this.add.dom(cx, cy).createFromHTML(
      `<input
        type="text"
        maxlength="${MAX_PSEUDO}"
        placeholder="Ton nom…"
        value="${this.escapeAttr(saved)}"
        style="
          width: 280px;
          padding: 13px 16px;
          font-size: 20px;
          font-family: 'Fredoka', sans-serif;
          font-weight: 500;
          text-align: center;
          border: 2px solid rgba(255,210,63,0.6);
          border-radius: 14px;
          outline: none;
          background: rgba(255,255,255,0.06);
          color: #ffffff;
          box-sizing: border-box;
        "
      />`,
    );
    element.setDepth(1);

    this.pseudoInput = element.node.querySelector("input") as HTMLInputElement;
    this.pseudoInput.addEventListener("input", () => {
      localStorage.setItem(STORAGE.pseudo, this.pseudoInput?.value.slice(0, MAX_PSEUDO) ?? "");
    });
    this.pseudoInput.addEventListener("focus", () => {
      this.pseudoInput!.style.borderColor = "rgba(255,210,63,1)";
    });
    this.pseudoInput.addEventListener("blur", () => {
      this.pseudoInput!.style.borderColor = "rgba(255,210,63,0.6)";
    });
  }

  private createButton(
    cx: number,
    cy: number,
    width: number,
    label: string,
    colorBottom: number,
    colorTop: number,
    onClick: () => void,
  ): void {
    const height = 52;
    const radius = 16;
    const container = this.add.container(cx, cy).setDepth(1);

    const bg = this.add.graphics();
    const draw = (scale: number) => {
      bg.clear();
      const w = width * scale;
      const h = height * scale;
      // Drop shadow.
      bg.fillStyle(0x000000, 0.25);
      bg.fillRoundedRect(-w / 2, -h / 2 + 4, w, h, radius);
      // Body gradient (top lighter, bottom darker).
      bg.fillGradientStyle(colorTop, colorTop, colorBottom, colorBottom, 1);
      bg.fillRoundedRect(-w / 2, -h / 2, w, h, radius);
      // Glossy top highlight.
      bg.fillStyle(0xffffff, 0.18);
      bg.fillRoundedRect(-w / 2 + 4, -h / 2 + 4, w - 8, h * 0.4, radius - 4);
    };
    draw(1);

    const text = this.add
      .text(0, 0, label, {
        fontFamily: UI_FONT,
        fontSize: "23px",
        color: "#ffffff",
        fontStyle: "600",
      })
      .setOrigin(0.5);
    text.setShadow(0, 2, "#00000055", 2);

    container.add([bg, text]);
    container.setSize(width, height);
    container.setInteractive({ useHandCursor: true });

    container.on("pointerover", () => draw(1.04));
    container.on("pointerout", () => draw(1));
    container.on("pointerdown", () => {
      draw(0.97);
      console.log(`[Menu] "${label}" cliqué`);
    });
    container.on("pointerup", () => {
      draw(1.04);
      onClick();
    });
  }

  private startGame(mode: "solo" | "multi"): void {
    const pseudo = (this.pseudoInput?.value ?? "").trim().slice(0, MAX_PSEUDO) || "Anonyme";
    localStorage.setItem(STORAGE.pseudo, pseudo);
    console.log(`[Menu] Démarrage du jeu — mode=${mode}, pseudo=${pseudo}`);
    this.scene.start(SCENES.Game, { mode, pseudo });
  }

  private flashNotice(message: string): void {
    const note = this.add
      .text(GAME.width / 2, GAME.height * 0.84, message, {
        fontFamily: UI_FONT,
        fontSize: "20px",
        color: "#ffd23f",
        fontStyle: "600",
      })
      .setOrigin(0.5)
      .setAlpha(0)
      .setDepth(5);

    this.tweens.add({
      targets: note,
      alpha: 1,
      duration: 200,
      yoyo: true,
      hold: 900,
      onComplete: () => note.destroy(),
    });
  }

  private escapeAttr(value: string): string {
    return value
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
}
