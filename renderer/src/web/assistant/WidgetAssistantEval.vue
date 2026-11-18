<template>
  <Widget
    :config="{ ...config, anchor }"
    move-handles="none"
    :removable="false"
    :inline-edit="false"
  >
    <div
      class="bg-gray-800 text-gray-200 rounded p-2 font-sans text-sm"
      style="width: 28rem; max-height: 80vh; overflow: auto"
    >
      <div class="mb-1 text-gray-400">
        装备评估 · {{ gameLabel }}
      </div>
      <div v-if="state.kind === 'waiting'">评估中…</div>
      <div v-else-if="state.kind === 'error'" class="text-red-400">
        {{ state.message }}
        <span class="text-gray-500">（{{ state.code }}）</span>
      </div>
      <pre v-else class="whitespace-pre-wrap break-all">{{ state.text }}</pre>
    </div>
  </Widget>
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
      };
    },
  } satisfies WidgetSpec,
};
</script>

<script setup lang="ts">
import { computed, inject, ref } from "vue";
import { Host } from "@/web/background/IPC";
import { AppConfig } from "@/web/Config";
import { detectedGame } from "@/web/background/GameInfo";
import type { WidgetManager } from "../overlay/interfaces";
import Widget from "../overlay/Widget.vue";

const props = defineProps<{
  config: AssistantEvalWidget;
}>();

const wm = inject<WidgetManager>("wm")!;

type State =
  | { kind: "waiting" }
  | { kind: "done"; text: string }
  | { kind: "error"; code: string; message: string };

const state = ref<State>({ kind: "waiting" });
const checkPosition = ref({ x: 1, y: 1 });
let requestId = "";
let requestSeq = 0;

const gameLabel = computed(() => {
  const realm = detectedGame.value?.realm ?? AppConfig().realm;
  return realm === "pc-tencent" ? "腾讯服" : "国际服";
});

Host.onEvent("MAIN->CLIENT::item-text", (e) => {
  if (e.target !== "assistant-eval") return;

  checkPosition.value = e.position;
  requestId = `${Date.now()}-${++requestSeq}`;
  state.value = { kind: "waiting" };
  wm.show(props.config.wmId);
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

Host.onEvent("MAIN->CLIENT::assistant-response", (e) => {
  if (e.id !== requestId) return;
  state.value = e.error
    ? { kind: "error", code: e.error.code, message: e.error.message }
    : { kind: "done", text: JSON.stringify(e.result, null, 2) };
});

props.config.wmWants = "hide";

const anchor = computed(() => {
  const width = wm.size.value.width;
  const poePanelWidth = wm.poePanelWidth.value;
  const side =
    checkPosition.value.x > window.screenX + width / 2 ? "inventory" : "stash";
  return {
    pos: side === "stash" ? "cl" : "cr",
    y: 50,
    x:
      side === "stash"
        ? (poePanelWidth / width) * 100
        : ((width - poePanelWidth) / width) * 100,
  };
});
</script>
