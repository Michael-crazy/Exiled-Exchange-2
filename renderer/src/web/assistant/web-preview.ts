// PoE2 assistant M09a: settings and exchange rates for the trade-site browser
// extension. The overlay sends them to the backend (method "web-preview",
// PoE2-Build-Assistant sources/web-preview.md), which then listens on
// 127.0.0.1:<port> for the extension and counts value for money the same way
// as the overlay (price-value.ts).
// M09b: the assistant's own trade window uses the same rates over stdio, on
// both servers, so they are sent even while the extension endpoint is off.

import {
  BASE_CURRENCIES,
  DEFAULT_BASE,
  TRADE_CURRENCIES,
  type DivineRates,
} from "./price-value";

export const DEFAULT_WEB_PREVIEW_PORT = 37428;
// Sent again this often, so a restarted backend listens again and the rates
// follow poe.ninja's refreshes.
export const WEB_PREVIEW_RESEND_MS = 120_000;

export interface WebPreviewSettings {
  webPreview: boolean;
  webPreviewPort: number;
  valueCurrency: string;
}

export interface WebPreviewParams {
  enabled: boolean;
  port: number;
  value_currency: string;
  // null while poe.ninja's prices are still loading.
  rates_source: "poe.ninja" | null;
  // Trade id -> Simplified Chinese and English name, value in Divine Orbs.
  currencies: Record<string, { name: string; en: string; divines?: number }>;
  // The same from the rates typed for the Tencent server (M08b).
  tencent_currencies: Record<
    string,
    { name: string; en: string; divines?: number }
  >;
}

export function isWebPreviewPort(v: unknown): boolean {
  return Number.isInteger(v) && (v as number) >= 1024 && (v as number) <= 65535;
}

function currencyTable(rates: DivineRates | null) {
  const currencies: WebPreviewParams["currencies"] = {};
  for (const c of TRADE_CURRENCIES) {
    if (c.id === "sep") continue;
    const divines = rates?.(c.id);
    currencies[c.id] = {
      name: c.zh,
      en: c.en,
      ...(divines && divines > 0 ? { divines } : {}),
    };
  }
  return currencies;
}

export function webPreviewParams(
  settings: WebPreviewSettings,
  rates: DivineRates | null,
  tencent: DivineRates | null = null,
): WebPreviewParams {
  return {
    enabled: settings.webPreview,
    port: isWebPreviewPort(settings.webPreviewPort)
      ? settings.webPreviewPort
      : DEFAULT_WEB_PREVIEW_PORT,
    value_currency: BASE_CURRENCIES.includes(settings.valueCurrency)
      ? settings.valueCurrency
      : DEFAULT_BASE,
    rates_source: rates ? "poe.ninja" : null,
    currencies: currencyTable(rates),
    tencent_currencies: currencyTable(tencent),
  };
}
