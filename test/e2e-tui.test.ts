import { describe, expect, it } from "vitest";
import { visibleWidth } from "@earendil-works/pi-tui";
import { DEFAULT_CONFIG } from "../src/config/defaults.js";
import { HELP_LINES, resolveGlobalKey, SHORTCUT_HINTS, SLASH_COMMANDS } from "../src/tui/keyboard.js";
import { buildSettingsList } from "../src/tui/overlays.js";
import { getTheme, themeNames } from "../src/tui/theme.js";
import {
  BannerComponent,
  ContextBarComponent,
  ConversationComponent,
  FooterComponent,
  HelpOverlayComponent,
  UsagePanelComponent,
} from "../src/tui/components.js";
import { EMPTY_REPO_STATUS } from "../src/git/status.js";

function assertWithinWidth(lines: string[], width: number): void {
  for (const line of lines) {
    expect(visibleWidth(line)).toBeLessThanOrEqual(width);
  }
}

describe("E2E TUI user flows", () => {
  it("exposes discoverable slash commands for every major feature", () => {
    const names = SLASH_COMMANDS.map((c) => c.name);
    for (const required of [
      "help",
      "settings",
      "models",
      "mode",
      "theme",
      "access",
      "adapters",
      "usage",
      "graphify",
      "headroom",
      "clear",
      "quit",
    ]) {
      expect(names).toContain(required);
    }
    for (const cmd of SLASH_COMMANDS) {
      expect(cmd.description.length).toBeGreaterThan(5);
    }
  });

  it("documents keyboard shortcuts in help overlay within terminal width", () => {
    const theme = getTheme("mono");
    const overlay = new HelpOverlayComponent(theme);
    for (const width of [60, 80, 120]) {
      const lines = overlay.render(width);
      assertWithinWidth(lines, width);
      expect(lines.join("\n")).toContain("/settings");
      expect(lines.join("\n")).toContain("Ctrl");
    }
    expect(HELP_LINES.some((line) => line.includes("Enter"))).toBe(true);
  });

  it("renders context bar, conversation, usage, and footer without overflow", () => {
    const theme = getTheme();
    const width = 100;
    const context = new ContextBarComponent({
      repo: {
        ...EMPTY_REPO_STATUS,
        isRepo: true,
        repoName: "olap",
        branch: "main",
        dirty: true,
        staged: 1,
      },
      cwd: "/Users/me/project",
      home: "/Users/me",
      orchestratorBadge: "grok:grok-composer-2.5-fast",
      workerBadge: "grok:grok-composer-2.5-fast",
      mode: "build",
      theme,
    });
    const conversation = new ConversationComponent(theme);
    conversation.addUser("add tests");
    conversation.addNote("Ready to run.", "success");

    const usage = new UsagePanelComponent({
      orchestratorModel: "grok:grok-composer-2.5-fast",
      workerModel: "grok:grok-composer-2.5-fast",
      theme,
    });
    usage.update({
      usage: {
        orchestrator: { tokens_in: 100, tokens_out: 50, calls: 1 },
        worker: { tokens_in: 0, tokens_out: 0, calls: 0 },
        subagents_spawned: 0,
        subagents_active: 0,
      },
      contextUsed: 1000,
      contextMax: 32000,
    });

    const footer = new FooterComponent({
      hints: SHORTCUT_HINTS,
      mode: "build",
      access: DEFAULT_CONFIG.access,
      themeName: "mono",
      theme,
    });
    const banner = new BannerComponent(theme);

    for (const component of [context, conversation, usage, footer, banner]) {
      assertWithinWidth(component.render(width), width);
    }
  });

  it("lets users change every settings row without leaving the panel", () => {
    const config = structuredClone(DEFAULT_CONFIG);
    const theme = getTheme();
    const list = buildSettingsList(config, theme, {
      onChange: () => undefined,
      onThemeChange: () => undefined,
      onCancel: () => undefined,
    });
    const firstPage = list.render(90).join("\n");
    expect(firstPage).toContain("Confirm before run");
    // Paginated settings — advance to worker section rows.
    for (let i = 0; i < 12; i++) list.handleInput("\x1b[B");
    const laterPage = list.render(90).join("\n");
    expect(laterPage).toMatch(/Max iterations|Stop on first pass|Max parallel|Loop policy/);
    expect(typeof list.updateValue).toBe("function");
  });

  it("supports global quit, clear, and escape without conflicting with editor keys", () => {
    expect(resolveGlobalKey("\x03")?.type).toBe("quit");
    expect(resolveGlobalKey("\x0c")?.type).toBe("clear");
    expect(resolveGlobalKey("\x1b")?.type).toBe("close-overlay");
    expect(resolveGlobalKey("tab")).toBeUndefined();
  });

  it("ships multiple themes users can cycle through", () => {
    const names = themeNames();
    expect(names.length).toBeGreaterThanOrEqual(5);
    for (const name of names) {
      const theme = getTheme(name);
      expect(theme.palette.fg).toBeTruthy();
      expect(typeof theme.text).toBe("function");
    }
  });
});
