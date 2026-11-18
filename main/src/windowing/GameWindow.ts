import type { BrowserWindow } from "electron";
import { EventEmitter } from "events";
import { OverlayController, AttachEvent } from "electron-overlay-window";

export interface GameWindow {
  on: (event: "active-change", listener: (isActive: boolean) => void) => this;
}
export class GameWindow extends EventEmitter {
  private _isActive = false;
  private _attachedTitle: string | null = null;

  get bounds() {
    return OverlayController.targetBounds;
  }

  get attachedTitle() {
    return this._attachedTitle;
  }

  get isActive() {
    return this._isActive;
  }

  set isActive(active: boolean) {
    if (this.isActive !== active) {
      this._isActive = active;
      this.emit("active-change", this._isActive);
    }
  }

  get uiSidebarWidth() {
    // sidebar is 370px at 800x600
    const ratio = 370 / 600;
    return Math.round(this.bounds.height * ratio);
  }

  attach(window: BrowserWindow | undefined, title: string) {
    // The native hook can only be started once per process.
    if (this._attachedTitle == null) {
      OverlayController.events.on("focus", () => {
        this.isActive = true;
      });
      OverlayController.events.on("blur", () => {
        this.isActive = false;
      });
      OverlayController.attachByTitle(window, title, {
        hasTitleBarOnMac: true,
      });
      this._attachedTitle = title;
    }
  }

  onAttach(cb: (hasAccess: boolean | undefined) => void) {
    OverlayController.events.on("attach", (e: AttachEvent) => {
      cb(e.hasAccess);
    });
  }

  screenshot() {
    return OverlayController.screenshot();
  }
}
