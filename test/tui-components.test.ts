import { describe, expect, it } from "vitest";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
  BannerComponent,
  ContextBarComponent,
  ConversationComponent,
  FooterComponent,
  HelpOverlayComponent,
  UsagePanelComponent,
  padLine,
} from "../src/tui/components.js";
import {
  budgetSeverity,
  formatDuration,
  formatEventTime,
  formatModelBadge,
  formatPhaseLabel,
  formatRoleUsage,
  formatShortcutDeck,
  formatTokenCount,
  gauge,
  percentOf,
  progressBar,
  shortenPath,
  spinnerFrame,
} from "../src/tui/format.js";
import { HELP_LINES, resolveGlobalKey, SLASH_COMMANDS } from "../src/tui/keyboard.js";
import { getTheme } from "../src/tui/theme.js";
import { EMPTY_REPO_STATUS, type RepoStatus } from "../src/git/status.js";
import type { RunEvent, UsageSnapshot } from "../src/types.js";

const sampleEvent: RunEvent = {
  ts: "2026-06-12T15:04:05.000Z",
  phase: "architect",
  type: "plan",
  tokens_in: 1200,
  tokens_out: 340,
  message: "Architect plan: decompose task into worker steps.",
};

const repo: RepoStatus = {
  ...EMPTY_REPO_STATUS,
  isRepo: true,
  repoName: "olap",
  branch: "main",
  staged: 1,
  dirty: true,
};

const usage: UsageSnapshot = {
  orchestrator: { tokens_in: 1200, tokens_out: 900, calls: 4 },
  worker: { tokens_in: 8000, tokens_out: 5000, calls: 3 },
  subagents_spawned: 3,
  subagents_active: 1,
};

function assertWithinWidth(lines: string[], width: number): void {
  for (const line of lines) {
    expect(visibleWidth(line)).toBeLessThanOrEqual(width);
  }
}

describe("format helpers", () => {
  it("renders progress bars and gauges with bounds", () => {
    expect(progressBar(5, 10, 10)).toBe("█████░░░░░");
    expect(progressBar(20, 10, 6)).toBe("██████");
    const g = gauge(5, 10, 10);
    expect(g.fill.length + g.track.length).toBe(10);
  });

  it("formats token counts and durations", () => {
    expect(formatTokenCount(900)).toBe("900");
    expect(formatTokenCount(1500)).toBe("1.5k");
    expect(formatDuration(500)).toBe("500ms");
    expect(formatDuration(1500)).toBe("1.5s");
    expect(formatDuration(65000)).toBe("1m05s");
  });

  it("shortens paths against home", () => {
    expect(shortenPath("/Users/me/project", "/Users/me", 40)).toBe("~/project");
    const long = shortenPath("/Users/me/a/b/c/d/e/f/g/h/i", "/Users/me", 12);
    expect(long.startsWith("…/")).toBe(true);
    expect(long.length).toBeLessThanOrEqual(13);
  });

  it("spins through frames and formats badges/usage", () => {
    expect(spinnerFrame(0)).toBe(spinnerFrame(10));
    expect(formatModelBadge("grok", "grok-4")).toBe("grok:grok-4");
    expect(formatRoleUsage(usage.worker)).toContain("3 calls");
  });

  it("keeps stable timeline columns and severities", () => {
    expect(formatEventTime(sampleEvent.ts)).toBe("15:04:05");
    expect(formatPhaseLabel("worker")).toBe("WRK");
    expect(percentOf(150, 100)).toBe(100);
    expect(budgetSeverity(98)).toBe("critical");
    expect(formatShortcutDeck(["a", "b"], 80)).toContain("a");
  });
});

describe("keyboard model", () => {
  it("maps minimal global keys", () => {
    expect(resolveGlobalKey("\x03")?.type).toBe("quit");
    expect(resolveGlobalKey("\x0c")?.type).toBe("clear");
    expect(resolveGlobalKey("\x1b")?.type).toBe("close-overlay");
  });

  it("documents slash commands and help", () => {
    const names = SLASH_COMMANDS.map((c) => c.name);
    expect(names).toContain("settings");
    expect(names).toContain("models");
    expect(names).toContain("mode");
    expect(HELP_LINES.some((line) => line.includes("/settings"))).toBe(true);
  });
});

describe("TUI components", () => {
  const theme = getTheme();

  it("renders a Warp-like context bar with repo, models, and mode", () => {
    const bar = new ContextBarComponent({
      repo,
      cwd: "/Users/me/olap",
      home: "/Users/me",
      orchestratorBadge: "grok-4-latest",
      workerBadge: "grok-code-fast-1",
      mode: "build",
      theme,
    });
    for (const width of [40, 80, 120]) {
      const lines = bar.render(width);
      assertWithinWidth(lines, width);
    }
    expect(bar.render(120).join("\n")).toContain("OLAP");
    expect(bar.render(120).join("\n")).toContain("▟▛");
    expect(bar.render(120).join("\n")).toContain("build");
  });

  it("renders the conversation with events and a live spinner", () => {
    const convo = new ConversationComponent(theme);
    convo.addUser("add the auth callback tests");
    convo.addEvent(sampleEvent);
    convo.addNote("Detected CLIs: grok", "success");
    const idle = convo.render(80);
    assertWithinWidth(idle, 80);
    expect(idle.join("\n")).toContain("plan");

    convo.setRunning(true, "Orchestrator planning");
    convo.setFrame(2);
    const running = convo.render(80);
    assertWithinWidth(running, 80);
    expect(running.join("\n")).toContain("Orchestrator planning");
    expect(convo.isRunning()).toBe(true);
  });

  it("renders the usage panel with role usage and sub-agents", () => {
    const panel = new UsagePanelComponent({
      usage,
      orchestratorModel: "grok:grok-4-latest",
      workerModel: "grok:grok-code-fast-1",
      theme,
    });
    panel.update({ contextUsed: 4000, contextMax: 32000, budgetUsed: 900, budgetMax: 4096 });
    const lines = panel.render(100);
    assertWithinWidth(lines, 100);
    const joined = lines.join("\n");
    expect(joined).toContain("orchestrator");
    expect(joined).toContain("worker");
    expect(joined).toContain("sub-agents");
    panel.setVisible(false);
    expect(panel.render(100)).toEqual([]);
  });

  it("renders footer with hints and config summary", () => {
    const footer = new FooterComponent({
      hints: ["Enter run", "/settings"],
      mode: "build",
      access: { approval: "on-failure", sandbox: "workspace-write", network: false, execution: "dry-run" },
      themeName: "olap-dark",
      theme,
    });
    const lines = footer.render(100);
    assertWithinWidth(lines, 100);
    expect(lines.join("\n")).toContain("build");
    expect(lines.join("\n")).toContain("dry-run");
  });

  it("renders help overlay and banner", () => {
    const help = new HelpOverlayComponent(theme).render(80);
    assertWithinWidth(help, 80);
    expect(help.join("\n")).toContain("Help");
    expect(help.join("\n")).toContain("/settings");

    const banner = new BannerComponent(theme, true).render(80);
    assertWithinWidth(banner, 80);
    expect(banner.join("\n")).toContain("█");
    expect(banner.join("\n")).toContain("orchestrated loop");
    // Narrow terminals fall back to a compact wordmark.
    const narrow = new BannerComponent(theme, true).render(20);
    assertWithinWidth(narrow, 20);
    expect(narrow.join("\n")).toContain("OLAP");
    expect(new BannerComponent(theme, false).render(80)).toEqual([]);
  });

  it("padLine pads and truncates to width", () => {
    expect(visibleWidth(padLine("test", 20))).toBe(20);
    expect(visibleWidth(padLine("a very long line of text here", 10))).toBeLessThanOrEqual(10);
  });
});
