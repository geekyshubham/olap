import { describe, expect, it } from "vitest";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
  BannerComponent,
  ContextBarComponent,
  ConversationComponent,
  FooterComponent,
  HelpOverlayComponent,
  RunPlanOverlay,
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
  subagents_spawned: 0,
  subagents_active: 0,
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
    expect(names).toContain("graphify");
    expect(names).toContain("headroom");
    expect(HELP_LINES.some((line) => line.includes("/settings"))).toBe(true);
    expect(HELP_LINES.some((line) => line.includes("/graphify"))).toBe(true);
    expect(HELP_LINES.some((line) => line.includes("/headroom"))).toBe(true);
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

  it("renders the usage panel with role usage and context gauges", () => {
    const panel = new UsagePanelComponent({
      usage,
      orchestratorModel: "grok:grok-4-latest",
      workerModel: "grok:grok-code-fast-1",
      theme,
    });
    panel.update({ contextUsed: 4000, contextMax: 32000, contextAvailable: 64000 });
    panel.update({
      cost: {
        enabled: true,
        currency: "USD",
        orchestrator_usd: 0.004,
        worker_usd: 0.002,
        total_usd: 0.006,
        single_model_baseline_usd: 0.024,
        savings_usd: 0.018,
        savings_percent: 75,
        pricing_complete: true,
      },
    });
    const lines = panel.render(130);
    assertWithinWidth(lines, 130);
    const joined = lines.join("\n");
    expect(joined).toContain("orchestrator");
    expect(joined).toContain("worker");
    // Honest gauge: real repo coverage (packed/available) + packed size + real
    // token totals, no perpetual "100% ⚠ truncated".
    expect(joined).toContain("context");
    expect(joined).toContain("tokens");
    expect(joined).toContain("$0.0060");
    expect(joined).toContain("saved 75%");
    // 4000 packed of 64000 discovered ≈ 6% coverage (not pinned at 100%).
    expect(joined).toContain("6%");
    expect(joined).not.toContain("truncated");
    panel.setVisible(false);
    expect(panel.render(100)).toEqual([]);
  });

  it("renders footer with hints and config summary", () => {
    const footer = new FooterComponent({
      hints: ["Enter run", "/settings"],
      mode: "build",
      access: { approval: "on-failure", sandbox: "workspace-write", network: false },
      themeName: "olap-dark",
      theme,
    });
    const lines = footer.render(100);
    assertWithinWidth(lines, 100);
    expect(lines.join("\n")).toContain("build");
    expect(lines.join("\n")).toContain("workspace-write");
  });

  it("renders routing, briefs, and parsed agent output", () => {
    const convo = new ConversationComponent(theme);
    convo.addRouting("direct", "operational task");
    convo.addBrief("worker", "Task: publish\n\nExecute directly.");
    convo.addAgent("text", "Running npm publish");
    convo.addAgent("text", "Planning next steps", "orchestrator");
    convo.addAgent("thought", "Checking git status");
    const lines = convo.render(100);
    assertWithinWidth(lines, 100);
    expect(lines.join("\n")).toContain("direct");
    expect(lines.join("\n")).toContain("wrk brief");
    expect(lines.join("\n")).toContain("npm publish");
    expect(lines.join("\n")).toContain("orch");
    expect(lines.join("\n")).toContain("Planning next steps");
    expect(lines.join("\n")).toContain("thought");
  });

  it("renders a diff summary, collapses thoughts, and shows tool status", () => {
    const convo = new ConversationComponent(theme);
    convo.addDiff({
      changed: true,
      files: [{ path: "src/x.ts", insertions: 3, deletions: 1, binary: false }],
      insertions: 3,
      deletions: 1,
    });
    convo.addAgent("thought", "a very long chain of reasoning that should be collapsed ".repeat(8));
    convo.addAgent("tool", "bash({\"command\":\"npm test\"})");
    const lines = convo.render(120);
    assertWithinWidth(lines, 120);
    const joined = lines.join("\n");
    expect(joined).toContain("changes");
    expect(joined).toContain("src/x.ts");
    expect(joined).toContain("+3");
    expect(joined).toContain("tool");
    // A long thought collapses to exactly one dimmed line.
    expect(lines.filter((l) => l.includes("thought"))).toHaveLength(1);
  });

  it("shows a live peek (last activity) and stall warning while running", () => {
    const convo = new ConversationComponent(theme);
    convo.setRunning(true, "Worker iteration 1/3");
    convo.setActivity("edit src/tui/components.ts");
    convo.setFrame(1);
    const peek = convo.render(120).join("\n");
    expect(peek).toContain("edit src/tui/components.ts");
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

    const wide = new BannerComponent(theme, true);
    expect(wide.chromeRowCount(80)).toBe(9);
    expect(wide.chromeRowCount(20)).toBe(1);
    expect(wide.chromeRowCount(80)).toBe(wide.render(80).length);
    expect(wide.chromeRowCount(20)).toBe(wide.render(20).length);
  });

  it("padLine pads and truncates to width", () => {
    expect(visibleWidth(padLine("test", 20))).toBe(20);
    expect(visibleWidth(padLine("a very long line of text here", 10))).toBeLessThanOrEqual(10);
  });
});

describe("transcript scrolling", () => {
  const theme = getTheme();

  function bigConvo(): ConversationComponent {
    // 12-row viewport (rows 12, no reserved chrome) with 60 one-line entries.
    const convo = new ConversationComponent(theme, { rows: () => 12 });
    convo.setReservedRows(0);
    for (let i = 0; i < 60; i++) convo.addUser(`line-${i}`);
    return convo;
  }

  it("renders a bounded viewport with a scroll-up indicator instead of dropping history", () => {
    const convo = bigConvo();
    const view = convo.render(80);
    assertWithinWidth(view, 80);
    expect(view.length).toBe(12);
    expect(view.join("\n")).toContain("PgUp");
    expect(convo.canScroll()).toBe(true);
  });

  it("scrolls up to reveal older lines and back to the bottom", () => {
    const convo = bigConvo();
    convo.render(80); // prime lastMaxOffset
    expect(convo.pageUp()).toBe(true);
    const scrolled = convo.render(80).join("\n");
    expect(scrolled).toContain("PgDn"); // a bottom indicator appears once scrolled up
    // A line that is hidden at the bottom becomes visible after scrolling up.
    expect(scrolled).toContain("line-40");

    convo.scrollToBottom();
    const bottom = convo.render(80).join("\n");
    expect(bottom).toContain("line-59");
    expect(bottom).not.toContain("PgDn");
  });

  it("does not scroll when everything fits", () => {
    const convo = new ConversationComponent(theme, { rows: () => 40 });
    convo.setReservedRows(0);
    convo.addUser("only one line");
    convo.render(80);
    expect(convo.canScroll()).toBe(false);
    expect(convo.scrollUp(1)).toBe(false);
  });

  it("keeps the scroll anchor when new lines arrive off-tail", () => {
    const convo = bigConvo();
    convo.render(80);
    convo.pageUp();
    const before = convo.render(80).join("\n");
    expect(before).toContain("line-40");
    convo.addUser("new-tail-line");
    const after = convo.render(80).join("\n");
    expect(after).toContain("line-40");
    expect(after).not.toContain("new-tail-line");
  });
});

describe("collapsible brief", () => {
  const theme = getTheme();

  it("collapses a long brief and links the full artifact", () => {
    const convo = new ConversationComponent(theme, { rows: () => 80 });
    convo.setReservedRows(0);
    convo.setRunId("RUN123");
    const longBrief = Array.from({ length: 40 }, (_, i) => `brief line ${i}`).join("\n");
    convo.addBrief("orchestrator", longBrief);
    const joined = convo.render(100).join("\n");
    expect(joined).toContain("orch brief");
    expect(joined).toContain("more lines");
    expect(joined).toContain(".olap/runs/RUN123/brief.md");
  });

  it("shows a short brief in full", () => {
    const convo = new ConversationComponent(theme, { rows: () => 80 });
    convo.setReservedRows(0);
    convo.addBrief("worker", "do the thing\nthen verify");
    const joined = convo.render(100).join("\n");
    expect(joined).toContain("do the thing");
    expect(joined).toContain("then verify");
    expect(joined).not.toContain("more lines");
  });
});

describe("run-plan overlay", () => {
  const theme = getTheme();

  it("renders the strategy, stop conditions, and models with a confirm hint", () => {
    const overlay = new RunPlanOverlay(
      {
        task: "add the auth callback tests",
        strategy: "loop",
        complexity: "complex",
        reason: "implementation task — full orchestrator/worker loop",
        mode: "build",
        maxIterations: 3,
        stopOnFirstPass: false,
        orchestrator: "grok:grok-composer-2.5-fast",
        worker: "grok:grok-composer-2.5-fast",
        stopConditions: ["max 3 iterations reached", "you cancel (Esc / Ctrl+C)"],
      },
      theme,
    );
    for (const width of [60, 80, 120]) {
      assertWithinWidth(overlay.render(width), width);
    }
    const joined = overlay.render(100).join("\n");
    expect(joined).toContain("Run plan");
    expect(joined).toContain("add the auth callback tests");
    expect(joined).toContain("loop");
    expect(joined).toContain("build");
    expect(joined).toContain("grok:grok-composer-2.5-fast");
    expect(joined).toContain("Start");
    expect(joined).toContain("Cancel");
  });
});

describe("run summary block", () => {
  const theme = getTheme();

  it("renders a completed summary with files, churn, and a report link", () => {
    const convo = new ConversationComponent(theme, { rows: () => 80 });
    convo.setReservedRows(0);
    convo.addSummary({
      status: "completed",
      iterations: 2,
      files: ["app/intel/views.py", "frontend/src/App.jsx"],
      insertions: 10,
      deletions: 3,
      runId: "RID1",
      sessionId: "sess-20260614T120000-abc123",
      workerCancelled: false,
    });
    const joined = convo.render(120).join("\n");
    expect(joined).toContain("Run completed");
    expect(joined).toContain("2 iterations");
    expect(joined).toContain("app/intel/views.py");
    expect(joined).toContain("+10");
    expect(joined).toContain("RID1/final-report.md");
    expect(joined).toContain("sess-20260614T120000-abc123");
    expect(joined).toContain("--session-id");
  });

  it("marks cancelled runs and worker cancellation", () => {
    const convo = new ConversationComponent(theme, { rows: () => 80 });
    convo.setReservedRows(0);
    convo.addSummary({
      status: "cancelled",
      iterations: 1,
      files: [],
      insertions: 0,
      deletions: 0,
      runId: "RID2",
      sessionId: "sess-20260614T120000-xyz789",
      workerCancelled: true,
    });
    const joined = convo.render(120).join("\n");
    expect(joined).toContain("Run cancelled");
    expect(joined).toContain("worker cancelled");
    expect(joined).toContain("no file changes");
  });
});

describe("verbose collapse", () => {
  const theme = getTheme();

  it("collapses agent/output/command detail when off and expands when on", () => {
    const convo = new ConversationComponent(theme, { rows: () => 80 });
    convo.setReservedRows(0);
    convo.addUser("review the tool");
    convo.addAgent("text", "worker doing the work");
    convo.addOutput("stdout", "a noisy output line");
    convo.addCommand("worker", "grok -p ...");

    // Verbose (default): detail is visible.
    expect(convo.render(120).join("\n")).toContain("worker doing the work");

    // Collapsed: detail hidden behind a summary, structural entries remain.
    convo.setVerbose(false);
    const collapsed = convo.render(120).join("\n");
    expect(collapsed).not.toContain("worker doing the work");
    expect(collapsed).toContain("activity lines hidden");
    expect(collapsed).toContain("/verbose");
    expect(collapsed).toContain("review the tool");

    // Toggle back on.
    expect(convo.toggleVerbose()).toBe(true);
    expect(convo.render(120).join("\n")).toContain("worker doing the work");
  });
});

describe("transcript message navigation", () => {
  const theme = getTheme();

  it("steps through messages with prev/next and stops at the ends", () => {
    const convo = new ConversationComponent(theme, { rows: () => 5 });
    convo.setReservedRows(0);
    for (let i = 1; i <= 8; i += 1) convo.addUser(`MSG${i}`);

    // Render once so anchors + max offset are known; the transcript must overflow.
    convo.render(60);
    expect(convo.canScroll()).toBe(true);

    // Walk up message-by-message until we reach the top.
    let up = 0;
    while (convo.scrollToPrevMessage()) {
      convo.render(60);
      up += 1;
      if (up > 100) break;
    }
    expect(up).toBeGreaterThan(0);
    expect(convo.scrollToPrevMessage()).toBe(false);
    expect(convo.render(60).join("\n")).toContain("MSG1");

    // Walk back down to the bottom.
    let down = 0;
    while (convo.scrollToNextMessage()) {
      convo.render(60);
      down += 1;
      if (down > 100) break;
    }
    expect(down).toBeGreaterThan(0);
    expect(convo.scrollToNextMessage()).toBe(false);
    expect(convo.render(60).join("\n")).toContain("MSG8");
  });

  it("does nothing when the transcript fits on screen", () => {
    const convo = new ConversationComponent(theme, { rows: () => 40 });
    convo.setReservedRows(0);
    convo.addUser("only one");
    convo.render(60);
    expect(convo.canScroll()).toBe(false);
    expect(convo.scrollToPrevMessage()).toBe(false);
    expect(convo.scrollToNextMessage()).toBe(false);
  });
});
