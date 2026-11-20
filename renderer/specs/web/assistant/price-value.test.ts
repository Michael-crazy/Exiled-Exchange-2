import { describe, expect, it } from "vitest";
import {
  type Entry,
  compact,
  entryValue,
  parseAmount,
  priceInBase,
  tencentRates,
  TRADE_CURRENCIES,
} from "@/web/assistant/price-value";
import type { EvalResult, EvalSlot } from "@/web/assistant/eval-result";

function slot(id: string, dpsPercent: number | null, ehp: number): EvalSlot {
  return {
    slot: id,
    label: id,
    replaced: null,
    displaced: [],
    metrics: {},
    delta: { TotalEHP: ehp },
    dps: { before: 100, after: 110, absolute: 10, percent: dpsPercent },
    resists: {} as EvalSlot["resists"],
    attribute_gaps: {} as EvalSlot["attribute_gaps"],
    summary: "",
  };
}

function entry(amountText: string, currency: string, slotId = "Ring 1"): Entry {
  return {
    key: "x",
    realm: "pc-tencent",
    result: {
      slots: [slot("Ring 1", 10, 500), slot("Ring 2", 4, 200)],
      default_slot: "Ring 1",
    } as unknown as EvalResult,
    slot: slotId,
    fromNote: false,
    amountText,
    currency,
  };
}

const tencent = tencentRates({
  tencentExaltedPerDivine: 400,
  tencentChaosPerDivine: 0,
  tencentDivinePerMirror: 1500,
});

describe("value for money (M08b)", () => {
  it("parses typed amounts", () => {
    expect(parseAmount("12")).toBe(12);
    expect(parseAmount(" 0.5 ")).toBe(0.5);
    expect(parseAmount("1/2")).toBe(0.5);
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("0")).toBeNull();
    expect(parseAmount("abc")).toBeNull();
  });

  it("converts with the Tencent rates typed in the settings", () => {
    expect(
      priceInBase({ amount: 200, currency: "exalted" }, "divine", tencent),
    ).toEqual({ ok: true, value: 0.5 });
    expect(
      priceInBase({ amount: 1, currency: "mirror" }, "exalted", tencent),
    ).toEqual({ ok: true, value: 600000 });
    expect(
      priceInBase({ amount: 3, currency: "divine" }, "divine", tencent),
    ).toEqual({ ok: true, value: 3 });
    // not filled in (0) or not offered on Tencent
    expect(
      priceInBase({ amount: 5, currency: "chaos" }, "divine", tencent),
    ).toEqual({ ok: false, missing: "chaos" });
    expect(
      priceInBase({ amount: 1, currency: "divine" }, "chaos", tencent),
    ).toEqual({ ok: false, missing: "chaos" });
    expect(
      priceInBase({ amount: 1, currency: "annul" }, "divine", tencent),
    ).toEqual({ ok: false, missing: "annul" });
  });

  it("divides the selected slot's gains by the price", () => {
    expect(
      entryValue(entry("200", "exalted"), "divine", tencent).value,
    ).toEqual({ dpsPercent: 20, ehp: 1000 });
    // the other slot tab
    expect(
      entryValue(entry("2", "divine", "Ring 2"), "divine", tencent).value,
    ).toEqual({ dpsPercent: 2, ehp: 100 });
    // no price yet / no rate
    expect(entryValue(entry("", "divine"), "divine", tencent)).toMatchObject({
      price: null,
      value: null,
    });
    expect(entryValue(entry("9", "chaos"), "divine", tencent).value).toBeNull();
  });

  it("formats with fewer decimals for larger numbers", () => {
    expect(compact(123.4)).toBe("+123");
    expect(compact(12.34)).toBe("+12.3");
    expect(compact(-1.234)).toBe("-1.23");
    expect(compact(0.0123)).toBe("+0.012");
    expect(compact(0)).toBe("0");
  });

  it("has the 38 trade currencies with Simplified Chinese names", () => {
    const real = TRADE_CURRENCIES.filter((c) => c.id !== "sep");
    expect(real).toHaveLength(38);
    expect(real.every((c) => c.zh && c.en)).toBe(true);
    expect(real.find((c) => c.id === "divine")?.zh).toBe("神圣石");
  });
});
