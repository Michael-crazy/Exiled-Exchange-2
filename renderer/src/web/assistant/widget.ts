import type { Widget } from "../overlay/widgets.js";

export interface AssistantEvalWidget extends Widget {
  hotkey: string | null;
  // Evaluate the item already on the clipboard, without copying.
  clipboardHotkey: string | null;
  // Evaluate items copied with the in-game market's copy button.
  watchClipboard: boolean;
  // Add the item under the mouse (or the market copy) to PoB's item list (U06).
  addToPobHotkey: string | null;
  // M08b: value for money is counted per 1 of this currency (trade id).
  valueCurrency: string;
  // M08b: Tencent exchange rates typed in PoB's options; 0 = not filled in.
  // 1 Divine Orb = N Exalted Orbs / N Chaos Orbs; 1 Mirror = N Divine Orbs.
  tencentExaltedPerDivine: number;
  tencentChaosPerDivine: number;
  tencentDivinePerMirror: number;
  // M09a: answer the trade-site browser extension on 127.0.0.1:<port>.
  webPreview: boolean;
  webPreviewPort: number;
}
