import { describe, expect, it, vi } from "vitest";
import { Host } from "@/web/background/IPC";

// The shared setup mocks the config module; this test needs the real one.
vi.unmock("@/web/Config");
// The widget registry pulls in Vue components; the version-36 config below
// already has every widget, so the upgrade does not need the defaults.
vi.mock("@/web/overlay/widget-registry.js", () => ({
  registry: { widgets: [] },
}));

function version36() {
  return {
    configVersion: 36,
    overlayKey: "Shift + Space",
    fontSize: 16,
    language: "cmn-Hant",
    widgets: [
      { wmId: 1, wmType: "menu", wmWants: "hide", wmZorder: 1 },
      {
        wmId: 2,
        wmType: "settings",
        wmWants: "hide",
        wmZorder: "exclusive",
      },
      {
        wmId: 3,
        wmType: "price-check",
        wmWants: "hide",
        wmZorder: "exclusive",
        hotkey: "D",
        hotkeyHold: "Ctrl",
        rememberCurrency: false,
      },
      {
        wmId: 9,
        wmType: "assistant-eval",
        wmWants: "hide",
        wmZorder: "exclusive",
        hotkey: "Alt + R",
      },
    ],
  };
}

describe("config upgrade", () => {
  it("writes an upgraded version-36 config back to the host", async () => {
    vi.mocked(Host.getConfig).mockResolvedValueOnce(
      JSON.stringify(version36()),
    );
    vi.mocked(Host.sendEvent).mockClear();

    const { initConfig, saveUpgradedConfig, defaultConfig } =
      await vi.importActual<typeof import("@/web/Config")>("@/web/Config");
    // updateConfig sets the root font size; stub after Vue is imported.
    vi.stubGlobal("document", { documentElement: { style: {} } });
    await initConfig();
    // Nothing is sent before the host connection is open (Host.init).
    expect(Host.sendEvent).not.toHaveBeenCalled();
    saveUpgradedConfig();
    saveUpgradedConfig(); // only once

    const saves = vi
      .mocked(Host.sendEvent)
      .mock.calls.map(([e]) => e)
      .filter((e) => e.name === "CLIENT->MAIN::save-config");
    expect(saves).toHaveLength(1);
    const payload = saves[0].payload as {
      contents: string;
      isTemporary: boolean;
    };
    expect(payload.isTemporary).toBe(false);
    const saved = JSON.parse(payload.contents);
    expect(saved.configVersion).toBe(defaultConfig().configVersion);
    expect(
      saved.widgets.find(
        (w: { wmType: string }) => w.wmType === "assistant-eval",
      ),
    ).toMatchObject({
      hotkey: "Alt + R",
      clipboardHotkey: "Ctrl + Shift + V",
      watchClipboard: true,
      addToPobHotkey: "Ctrl + Shift + A",
      valueCurrency: "divine",
      tencentExaltedPerDivine: 0,
      tencentChaosPerDivine: 0,
      tencentDivinePerMirror: 0,
      webPreview: true,
      webPreviewPort: 37428,
    });
    vi.unstubAllGlobals();
  });
});
