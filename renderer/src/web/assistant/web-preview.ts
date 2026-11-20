// PoE2 assistant M09a: settings and exchange rates for the trade-site browser
// extension. The overlay sends them to the backend (method "web-preview",
// PoE2-Build-Assistant sources/web-preview.md), which then listens on
// 127.0.0.1:<port> for the extension and counts value for money the same way
// as the overlay (price-value.ts).

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
}

export function isWebPreviewPort(v: unknown): boolean {
  return Number.isInteger(v) && (v as number) >= 1024 && (v as number) <= 65535;
}

export function webPreviewParams(
  settings: WebPreviewSettings,
  rates: DivineRates | null,
): WebPreviewParams {
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
  return {
    enabled: settings.webPreview,
    port: isWebPreviewPort(settings.webPreviewPort)
      ? settings.webPreviewPort
      : DEFAULT_WEB_PREVIEW_PORT,
    value_currency: BASE_CURRENCIES.includes(settings.valueCurrency)
      ? settings.valueCurrency
      : DEFAULT_BASE,
    rates_source: rates ? "poe.ninja" : null,
    currencies,
  };
}
