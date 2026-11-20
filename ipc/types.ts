export interface HostConfig {
  shortcuts: ShortcutAction[];
  restoreClipboard: boolean;
  clientLog: string | null;
  gameConfig: string | null;
  stashScroll: boolean;
  overlayKey: string;
  logKeys: boolean;
  windowTitle: string;
  language: string;
  readClientLog: boolean;
  libraryAlpha: boolean;
  libraryOutputPath: string | null;
  initialDelay: number;
  hideOverlayOnBlur: boolean;
  // PoE2 assistant: evaluate item text that appears on the clipboard
  // while the game is in front (the in-game market's copy button).
  assistantWatchClipboard: boolean;
}

export interface ShortcutAction {
  shortcut: string;
  keepModKeys?: true;
  action:
    | {
        type: "copy-item";
        focusOverlay?: boolean;
        target: string;
      }
    | {
        // Use the item text already on the clipboard, without copying.
        type: "clipboard-item";
        focusOverlay?: boolean;
        target: string;
      }
    | {
        // PoE2 assistant (U06): add the item under the mouse, or else the
        // item already on the clipboard, to the build open in PoB.
        type: "add-to-pob";
        target: string;
      }
    | {
        type: "ocr-text";
        target: "heist-gems";
      }
    | {
        type: "trigger-event";
        target: string;
      }
    | {
        type: "stash-search";
        text: string;
      }
    | {
        type: "toggle-overlay";
      }
    | {
        type: "paste-in-chat";
        text: string;
        send: boolean;
      }
    | {
        type: "test-only";
      };
}

export type UpdateInfo =
  | {
      state: "initial" | "checking-for-update";
    }
  | {
      state: "update-available";
      version: string;
      noDownloadReason: "not-supported" | "disabled-by-flag" | null;
    }
  | {
      state: "update-downloaded";
      version: string;
    }
  | {
      state: "update-not-available" | "error";
      checkedAt: number;
    };

export interface HostState {
  contents: string | null;
  version: string;
  updater: UpdateInfo;
}

export type IpcEvent =
  // events that have meaning only in Overlay mode:
  | IpcOverlayAttached
  | IpcFocusChange
  | IpcVisibility
  | IpcFocusGame
  | IpcOverlayRenderState
  | IpcHideExclusiveWidget
  | IpcTrackArea
  // events used by any type of Client:
  | IpcSaveConfig
  | IpcUpdaterState
  | IpcGameLog
  | IpcClientIsActive
  | IpcLogEntry
  | IpcHostConfig
  | IpcWidgetAction
  | IpcItemText
  | IpcItemTextFailed
  | IpcOcrText
  | IpcConfigChanged
  | IpcUserAction
  | IpcWriteToFile
  | IpcReparseLog
  | IpcGameDetected
  | IpcAssistantRequest
  | IpcAssistantResponse
  | IpcPobSettings
  | IpcPobSettingsApplied;

export type IpcEventPayload<
  Name extends IpcEvent["name"],
  T extends IpcEvent = IpcEvent,
> = T extends { name: Name; payload: infer P } ? P : never;

type IpcOverlayAttached = Event<"MAIN->OVERLAY::overlay-attached">;

type IpcFocusChange = Event<
  "MAIN->OVERLAY::focus-change",
  {
    game: boolean;
    overlay: boolean;
    usingHotkey: boolean;
  }
>;

type IpcVisibility = Event<
  "MAIN->OVERLAY::visibility",
  {
    isVisible: boolean;
  }
>;

type IpcFocusGame = Event<"OVERLAY->MAIN::focus-game">;

type IpcOverlayRenderState = Event<
  "OVERLAY->MAIN::render-state",
  {
    shouldShow: boolean;
  }
>;

type IpcHideExclusiveWidget = Event<"MAIN->OVERLAY::hide-exclusive-widget">;

type IpcTrackArea = Event<
  "OVERLAY->MAIN::track-area",
  {
    holdKey: string;
    closeThreshold: number;
    from: { x: number; y: number };
    area: { x: number; y: number; width: number; height: number };
    dpr: number;
  }
>;

type IpcHostConfig = Event<"CLIENT->MAIN::update-host-config", HostConfig>;

type IpcClientIsActive = Event<
  "CLIENT->MAIN::used-recently",
  {
    isOverlay: boolean;
  }
>;

type IpcSaveConfig = Event<
  "CLIENT->MAIN::save-config",
  {
    contents: string;
    isTemporary: boolean;
  }
>;

// PoE2 assistant: settings changed in Path of Building's Options window.
type IpcPobSettings = Event<
  "MAIN->CLIENT::pob-settings",
  {
    seq: number;
    set: Record<string, unknown>;
  }
>;

type IpcPobSettingsApplied = Event<
  "CLIENT->MAIN::pob-settings-applied",
  {
    seq: number;
    rejected: Record<string, string>;
  }
>;

type IpcConfigChanged = Event<
  "MAIN->CLIENT::config-changed",
  {
    contents: string;
  }
>;

type IpcLogEntry = Event<
  "MAIN->CLIENT::log-entry",
  {
    message: string;
  }
>;

type IpcWidgetAction = Event<
  "MAIN->CLIENT::widget-action",
  {
    target: string;
  }
>;

type IpcItemText = Event<
  "MAIN->CLIENT::item-text",
  {
    target: string;
    clipboard: string;
    item?: unknown;
    position: { x: number; y: number };
    focusOverlay: boolean;
    // clipboard-watch: the game put item text on the clipboard by itself
    // (the in-game market's copy button), no hotkey was pressed.
    trigger?: "clipboard-watch";
    // add-to-pob: add the item to PoB instead of evaluating it (U06).
    mode?: "add-to-pob";
  }
>;

type IpcItemTextFailed = Event<
  "MAIN->CLIENT::item-text-failed",
  {
    target: string;
    position: { x: number; y: number };
    // unchanged: the game copied nothing (equipped items cannot be copied).
    // not-item: the clipboard changed to something that is not an item.
    // clipboard-empty: the clipboard hotkey found no item text there.
    reason: "unchanged" | "not-item" | "clipboard-empty";
    focusOverlay: boolean;
    mode?: "add-to-pob";
  }
>;

type IpcOcrText = Event<
  "MAIN->CLIENT::ocr-text",
  {
    target: string;
    pressTime: number;
    ocrTime: number;
    paragraphs: string[];
  }
>;

type IpcGameLog = Event<
  "MAIN->CLIENT::game-log",
  {
    lines: string[];
  }
>;

type IpcReparseLog = Event<"CLIENT->MAIN::re-parse-log">;

// The game client currently running, detected from its process.
export interface DetectedGame {
  realm: "pc-ggg" | "pc-tencent";
  process: string;
  pid: number;
  exePath: string | null;
  windowTitle: string;
  clientLog: string | null;
  gameConfig: string;
  // Client language: EE2 language code, or "cmn-Hans" for Tencent.
  // null when the international config could not be read.
  language: string | null;
}

type IpcGameDetected = Event<
  "MAIN->CLIENT::game-detected",
  {
    game: DetectedGame | null;
  }
>;

// Request to the Python backend, see sources/assistant-shell.md
// in PoE2-Build-Assistant.
type IpcAssistantRequest = Event<
  "CLIENT->MAIN::assistant-request",
  {
    id: string;
    method: string;
    params: unknown;
  }
>;

type IpcAssistantResponse = Event<
  "MAIN->CLIENT::assistant-response",
  {
    id: string;
    result?: unknown;
    error?: { code: string; message: string };
  }
>;

type IpcUpdaterState = Event<"MAIN->CLIENT::updater-state", UpdateInfo>;

// Hotkeyable actions are defined in `ShortcutAction`.
// Actions below are triggered by user interaction with the UI.
type IpcUserAction = Event<
  "CLIENT->MAIN::user-action",
  | {
      action: "check-for-update" | "update-and-restart" | "quit";
    }
  | {
      action: "stash-search";
      text: string;
    }
>;

type IpcWriteToFile = Event<
  "CLIENT->MAIN::write-data",
  | {
      action: "log-item";
      text: string;
    }
  | {
      action: "session";
      start: boolean;
      name?: string;
      header?: string;
    }
  | {
      action: "client-log-event";
      data: ClientLogEvent;
      close: boolean;
    }
>;

export type ClientLogEvent =
  | GeneralLogEvent
  | LoadZoneEvent
  | LevelUpEvent
  | GameVersionEvent
  | AltTabEvent
  | NpcEvent
  | PlayerDeathEvent
  | PassiveTreeEvent
  | PermanentBonusEvent
  | SkillPointEvent
  | MapNavEvent
  | AfkEvent;

type BaseLogEvent = {
  ts: number;
  ms: number;
};

export type GeneralLogEvent = BaseLogEvent & {
  type: "log" | "game-start" | "login";
};

export type LoadZoneEvent = BaseLogEvent & {
  type: "load-zone";
  zone: string;
  areaLevel: number;
  seed: number;
};

export type LevelUpEvent = BaseLogEvent & {
  type: "level-up";
  charName: string;
  charClass: string;
  level: number;
};

export type GameVersionEvent = BaseLogEvent & {
  type: "game-version";
  version: string;
};

export type AltTabEvent = BaseLogEvent & {
  type: "alt-tab";
  gameFocused: boolean;
};

export type NpcEvent = BaseLogEvent & {
  type: "npc";
  npcName: string;
  message: string;
};

export type PlayerDeathEvent = BaseLogEvent & {
  type: "player-death";
  charName: string;
};

export type PassiveTreeEvent = BaseLogEvent & {
  type: "passive-tree";
  allocate: boolean;
  nodeId: string;
  nodeName: string;
};

export type PermanentBonusEvent = BaseLogEvent & {
  type: "permanent-bonus";
  permanentBonus: string;
  charName: string;
};

export type SkillPointEvent = BaseLogEvent & {
  type: "skill-point";
  points: number;
  pointType:
    | "passive"
    | "weapon-set"
    | "atlas"
    // all atlas sub trees
    | "map-boss"
    | "arbiter-boss"
    | "abyss"
    | "ritual"
    | "delirium"
    | "expedition"
    | "breach";
};

export type MapNavEvent = BaseLogEvent & {
  type: "map-nav";
  mapName: string;
};

export type AfkEvent = BaseLogEvent & {
  type: "afk";
  isAfk: boolean;
};

interface Event<TName extends string, TPayload = undefined> {
  name: TName;
  payload: TPayload;
}
