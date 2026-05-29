import Phaser from "phaser";
import { GAME, SCENES } from "../config";
import type { GameScene } from "./GameScene";

interface PauseInit {
  volume: number; // 0..1
}

const TITLE_FONT = "Luckiest Guy, sans-serif";
const UI_FONT = "Fredoka, sans-serif";

/**
 * Pause overlay launched on top of a paused GameScene. Holds a master-volume slider (0–100%)
 * that applies live, plus Resume / Menu. The game's music keeps playing here so volume changes
 * give immediate feedback.
 */
export class PauseScene extends Phaser.Scene {
  private percentText!: Phaser.GameObjects.Text;
  private slider?: HTMLInputElement;

  constructor() {
    super(SCENES.Pause);
  }

  create(data: PauseInit): void {
    const cx = GAME.width / 2;
    const startVol = Math.round((data?.volume ?? 0.7) * 100);

    this.add.rectangle(0, 0, GAME.width, GAME.height, 0x0a0f24, 0.82).setOrigin(0).setDepth(0);

    this.add
      .text(cx, GAME.height * 0.26, "Pause", {
        fontFamily: TITLE_FONT,
        fontSize: "52px",
        color: "#ffd23f",
      })
      .setOrigin(0.5)
      .setDepth(1)
      .setStroke("#1d2b53", 8);

    // Volume label + live percentage.
    this.add
      .text(cx, GAME.height * 0.4, "Volume", {
        fontFamily: UI_FONT,
        fontSize: "22px",
        color: "#cdd6f4",
        fontStyle: "600",
      })
      .setOrigin(0.5)
      .setDepth(1);

    this.percentText = this.add
      .text(cx, GAME.height * 0.51, `${startVol}%`, {
        fontFamily: TITLE_FONT,
        fontSize: "30px",
        color: "#ffffff",
      })
      .setOrigin(0.5)
      .setDepth(1);

    this.createSlider(cx, GAME.height * 0.45, startVol);

    this.createButton(cx, GAME.height * 0.66, "►  Reprendre", 0x2fa84f, 0x43c463, () => this.resumeGame());
    this.createButton(cx, GAME.height * 0.77, "Menu", 0x3f6fd1, 0x5a8dee, () => {
      this.scene.stop(SCENES.Game);
      this.scene.start(SCENES.Menu);
      this.scene.stop(SCENES.Pause);
    });

    this.input.keyboard?.on("keydown-ESC", this.resumeGame, this);
    this.input.keyboard?.on("keydown-P", this.resumeGame, this);
  }

  private resumeGame(): void {
    this.scene.resume(SCENES.Game);
    this.scene.stop(SCENES.Pause);
  }

  private createSlider(cx: number, cy: number, startVol: number): void {
    const element = this.add.dom(cx, cy).createFromHTML(
      `<input type="range" min="0" max="100" value="${startVol}" step="1"
        style="
          width: 260px;
          accent-color: #ffd23f;
          cursor: pointer;
        " />`,
    );
    element.setDepth(2);
    this.slider = element.node.querySelector("input") as HTMLInputElement;

    const apply = () => {
      const pct = Number(this.slider?.value ?? 0);
      this.percentText.setText(`${pct}%`);
      const gs = this.scene.get(SCENES.Game) as GameScene;
      gs.setVolume(pct / 100);
    };
    this.slider.addEventListener("input", apply);
  }

  private createButton(
    cx: number,
    cy: number,
    label: string,
    colorBottom: number,
    colorTop: number,
    onClick: () => void,
  ): void {
    const width = GAME.width * 0.6;
    const height = 52;
    const radius = 16;
    const container = this.add.container(cx, cy).setDepth(2);

    const bg = this.add.graphics();
    const draw = (scale: number) => {
      bg.clear();
      const w = width * scale;
      const h = height * scale;
      bg.fillStyle(0x000000, 0.25);
      bg.fillRoundedRect(-w / 2, -h / 2 + 4, w, h, radius);
      bg.fillGradientStyle(colorTop, colorTop, colorBottom, colorBottom, 1);
      bg.fillRoundedRect(-w / 2, -h / 2, w, h, radius);
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
    container.on("pointerdown", () => draw(0.97));
    container.on("pointerup", () => {
      draw(1.04);
      onClick();
    });
  }
}
