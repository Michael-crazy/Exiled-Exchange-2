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

export interface SlotValue {
  // DPS % gained per 1 base currency; null when the build has no DPS.
  dpsPercent: number | null;
  // Effective life gained per 1 base currency.
  ehp: number;
}

export function slotValue(slot: EvalSlot, priceBase: number): SlotValue | null {
  if (!(priceBase > 0)) return null;
  return {
    dpsPercent: slot.dps.percent === null ? null : slot.dps.percent / priceBase,
    ehp: (slot.delta.TotalEHP ?? 0) / priceBase,
  };
}

// Fewer decimals for larger numbers: 123 / 12.3 / 1.23 / 0.012.
export function compact(value: number): string {
  const abs = Math.abs(value);
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : abs >= 0.1 ? 2 : 3;
  const text = value.toFixed(digits);
  return Number(text) > 0 ? `+${text}` : Number(text) === 0 ? "0" : text;
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

export interface EntryValue {
  price: Price | null;
  inBase: PriceInBase | null;
  value: SlotValue | null;
}

export function entryValue(
  entry: Entry,
  base: string,
  rates: DivineRates,
): EntryValue {
  const price = entryPrice(entry);
  const inBase = price && priceInBase(price, base, rates);
  const slot = entrySlot(entry);
  const value =
    inBase && inBase.ok && slot ? slotValue(slot, inBase.value) : null;
  return { price, inBase, value };
}

export function amountText(amount: number): string {
  return String(Math.round(amount * 100) / 100);
}
