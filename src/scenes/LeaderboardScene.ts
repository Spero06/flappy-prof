import Phaser from "phaser";
import { GAME, SCENES } from "../config";
import { randomSeed } from "../systems/Rng";
import {
  fetchTopScores,
  isConfigured,
  subscribeToScores,
  type ScoreRow,
} from "../systems/Net";

interface LeaderboardInit {
  /** Where we came from, so "Rejouer" can restart the same mode/pseudo. */
  pseudo?: string;
  mode?: "solo" | "multi";
  seed?: number;
  /** Row id to highlight (the score the player just submitted). */
  highlightId?: string | null;
}

const TITLE_FONT = "Luckiest Guy, sans-serif";
const UI_FONT = "Fredoka, sans-serif";
const TOP_N = 15;

/** Live top-15 leaderboard (CLAUDE.md section 9). Subscribes to Realtime inserts. */
export class LeaderboardScene extends Phaser.Scene {
  private params: LeaderboardInit = {};
  private rowObjects: Phaser.GameObjects.GameObject[] = [];
  private statusText!: Phaser.GameObjects.Text;
  private unsubscribe: () => void = () => {};
  private listTop = 0;
  private rowHeight = 0;
  private refreshScheduled = false;

  constructor() {
    super(SCENES.Leaderboard);
  }

  init(data: LeaderboardInit): void {
    this.params = data ?? {};
  }

  create(): void {
    const cx = GAME.width / 2;

    this.drawBackground();

    this.add
      .text(cx, GAME.height * 0.09, "Classement", {
        fontFamily: TITLE_FONT,
        fontSize: "46px",
        color: "#ffd23f",
      })
      .setOrigin(0.5)
      .setStroke("#1d2b53", 8);

    // List panel.
    const panelW = GAME.width * 0.88;
    const panelTop = GAME.height * 0.16;
    const panelH = GAME.height * 0.62;
    const card = this.add.graphics();
    card.fillStyle(0x0e1430, 0.7);
    card.fillRoundedRect(cx - panelW / 2, panelTop, panelW, panelH, 18);
    card.lineStyle(2, 0xffffff, 0.16);
    card.strokeRoundedRect(cx - panelW / 2, panelTop, panelW, panelH, 18);

    this.listTop = panelTop + 18;
    this.rowHeight = (panelH - 36) / TOP_N;

    this.statusText = this.add
      .text(cx, panelTop + panelH / 2, "Chargement…", {
        fontFamily: UI_FONT,
        fontSize: "20px",
        color: "#9aa6d6",
        align: "center",
        fontStyle: "600",
        wordWrap: { width: panelW - 40 },
      })
      .setOrigin(0.5)
      .setDepth(2);

    // Buttons.
    const btnY = GAME.height * 0.88;
    if (this.params.mode && this.params.pseudo) {
      this.createButton(cx - GAME.width * 0.22, btnY, GAME.width * 0.4, "►  Rejouer", 0x2fa84f, 0x43c463, () => {
        const seed = this.params.mode === "solo" ? randomSeed() : (this.params.seed ?? randomSeed());
        this.scene.start(SCENES.Game, { mode: this.params.mode, pseudo: this.params.pseudo, seed });
      });
      this.createButton(cx + GAME.width * 0.22, btnY, GAME.width * 0.4, "Menu", 0x3f6fd1, 0x5a8dee, () =>
        this.scene.start(SCENES.Menu),
      );
    } else {
      this.createButton(cx, btnY, GAME.width * 0.5, "Menu", 0x3f6fd1, 0x5a8dee, () =>
        this.scene.start(SCENES.Menu),
      );
    }

    if (!isConfigured()) {
      this.statusText.setText(
        "Classement hors ligne.\nConfigure Supabase (.env) pour activer le tableau des scores.",
      );
      return;
    }

    void this.refresh();
    this.unsubscribe = subscribeToScores(() => this.scheduleRefresh());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.unsubscribe());
  }

  /** Coalesce bursts of realtime inserts into one refetch (classroom = many at once). */
  private scheduleRefresh(): void {
    if (this.refreshScheduled) return;
    this.refreshScheduled = true;
    this.time.delayedCall(500, () => {
      this.refreshScheduled = false;
      void this.refresh();
    });
  }

  private async refresh(): Promise<void> {
    const rows = await fetchTopScores(TOP_N);
    // The scene may have been torn down while awaiting.
    if (!this.scene.isActive()) return;
    this.renderRows(rows);
  }

  private renderRows(rows: ScoreRow[]): void {
    for (const o of this.rowObjects) o.destroy();
    this.rowObjects = [];

    if (rows.length === 0) {
      this.statusText.setText("Aucun score pour l'instant.\nSois le premier !").setVisible(true);
      return;
    }
    this.statusText.setVisible(false);

    const cx = GAME.width / 2;
    const panelW = GAME.width * 0.88;
    const leftX = cx - panelW / 2 + 16;
    const rightX = cx + panelW / 2 - 16;

    rows.forEach((row, i) => {
      const y = this.listTop + this.rowHeight * (i + 0.5);
      const isMe = this.params.highlightId != null && row.id === this.params.highlightId;

      if (isMe) {
        const hl = this.add.graphics().setDepth(1);
        hl.fillStyle(0xffd23f, 0.18);
        hl.fillRoundedRect(leftX - 6, y - this.rowHeight / 2 + 2, panelW - 20, this.rowHeight - 4, 8);
        this.rowObjects.push(hl);
      }

      const rankColor = i === 0 ? "#ffd23f" : i === 1 ? "#cdd6f4" : i === 2 ? "#e8a06a" : "#8893c0";
      const rank = this.add
        .text(leftX, y, `${i + 1}`, {
          fontFamily: TITLE_FONT,
          fontSize: "22px",
          color: rankColor,
        })
        .setOrigin(0, 0.5)
        .setDepth(2);

      const name = this.add
        .text(leftX + 42, y, row.player_name, {
          fontFamily: UI_FONT,
          fontSize: "20px",
          color: isMe ? "#ffd23f" : "#ffffff",
          fontStyle: isMe ? "700" : "500",
        })
        .setOrigin(0, 0.5)
        .setDepth(2);
      // Trim long names so the score stays visible.
      if (name.width > panelW - 150) {
        name.setText(row.player_name.slice(0, 12) + "…");
      }

      const score = this.add
        .text(rightX, y, String(row.score), {
          fontFamily: TITLE_FONT,
          fontSize: "22px",
          color: "#ffffff",
        })
        .setOrigin(1, 0.5)
        .setDepth(2);

      this.rowObjects.push(rank, name, score);
    });
  }

  private drawBackground(): void {
    const g = this.add.graphics().setDepth(-20);
    g.fillGradientStyle(0x2a3f8f, 0x2a3f8f, 0x0d1330, 0x0d1330, 1);
    g.fillRect(0, 0, GAME.width, GAME.height);
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
    const container = this.add.container(cx, cy).setDepth(3);

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
        fontSize: "22px",
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
