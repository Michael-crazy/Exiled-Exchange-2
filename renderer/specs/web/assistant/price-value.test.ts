import { describe, expect, it } from "vitest";
import {
  type Entry,
  compact,
  entryValue,
  gainText,
  parseAmount,
  priceInBase,
  showsValue,
  takesTypedPrice,
  tencentRates,
  TRADE_CURRENCIES,
  valueOrder,
} from "@/web/assistant/price-value";
import {
  type EvalResult,
  type EvalSlot,
  priceText,
} from "@/web/assistant/eval-result";

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
    ).toEqual({ hasDps: true, dpsPercent: 20, ehp: 1000, cheap: false });
    // the other slot tab
    expect(
      entryValue(entry("2", "divine", "Ring 2"), "divine", tencent).value,
    ).toEqual({ hasDps: true, dpsPercent: 2, ehp: 100, cheap: false });
    // no price yet / no rate
    expect(entryValue(entry("", "divine"), "divine", tencent)).toMatchObject({
      price: null,
      value: null,
    });
    expect(entryValue(entry("9", "chaos"), "divine", tencent).value).toBeNull();
  });

  // V10 #21: no gain, very cheap items, comparison order.
  function priced(
    amountText: string,
    currency: string,
    dpsPercent: number | null,
    ehp: number,
  ): Entry {
    return {
      ...entry(amountText, currency),
      result: {
        slots: [slot("Ring 1", dpsPercent, ehp)],
        default_slot: "Ring 1",
      } as unknown as EvalResult,
    };
  }
  const ninja = (id: string) =>
    ({ divine: 1, exalted: 0.004, regal: 0.0005, transmute: 0.00002 })[id];

  it("shows no gain instead of negative values per currency", () => {
    // DPS -0.008% rounds to 0.0 %, effective life drops: nothing gained.
    const v = entryValue(priced("3", "divine", -0.008, -20), "divine", ninja);
    expect(v.noGain).toBe(true);
    expect(v.value).toMatchObject({ dpsPercent: null, ehp: null });
    // One of the two still counts.
    const ehpOnly = entryValue(priced("2", "divine", -1, 300), "divine", ninja);
    expect(ehpOnly.noGain).toBe(false);
    expect(ehpOnly.value).toMatchObject({ dpsPercent: null, ehp: 150 });
    expect(gainText(null)).toBe("无提升");
    expect(gainText(0.0001, "%")).toBe("<+0.001%");
  });

  it("does not divide by a price below 0.05 Divine Orbs", () => {
    // 1 Regal Orb = 0.0005 divine: the gains as they are.
    const v = entryValue(priced("1", "regal", 2.42, 300), "divine", ninja);
    expect(v.value).toEqual({
      hasDps: true,
      dpsPercent: 2.42,
      ehp: 300,
      cheap: true,
    });
    // The limit is in Divine Orbs whatever the base currency.
    expect(
      entryValue(priced("10", "exalted", 2, 300), "exalted", ninja).value,
    ).toMatchObject({ cheap: true, dpsPercent: 2 });
    expect(
      entryValue(priced("13", "exalted", 2, 300), "exalted", ninja).value,
    ).toMatchObject({ cheap: false });
    // Unknown rate: cannot tell, no value.
    expect(
      entryValue(priced("1", "annul", 2, 300), "divine", ninja).value,
    ).toBeNull();
  });

  it("orders the comparison list: value, very cheap, no price, no gain", () => {
    const values = {
      none: entryValue(priced("1", "divine", -1, -5), "divine", ninja),
      cheap: entryValue(priced("1", "transmute", 9, 900), "divine", ninja),
      noPrice: entryValue(priced("", "divine", 3, 100), "divine", ninja),
      low: entryValue(priced("2", "divine", 2, 100), "divine", ninja),
      high: entryValue(priced("1", "divine", 2, 100), "divine", ninja),
      ehpOnly: entryValue(priced("1", "divine", 0, 900), "divine", ninja),
    };
    const order = Object.entries(values)
      .sort(([, a], [, b]) => valueOrder(a, b))
      .map(([name]) => name);
    expect(order).toEqual([
      "high",
      "low",
      "ehpOnly",
      "cheap",
      "noPrice",
      "none",
    ]);
  });

  it("asks for a price only on Tencent (V10 #19)", () => {
    const intl = { ...entry("", "divine"), realm: "pc-ggg" };
    expect(takesTypedPrice(intl)).toBe(false);
    expect(showsValue(intl)).toBe(false);
    expect(showsValue({ ...intl, fromNote: true, amountText: "1" })).toBe(true);
    expect(takesTypedPrice(entry("", "divine"))).toBe(true);
    expect(takesTypedPrice({ ...entry("1", "divine"), fromNote: true })).toBe(
      false,
    );
  });

  it("names the note's currency in Simplified Chinese (V10 #22)", () => {
    expect(
      priceText({
        kind: "buyout",
        amount: 1,
        currency: "mirror",
        currency_name: "卡蘭德的魔鏡",
      }),
    ).toBe("一口价 1 卡兰德的魔镜");
    expect(
      priceText({
        kind: "price",
        amount: 2,
        currency: "unknown-thing",
        currency_name: null,
      }),
    ).toBe("标价 2 unknown-thing");
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
