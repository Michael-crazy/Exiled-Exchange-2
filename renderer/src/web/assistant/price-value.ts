// PoE2 assistant M08b: value for money of an evaluated item.
//
// The price comes from the market copy's note (international server) or is
// typed in the overlay's header (Tencent server: its market copy has no
// price). It is converted to the base currency (default Divine Orb), and the
// DPS % and effective life gain of the selected slot are divided by it.
//
// Exchange rates are values in Divine Orbs per unit: poe.ninja on the
// international server, the rates typed in the settings on Tencent.

import { TRADE_CURRENCIES, type TradeCurrency } from "./trade-currency";
import type { EvalResult, EvalSlot } from "./eval-result";

export { TRADE_CURRENCIES, type TradeCurrency };

// Header buttons; the rest of the list is in the "more" menu.
export const COMMON_CURRENCIES = ["exalted", "divine", "chaos"];
// Currencies the value can be counted in (setting valueCurrency).
export const BASE_CURRENCIES = ["divine", "exalted", "chaos"];
export const DEFAULT_BASE = "divine";

const BY_ID = new Map(TRADE_CURRENCIES.map((c) => [c.id, c]));

export function currencyById(id: string): TradeCurrency | undefined {
  return id === "sep" ? undefined : BY_ID.get(id);
}

// Simplified Chinese name for buttons and the value line.
export function currencyName(id: string): string {
  return currencyById(id)?.zh || id;
}

export function currencyIcon(
  id: string,
  realm: string | undefined,
): string | null {
  const image = currencyById(id)?.image;
  if (!image) return null;
  const host =
    realm === "pc-tencent"
      ? "https://poecdn.game.qq.com"
      : "https://web.poecdn.com";
  return host + image;
}

export interface Price {
  amount: number;
  currency: string;
}

// Value of one unit in Divine Orbs, undefined when unknown.
export type DivineRates = (currency: string) => number | undefined;

// Rates typed in the settings for the Tencent server ("1 神圣石 = N 崇高石"
// and so on); 0 means not filled in.
export interface TencentRateSettings {
  tencentExaltedPerDivine: number;
  tencentChaosPerDivine: number;
  tencentDivinePerMirror: number;
}

export function tencentRates(s: TencentRateSettings): DivineRates {
  return (currency) => {
    switch (currency) {
      case "divine":
        return 1;
      case "exalted":
        return s.tencentExaltedPerDivine > 0
          ? 1 / s.tencentExaltedPerDivine
          : undefined;
      case "chaos":
        return s.tencentChaosPerDivine > 0
          ? 1 / s.tencentChaosPerDivine
          : undefined;
      case "mirror":
        return s.tencentDivinePerMirror > 0
          ? s.tencentDivinePerMirror
          : undefined;
    }
    return undefined;
  };
}

export type PriceInBase =
  | { ok: true; value: number }
  // No rate for this currency (the price's or the base's).
  | { ok: false; missing: string };

export function priceInBase(
  price: Price,
  base: string,
  rates: DivineRates,
): PriceInBase {
  if (price.currency === base) return { ok: true, value: price.amount };
  const unit = rates(price.currency);
  if (!(unit && unit > 0)) return { ok: false, missing: price.currency };
  const baseUnit = rates(base);
  if (!(baseUnit && baseUnit > 0)) return { ok: false, missing: base };
  return { ok: true, value: (price.amount * unit) / baseUnit };
}

// Below this price (in Divine Orbs) the gains are not divided by it: a
// 1 Regal Orb item would show gains thousands of times over (V10 #21).
export const MIN_PRICE_DIVINES = 0.05;

export interface SlotGains {
  // false when the build has no DPS.
  hasDps: boolean;
  // DPS % and effective life gained; null when there is no gain (≤ 0 after
  // the same rounding as the summary: 0.1 % DPS, 1 effective life).
  dpsPercent: number | null;
  ehp: number | null;
}

export function slotGains(slot: EvalSlot): SlotGains {
  const percent = slot.dps.percent;
  const ehp = slot.delta.TotalEHP ?? 0;
  return {
    hasDps: percent !== null,
    dpsPercent:
      percent !== null && Math.round(percent * 10) > 0 ? percent : null,
    ehp: Math.round(ehp) > 0 ? ehp : null,
  };
}

export function hasGain(gains: SlotGains): boolean {
  return gains.dpsPercent !== null || gains.ehp !== null;
}

export interface SlotValue extends SlotGains {
  // Price below MIN_PRICE_DIVINES: the gains as they are, not per currency.
  cheap: boolean;
}

// Gains per 1 base currency (priceBase: the price in it), or as they are
// when the price is very low.
export function slotValue(
  slot: EvalSlot,
  priceBase: number,
  cheap = false,
): SlotValue | null {
  if (!(priceBase > 0)) return null;
  const gains = slotGains(slot);
  const per = (v: number | null) =>
    v === null ? null : cheap ? v : v / priceBase;
  return {
    hasDps: gains.hasDps,
    dpsPercent: per(gains.dpsPercent),
    ehp: per(gains.ehp),
    cheap,
  };
}

// Fewer decimals for larger numbers: 123 / 12.3 / 1.23 / 0.012.
export function compact(value: number): string {
  const abs = Math.abs(value);
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : abs >= 0.1 ? 2 : 3;
  const text = value.toFixed(digits);
  return Number(text) > 0 ? `+${text}` : Number(text) === 0 ? "0" : text;
}

// A gain of the value line and the comparison list; null is no gain.
export function gainText(value: number | null, unit = ""): string {
  if (value === null) return "无提升";
  const text = compact(value);
  // Positive but too small for three decimals.
  return (text === "0" ? "<+0.001" : text) + unit;
}

// Amount typed in the header: "", "12", "0.5", "1/2"; null when not a price.
export function parseAmount(text: string): number | null {
  const t = text.trim();
  if (!t) return null;
  const frac = /^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/.exec(t);
  const n = frac ? Number(frac[1]) / Number(frac[2]) : Number(t);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// One evaluated item in the overlay's comparison list.
export interface Entry {
  // The copied item text: the same item evaluated again reuses its entry.
  key: string;
  // Server the item was evaluated for: prices and rates differ.
  realm: string;
  result: EvalResult;
  // Selected slot tab.
  slot: string | null;
  // From the market copy's price note; otherwise typed in the header.
  fromNote: boolean;
  amountText: string;
  currency: string;
}

export function entrySlot(entry: Entry): EvalSlot | undefined {
  return (
    entry.result.slots.find((s) => s.slot === entry.slot) ??
    entry.result.slots[0]
  );
}

export function entryPrice(entry: Entry): Price | null {
  const amount = parseAmount(entry.amountText);
  return amount === null ? null : { amount, currency: entry.currency };
}

// International items need a price note (market copy) for a value; on
// Tencent the market copy has none, so the price is typed in (V10 #19).
export function takesTypedPrice(entry: Entry): boolean {
  return !entry.fromNote && entry.realm === "pc-tencent";
}

export function showsValue(entry: Entry): boolean {
  return entry.fromNote || takesTypedPrice(entry);
}

export interface EntryValue {
  price: Price | null;
  inBase: PriceInBase | null;
  value: SlotValue | null;
  // Neither DPS nor effective life goes up: shown as "无提升", listed last.
  noGain: boolean;
}

export function entryValue(
  entry: Entry,
  base: string,
  rates: DivineRates,
): EntryValue {
  const price = entryPrice(entry);
  const inBase = price && priceInBase(price, base, rates);
  const slot = entrySlot(entry);
  const divines = price && priceInBase(price, "divine", rates);
  const cheap = !!divines && divines.ok && divines.value < MIN_PRICE_DIVINES;
  const value =
    inBase && inBase.ok && slot ? slotValue(slot, inBase.value, cheap) : null;
  return { price, inBase, value, noGain: !slot || !hasGain(slotGains(slot)) };
}

// Comparison list order: values per currency (best first), then very cheap
// items with their plain gains, then items without a price, then no gain.
export function valueOrder(a: EntryValue, b: EntryValue): number {
  const group = (v: EntryValue) =>
    v.noGain ? 3 : !v.value ? 2 : v.value.cheap ? 1 : 0;
  // Larger first; no gain (null) after any gain.
  const desc = (k: "dpsPercent" | "ehp") => {
    const x = a.value?.[k] ?? null;
    const y = b.value?.[k] ?? null;
    return x === y ? 0 : y === null ? -1 : x === null ? 1 : y - x;
  };
  return group(a) - group(b) || desc("dpsPercent") || desc("ehp");
}

export function amountText(amount: number): string {
  return String(Math.round(amount * 100) / 100);
}
