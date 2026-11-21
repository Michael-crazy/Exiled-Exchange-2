import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import { describe, expect, test } from "vitest";
import {
  TRADE_SITES,
  browserUserAgent,
  isTradePage,
  previewRequest,
  previewValue,
  staysInWindow,
  tradeRealm,
} from "../../../../main/src/trade-window-rules";
import {
  nextCheckDelayMs,
  refreshOutcome,
  sessionState,
} from "../../../../main/src/tencent-session";

const ggg = TRADE_SITES["pc-ggg"];
const tencent = TRADE_SITES["pc-tencent"];

// M09b: the assistant's own trade window.
describe("trade window rules", () => {
  test("opens the site of the current server", () => {
    expect(tradeRealm("pc-tencent")).toBe("pc-tencent");
    for (const realm of ["pc-ggg", "pc-garena", undefined, null]) {
      expect(tradeRealm(realm)).toBe("pc-ggg");
    }
    expect(ggg.url).toBe("https://www.pathofexile.com/trade2");
    expect(ggg.partition).toBe("persist:trade-ggg");
    expect(tencent.url).toBe("https://poe.game.qq.com/trade2");
    // Tencent shares the default session with the price check's login.
    expect(tencent.partition).toBeNull();
  });

  test("the page script runs on trade2 pages of the window's site only", () => {
    expect(
      isTradePage("https://www.pathofexile.com/trade2/search/poe2/x/abc", ggg),
    ).toBe(true);
    expect(isTradePage("https://poe.game.qq.com/trade2", tencent)).toBe(true);
    expect(isTradePage("https://poe.game.qq.com/login", tencent)).toBe(false);
    expect(isTradePage("https://poe.game.qq.com/trade2x", tencent)).toBe(false);
    expect(isTradePage("https://poe.game.qq.com/trade2", ggg)).toBe(false);
    expect(isTradePage("http://www.pathofexile.com/trade2", ggg)).toBe(false);
    expect(
      isTradePage("https://www.pathofexile.com.evil.com/trade2", ggg),
    ).toBe(false);
  });

  test("sign-in pages stay in the window, other links go to the browser", () => {
    expect(
      staysInWindow("https://xui.ptlogin2.qq.com/cgi-bin/xlogin", tencent),
    ).toBe(true);
    expect(staysInWindow("https://www.pathofexile.com/login", ggg)).toBe(true);
    expect(
      staysInWindow("https://challenges.cloudflare.com/turnstile", ggg),
    ).toBe(true);
    expect(staysInWindow("https://poe.ninja/poe2", ggg)).toBe(false);
    expect(staysInWindow("https://qq.com.evil.com/", tencent)).toBe(false);
    expect(staysInWindow("javascript:alert(1)", ggg)).toBe(false);
  });

  test("evaluation requests: language follows the site", () => {
    const message = {
      type: "poe2-assistant-evaluate",
      item_text: "Item Class: 鞋子",
      price: { amount: 1, currency: "divine" },
      language: "en",
    };
    expect(previewRequest(message, tencent)).toEqual({
      item_text: "Item Class: 鞋子",
      price: { amount: 1, currency: "divine" },
      language: "zh_hans",
      realm: "pc-tencent",
    });
    expect(previewRequest({ item_text: "x" }, ggg)).toMatchObject({
      price: null,
      language: "en",
      realm: "pc-ggg",
    });
    for (const bad of [
      null,
      "text",
      { item_text: "" },
      { item_text: 5 },
      { item_text: "x".repeat(20_001) },
      { item_text: "x", price: "1 divine" },
    ]) {
      expect(previewRequest(bad, ggg)).toBeNull();
    }
  });

  test("user agent looks like plain Chrome", () => {
    expect(
      browserUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) exiled-exchange-2/0.16.3 Chrome/144.0.0.0 Electron/40.10.2 Safari/537.36",
      ),
    ).toBe(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
    );
  });

  test("page script files are the extension's, unchanged", () => {
    const dir = path.resolve(__dirname, "../../../../main/trade-preview");
    const source = fs.readFileSync(path.join(dir, "SOURCE.md"), "utf-8");
    const rows = [...source.matchAll(/^\| (\S+) \| ([0-9a-f]{64}) \|$/gm)];
    expect(rows.map((m) => m[1])).toEqual([
      "content.js",
      "styles.css",
      "assistant/preview.js",
      "assistant/preview.css",
      "LICENSE",
    ]);
    for (const [, file, hash] of rows) {
      const data = fs.readFileSync(path.join(dir, file));
      expect(createHash("sha256").update(data).digest("hex"), file).toBe(hash);
    }
    // The shared script takes the window's transport.
    expect(
      fs.readFileSync(path.join(dir, "assistant/preview.js"), "utf-8"),
    ).toContain("poe2AssistantTransport");
  });
});

// Tencent login renewal: cookie names and expiry times only.
describe("Tencent session state", () => {
  const now = 1_800_000_000;
  const cookie = (name: string, expirationDate?: number) => ({
    name,
    domain: ".poe.game.qq.com",
    expirationDate,
  });

  test("token and server session from cookie names and expiry", () => {
    expect(
      sessionState(
        [cookie("POESESSID", now + 1e6), cookie("POETOKEN", now + 3600)],
        now,
      ),
    ).toEqual({ hasServerSession: true, tokenUntil: now + 3600 });
    // About to end, or on another host: not counted.
    expect(
      sessionState([cookie("POETOKEN", now + 30)], now).tokenUntil,
    ).toBeNull();
    expect(
      sessionState(
        [{ name: "POETOKEN", domain: ".qq.com", expirationDate: now + 3600 }],
        now,
      ),
    ).toEqual({ hasServerSession: false, tokenUntil: null });
  });

  test("background reload outcome", () => {
    const none = { hasServerSession: true, tokenUntil: null };
    const old = { hasServerSession: true, tokenUntil: now + 100 };
    const fresh = { hasServerSession: true, tokenUntil: now + 86400 };
    const page = "https://poe.game.qq.com/trade2";
    expect(refreshOutcome(none, fresh, page, false)).toBe("renewed");
    expect(refreshOutcome(old, fresh, page, false)).toBe("renewed");
    expect(refreshOutcome(old, old, page, false)).toBeNull();
    expect(refreshOutcome(old, old, page, true)).toBe("unchanged");
    expect(
      refreshOutcome(
        none,
        none,
        "https://poe.game.qq.com/login?redir=%2Ftrade2",
        false,
      ),
    ).toBe("login-required");
    // The OAuth round trip is not the login page.
    expect(
      refreshOutcome(
        none,
        none,
        "https://poe.game.qq.com/oauth/authorize?x=1",
        false,
      ),
    ).toBeNull();
  });

  test("next background check one minute after the token ends", () => {
    expect(
      nextCheckDelayMs({ hasServerSession: true, tokenUntil: now + 3600 }, now),
    ).toBe(3660_000);
    expect(
      nextCheckDelayMs({ hasServerSession: true, tokenUntil: null }, now),
    ).toBeNull();
  });
});

// V10 #21: the trade window shows value for money with the overlay's rules.
describe("trade window value (same rules as the overlay)", () => {
  const reply = (
    dps: number | null,
    ehp: number,
    priceInBase: number,
    priceInDivine: number | null,
  ) => ({
    ok: true,
    slot: { dps_percent: dps, ehp },
    price: { amount: 1, currency: "divine" },
    value: {
      base: "divine",
      base_name: "神圣石",
      price_name: "崇高石",
      price_in_base: priceInBase,
      price_in_divine: priceInDivine,
      dps_percent: dps === null ? null : dps / priceInBase,
      ehp: ehp / priceInBase,
    },
  });
  const valueOf = (r: unknown) =>
    (r as { value: Record<string, unknown> }).value;

  test("two gains per currency stay numbers", () => {
    const v = valueOf(previewValue(reply(6, 300, 2, 2)));
    expect(v).toMatchObject({ price_in_base: 2, dps_percent: 3, ehp: 150 });
    expect(v.message).toBeUndefined();
  });

  test("no gain, as on the overlay", () => {
    const v = valueOf(previewValue(reply(-0.008, -12, 3, 3)));
    expect(v.message).toBe("每 1 神圣石：无提升");
    expect(v.price_in_base).toBeUndefined();
    // One of the two gained: the other says so.
    expect(valueOf(previewValue(reply(-1, 300, 2, 2))).message).toBe(
      "每 1 神圣石：DPS 无提升 · 有效生命 +150",
    );
  });

  test("below 0.05 Divine Orbs the gains are not divided", () => {
    // 1 Regal Orb counted in Exalted Orbs: 0.13 exalted, 0.0005 divine.
    expect(valueOf(previewValue(reply(2.42, 300, 0.13, 0.0005))).message).toBe(
      "价格极低（不足 0.05 神圣石），只看提升：DPS +2.42% · 有效生命 +300",
    );
    // No DPS in the build.
    expect(valueOf(previewValue(reply(null, 300, 0.01, 0.01))).message).toBe(
      "价格极低（不足 0.05 神圣石），只看提升：有效生命 +300",
    );
  });

  test("errors and replies without a price pass through", () => {
    const failed = { ok: false, code: "x", message: "y" };
    expect(previewValue(failed)).toBe(failed);
    const unknown = {
      ok: true,
      slot: { dps_percent: 1, ehp: 1 },
      value: { message: "不认识的通货：x" },
    };
    expect(previewValue(unknown)).toBe(unknown);
  });
});
