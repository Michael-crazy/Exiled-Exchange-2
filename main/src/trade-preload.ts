import { contextBridge, ipcRenderer } from "electron";
import { PREVIEW_CHANNEL, PREVIEW_WORLD_ID } from "./trade-window-rules";

// Preload of the assistant's trade window (M09b, TradeWindow.ts). Gives the
// page script (the extension's assistant/preview.js), which runs in its own
// isolated world, the function it sends evaluations with. The site's own
// JavaScript runs in the main world and cannot reach it.
contextBridge.exposeInIsolatedWorld(
  PREVIEW_WORLD_ID,
  "poe2AssistantTransport",
  {
    evaluate: async (message: unknown) =>
      await (ipcRenderer.invoke(PREVIEW_CHANNEL, message) as Promise<unknown>),
  },
);
