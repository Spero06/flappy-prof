import Phaser from "phaser";
import { GAME, QUIZ, SCENES } from "../config";
import type { QuizDraw } from "../systems/QuestionManager";

interface QuizInit {
  question: QuizDraw;
  onResolved: (correct: boolean) => void;
  /** Multiplayer: run the synchronized, timed flow (15s answer → 10s reveal → 3-2-1). */
  timed?: boolean;
  /** Multiplayer: broadcast this client's pick so others see it. */
  broadcastPick?: (option: string) => void;
}

const TITLE_FONT = "Luckiest Guy, sans-serif";
const UI_FONT = "Fredoka, sans-serif";

interface OptBtn {
  container: Phaser.GameObjects.Container;
  redraw: (fill: number) => void;
  option: string;
  pickLabel: Phaser.GameObjects.Text;
}

/**
 * Paused overlay opened by a quiz gate. SOLO: self-paced — pick, read the explanation, press
 * Continuer. MULTI: a SYNCHRONIZED, timed shared moment — everyone gets the same question (seeded)
 * and option order, has `answerMs` to pick (picks shown live), then `revealMs` of the correct
 * answer + explanation, then a 3-2-1 so the whole room resumes together. No penalty for a wrong
 * answer (CLAUDE.md section 6) — the encounter is the point.
 */
export class QuizScene extends Phaser.Scene {
  private question!: QuizDraw;
  private onResolved!: (correct: boolean) => void;
  private timed = false;
  private broadcastPick?: (option: string) => void;

  private answered = false;
  private picked: string | null = null;
  private buttons: OptBtn[] = [];
  private optionPicks = new Map<string, string[]>();

  constructor() {
    super(SCENES.Quiz);
  }

  init(data: QuizInit): void {
    this.question = data.question;
    this.onResolved = data.onResolved;
    this.timed = data.timed ?? false;
    this.broadcastPick = data.broadcastPick;
    this.answered = false;
    this.picked = null;
    this.buttons = [];
    this.optionPicks = new Map();
  }

  create(): void {
    const cx = GAME.width / 2;

    this.add.rectangle(0, 0, GAME.width, GAME.height, 0x0a0f24, 0.86).setOrigin(0).setDepth(0);

    this.add
      .text(cx, GAME.height * 0.12, "Une petite question !", {
        fontFamily: TITLE_FONT,
        fontSize: "32px",
        color: "#ffd23f",
      })
      .setOrigin(0.5)
      .setDepth(1)
      .setStroke("#1d2b53", 6);

    // Question card.
    const cardW = GAME.width * 0.86;
    const cardY = GAME.height * 0.27;
    const card = this.add.graphics().setDepth(1);
    card.fillStyle(0x141b3c, 0.95);
    card.fillRoundedRect(cx - cardW / 2, cardY - 64, cardW, 128, 18);
    card.lineStyle(2, 0xffffff, 0.16);
    card.strokeRoundedRect(cx - cardW / 2, cardY - 64, cardW, 128, 18);

    this.add
      .text(cx, cardY, this.question.sentence, {
        fontFamily: UI_FONT,
        fontSize: "22px",
        color: "#ffffff",
        align: "center",
        fontStyle: "600",
        wordWrap: { width: cardW - 40 },
      })
      .setOrigin(0.5)
      .setDepth(2);

    // Option buttons.
    const top = GAME.height * 0.45;
    const gap = 80;
    this.question.options.forEach((opt, i) => {
      this.createOption(cx, top + i * gap, opt);
    });

    if (this.timed) {
      this.events.on("remotePick", (p: { pseudo: string; option: string }) =>
        this.addPick(p.pseudo, p.option),
      );
      this.startAnswerTimer();
    }
  }

  private createOption(cx: number, cy: number, option: string): void {
    const w = GAME.width * 0.82;
    const h = 58;
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
      .text(0, 0, option, { fontFamily: UI_FONT, fontSize: "24px", color: "#ffffff", fontStyle: "600" })
      .setOrigin(0.5);

    container.add([bg, text]);
    container.setSize(w, h);
    container.setInteractive({ useHandCursor: true });
    container.on("pointerover", () => { if (!this.answered && !this.picked) redraw(0x37498f); });
    container.on("pointerout", () => { if (!this.answered && !this.picked) redraw(0x2c3a72); });
    container.on("pointerdown", () => this.choose(option));

    // Live "who picked this" label (multiplayer), tucked under the option.
    const pickLabel = this.add
      .text(cx, cy + 31, "", { fontFamily: UI_FONT, fontSize: "12px", color: "#9fd0ff" })
      .setOrigin(0.5)
      .setDepth(2);

    this.buttons.push({ container, redraw, option, pickLabel });
  }

  private choose(option: string): void {
    if (this.answered) return;

    if (this.timed) {
      if (this.picked) return; // pick is locked once made
      this.picked = option;
      this.addPick("Toi", option);
      this.broadcastPick?.(option);
      // Highlight the choice (blue) and lock all options — reveal comes when the timer ends.
      for (const b of this.buttons) {
        b.container.disableInteractive();
        b.redraw(b.option === option ? 0x3f6fd1 : 0x2c3a72);
      }
      return;
    }

    // Solo: reveal immediately + a Continuer button.
    this.answered = true;
    const correct = option === this.question.answer;
    for (const b of this.buttons) {
      b.container.disableInteractive();
      if (b.option === this.question.answer) b.redraw(0x2fa84f);
      else if (b.option === option) b.redraw(0xc0392b);
      else b.redraw(0x232a4d);
    }
    this.showExplanation(correct);
    this.createContinueButton(correct);
  }

  // --- Multiplayer timed flow ------------------------------------------------

  private addPick(pseudo: string, option: string): void {
    const list = this.optionPicks.get(option) ?? [];
    if (!list.includes(pseudo)) list.push(pseudo);
    this.optionPicks.set(option, list);
    const btn = this.buttons.find((b) => b.option === option);
    btn?.pickLabel.setText(`👤 ${list.join(", ")}`);
  }

  private startAnswerTimer(): void {
    const cx = GAME.width / 2;
    const w = GAME.width * 0.82;
    const y = GAME.height * 0.38;
    this.add.rectangle(cx, y, w, 10, 0x000000, 0.4).setDepth(1);
    const bar = this.add.rectangle(cx - w / 2, y, w, 10, 0x43c463).setOrigin(0, 0.5).setDepth(1);
    this.tweens.add({
      targets: bar,
      scaleX: 0,
      duration: QUIZ.answerMs,
      ease: "Linear",
      onComplete: () => this.reveal(),
    });
  }

  /** Timer ended: lock in, reveal the correct answer + explanation, then count down to resume. */
  private reveal(): void {
    if (this.answered) return;
    this.answered = true;
    const correct = this.picked === this.question.answer;
    for (const b of this.buttons) {
      b.container.disableInteractive();
      if (b.option === this.question.answer) b.redraw(0x2fa84f);
      else if (b.option === this.picked) b.redraw(0xc0392b);
      else b.redraw(0x232a4d);
    }
    this.showExplanation(correct);
    this.time.delayedCall(QUIZ.revealMs, () => this.startResumeCountdown(correct));
  }

  private startResumeCountdown(correct: boolean): void {
    const num = this.add
      .text(GAME.width / 2, GAME.height * 0.945, "", {
        fontFamily: TITLE_FONT,
        fontSize: "40px",
        color: "#ffd23f",
      })
      .setOrigin(0.5)
      .setDepth(4)
      .setStroke("#1d2b53", 5);
    let n = 3;
    const tick = () => {
      num.setText(n > 0 ? `Reprise dans ${n}…` : "GO !");
      if (n <= 0) {
        this.resolve(correct);
        return;
      }
      n -= 1;
      this.time.delayedCall(700, tick);
    };
    tick();
  }

  private resolve(correct: boolean): void {
    const cb = this.onResolved;
    this.scene.stop();
    cb(correct);
  }

  // --- Solo continue + shared explanation ------------------------------------

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
      .text(0, 0, "Continuer", { fontFamily: TITLE_FONT, fontSize: "26px", color: "#1d2b53" })
      .setOrigin(0.5);

    container.add([bg, text]);
    container.setSize(w, h);
    container.setInteractive({ useHandCursor: true });
    container.on("pointerover", () => redraw(0xffd84d));
    container.on("pointerout", () => redraw(0xffcc00));
    container.on("pointerdown", () => this.resolve(correct));

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
