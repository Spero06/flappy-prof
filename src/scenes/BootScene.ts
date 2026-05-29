import Phaser from "phaser";
import { SCENES } from "../config";

/** Earliest scene: minimal setup, then hand off to the asset loader. */
export class BootScene extends Phaser.Scene {
  constructor() {
    super(SCENES.Boot);
  }

  create(): void {
    this.scale.refresh();
    this.scene.start(SCENES.Preload);
  }
}
