import { Host } from "@/web/background/IPC";
import { RateLimiter } from "./RateLimiter";
import {
  RATE_LIMIT_RULES,
  adjustRateLimits,
  type TradeResponse,
} from "./common";
import { tradeLeaguePath, withTencentLogin } from "./tencent";

// Currency rates on the Tencent trade site, for M08b (which uses rates the
// user typed in until this is wired up; those stay the fallback).
//
// The Tencent PoE2 site has no currency exchange (`/api/trade2/exchange`
// answers 404, the exchange page redirects to item search), so rates come
// from the item search: listings of one unit of `base` (default Divine Orb)
// priced in the currency, cheapest first. A currency's value is 1 / median
// price over the first single-unit listings, in `base` per unit. Listings
// of stacks are skipped: their price may be for the stack or for one unit.
// Two requests per currency (search + fetch), under the trade rate limits.
// Only currencies cheaper than `base` can be priced this way.

export interface TencentRate {
  currency: string;
  // How many `base` one unit of `currency` is worth.
  value: number;
  // Listings the median was taken from.
  offers: number;
}

const LISTINGS_USED = 10;

let names: Record<string, string> | null = null;

// Simplified Chinese item names of currencies by trade id (the search wants
// the name), from PoE2-Build-Assistant `data/trade/currency.json`.
async function currencyName(id: string) {
  names ??= (await (
    await fetch(`${import.meta.env.BASE_URL}data/cmn-Hans/trade-currency.json`)
  ).json()) as Record<string, string>;
  const name = names[id];
  if (!name) throw new Error(`未知通货：${id}`);
  return name;
}

async function api<T>(
  limits: Set<RateLimiter>,
  url: string,
  init?: RequestInit,
): Promise<T> {
  const response = await withTencentLogin(async () => {
    await RateLimiter.waitMulti(limits);
    const res = await Host.proxy(`poe.game.qq.com/api/trade2/${url}`, init);
    adjustRateLimits(limits, res.headers);
    return res;
  });
  const data = (await response.json()) as TradeResponse<T>;
  if (data.error) throw new Error(data.error.message);
  return data;
}

async function unitPrices(
  leagueId: string,
  baseName: string,
  currency: string,
) {
  const search = await api<{ id: string; result: string[] }>(
    RATE_LIMIT_RULES.SEARCH,
    `search/${tradeLeaguePath(leagueId)}`,
    {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: {
          status: { option: "online" },
          type: baseName,
          filters: {
            trade_filters: { filters: { price: { option: currency } } },
          },
        },
        sort: { price: "asc" },
      }),
    },
  );
  if (!search.result.length) return [];
  const fetched = await api<{
    result: Array<{
      listing: { price?: { amount: number; currency: string } };
      item: { stackSize?: number };
    } | null>;
  }>(
    RATE_LIMIT_RULES.FETCH,
    `fetch/${search.result.slice(0, LISTINGS_USED).join(",")}?query=${search.id}&realm=poe2`,
  );
  return fetched.result
    .filter((r) => r != null)
    .filter(
      (r) =>
        (r.item.stackSize ?? 1) === 1 &&
        r.listing.price?.currency === currency &&
        r.listing.price.amount > 0,
    )
    .map((r) => r.listing.price!.amount);
}

function median(values: number[]) {
  const sorted = values.toSorted((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Currency ids are the trade ids shared by both sites, e.g. "exalted",
// "chaos". A currency without single-unit listings right now is left out.
export async function fetchTencentRates(
  leagueId: string,
  currencies: string[],
  base = "divine",
): Promise<TencentRate[]> {
  const baseName = await currencyName(base);
  const rates: TencentRate[] = [];
  for (const currency of currencies) {
    if (currency === base) {
      rates.push({ currency, value: 1, offers: 0 });
      continue;
    }
    const prices = await unitPrices(leagueId, baseName, currency);
    if (prices.length) {
      rates.push({
        currency,
        value: 1 / median(prices),
        offers: prices.length,
      });
    }
  }
  return rates;
}
