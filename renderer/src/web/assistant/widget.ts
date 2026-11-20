import type { Widget } from "../overlay/widgets.js";

export interface AssistantEvalWidget extends Widget {
  hotkey: string | null;
  // Evaluate the item already on the clipboard, without copying.
  clipboardHotkey: string | null;
  // Evaluate items copied with the in-game market's copy button.
  watchClipboard: boolean;
}
