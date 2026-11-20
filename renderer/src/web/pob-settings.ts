import { KeyToCode, isModKey } from "@ipc/KeyToCode";
import { BASE_CURRENCIES } from "@/web/assistant/price-value";

// Applies settings sent from Path of Building's Options window (PoE2
// assistant U03, see main/src/host-files/PobSettingsBridge.ts). Each entry is
// "<config key>" or "widget:<wmType>.<key>" -> new value. Only keys the
// config already has are set, and only with a value of the same kind; the
// others are returned as rejected with the reason.

const REALMS = ["pc-ggg", "pc-garena", "pc-tencent"];
const LANGUAGES = ["en", "ru", "cmn-Hant", "ko", "ja", "de", "es", "pt", "fr"];

function isHotkey(value: unknown, noModKeys = false): boolean {
  if (typeof value !== "string") return false;
  const keys = value.split(" + ");
  const mainKeys = keys.filter((key) => !isModKey(key));
  return (
    mainKeys.length === 1 &&
    keys.every((key) => isModKey(key) || key in KeyToCode) &&
    !mainKeys.includes("F12") &&
    (!noModKeys || keys.length === 1)
  );
}

const RULES: Record<string, (value: unknown) => boolean> = {
  "realm": (v) => REALMS.includes(v as string),
  "language": (v) => LANGUAGES.includes(v as string),
  "fontSize": (v) =>
    Number.isInteger(v) && (v as number) >= 8 && (v as number) <= 40,
  "overlayKey": (v) => isHotkey(v),
  "widget:price-check.hotkey": (v) => v === null || isHotkey(v, true),
  "widget:price-check.hotkeyHold": (v) => v === "Ctrl" || v === "Alt",
  // M08b: value for money
  "widget:assistant-eval.valueCurrency": (v) =>
    BASE_CURRENCIES.includes(v as string),
  "widget:assistant-eval.tencentExaltedPerDivine": isRate,
  "widget:assistant-eval.tencentChaosPerDivine": isRate,
  "widget:assistant-eval.tencentDivinePerMirror": isRate,
};

// Exchange rate typed in PoB; 0 = not filled in.
function isRate(v: unknown): boolean {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v < 1e9;
}

function isHotkeyField(key: string) {
  return key === "hotkey" || /(Key|Hotkey)$/.test(key);
}

interface Widgets {
  widgets: Array<{ wmType: string }>;
}

export function applyPobSettings(
  config: Widgets,
  set: Record<string, unknown>,
): Record<string, string> {
  const rejected: Record<string, string> = {};
  for (const [path, value] of Object.entries(set)) {
    const match = /^widget:([^.]+)\.(.+)$/.exec(path);
    const holder = (
      match ? config.widgets.find((w) => w.wmType === match[1]) : config
    ) as Record<string, unknown> | undefined;
    const key = match ? match[2] : path;
    if (!holder || !(key in holder)) {
      rejected[path] = "unknown setting";
      continue;
    }
    const current = holder[key];
    const rule = RULES[path];
    const ok = rule
      ? rule(value)
      : isHotkeyField(key)
        ? value === null || isHotkey(value)
        : current !== null && typeof value === typeof current;
    if (!ok) {
      rejected[path] = "invalid value";
      continue;
    }
    holder[key] = value;
  }
  return rejected;
}
