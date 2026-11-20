import { shallowRef } from "vue";
import type { DetectedGame } from "@ipc/types";
import { Host } from "./IPC";
import { AppConfig, type Config } from "@/web/Config";

// The game client detected by the main process.
export const detectedGame = shallowRef<DetectedGame | null>(null);

export function initGameInfo() {
  Host.onEvent("MAIN->CLIENT::game-detected", ({ game }) => {
    detectedGame.value = game;
    const config = AppConfig();
    if (!game || !config.followGame) return;

    config.realm = game.realm;
    // EE2 has no Simplified Chinese data. On Tencent the price check parses
    // P05's English translation of the item and the interface is Simplified
    // Chinese (uiLanguage); the backend gets the real client language.
    const language = game.realm === "pc-tencent" ? "en" : game.language;
    if (language) {
      config.language = language as Config["language"];
    }
  });
}
