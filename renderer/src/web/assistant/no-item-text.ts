import type { IpcEventPayload } from "@ipc/types";

type Reason = IpcEventPayload<"MAIN->CLIENT::item-text-failed">["reason"];

// Shown when a hotkey did not get item text from the game.
export function noItemText(reason: Reason) {
  if (reason === "clipboard-empty") {
    return {
      code: "clipboard-no-item",
      message:
        "剪贴板里没有装备信息：请先在市集里点“复制”，或对装备按 Ctrl + C，再按快捷键。",
    };
  }
  return reason === "unchanged"
    ? {
        code: "no-item-copied",
        message:
          "没有复制到装备信息：已穿戴的装备无法复制，请对背包、仓库或市集里的装备使用。也可能是按键时鼠标没有停在装备上。",
      }
    : {
        code: "clipboard-not-item",
        message:
          "剪贴板里的内容不是装备信息：请把鼠标停在背包、仓库或市集里的装备上，等提示框出现后再按快捷键。",
      };
}
