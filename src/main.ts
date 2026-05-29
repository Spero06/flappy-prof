import Phaser from "phaser";
import { GAME, SCENES } from "./config";
import { BootScene } from "./scenes/BootScene";
import { PreloadScene } from "./scenes/PreloadScene";
import { MenuScene } from "./scenes/MenuScene";
import { GameScene } from "./scenes/GameScene";
import { QuizScene } from "./scenes/QuizScene";
import { GameOverScene } from "./scenes/GameOverScene";
import { LeaderboardScene } from "./scenes/LeaderboardScene";
import { PauseScene } from "./scenes/PauseScene";

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: "game",
  backgroundColor: GAME.backgroundColor,
  dom: {
    createContainer: true,
  },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: GAME.width,
    height: GAME.height,
  },
  // Crispness on retina / high-DPR screens: the Scale manager (FIT) renders at the
  // design resolution and CSS-scales to the viewport; roundPixels avoids blur.
  render: {
    antialias: true,
    roundPixels: true,
    pixelArt: false,
  },
  physics: {
    default: "arcade",
    arcade: {
      gravity: { x: 0, y: 0 },
      debug: false,
    },
  },
  scene: [
    BootScene,
    PreloadScene,
    MenuScene,
    GameScene,
    QuizScene,
    GameOverScene,
    LeaderboardScene,
    PauseScene,
  ],
};

const game = new Phaser.Game(config);

// Keep the canvas sized to the window across orientation / resize events.
window.addEventListener("resize", () => game.scale.refresh());

// Expose for quick debugging in the console during development.
(window as unknown as { game: Phaser.Game }).game = game;

export {};

// Scene keys are re-exported for convenience in other modules.
export { SCENES };
