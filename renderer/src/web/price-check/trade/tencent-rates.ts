import { Host } from "@/web/background/IPC";
import { RateLimiter } from "./RateLimiter";
import {
  RATE_LIMIT_RULES,
  adjustRateLimits,
  type TradeResponse,
} from "./common";
import { tradeLeaguePath, withTencentLogin } from "./tencent";

// Currency rates on the Tencent trade site, from its currency exchange
// (`/api/trade2/exchange`, login required). For M08b, which uses rates the
// user typed in until this is wired up; those stay the fallback.
//
// For each currency one exchange search: offers that pay `base` for it.
// The rate is the median over the first offers (the cheapest), in `base`
// per 1 unit of the currency. Currency ids are the trade ids shared by both
// sites (`data/trade/currency.json`), e.g. "divine", "exalted", "chaos".

export interface TencentRate {
  currency: string;
  // How many `base` one unit of `currency` is worth.
  value: number;
  // Offers the median was taken from.
  offers: number;
}

const OFFERS_USED = 10;

interface ExchangeResult {
  result: Record<
    string,
    {
      listing: {
        offers: Array<{
          exchange: { currency: string; amount: number };
          item: { currency: string; amount: number; stock: number };
        }>;
      };
    }
  >;
}

async function exchange(leagueId: string, have: string, want: string) {
  const response = await withTencentLogin(async () => {
    await RateLimiter.waitMulti(RATE_LIMIT_RULES.EXCHANGE);
    const res = await Host.proxy(
      `poe.game.qq.com/api/trade2/exchange/${tradeLeaguePath(leagueId)}`,
      {
        method: "POST",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          engine: "new",
          query: { status: { option: "online" }, have: [have], want: [want] },
          sort: { have: "asc" },
        }),
      },
    );
    adjustRateLimits(RATE_LIMIT_RULES.EXCHANGE, res.headers);
    return res;
  });
  const data = (await response.json()) as TradeResponse<ExchangeResult>;
  if (data.error) throw new Error(data.error.message);
  return data;
}

function median(values: number[]) {
  const sorted = values.toSorted((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Requests run one after another under the exchange rate limit; a currency
// nobody is selling for `base` right now is left out of the result.
export async function fetchTencentRates(
  leagueId: string,
  currencies: string[],
  base = "divine",
): Promise<TencentRate[]> {
  const rates: TencentRate[] = [];
  for (const currency of currencies) {
    if (currency === base) {
      rates.push({ currency, value: 1, offers: 0 });
      continue;
    }
    const data = await exchange(leagueId, base, currency);
    const perUnit: number[] = [];
    for (const { listing } of Object.values(data.result)) {
      for (const offer of listing.offers) {
        if (offer.exchange.currency === base && offer.item.amount > 0) {
          perUnit.push(offer.exchange.amount / offer.item.amount);
        }
      }
      if (perUnit.length >= OFFERS_USED) break;
    }
    if (perUnit.length) {
      rates.push({ currency, value: median(perUnit), offers: perUnit.length });
    }
  }
  return rates;
}
