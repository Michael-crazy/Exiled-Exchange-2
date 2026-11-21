// PoE2 assistant: value-for-money rules shared by the overlay (renderer
// web/assistant/price-value.ts, M08b) and the assistant's trade window
// (main trade-window-rules.ts, M09b), so both show the same thing (V10 #21).

// Below this price (in Divine Orbs) the gains are not divided by it: a
// 1 Regal Orb item would show gains thousands of times over.
export const MIN_PRICE_DIVINES = 0.05;

export interface Gains {
  // false when the build has no DPS.
  hasDps: boolean;
  // DPS % and effective life gained; null when there is no gain (≤ 0 after
  // the same rounding as the summary: 0.1 % DPS, 1 effective life).
  dpsPercent: number | null;
  ehp: number | null;
}

// dpsPercent: null when the build has no DPS.
export function gains(dpsPercent: number | null, ehp: number): Gains {
  return {
    hasDps: dpsPercent !== null,
    dpsPercent:
      dpsPercent !== null && Math.round(dpsPercent * 10) > 0
        ? dpsPercent
        : null,
    ehp: Math.round(ehp) > 0 ? ehp : null,
  };
}

export function hasGain(g: Gains): boolean {
  return g.dpsPercent !== null || g.ehp !== null;
}

// Price in Divine Orbs below MIN_PRICE_DIVINES; unknown (no rate) is not.
export function isCheap(priceDivines: number | null | undefined): boolean {
  return typeof priceDivines === "number" && priceDivines < MIN_PRICE_DIVINES;
}

// Gains per 1 base currency (priceBase: the price in it), or as they are
// when the price is very low.
export function perPrice(g: Gains, priceBase: number, cheap: boolean): Gains {
  const per = (v: number | null) =>
    v === null ? null : cheap ? v : v / priceBase;
  return { hasDps: g.hasDps, dpsPercent: per(g.dpsPercent), ehp: per(g.ehp) };
}

// Fewer decimals for larger numbers: 123 / 12.3 / 1.23 / 0.012.
export function compact(value: number): string {
  const abs = Math.abs(value);
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : abs >= 0.1 ? 2 : 3;
  const text = value.toFixed(digits);
  return Number(text) > 0 ? `+${text}` : Number(text) === 0 ? "0" : text;
}

// A gain as shown; null is no gain.
export function gainText(value: number | null, unit = ""): string {
  if (value === null) return "无提升";
  const text = compact(value);
  // Positive but too small for three decimals.
  return (text === "0" ? "<+0.001" : text) + unit;
}

// "DPS +1.2% · 有效生命 +300" (no DPS part when the build has no DPS).
export function gainsText(g: Gains): string {
  return [
    g.hasDps ? `DPS ${gainText(g.dpsPercent, "%")}` : null,
    `有效生命 ${gainText(g.ehp)}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

export const CHEAP_NOTE = `价格极低（不足 ${MIN_PRICE_DIVINES} 神圣石），只看提升`;
