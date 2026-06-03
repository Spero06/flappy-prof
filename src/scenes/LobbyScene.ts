import Phaser from "phaser";
import { GAME, SCENES } from "../config";
import { isConfigured, joinRoom, type RoomHandle, type RoomMember } from "../systems/Net";

interface LobbyInit {
  pseudo: string;
}

const TITLE_FONT = "Luckiest Guy, sans-serif";
const UI_FONT = "Fredoka, sans-serif";

/**
 * Multiplayer lobby (CLAUDE.md 8.2). Milestone 1: enter a room code, join a Supabase Realtime
 * room, and see who else is in it (Presence). The synced seed + 3-2-1 countdown that launches a
 * shared run is the next milestone — for now this proves the room/presence layer works.
 */
export class LobbyScene extends Phaser.Scene {
  private pseudo = "Anonyme";
  private room: RoomHandle | null = null;
  private codeInput?: HTMLInputElement;
  private membersText!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;
  private joined = false;

  constructor() {
    super(SCENES.Lobby);
  }

  init(data: LobbyInit): void {
    this.pseudo = data?.pseudo ?? "Anonyme";
    this.room = null;
    this.joined = false;
  }

  create(): void {
    const cx = GAME.width / 2;
    this.drawBackground();

    this.add
      .text(cx, GAME.height * 0.12, "Multijoueur", {
        fontFamily: TITLE_FONT,
        fontSize: "44px",
        color: "#ffd23f",
      })
      .setOrigin(0.5)
      .setStroke("#1d2b53", 8);

    if (!isConfigured()) {
      this.add
        .text(cx, GAME.height * 0.45, "Multijoueur hors ligne.\nConfigure Supabase (.env).", {
          fontFamily: UI_FONT,
          fontSize: "20px",
          color: "#9aa6d6",
          align: "center",
          fontStyle: "600",
          wordWrap: { width: GAME.width * 0.8 },
        })
        .setOrigin(0.5);
      this.createButton(cx, GAME.height * 0.7, "Menu", 0x3f6fd1, 0x5a8dee, () =>
        this.scene.start(SCENES.Menu),
      );
      return;
    }

    this.add
      .text(cx, GAME.height * 0.24, "Code de la salle", {
        fontFamily: UI_FONT,
        fontSize: "18px",
        color: "#cdd6f4",
        fontStyle: "600",
      })
      .setOrigin(0.5);

    this.createCodeInput(cx, GAME.height * 0.31);

    this.createButton(cx, GAME.height * 0.42, "Rejoindre la salle", 0x2fa84f, 0x43c463, () =>
      this.joinRoomFromInput(),
    );

    this.statusText = this.add
      .text(cx, GAME.height * 0.52, "Entre un code (ex: la classe) pour jouer ensemble.", {
        fontFamily: UI_FONT,
        fontSize: "16px",
        color: "#9aa6d6",
        align: "center",
        wordWrap: { width: GAME.width * 0.8 },
      })
      .setOrigin(0.5);

    this.membersText = this.add
      .text(cx, GAME.height * 0.62, "", {
        fontFamily: UI_FONT,
        fontSize: "18px",
        color: "#ffffff",
        align: "center",
        fontStyle: "600",
        wordWrap: { width: GAME.width * 0.8 },
        lineSpacing: 6,
      })
      .setOrigin(0.5, 0);

    this.createButton(cx, GAME.height * 0.9, "Menu", 0x3f6fd1, 0x5a8dee, () => {
      this.room?.leave();
      this.scene.start(SCENES.Menu);
    });

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.room?.leave());
  }

  private joinRoomFromInput(): void {
    if (this.joined) return;
    const code = (this.codeInput?.value ?? "").trim().toUpperCase().slice(0, 12);
    if (code.length < 2) {
      this.statusText.setText("Entre un code d'au moins 2 caractères.").setColor("#ff7a7a");
      return;
    }

    this.room = joinRoom(code, this.pseudo, {
      onPresence: (members) => this.onPresence(members),
    });
    if (!this.room) {
      this.statusText.setText("Connexion impossible.").setColor("#ff7a7a");
      return;
    }

    this.joined = true;
    if (this.codeInput) this.codeInput.disabled = true;
    this.statusText.setText(`Salle « ${code} » — en attente des joueurs…`).setColor("#43c463");
  }

  private onPresence(members: RoomMember[]): void {
    const lines = members.map((m) => `• ${m.pseudo}${m.id === this.room?.id ? "  (toi)" : ""}`);
    this.membersText.setText(
      `Joueurs (${members.length}) :\n${lines.join("\n")}`,
    );
  }

  private createCodeInput(cx: number, cy: number): void {
    const element = this.add.dom(cx, cy).createFromHTML(
      `<input type="text" maxlength="12" placeholder="CODE"
        style="
          width: 220px; padding: 12px 16px; font-size: 22px;
          font-family: 'Luckiest Guy', sans-serif; letter-spacing: 2px; text-align: center;
          text-transform: uppercase; border: 2px solid rgba(255,210,63,0.6); border-radius: 14px;
          outline: none; background: rgba(255,255,255,0.06); color: #ffffff; box-sizing: border-box;
        " />`,
    );
    this.codeInput = element.node.querySelector("input") as HTMLInputElement;
  }

  private drawBackground(): void {
    const g = this.add.graphics().setDepth(-20);
    g.fillGradientStyle(0x2a3f8f, 0x2a3f8f, 0x0d1330, 0x0d1330, 1);
    g.fillRect(0, 0, GAME.width, GAME.height);
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
