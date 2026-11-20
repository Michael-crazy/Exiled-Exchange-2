<template>
  <!-- Same placement as the price check window: next to the game panel on
       the side of the screen where the item was. -->
  <div
    style="top: 0; left: 0; height: 100%; width: 100%; position: absolute"
    class="flex pointer-events-none"
    :class="side === 'stash' ? 'flex-row' : 'flex-row-reverse'"
  >
    <div class="shrink-0" style="width: var(--game-panel)"></div>
    <div
      class="shrink-0 flex flex-col text-gray-200 pointer-events-auto self-start"
      style="width: 28.75rem; max-height: 100%"
    >
      <AppTitleBar :title="`装备评估 · ${gameLabel}`" @close="close" />
      <div class="bg-gray-800 p-3 text-sm overflow-y-auto min-h-0">
        <div v-if="state.kind === 'waiting'" class="text-gray-400">评估中…</div>
        <ui-error-box v-else-if="state.kind === 'error'">
          <template #name>无法评估</template>
          <p>{{ state.message }}</p>
          <p class="text-gray-500 text-xs">{{ state.code }}</p>
        </ui-error-box>
        <EvalResultView v-else :result="state.result" />
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import type { WidgetSpec } from "../overlay/interfaces";
import type { AssistantEvalWidget } from "./widget.js";

export default {
  widget: {
    type: "assistant-eval",
    instances: "single",
    initInstance: (): AssistantEvalWidget => {
      return {
        wmId: 0,
        wmType: "assistant-eval",
        wmTitle: "",
        wmWants: "hide",
        wmZorder: "exclusive",
        wmFlags: ["hide-on-blur", "menu::skip"],
        hotkey: "Ctrl + Shift + D",
        clipboardHotkey: "Ctrl + Shift + V",
        watchClipboard: true,
      };
    },
  } satisfies WidgetSpec,
};
</script>

<script setup lang="ts">
import { computed, inject, onBeforeUnmount, ref } from "vue";
import { hotkeyToString } from "@ipc/KeyToCode";
import { Host } from "@/web/background/IPC";
import { AppConfig } from "@/web/Config";
import { detectedGame } from "@/web/background/GameInfo";
import type { WidgetManager } from "../overlay/interfaces";
import AppTitleBar from "@/web/ui/AppTitlebar.vue";
import UiErrorBox from "@/web/ui/UiErrorBox.vue";
import EvalResultView from "./EvalResult.vue";
import type { EvalResult } from "./eval-result";
import { noItemText } from "./no-item-text";

const props = defineProps<{
  config: AssistantEvalWidget;
}>();

const wm = inject<WidgetManager>("wm")!;

type State =
  | { kind: "waiting" }
  | { kind: "done"; result: EvalResult }
  | { kind: "error"; code: string; message: string };

const state = ref<State>({ kind: "waiting" });
const checkPosition = ref({ x: 1, y: 1 });
let requestId = "";
let requestSeq = 0;
let watchdog: ReturnType<typeof setTimeout> | undefined;
// Longer than the main process' own 30 s backend timeout.
const WATCHDOG_MS = 40_000;

function finish(next: State) {
  clearTimeout(watchdog);
  requestId = "";
  state.value = next;
}

const gameLabel = computed(() => {
  const realm = detectedGame.value?.realm ?? AppConfig().realm;
  return realm === "pc-tencent" ? "腾讯服" : "国际服";
});

const side = computed(() =>
  checkPosition.value.x > window.screenX + window.innerWidth / 2
    ? "inventory"
    : "stash",
);

const isShown = () => props.config.wmWants === "show";

// The overlay stays until Esc, a click outside it or the hotkey again.
// Esc and outside clicks give focus back to the game, and the
// "hide-on-blur" flag hides the window.
function close() {
  if (Host.isElectron) {
    Host.sendEvent({ name: "OVERLAY->MAIN::focus-game", payload: undefined });
  } else {
    wm.hide(props.config.wmId);
  }
}

// While the overlay has focus the game's global hotkeys are off,
// so the overlay sees the hotkey as a normal key press.
function onKeydown(e: KeyboardEvent) {
  if (!isShown()) return;
  let code = e.code;
  if (code.startsWith("Key")) code = code.slice("Key".length);
  else if (code.startsWith("Digit")) code = code.slice("Digit".length);
  const pressed = hotkeyToString([code], e.ctrlKey, e.shiftKey, e.altKey);
  if (
    (props.config.hotkey && pressed === props.config.hotkey) ||
    (props.config.clipboardHotkey && pressed === props.config.clipboardHotkey)
  ) {
    e.preventDefault();
    close();
  }
}
window.addEventListener("keydown", onKeydown);
onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown));

Host.onEvent("MAIN->CLIENT::item-text", (e) => {
  if (e.target !== "assistant-eval") return;
  // The hotkey reached the game, so the overlay is not focused: toggle.
  // An item copied in the market always replaces what is shown.
  if (isShown() && e.trigger !== "clipboard-watch") {
    wm.hide(props.config.wmId);
    return;
  }

  checkPosition.value = e.position;
  const id = `${Date.now()}-${++requestSeq}`;
  requestId = id;
  state.value = { kind: "waiting" };
  wm.show(props.config.wmId);
  clearTimeout(watchdog);
  watchdog = setTimeout(() => {
    if (requestId !== id) return;
    finish({
      kind: "error",
      code: "shell-timeout",
      message: "助手没有收到后端的结果，请稍后重试。",
    });
  }, WATCHDOG_MS);
  Host.sendEvent({
    name: "CLIENT->MAIN::assistant-request",
    payload: {
      id: requestId,
      method: "evaluate-item",
      params: {
        item_text: e.clipboard,
        game: {
          realm: detectedGame.value?.realm ?? AppConfig().realm,
          language: detectedGame.value?.language ?? null,
        },
      },
    },
  });
});

Host.onEvent("MAIN->CLIENT::item-text-failed", (e) => {
  if (e.target !== "assistant-eval") return;
  if (isShown()) {
    wm.hide(props.config.wmId);
    return;
  }

  checkPosition.value = e.position;
  finish({ kind: "error", ...noItemText(e.reason) });
  wm.show(props.config.wmId);
});

Host.onEvent("MAIN->CLIENT::assistant-response", (e) => {
  if (!requestId || e.id !== requestId) return;
  if (e.error) {
    finish({
      kind: "error",
      code: e.error.code,
      message: e.error.message || "后端返回了错误，但没有说明原因。",
    });
  } else if (e.result == null) {
    finish({
      kind: "error",
      code: "empty-result",
      message: "后端没有返回评估结果。",
    });
  } else {
    finish({ kind: "done", result: e.result as EvalResult });
  }
});

Host.onEvent("MAIN->OVERLAY::hide-exclusive-widget", () => {
  wm.hide(props.config.wmId);
});

props.config.wmWants = "hide";
</script>
