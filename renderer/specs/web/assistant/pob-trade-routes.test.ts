import { describe, expect, test } from "vitest";
import {
  isPobRequest,
  passedHeaders,
  pobTradeRoute,
} from "../../../../main/src/pob-trade-routes";

// M04: routes of the local bridge PoB's Trader uses for the Tencent site.
describe("pobTradeRoute", () => {
  const league = encodeURIComponent("奥杜尔秘符");

  test("search goes to the poe2 realm with PoB's league segment", () => {
    expect(pobTradeRoute("POST", `/pob-trade/search/${league}`)).toEqual({
      kind: "search",
      url: `https://poe.game.qq.com/api/trade2/search/poe2/${league}`,
    });
  });

  test("fetch keeps ids and query id and adds the realm", () => {
    expect(
      pobTradeRoute("GET", "/pob-trade/fetch/aa11,bb22?query=Q9x"),
    ).toEqual({
      kind: "fetch",
      url: "https://poe.game.qq.com/api/trade2/fetch/aa11,bb22?query=Q9x&realm=poe2",
    });
  });

  test("leagues and login", () => {
    expect(pobTradeRoute("GET", "/pob-trade/leagues")?.kind).toBe("leagues");
    expect(pobTradeRoute("POST", "/pob-trade/login")).toEqual({
      kind: "login",
    });
  });

  test("anything else is refused", () => {
    for (const [method, url] of [
      ["GET", `/pob-trade/search/${league}`],
      ["POST", "/pob-trade/search/a%2Fb"],
      ["POST", "/pob-trade/search/../x"],
      ["GET", "/pob-trade/fetch/aa11"],
      ["GET", "/pob-trade/fetch/a/b?query=q"],
      ["GET", `/pob-trade/fetch/${Array(11).fill("a").join(",")}?query=q`],
      ["GET", "/pob-trade/api/trade2/exchange"],
      ["GET", "/proxy/poe.game.qq.com/api"],
    ]) {
      expect(pobTradeRoute(method, url), `${method} ${url}`).toBeNull();
    }
  });
});

describe("isPobRequest", () => {
  test("needs the PoB header and no Origin", () => {
    expect(isPobRequest({ "x-pob-trade": "1" })).toBe(true);
    expect(isPobRequest({})).toBe(false);
    expect(
      isPobRequest({ "x-pob-trade": "1", "origin": "https://example.com" }),
    ).toBe(false);
  });
});

describe("passedHeaders", () => {
  test("only rate limit headers go back to PoB", () => {
    expect(
      passedHeaders({
        "X-Rate-Limit-Policy": "trade-search-request-limit",
        "x-rate-limit-account": "3:5:60",
        "retry-after": "5",
        "set-cookie": ["a=b"],
        "content-type": "application/json",
      }),
    ).toEqual({
      "x-rate-limit-policy": "trade-search-request-limit",
      "x-rate-limit-account": "3:5:60",
      "retry-after": "5",
    });
  });
});
