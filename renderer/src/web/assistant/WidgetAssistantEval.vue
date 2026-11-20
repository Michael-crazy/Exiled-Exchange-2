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
      <AppTitleBar
        :title="`${state.kind === 'notice' ? '加入 PoB' : '装备评估'} · ${gameLabel}`"
        @close="close"
      />
      <div class="bg-gray-800 p-3 text-sm overflow-y-auto min-h-0">
        <div v-if="state.kind === 'waiting'" class="text-gray-400">评估中…</div>
        <div
          v-else-if="state.kind === 'notice'"
          class="text-base"
          :class="{
            'text-gray-400': state.tone === 'pending',
            'text-green-400': state.tone === 'ok',
            'text-red-400': state.tone === 'error',
          }"
        >
          {{ state.message }}
        </div>
        <ui-error-box v-else-if="state.kind === 'error'">
          <template #name>无法评估</template>
          <p>{{ state.message }}</p>
          <p class="text-gray-500 text-xs">{{ state.code }}</p>
        </ui-error-box>
        <template v-else>
          <EvalResultView
            :entry="state.entry"
            :value="valueOf(state.entry)"
            :base="base"
            :realm="realm"
            :missing-rate="missingRate(state.entry)"
            @update:slot="state.entry.slot = $event"
            @update:amount-text="state.entry.amountText = $event"
            @update:currency="setCurrency(state.entry, $event)"
          />
          <CompareList
            v-if="entries.length > 1"
            class="mt-3"
            :entries="entries"
            :current="state.entry"
            :base="base"
            :value-of="valueOf"
            @select="show"
            @clear="clearOthers"
          />
        </template>
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
        addToPobHotkey: "Ctrl + Shift + A",
        valueCurrency: "divine",
        tencentExaltedPerDivine: 0,
        tencentChaosPerDivine: 0,
        tencentDivinePerMirror: 0,
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
import CompareList from "./CompareList.vue";
import type { EvalResult } from "./eval-result";
import { noItemText } from "./no-item-text";
import { usePoeninja } from "@/web/background/Prices";
import { TRADE_TAG_TO_REF } from "@/assets/data";
import {
  type DivineRates,
  type Entry,
  BASE_CURRENCIES,
  DEFAULT_BASE,
  amountText,
  currencyById,
  currencyName,
  entryValue,
  tencentRates,
} from "./price-value";

const props = defineProps<{
  config: AssistantEvalWidget;
}>();

const wm = inject<WidgetManager>("wm")!;

type State =
  | { kind: "waiting" }
  | { kind: "done"; entry: Entry }
  | { kind: "error"; code: string; message: string }
  // U06: a short notice for the add-to-PoB hotkey; it hides by itself.
  | { kind: "notice"; tone: "pending" | "ok" | "error"; message: string };

const state = ref<State>({ kind: "waiting" });
const checkPosition = ref({ x: 1, y: 1 });
let requestId = "";
let requestSeq = 0;
// Item text of the pending evaluation (key of its comparison entry).
let requestText = "";
let watchdog: ReturnType<typeof setTimeout> | undefined;
// Longer than the main process' own 30 s backend timeout.
const WATCHDOG_MS = 40_000;

let hideTimer: ReturnType<typeof setTimeout> | undefined;
// Notices stay this long, then the widget hides (errors a little longer).
const NOTICE_MS = { ok: 2500, error: 5000 };

function finish(next: State) {
  clearTimeout(watchdog);
  clearTimeout(hideTimer);
  requestId = "";
  state.value = next;
  if (next.kind === "notice" && next.tone !== "pending") {
    hideTimer = setTimeout(() => {
      if (state.value === next) wm.hide(props.config.wmId);
    }, NOTICE_MS[next.tone]);
  }
}

// Add the item to the build open in PoB; the game keeps the focus.
function addToPob(text: string) {
  const id = `${Date.now()}-${++requestSeq}`;
  requestId = id;
  clearTimeout(hideTimer);
  state.value = { kind: "notice", tone: "pending", message: "正在加入 PoB…" };
  wm.show(props.config.wmId);
  clearTimeout(watchdog);
  watchdog = setTimeout(() => {
    if (requestId !== id) return;
    finish({
      kind: "notice",
      tone: "error",
      message: "助手没有收到后端的结果，请稍后重试。",
    });
  }, WATCHDOG_MS);
  Host.sendEvent({
    name: "CLIENT->MAIN::assistant-request",
    payload: {
      id,
      method: "add-to-pob",
      params: {
        item_text: text,
        game: {
          realm: detectedGame.value?.realm ?? AppConfig().realm,
          language: detectedGame.value?.language ?? null,
        },
      },
    },
  });
}

const realm = computed(() => detectedGame.value?.realm ?? AppConfig().realm);
const gameLabel = computed(() =>
  realm.value === "pc-tencent" ? "腾讯服" : "国际服",
);

// ---- M08b: value for money and the comparison list ----

// Recently evaluated items, newest first; the shown one is state.entry.
const entries = ref<Entry[]>([]);
const MAX_ENTRIES = 6;

const base = computed(() =>
  BASE_CURRENCIES.includes(props.config.valueCurrency)
    ? props.config.valueCurrency
    : DEFAULT_BASE,
);

const ninja = usePoeninja();

// Value of one unit in Divine Orbs.
const rates = computed<DivineRates>(() => {
  if (realm.value === "pc-tencent") return tencentRates(props.config);
  // poe.ninja's database is not reactive; its exchange rate changes on load.
  if (ninja.xchgRate.value === undefined)
    return (id) => (id === "divine" ? 1 : undefined);
  return (id) => {
    if (id === "divine") return 1;
    const name = TRADE_TAG_TO_REF.get(id) ?? currencyById(id)?.en;
    if (!name) return undefined;
    return ninja.findPriceByQuery({ ns: "ITEM", name })?.primaryValue;
  };
});

function valueOf(entry: Entry) {
  return entryValue(entry, base.value, rates.value);
}

function missingRate(entry: Entry): string {
  const v = valueOf(entry);
  if (!v.inBase || v.inBase.ok) return "";
  const name = currencyName(v.inBase.missing);
  if (realm.value !== "pc-tencent") {
    return ninja.xchgRate.value === undefined
      ? "正在获取 poe.ninja 汇率…"
      : `poe.ninja 没有${name}的价格`;
  }
  return ["exalted", "chaos", "mirror"].includes(v.inBase.missing)
    ? `未填写${name}的汇率：请在 PoB 选项“游戏内助手”里填写`
    : `腾讯服暂时只能换算崇高石、神圣石、混沌石和卡兰德的魔镜`;
}

const LAST_CURRENCY_KEY = "poe2-assistant.price-currency";
function lastCurrency(): string {
  try {
    const id = localStorage.getItem(LAST_CURRENCY_KEY);
    if (id && currencyById(id)) return id;
  } catch {
    // storage unavailable: use the default
  }
  return base.value;
}

function setCurrency(entry: Entry, id: string) {
  entry.currency = id;
  try {
    localStorage.setItem(LAST_CURRENCY_KEY, id);
  } catch {
    // not remembered
  }
}

// Adds (or refreshes) the evaluated item and shows it.
function addEntry(key: string, result: EvalResult) {
  const old = entries.value.find((e) => e.key === key);
  const note = result.item.price;
  const entry: Entry = {
    key,
    realm: realm.value,
    result,
    slot: result.default_slot,
    fromNote: note != null,
    amountText: note ? amountText(note.amount) : (old?.amountText ?? ""),
    currency: note ? note.currency : (old?.currency ?? lastCurrency()),
  };
  // Items evaluated against another build or server are not comparable.
  const path = result.build?.path ?? null;
  entries.value = [
    entry,
    ...entries.value.filter(
      (e) =>
        e.key !== key &&
        e.realm === entry.realm &&
        (e.result.build?.path ?? null) === path,
    ),
  ].slice(0, MAX_ENTRIES);
  if (realm.value !== "pc-tencent") ninja.queuePricesFetch();
  return entries.value[0];
}

function show(entry: Entry) {
  state.value = { kind: "done", entry };
}

function clearOthers() {
  if (state.value.kind === "done") entries.value = [state.value.entry];
}

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
  if (e.mode === "add-to-pob") {
    checkPosition.value = e.position;
    addToPob(e.clipboard);
    return;
  }
  // The hotkey reached the game, so the overlay is not focused: toggle.
  // An item copied in the market always replaces what is shown.
  if (isShown() && e.trigger !== "clipboard-watch") {
    wm.hide(props.config.wmId);
    return;
  }

  checkPosition.value = e.position;
  const id = `${Date.now()}-${++requestSeq}`;
  requestId = id;
  requestText = e.clipboard;
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
  if (e.mode === "add-to-pob") {
    checkPosition.value = e.position;
    finish({
      kind: "notice",
      tone: "error",
      message:
        "没有可加入的装备：请把鼠标停在背包、仓库或市集里的装备上，或先在市集里点“复制”，再按快捷键。",
    });
    wm.show(props.config.wmId);
    return;
  }
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
  if (state.value.kind === "notice") {
    const result = e.result as { message?: string } | undefined;
    finish(
      e.error
        ? { kind: "notice", tone: "error", message: e.error.message }
        : {
            kind: "notice",
            tone: "ok",
            message: result?.message ?? "已加入 PoB",
          },
    );
    return;
  }
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
    const entry = addEntry(requestText, e.result as EvalResult);
    finish({ kind: "done", entry });
  }
});

Host.onEvent("MAIN->OVERLAY::hide-exclusive-widget", () => {
  wm.hide(props.config.wmId);
});

props.config.wmWants = "hide";
</script>
