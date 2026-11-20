import { shallowRef } from "vue";

// Simplified Chinese text of the Tencent trade site's stat filters, keyed by
// trade stat id (the same ids as the international site). Generated from
// PoE2-Build-Assistant `data/trade/stats.json` (field `zh`).
const texts = shallowRef<Record<string, string> | null>(null);
let requested = false;

export function tencentStatText(tradeId: string): string | undefined {
  if (!texts.value) {
    if (!requested) {
      requested = true;
      fetch(`${import.meta.env.BASE_URL}data/cmn-Hans/trade-stats.json`)
        .then((res) => res.json())
        .then((data: Record<string, string>) => {
          texts.value = data;
        });
    }
    return undefined;
  }
  return texts.value[tradeId];
}
