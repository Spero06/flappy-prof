import Phaser from "phaser";
import { GAME, SCENES } from "../config";
import type { QuizDraw } from "../systems/QuestionManager";

interface QuizInit {
  question: QuizDraw;
  onResolved: (correct: boolean) => void;
}

const TITLE_FONT = "Luckiest Guy, sans-serif";
const UI_FONT = "Fredoka, sans-serif";

/**
 * Paused overlay opened by a quiz gate. Shows a French grammar question with four large
 * touch options, then a short explanation, before handing the result back to GameScene.
 * Wrong answers carry no penalty (CLAUDE.md section 6) — the goal is the encounter itself.
 */
export class QuizScene extends Phaser.Scene {
  private question!: QuizDraw;
  private onResolved!: (correct: boolean) => void;
  private answered = false;
  private buttons: { container: Phaser.GameObjects.Container; redraw: (fill: number) => void; option: string }[] = [];

  constructor() {
    super(SCENES.Quiz);
  }

  init(data: QuizInit): void {
    this.question = data.question;
    this.onResolved = data.onResolved;
    this.answered = false;
    this.buttons = [];
  }

  create(): void {
    const cx = GAME.width / 2;

    this.add.rectangle(0, 0, GAME.width, GAME.height, 0x0a0f24, 0.86).setOrigin(0).setDepth(0);

    this.add
      .text(cx, GAME.height * 0.13, "Une petite question !", {
        fontFamily: TITLE_FONT,
        fontSize: "34px",
        color: "#ffd23f",
      })
      .setOrigin(0.5)
      .setDepth(1)
      .setStroke("#1d2b53", 6);

    // Question card.
    const cardW = GAME.width * 0.86;
    const cardY = GAME.height * 0.28;
    const card = this.add.graphics().setDepth(1);
    card.fillStyle(0x141b3c, 0.95);
    card.fillRoundedRect(cx - cardW / 2, cardY - 70, cardW, 140, 18);
    card.lineStyle(2, 0xffffff, 0.16);
    card.strokeRoundedRect(cx - cardW / 2, cardY - 70, cardW, 140, 18);

    this.add
      .text(cx, cardY, this.question.sentence, {
        fontFamily: UI_FONT,
        fontSize: "23px",
        color: "#ffffff",
        align: "center",
        fontStyle: "600",
        wordWrap: { width: cardW - 40 },
      })
      .setOrigin(0.5)
      .setDepth(2);

    // Option buttons.
    const top = GAME.height * 0.46;
    const gap = 78;
    this.question.options.forEach((opt, i) => {
      this.createOption(cx, top + i * gap, opt);
    });
  }

  private createOption(cx: number, cy: number, option: string): void {
    const w = GAME.width * 0.82;
    const h = 60;
    const radius = 14;
    const container = this.add.container(cx, cy).setDepth(2);

    const bg = this.add.graphics();
    const redraw = (fill: number) => {
      bg.clear();
      bg.fillStyle(0x000000, 0.25);
      bg.fillRoundedRect(-w / 2, -h / 2 + 4, w, h, radius);
      bg.fillStyle(fill, 1);
      bg.fillRoundedRect(-w / 2, -h / 2, w, h, radius);
      bg.lineStyle(2, 0xffffff, 0.22);
      bg.strokeRoundedRect(-w / 2, -h / 2, w, h, radius);
    };
    redraw(0x2c3a72);

    const text = this.add
      .text(0, 0, option, {
        fontFamily: UI_FONT,
        fontSize: "24px",
        color: "#ffffff",
        fontStyle: "600",
      })
      .setOrigin(0.5);

    container.add([bg, text]);
    container.setSize(w, h);
    container.setInteractive({ useHandCursor: true });
    container.on("pointerover", () => { if (!this.answered) redraw(0x37498f); });
    container.on("pointerout", () => { if (!this.answered) redraw(0x2c3a72); });
    container.on("pointerdown", () => this.choose(option));

    this.buttons.push({ container, redraw, option });
  }

  private choose(option: string): void {
    if (this.answered) return;
    this.answered = true;
    const correct = option === this.question.answer;

    // Recolor: correct option green, a wrong pick red.
    for (const b of this.buttons) {
      b.container.disableInteractive();
      if (b.option === this.question.answer) b.redraw(0x2fa84f);
      else if (b.option === option) b.redraw(0xc0392b);
      else b.redraw(0x232a4d);
    }

    this.showExplanation(correct);
    this.createContinueButton(correct);
  }

  private createContinueButton(correct: boolean): void {
    const cx = GAME.width / 2;
    const cy = GAME.height * 0.945;
    const w = GAME.width * 0.5;
    const h = 54;
    const radius = 14;
    const container = this.add.container(cx, cy).setDepth(4);

    const bg = this.add.graphics();
    const redraw = (fill: number) => {
      bg.clear();
      bg.fillStyle(0x000000, 0.25);
      bg.fillRoundedRect(-w / 2, -h / 2 + 4, w, h, radius);
      bg.fillStyle(fill, 1);
      bg.fillRoundedRect(-w / 2, -h / 2, w, h, radius);
      bg.lineStyle(2, 0xffffff, 0.3);
      bg.strokeRoundedRect(-w / 2, -h / 2, w, h, radius);
    };
    redraw(0xffcc00);

    const text = this.add
      .text(0, 0, "Continuer", {
        fontFamily: TITLE_FONT,
        fontSize: "26px",
        color: "#1d2b53",
      })
      .setOrigin(0.5);

    container.add([bg, text]);
    container.setSize(w, h);
    container.setInteractive({ useHandCursor: true });
    container.on("pointerover", () => redraw(0xffd84d));
    container.on("pointerout", () => redraw(0xffcc00));
    container.on("pointerdown", () => {
      const cb = this.onResolved;
      this.scene.stop();
      cb(correct);
    });

    container.setScale(0.8);
    this.tweens.add({ targets: container, scale: 1, duration: 200, ease: "Back.Out" });
  }

  private showExplanation(correct: boolean): void {
    const cx = GAME.width / 2;

    this.add
      .text(cx, GAME.height * 0.82, correct ? "C'est en plein ça !" : "Ben non…", {
        fontFamily: TITLE_FONT,
        fontSize: "26px",
        color: correct ? "#43c463" : "#ff7a7a",
      })
      .setOrigin(0.5)
      .setDepth(3)
      .setStroke("#1d2b53", 5);

    if (this.question.explanation) {
      this.add
        .text(cx, GAME.height * 0.875, this.question.explanation, {
          fontFamily: UI_FONT,
          fontSize: "16px",
          color: "#cdd6f4",
          align: "center",
          wordWrap: { width: GAME.width * 0.84 },
        })
        .setOrigin(0.5)
        .setDepth(3);
    }
  }
}
