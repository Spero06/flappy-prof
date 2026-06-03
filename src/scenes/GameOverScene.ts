import Phaser from "phaser";
import { GAME, SCENES } from "../config";
import { randomSeed } from "../systems/Rng";
import { isConfigured, submitScore } from "../systems/Net";

interface GameOverInit {
  score: number;
  mode: "solo" | "multi";
  pseudo: string;
  seed: number;
  roomId?: string;
}

const TITLE_FONT = "Luckiest Guy, sans-serif";
const UI_FONT = "Fredoka, sans-serif";
const BEST_KEY = "flappyprof.best";

/** Score summary with restart + leaderboard submission (CLAUDE.md section 9). */
export class GameOverScene extends Phaser.Scene {
  private result!: GameOverInit;
  private statusText!: Phaser.GameObjects.Text;
  /** Id of this run's submitted row, used to highlight it on the leaderboard. */
  private submittedId: string | null = null;

  constructor() {
    super(SCENES.GameOver);
  }

  init(data: GameOverInit): void {
    this.result = data;
    this.submittedId = null;
  }

  create(): void {
    const cx = GAME.width / 2;

    const prevBest = Number(localStorage.getItem(BEST_KEY) ?? 0);
    const isNewBest = this.result.score > prevBest && this.result.score > 0;
    const best = Math.max(this.result.score, prevBest);
    localStorage.setItem(BEST_KEY, String(best));

    this.add.rectangle(0, 0, GAME.width, GAME.height, 0x0d1330, 0.78).setOrigin(0).setDepth(0);

    this.add
      .text(cx, GAME.height * 0.22, "C'est fini là !", {
        fontFamily: TITLE_FONT,
        fontSize: "52px",
        color: "#ffd23f",
      })
      .setOrigin(0.5)
      .setDepth(1)
      .setStroke("#1d2b53", 8);

    this.createScorePanel(cx, GAME.height * 0.42, best, isNewBest);

    this.statusText = this.add
      .text(cx, GAME.height * 0.57, "", {
        fontFamily: UI_FONT,
        fontSize: "17px",
        color: "#9aa6d6",
        fontStyle: "600",
      })
      .setOrigin(0.5)
      .setDepth(2);

    this.createButton(cx, GAME.height * 0.66, "►  Rejouer", 0x2fa84f, 0x43c463, () => {
      const nextSeed = this.result.mode === "solo" ? randomSeed() : this.result.seed;
      this.scene.start(SCENES.Game, {
        mode: this.result.mode,
        pseudo: this.result.pseudo,
        seed: nextSeed,
      });
    });
    this.createButton(cx, GAME.height * 0.76, "🏆  Classement", 0xd9912a, 0xf0b048, () => {
      this.scene.start(SCENES.Leaderboard, {
        pseudo: this.result.pseudo,
        mode: this.result.mode,
        seed: this.result.seed,
        highlightId: this.submittedId,
      });
    });
    this.createButton(cx, GAME.height * 0.86, "Menu", 0x3f6fd1, 0x5a8dee, () => {
      this.scene.start(SCENES.Menu);
    });

    this.submitScoreFlow();
  }

  /** Send this run's score to the leaderboard (no-op + offline note when unconfigured). */
  private submitScoreFlow(): void {
    if (this.result.score <= 0) return;
    if (!isConfigured()) {
      this.statusText.setText("Classement hors ligne");
      return;
    }
    this.statusText.setText("Envoi du score…");
    void submitScore({
      player_name: this.result.pseudo,
      score: this.result.score,
      mode: this.result.mode,
      room_code: this.result.roomId ?? null,
    }).then((row) => {
      if (!this.scene.isActive()) return;
      if (row) {
        this.submittedId = row.id;
        this.statusText.setText("Score enregistré !").setColor("#43c463");
      } else {
        this.statusText.setText("Échec de l'envoi du score").setColor("#ff7a7a");
      }
    });
  }

  private createScorePanel(cx: number, cy: number, best: number, isNewBest: boolean): void {
    const w = GAME.width * 0.72;
    const h = 150;
    const card = this.add.graphics().setDepth(1);
    card.fillStyle(0x0e1430, 0.85);
    card.fillRoundedRect(cx - w / 2, cy - h / 2, w, h, 20);
    card.lineStyle(2, 0xffffff, 0.18);
    card.strokeRoundedRect(cx - w / 2, cy - h / 2, w, h, 20);

    this.add
      .text(cx, cy - 40, "Score", {
        fontFamily: UI_FONT,
        fontSize: "18px",
        color: "#9aa6d6",
        fontStyle: "600",
      })
      .setOrigin(0.5)
      .setDepth(2);

    this.add
      .text(cx, cy - 2, String(this.result.score), {
        fontFamily: TITLE_FONT,
        fontSize: "56px",
        color: "#ffffff",
      })
      .setOrigin(0.5)
      .setDepth(2);

    this.add
      .text(cx, cy + 44, isNewBest ? `★ Nouveau record : ${best} ★` : `Record : ${best}`, {
        fontFamily: UI_FONT,
        fontSize: "18px",
        color: isNewBest ? "#ffd23f" : "#cdd6f4",
        fontStyle: "600",
      })
      .setOrigin(0.5)
      .setDepth(2);
  }

  private createButton(
    cx: number,
    cy: number,
    label: string,
    colorBottom: number,
    colorTop: number,
    onClick: () => void,
  ): void {
    const width = GAME.width * 0.62;
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
