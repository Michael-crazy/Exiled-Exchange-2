import { clipboard } from "electron";
import { isPoeItem, type HostClipboard } from "./HostClipboard";
import type { GameWindow } from "../windowing/GameWindow";

const WATCH_DELAY = 250;

// Item text already on the clipboard, for the clipboard hotkey.
export function clipboardItemText(): string | null {
  const text = clipboard.readText();
  return isPoeItem(text) ? text : null;
}

// The in-game market's copy button puts item text on the clipboard without
// a hotkey. Report new item text that appears while the game is in front,
// but not the text EE2 itself copied with its own hotkeys.
export class ClipboardWatcher {
  private timer?: ReturnType<typeof setInterval>;
  private lastText = "";
  private lastItem = "";

  constructor(
    private host: HostClipboard,
    private poeWindow: GameWindow,
    private onItem: (text: string) => void,
  ) {}

  setEnabled(enabled: boolean) {
    if (enabled === (this.timer != null)) return;
    if (enabled) {
      // What is already on the clipboard is not new.
      this.lastText = clipboard.readText();
      this.lastItem = isPoeItem(this.lastText) ? this.lastText : "";
      this.timer = setInterval(() => {
        this.check();
      }, WATCH_DELAY);
    } else {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private check() {
    // EE2 is copying an item for a hotkey right now.
    if (this.host.isPolling) return;

    const text = clipboard.readText();
    if (text === this.lastText) return;
    this.lastText = text;
    if (!isPoeItem(text)) return;
    // The same item again, e.g. put back by "restore clipboard".
    if (text === this.lastItem) return;
    this.lastItem = text;
    // Copied by EE2 for a hotkey.
    if (text === this.host.lastItemText) return;
    // Copied outside the game (e.g. from a trade website).
    if (!this.poeWindow.isActive) return;

    this.onItem(text);
  }
}
