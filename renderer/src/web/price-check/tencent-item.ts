import { Host } from "@/web/background/IPC";
import { AppConfig } from "@/web/Config";
import { rememberTencentNames } from "./trade/tencent";

// Tencent items are copied in Simplified Chinese, which EE2 has no data for.
// The assistant backend translates them with P05 into the English game text
// that EE2's own parser reads (`translate-item`, sources/assistant-shell.md).

const TIMEOUT_MS = 35_000;
let nextId = 1;

export function needsTranslation(text: string) {
  return AppConfig().realm === "pc-tencent" && !text.startsWith("Item Class:");
}

export async function translateTencentItem(
  text: string,
): Promise<{ text: string } | { error: string }> {
  const id = `price-check-${nextId++}`;
  return await new Promise((resolve) => {
    const listener = Host.onEvent("MAIN->CLIENT::assistant-response", (e) => {
      if (e.id !== id) return;
      listener.abort();
      clearTimeout(timer);
      const result = e.result as
        | { text?: string; names?: Array<[string, string]> }
        | undefined;
      if (e.error) {
        resolve({ error: e.error.message });
      } else if (!result?.text) {
        resolve({ error: "助手后端没有返回英文装备文本。" });
      } else {
        rememberTencentNames(result.names ?? []);
        resolve({ text: result.text });
      }
    });
    const timer = setTimeout(() => {
      listener.abort();
      resolve({ error: "助手后端没有及时返回英文装备文本，请再查一次。" });
    }, TIMEOUT_MS);
    Host.sendEvent({
      name: "CLIENT->MAIN::assistant-request",
      payload: {
        id,
        method: "translate-item",
        params: {
          item_text: text,
          game: { realm: "pc-tencent", language: "cmn-Hans" },
        },
      },
    });
  });
}
