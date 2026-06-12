import { describe, expect, it } from "vitest";
import {
  HeaderComponent,
  HelpOverlayComponent,
  ShortcutsComponent,
  StatusFooterComponent,
  TimelineComponent,
  panelLine,
} from "../src/tui/components.js";
import {
  budgetSeverity,
  formatCompactMetrics,
  formatEventTime,
  formatPhaseLabel,
  formatTimelineEvent,
  formatTokenCount,
  percentOf,
  progressBar,
  timelineMessageWidth,
} from "../src/tui/format.js";
import { HELP_LINES, SHORTCUT_HINTS, resolveGlobalKey } from "../src/tui/keyboard.js";
import type { RunEvent } from "../src/types.js";

const sampleEvent: RunEvent = {
  ts: "2026-06-12T15:04:05.000Z",
  phase: "architect",
  type: "plan",
  tokens_in: 1200,
  tokens_out: 340,
  message: "Architect plan: decompose task into worker steps.",
};

describe("TUI format helpers", () => {
  it("renders progress bars with bounds", () => {
    expect(progressBar(5, 10, 10)).toBe("█████░░░░░");
    expect(progressBar(20, 10, 6)).toBe("██████");
    expect(progressBar(0, 0, 8)).toBe("░░░░░░░░");
  });

  it("formats token counts compactly", () => {
    expect(formatTokenCount(900)).toBe("900");
    expect(formatTokenCount(1500)).toBe("1.5k");
    expect(formatTokenCount(12000)).toBe("12k");
  });

  it("formats timeline rows with stable columns", () => {
    expect(formatEventTime(sampleEvent.ts)).toBe("15:04:05");
    expect(formatPhaseLabel("worker")).toBe("WRK");
    const row = formatTimelineEvent(sampleEvent, 40);
    expect(row).toContain("15:04:05");
    expect(row).toContain("ARC");
    expect(row).toContain("plan");
    expect(row).toContain("↑1.2k");
  });

  it("computes percentages and budget severity", () => {
    expect(percentOf(25, 100)).toBe(25);
    expect(percentOf(150, 100)).toBe(100);
    expect(budgetSeverity(50)).toBe("ok");
    expect(budgetSeverity(85)).toBe("warn");
    expect(budgetSeverity(98)).toBe("critical");
  });

  it("builds compact metrics line", () => {
    const line = formatCompactMetrics({
      adapter: "codex",
      contextUsed: 400,
      contextMax: 8000,
      tokensIn: 1200,
      tokensOut: 900,
      efficiency: 0.75,
      budgetUsed: 200,
      budgetMax: 4000,
      contextPacked: true,
    });
    expect(line).toContain("ctx");
    expect(line).toContain("budget");
    expect(line).toContain("packed");
  });

  it("reserves timeline message width from terminal width", () => {
    expect(timelineMessageWidth(120)).toBeGreaterThan(40);
  });
});

describe("TUI keyboard shortcuts", () => {
  it("maps global keys to actions", () => {
    expect(resolveGlobalKey("\x03")?.type).toBe("quit");
    expect(resolveGlobalKey("\x0c")?.type).toBe("clear-output");
    expect(resolveGlobalKey("\x1b")?.type).toBe("toggle-help");
  });

  it("documents help and shortcut hints", () => {
    expect(SHORTCUT_HINTS.length).toBeGreaterThan(2);
    expect(HELP_LINES.some((line) => line.includes("/help"))).toBe(true);
  });
});

describe("TUI components", () => {
  it("renders header with status badge", () => {
    const header = new HeaderComponent("ready", "idle");
    const lines = header.render(80);
    expect(lines[0]).toContain("OLAP");
    expect(lines[0]).toContain("idle");

    header.setStatus("running");
    expect(header.render(80)[0]).toContain("running");
  });

  it("renders empty and populated timeline panels", () => {
    const timeline = new TimelineComponent();
    const empty = timeline.render(60);
    expect(empty.some((line) => line.includes("Waiting"))).toBe(true);

    timeline.setEvents([sampleEvent]);
    const filled = timeline.render(60);
    expect(filled.some((line) => line.includes("│"))).toBe(true);
    expect(filled.join("\n")).toContain("plan");
  });

  it("renders status footer metrics", () => {
    const footer = new StatusFooterComponent({
      adapter: "grok",
      contextUsed: 100,
      contextMax: 1000,
      tokensIn: 50,
      tokensOut: 75,
      efficiency: 1.5,
      budgetUsed: 80,
      budgetMax: 500,
      contextPacked: false,
    });
    const lines = footer.render(100);
    expect(lines.length).toBe(3);
    expect(lines.join("\n")).toContain("grok");
    expect(lines.join("\n")).toContain("budget");
  });

  it("renders help overlay and shortcuts", () => {
    const help = new HelpOverlayComponent().render(80);
    expect(help.join("\n")).toContain("Help");
    expect(help.join("\n")).toContain("/help");

    const shortcuts = new ShortcutsComponent().render(100);
    expect(shortcuts[0]).toContain("quit");
  });

  it("panelLine pads to inner width", () => {
    const line = panelLine("test", 20);
    expect(line).toContain("│");
    expect(line).toContain("test");
  });
});
