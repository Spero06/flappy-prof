import Phaser from "phaser";
import { GAME, SCENES } from "../config";
import { randomSeed } from "../systems/Rng";
import {
  createRoom,
  fetchOpenRooms,
  isConfigured,
  joinRoom,
  setRoomStatus,
  subscribeRooms,
  verifyRoom,
  type RoomHandle,
  type RoomMember,
  type RoomRow,
} from "../systems/Net";

interface LobbyInit {
  pseudo: string;
}

const TITLE_FONT = "Luckiest Guy, sans-serif";
const UI_FONT = "Fredoka, sans-serif";

/**
 * Multiplayer rooms browser (CLAUDE.md 8.2). A `rooms` table backs the live list (browse →
 * create / join). Creating a room makes you the admin; the admin starts a synced run (shared
 * seed + 3-2-1 countdown over the room's Realtime channel). Presence drives the member list.
 */
export class LobbyScene extends Phaser.Scene {
  private pseudo = "Anonyme";

  private headerText!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;
  private view: Phaser.GameObjects.GameObject[] = [];
  private nameInput?: HTMLInputElement;
  private pwInput?: HTMLInputElement;

  private rooms: RoomRow[] = [];
  private selected: RoomRow | null = null;
  private unsubRooms: () => void = () => {};

  private room: RoomHandle | null = null;
  private roomRow: RoomRow | null = null;
  private members: RoomMember[] = [];
  private isAdmin = false;
  private starting = false;
  private mode: "browse" | "create" | "join" | "room" = "browse";

  constructor() {
    super(SCENES.Lobby);
  }

  init(data: LobbyInit): void {
    this.pseudo = data?.pseudo ?? "Anonyme";
    this.rooms = [];
    this.selected = null;
    this.room = null;
    this.roomRow = null;
    this.members = [];
    this.isAdmin = false;
    this.starting = false;
    this.unsubRooms = () => {};
  }

  create(): void {
    const cx = GAME.width / 2;
    this.drawBackground();

    this.headerText = this.add
      .text(cx, GAME.height * 0.1, "Salons", {
        fontFamily: TITLE_FONT,
        fontSize: "40px",
        color: "#ffd23f",
      })
      .setOrigin(0.5)
      .setStroke("#1d2b53", 7);

    this.statusText = this.add
      .text(cx, GAME.height * 0.86, "", {
        fontFamily: UI_FONT,
        fontSize: "15px",
        color: "#9aa6d6",
        align: "center",
        wordWrap: { width: GAME.width * 0.84 },
      })
      .setOrigin(0.5);

    if (!isConfigured()) {
      this.headerText.setText("Multijoueur");
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
      this.button(cx, GAME.height * 0.7, GAME.width * 0.6, "Menu", 0x3f6fd1, 0x5a8dee, () =>
        this.scene.start(SCENES.Menu),
      );
      return;
    }

    this.showBrowse();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.cleanup());
  }

  private cleanup(): void {
    this.unsubRooms();
    if (!this.starting) {
      this.room?.leave();
      if (this.isAdmin && this.roomRow) void setRoomStatus(this.roomRow.id, "closed");
    }
  }

  private clearView(): void {
    for (const o of this.view) o.destroy();
    this.view = [];
    this.nameInput = undefined;
    this.pwInput = undefined;
  }

  // --- Browse ----------------------------------------------------------------

  private showBrowse(): void {
    this.mode = "browse";
    this.clearView();
    this.headerText.setText("Salons");
    this.statusText.setText("Choisis un salon, puis Rejoindre — ou crée le tien.").setColor("#9aa6d6");

    this.renderRoomList();
    void this.refreshRooms();
    this.unsubRooms();
    this.unsubRooms = subscribeRooms(() => void this.refreshRooms());

    const cx = GAME.width / 2;
    this.view.push(
      this.button(cx, GAME.height * 0.72, GAME.width * 0.7, "➕  Créer une salle", 0x2fa84f, 0x43c463, () =>
        this.showCreate(),
      ),
    );
    this.view.push(
      this.button(cx, GAME.height * 0.8, GAME.width * 0.7, "Rejoindre", 0x3f6fd1, 0x5a8dee, () => {
        if (!this.selected) {
          this.statusText.setText("Sélectionne d'abord un salon.").setColor("#ffd23f");
          return;
        }
        this.showJoin(this.selected);
      }),
    );
    this.view.push(
      this.button(cx, GAME.height * 0.93, GAME.width * 0.45, "Retour", 0x55607f, 0x6b7798, () =>
        this.scene.start(SCENES.Menu),
      ),
    );
  }

  private async refreshRooms(): Promise<void> {
    const rooms = await fetchOpenRooms();
    if (!this.scene.isActive() || this.mode !== "browse") return;
    this.rooms = rooms;
    if (this.selected && !rooms.some((r) => r.id === this.selected!.id)) this.selected = null;
    this.renderRoomList();
  }

  private renderRoomList(): void {
    // Drop any previous row objects (tagged) before redrawing.
    this.view = this.view.filter((o) => {
      if (o.getData?.("roomRow")) {
        o.destroy();
        return false;
      }
      return true;
    });

    const cx = GAME.width / 2;
    const top = GAME.height * 0.2;
    const rowH = 48;

    if (this.rooms.length === 0) {
      const empty = this.add
        .text(cx, GAME.height * 0.42, "Aucun salon ouvert.\nCrée le premier !", {
          fontFamily: UI_FONT,
          fontSize: "18px",
          color: "#9aa6d6",
          align: "center",
        })
        .setOrigin(0.5);
      empty.setData("roomRow", true);
      this.view.push(empty);
      return;
    }

    this.rooms.slice(0, 6).forEach((room, i) => {
      const y = top + i * (rowH + 8) + rowH / 2;
      const selected = this.selected?.id === room.id;
      const w = GAME.width * 0.84;

      const bg = this.add.graphics();
      bg.fillStyle(selected ? 0x2c7a4a : 0x141b3c, 0.92);
      bg.fillRoundedRect(cx - w / 2, y - rowH / 2, w, rowH, 12);
      bg.lineStyle(2, selected ? 0x43c463 : 0xffffff, selected ? 0.9 : 0.14);
      bg.strokeRoundedRect(cx - w / 2, y - rowH / 2, w, rowH, 12);
      bg.setData("roomRow", true);

      const label = this.add
        .text(cx - w / 2 + 16, y, `${room.name}`, {
          fontFamily: UI_FONT,
          fontSize: "20px",
          color: "#ffffff",
          fontStyle: "600",
        })
        .setOrigin(0, 0.5);
      label.setData("roomRow", true);

      const host = this.add
        .text(cx + w / 2 - 16, y, `🔒 ${room.host_name}`, {
          fontFamily: UI_FONT,
          fontSize: "14px",
          color: "#9aa6d6",
        })
        .setOrigin(1, 0.5);
      host.setData("roomRow", true);

      const hit = this.add
        .rectangle(cx, y, w, rowH, 0xffffff, 0.001)
        .setInteractive({ useHandCursor: true });
      hit.on("pointerdown", () => {
        this.selected = room;
        this.renderRoomList();
      });
      hit.setData("roomRow", true);

      this.view.push(bg, label, host, hit);
    });
  }

  // --- Create ----------------------------------------------------------------

  private showCreate(): void {
    this.mode = "create";
    this.clearView();
    this.unsubRooms();
    this.headerText.setText("Créer une salle");
    this.statusText.setText("Mot de passe : chiffres uniquement.").setColor("#9aa6d6");
    const cx = GAME.width / 2;

    this.view.push(this.label(cx, GAME.height * 0.26, "Nom du salon"));
    this.nameInput = this.textInput(cx, GAME.height * 0.32, {
      placeholder: "ex: La classe",
      maxlength: 24,
    });

    this.view.push(this.label(cx, GAME.height * 0.45, "Mot de passe (chiffres)"));
    this.pwInput = this.textInput(cx, GAME.height * 0.51, {
      placeholder: "ex: 1234",
      maxlength: 8,
      numeric: true,
    });

    this.view.push(
      this.button(cx, GAME.height * 0.66, GAME.width * 0.7, "Créer & entrer", 0x2fa84f, 0x43c463, () =>
        void this.doCreate(),
      ),
    );
    this.view.push(
      this.button(cx, GAME.height * 0.76, GAME.width * 0.5, "Annuler", 0x55607f, 0x6b7798, () =>
        this.showBrowse(),
      ),
    );
  }

  private async doCreate(): Promise<void> {
    const name = (this.nameInput?.value ?? "").trim();
    const pw = (this.pwInput?.value ?? "").replace(/\D/g, "");
    if (name.length < 1) {
      this.statusText.setText("Donne un nom au salon.").setColor("#ff7a7a");
      return;
    }
    if (pw.length < 1) {
      this.statusText.setText("Mot de passe : au moins 1 chiffre.").setColor("#ff7a7a");
      return;
    }
    this.statusText.setText("Création…").setColor("#9aa6d6");
    const row = await createRoom(name, pw, this.pseudo);
    if (!this.scene.isActive()) return;
    if (!row) {
      this.statusText.setText("Création impossible.").setColor("#ff7a7a");
      return;
    }
    this.roomRow = row;
    this.isAdmin = true;
    this.joinChannel(row);
    this.showRoom();
  }

  // --- Join ------------------------------------------------------------------

  private showJoin(room: RoomRow): void {
    this.mode = "join";
    this.clearView();
    this.unsubRooms();
    this.headerText.setText(room.name);
    this.statusText.setText(`Salon de ${room.host_name}`).setColor("#9aa6d6");
    const cx = GAME.width / 2;

    this.view.push(this.label(cx, GAME.height * 0.36, "Mot de passe"));
    this.pwInput = this.textInput(cx, GAME.height * 0.42, {
      placeholder: "chiffres",
      maxlength: 8,
      numeric: true,
    });

    this.view.push(
      this.button(cx, GAME.height * 0.56, GAME.width * 0.7, "Rejoindre", 0x2fa84f, 0x43c463, () =>
        void this.doJoin(room),
      ),
    );
    this.view.push(
      this.button(cx, GAME.height * 0.66, GAME.width * 0.5, "Annuler", 0x55607f, 0x6b7798, () =>
        this.showBrowse(),
      ),
    );
  }

  private async doJoin(room: RoomRow): Promise<void> {
    const pw = (this.pwInput?.value ?? "").replace(/\D/g, "");
    if (pw.length < 1) {
      this.statusText.setText("Entre le mot de passe.").setColor("#ff7a7a");
      return;
    }
    this.statusText.setText("Connexion…").setColor("#9aa6d6");
    const row = await verifyRoom(room.id, pw);
    if (!this.scene.isActive()) return;
    if (!row) {
      this.statusText.setText("Mauvais mot de passe.").setColor("#ff7a7a");
      return;
    }
    this.roomRow = row;
    this.isAdmin = false;
    this.joinChannel(row);
    this.showRoom();
  }

  // --- In-room ---------------------------------------------------------------

  private joinChannel(row: RoomRow): void {
    this.room = joinRoom(row.id, this.pseudo, {
      onPresence: (m) => this.onPresence(m),
      // Admin pressed start: jump to the game screen with the shared seed (countdown plays there).
      onStart: (s) => this.startGame(s),
    });
  }

  private showRoom(): void {
    this.mode = "room";
    this.clearView();
    if (!this.roomRow) return;
    this.headerText.setText(this.roomRow.name);
    const cx = GAME.width / 2;

    const membersText = this.add
      .text(cx, GAME.height * 0.26, "Joueurs : …", {
        fontFamily: UI_FONT,
        fontSize: "18px",
        color: "#ffffff",
        align: "center",
        fontStyle: "600",
        wordWrap: { width: GAME.width * 0.84 },
        lineSpacing: 6,
      })
      .setOrigin(0.5, 0);
    membersText.setData("members", true);
    this.view.push(membersText);
    this.renderMembers();

    if (this.isAdmin) {
      this.statusText.setText("Tu es l'hôte — lance la partie quand tout le monde est là.").setColor("#43c463");
      this.view.push(
        this.button(cx, GAME.height * 0.7, GAME.width * 0.7, "▶  Commencer", 0x2fa84f, 0x43c463, () =>
          this.adminStart(),
        ),
      );
    } else {
      this.statusText.setText("En attente de l'hôte…").setColor("#9aa6d6");
    }

    this.view.push(
      this.button(cx, GAME.height * 0.84, GAME.width * 0.5, "Quitter", 0x55607f, 0x6b7798, () =>
        this.leaveRoom(),
      ),
    );
  }

  private onPresence(members: RoomMember[]): void {
    this.members = members;
    if (this.mode === "room") this.renderMembers();
  }

  private renderMembers(): void {
    const txt = this.view.find((o) => o.getData?.("members")) as Phaser.GameObjects.Text | undefined;
    if (!txt) return;
    const lines = this.members.map(
      (m) => `• ${m.pseudo}${m.id === this.room?.id ? "  (toi)" : ""}`,
    );
    txt.setText(`Joueurs (${this.members.length}) :\n${lines.join("\n")}`);
  }

  private adminStart(): void {
    if (!this.isAdmin || !this.roomRow) return;
    const seed = randomSeed();
    void setRoomStatus(this.roomRow.id, "started");
    this.room?.broadcastStart(seed); // tell everyone to go to the game screen
    this.startGame(seed);
  }

  /** Hand the live room channel to the GameScene; the 3-2-1 countdown plays there. */
  private startGame(seed: number): void {
    if (this.starting) return;
    this.starting = true;
    this.unsubRooms();
    this.scene.start(SCENES.Game, {
      mode: "multi",
      pseudo: this.pseudo,
      seed,
      roomId: this.roomRow?.id,
      room: this.room ?? undefined,
    });
  }

  private leaveRoom(): void {
    this.room?.leave();
    this.room = null;
    if (this.isAdmin && this.roomRow) void setRoomStatus(this.roomRow.id, "closed");
    this.roomRow = null;
    this.isAdmin = false;
    this.showBrowse();
  }

  // --- UI helpers ------------------------------------------------------------

  private drawBackground(): void {
    const g = this.add.graphics().setDepth(-20);
    g.fillGradientStyle(0x2a3f8f, 0x2a3f8f, 0x0d1330, 0x0d1330, 1);
    g.fillRect(0, 0, GAME.width, GAME.height);
  }

  private label(cx: number, cy: number, text: string): Phaser.GameObjects.Text {
    return this.add
      .text(cx, cy, text, {
        fontFamily: UI_FONT,
        fontSize: "17px",
        color: "#cdd6f4",
        fontStyle: "600",
      })
      .setOrigin(0.5);
  }

  private textInput(
    cx: number,
    cy: number,
    opts: { placeholder: string; maxlength: number; numeric?: boolean },
  ): HTMLInputElement {
    const extra = opts.numeric ? 'inputmode="numeric" pattern="[0-9]*"' : "";
    const element = this.add.dom(cx, cy).createFromHTML(
      `<input type="text" maxlength="${opts.maxlength}" placeholder="${opts.placeholder}" ${extra}
        style="
          width: 240px; padding: 11px 16px; font-size: 20px; font-family: 'Fredoka', sans-serif;
          font-weight: 500; text-align: center; border: 2px solid rgba(255,210,63,0.6);
          border-radius: 14px; outline: none; background: rgba(255,255,255,0.06);
          color: #ffffff; box-sizing: border-box;
        " />`,
    );
    this.view.push(element);
    return element.node.querySelector("input") as HTMLInputElement;
  }

  private button(
    cx: number,
    cy: number,
    width: number,
    label: string,
    colorBottom: number,
    colorTop: number,
    onClick: () => void,
  ): Phaser.GameObjects.Container {
    const height = 50;
    const radius = 15;
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
      bg.fillStyle(0xffffff, 0.16);
      bg.fillRoundedRect(-w / 2 + 4, -h / 2 + 4, w - 8, h * 0.4, radius - 4);
    };
    draw(1);

    const text = this.add
      .text(0, 0, label, {
        fontFamily: UI_FONT,
        fontSize: "21px",
        color: "#ffffff",
        fontStyle: "600",
      })
      .setOrigin(0.5);

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
    return container;
  }
}
