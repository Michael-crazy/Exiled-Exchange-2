import { describe, expect, it } from "vitest";
import { applyPobSettings } from "@/web/pob-settings";

function config() {
  return {
    overlayKey: "Shift + Space",
    realm: "pc-ggg",
    language: "en",
    followGame: true,
    fontSize: 16,
    hideOverlayOnBlur: false,
    widgets: [
      { wmType: "price-check", hotkey: "D", hotkeyHold: "Ctrl" },
      {
        wmType: "assistant-eval",
        hotkey: "Ctrl + Shift + D" as string | null,
        valueCurrency: "divine",
        tencentExaltedPerDivine: 0,
        tencentChaosPerDivine: 0,
        webPreview: true,
        webPreviewPort: 37428,
      },
    ],
  };
}

describe("settings from Path of Building", () => {
  it("applies top-level and widget entries", () => {
    const cfg = config();
    const rejected = applyPobSettings(cfg, {
      "overlayKey": "Ctrl + Alt + Space",
      "realm": "pc-tencent",
      "followGame": false,
      "fontSize": 20,
      "hideOverlayOnBlur": true,
      "widget:price-check.hotkey": "Q",
      "widget:price-check.hotkeyHold": "Alt",
      "widget:assistant-eval.hotkey": null,
    });
    expect(rejected).toEqual({});
    expect(cfg).toMatchObject({
      overlayKey: "Ctrl + Alt + Space",
      realm: "pc-tencent",
      followGame: false,
      fontSize: 20,
      hideOverlayOnBlur: true,
      widgets: [{ hotkey: "Q", hotkeyHold: "Alt" }, { hotkey: null }],
    });
  });

  it("rejects unknown keys and wrong values, applying the rest", () => {
    const cfg = config();
    const rejected = applyPobSettings(cfg, {
      "notASetting": true,
      "widget:no-widget.hotkey": "A",
      "realm": "pc-moon",
      "followGame": "yes",
      "fontSize": 200,
      "overlayKey": null,
      "widget:price-check.hotkey": "Ctrl + Q",
      "widget:price-check.hotkeyHold": "Shift",
      "widget:assistant-eval.hotkey": "Ctrl + F12",
      "language": "cmn-Hant",
    });
    expect(Object.keys(rejected).sort()).toEqual(
      [
        "fontSize",
        "followGame",
        "notASetting",
        "overlayKey",
        "realm",
        "widget:assistant-eval.hotkey",
        "widget:no-widget.hotkey",
        "widget:price-check.hotkey",
        "widget:price-check.hotkeyHold",
      ].sort(),
    );
    expect(cfg).toEqual({ ...config(), language: "cmn-Hant" });
  });

  it("accepts hotkeys and switches added later by name", () => {
    const cfg = {
      ...config(),
      assistantWatchClipboard: false,
      widgets: [{ wmType: "assistant-eval", clipboardHotkey: null }],
    };
    expect(
      applyPobSettings(cfg, {
        "assistantWatchClipboard": true,
        "widget:assistant-eval.clipboardHotkey": "Ctrl + Shift + V",
      }),
    ).toEqual({});
    expect(cfg.assistantWatchClipboard).toBe(true);
    expect(cfg.widgets[0].clipboardHotkey).toBe("Ctrl + Shift + V");
    expect(
      applyPobSettings(cfg, {
        "widget:assistant-eval.clipboardHotkey": "Ctrl + Nope",
      }),
    ).toEqual({ "widget:assistant-eval.clipboardHotkey": "invalid value" });
  });

  it("checks the value-for-money settings (M08b)", () => {
    const cfg = config();
    const rejected = applyPobSettings(cfg, {
      "widget:assistant-eval.valueCurrency": "exalted",
      "widget:assistant-eval.tencentExaltedPerDivine": 420.5,
      "widget:assistant-eval.tencentChaosPerDivine": -3,
    });
    expect(rejected).toEqual({
      "widget:assistant-eval.tencentChaosPerDivine": "invalid value",
    });
    expect(cfg.widgets[1]).toMatchObject({
      valueCurrency: "exalted",
      tencentExaltedPerDivine: 420.5,
      tencentChaosPerDivine: 0,
    });
    expect(
      applyPobSettings(cfg, { "widget:assistant-eval.valueCurrency": "apple" }),
    ).toEqual({ "widget:assistant-eval.valueCurrency": "invalid value" });
  });
  it("checks the web preview settings (M09a)", () => {
    const cfg = config();
    const rejected = applyPobSettings(cfg, {
      "widget:assistant-eval.webPreview": false,
      "widget:assistant-eval.webPreviewPort": 40000,
    });
    expect(rejected).toEqual({});
    expect(cfg.widgets[1]).toMatchObject({
      webPreview: false,
      webPreviewPort: 40000,
    });
    expect(
      applyPobSettings(cfg, {
        "widget:assistant-eval.webPreview": "yes",
        "widget:assistant-eval.webPreviewPort": 80,
      }),
    ).toEqual({
      "widget:assistant-eval.webPreview": "invalid value",
      "widget:assistant-eval.webPreviewPort": "invalid value",
    });
    expect(cfg.widgets[1].webPreviewPort).toBe(40000);
  });
});
