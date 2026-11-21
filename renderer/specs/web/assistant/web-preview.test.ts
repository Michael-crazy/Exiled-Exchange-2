import { describe, expect, it } from "vitest";
import {
  DEFAULT_WEB_PREVIEW_PORT,
  isWebPreviewPort,
  webPreviewParams,
} from "@/web/assistant/web-preview";
import { tencentRates } from "@/web/assistant/price-value";

const settings = {
  webPreview: true,
  webPreviewPort: 40000,
  valueCurrency: "exalted",
};

describe("web preview settings for the backend (M09a)", () => {
  it("sends names and poe.ninja values in Divine Orbs", () => {
    const rates = (id: string) =>
      id === "divine" ? 1 : id === "exalted" ? 0.002 : undefined;
    const params = webPreviewParams(settings, rates);
    expect(params).toMatchObject({
      enabled: true,
      port: 40000,
      value_currency: "exalted",
      rates_source: "poe.ninja",
    });
    expect(params.currencies.exalted).toEqual({
      name: "崇高石",
      en: "Exalted Orb",
      divines: 0.002,
    });
    expect(params.currencies.chaos).toEqual({
      name: "混沌石",
      en: "Chaos Orb",
    });
    expect(params.currencies.sep).toBeUndefined();
  });

  it("marks rates as loading and falls back to defaults", () => {
    const params = webPreviewParams(
      { webPreview: false, webPreviewPort: 80, valueCurrency: "apple" },
      null,
    );
    expect(params).toMatchObject({
      enabled: false,
      port: DEFAULT_WEB_PREVIEW_PORT,
      value_currency: "divine",
      rates_source: null,
    });
    expect(params.currencies.divine.divines).toBeUndefined();
  });

  it("sends the typed Tencent rates for the trade window (M09b)", () => {
    const tencent = tencentRates({
      tencentExaltedPerDivine: 400,
      tencentChaosPerDivine: 0,
      tencentDivinePerMirror: 300,
    });
    const params = webPreviewParams(settings, null, tencent);
    expect(params.tencent_currencies.exalted.divines).toBeCloseTo(1 / 400);
    expect(params.tencent_currencies.mirror.divines).toBe(300);
    expect(params.tencent_currencies.chaos.divines).toBeUndefined();
    expect(params.currencies.exalted.divines).toBeUndefined();
  });

  it("accepts ports 1024-65535 only", () => {
    expect(isWebPreviewPort(37428)).toBe(true);
    for (const v of [80, 65536, 1.5, "37428", null]) {
      expect(isWebPreviewPort(v)).toBe(false);
    }
  });
});
