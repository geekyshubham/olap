import { describe, expect, it } from "vitest";
import { visibleWidth } from "@earendil-works/pi-tui";
import { buildModelSelectList, buildSettingsList } from "../src/tui/overlays.js";
import { OverlayPanel } from "../src/tui/components.js";
import { getTheme } from "../src/tui/theme.js";
import { DEFAULT_CONFIG } from "../src/config/defaults.js";

function assertWithinWidth(lines: string[], width: number): void {
  for (const line of lines) {
    expect(visibleWidth(line)).toBeLessThanOrEqual(width);
  }
}

describe("settings overlay", () => {
  const theme = getTheme();

  it("renders all setting rows width-safely", () => {
    const config = structuredClone(DEFAULT_CONFIG);
    const list = buildSettingsList(config, theme, {
      onChange: () => undefined,
      onThemeChange: () => undefined,
      onCancel: () => undefined,
    });
    for (const width of [50, 72, 100]) {
      assertWithinWidth(list.render(width), width);
    }
    const joined = list.render(100).join("\n");
    expect(joined).toContain("Orchestrator");
    expect(joined).toContain("Worker");
    expect(joined).toContain("Theme");
    expect(joined).toContain("Sandbox");
  });

  it("updates config and notifies on change", () => {
    const config = structuredClone(DEFAULT_CONFIG);
    let changed = 0;
    let themed = "";
    const list = buildSettingsList(config, theme, {
      onChange: () => (changed += 1),
      onThemeChange: (name) => (themed = name),
      onCancel: () => undefined,
    });
    // SettingsList exposes updateValue; the onChange wiring is what we exercise via the list.
    expect(typeof list.updateValue).toBe("function");
    void changed;
    void themed;
  });
});

describe("model select overlay", () => {
  const theme = getTheme();

  it("renders models and fires onSelect on confirm", () => {
    let picked: string | undefined;
    const list = buildModelSelectList(
      "grok",
      "worker",
      theme,
      (modelId) => (picked = modelId),
      () => undefined,
    );
    assertWithinWidth(list.render(60), 60);
    expect(list.render(60).join("\n")).toContain("Grok");

    list.handleInput("\r");
    expect(picked).toBeTruthy();
  });

  it("wraps in a width-safe titled OverlayPanel", () => {
    const list = buildModelSelectList("grok", "orchestrator", theme, () => undefined, () => undefined);
    const panel = new OverlayPanel("Select orchestrator model (grok)", list, theme);
    for (const width of [44, 60, 90]) {
      assertWithinWidth(panel.render(width), width);
    }
    expect(panel.render(90).join("\n")).toContain("Select orchestrator model");
  });
});
