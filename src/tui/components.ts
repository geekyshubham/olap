import {
  truncateToWidth,
  visibleWidth,
  type Component,
  type Focusable,
} from "@earendil-works/pi-tui";
import type {
  AccessConfig,
  ArchitectReview,
  RunEvent,
  UsageSnapshot,
  WorkMode,
} from "../types.js";
import type { RepoStatus } from "../git/status.js";
import { formatDiffSummary, formatRepoStatus } from "../git/status.js";
import type { DiffSummary } from "../git/status.js";
import {
  formatDuration,
  formatModelBadge,
  formatRoleUsage,
  formatTokenCount,
  gauge,
  percentOf,
  shortenPath,
  spinnerFrame,
} from "./format.js";
import { HELP_LINES } from "./keyboard.js";
import { getTheme, type Theme } from "./theme.js";

export function padLine(line: string, width: number): string {
  const visible = visibleWidth(line);
  if (visible >= width) return truncateToWidth(line, width);
  return line + " ".repeat(width - visible);
}

/** Block-letter wordmark for the OLAP banner (ANSI-shadow style). */
const OLAP_LOGO = [
  " ██████╗ ██╗      █████╗ ██████╗ ",
  "██╔═══██╗██║     ██╔══██╗██╔══██╗",
  "██║   ██║██║     ███████║██████╔╝",
  "██║   ██║██║     ██╔══██║██╔═══╝ ",
  "╚██████╔╝███████╗██║  ██║██║     ",
  " ╚═════╝ ╚══════╝╚═╝  ╚═╝╚═╝     ",
] as const;

function centerLine(line: string, width: number): string {
  const visible = visibleWidth(line);
  if (visible >= width) return truncateToWidth(line, width);
  const left = Math.floor((width - visible) / 2);
  return " ".repeat(left) + line;
}

/** Colorize a logo line: solid blocks in the accent color, shadow glyphs dimmed. */
function colorizeLogoLine(line: string, theme: Theme): string {
  let out = "";
  let i = 0;
  while (i < line.length) {
    const char = line[i];
    if (char === " ") {
      let j = i;
      while (j < line.length && line[j] === " ") j++;
      out += " ".repeat(j - i);
      i = j;
      continue;
    }
    const isBlock = char === "█";
    let j = i;
    while (j < line.length && line[j] !== " " && (line[j] === "█") === isBlock) j++;
    const run = line.slice(i, j);
    out += isBlock ? theme.title(run) : theme.faint(run);
    i = j;
  }
  return out;
}

function joinLeftRight(left: string, right: string, width: number): string {
  const leftW = visibleWidth(left);
  const rightW = visibleWidth(right);
  if (leftW + rightW + 1 > width) {
    // Not enough room: keep the right segment, truncate the left.
    const room = Math.max(0, width - rightW - 1);
    const truncatedLeft = truncateToWidth(left, room);
    const used = visibleWidth(truncatedLeft) + rightW;
    return truncatedLeft + " ".repeat(Math.max(1, width - used)) + right;
  }
  return left + " ".repeat(width - leftW - rightW) + right;
}

function frame(title: string, bodyLines: string[], width: number, theme: Theme): string[] {
  const inner = Math.max(10, width - 4);
  const titleText = ` ${title} `;
  const titleVisible = visibleWidth(titleText);
  const dashCount = Math.max(0, inner - titleVisible + 1);
  const top = theme.border(`╭─${theme.title(titleText)}${theme.border("─".repeat(dashCount))}╮`);
  const bottom = theme.border(`╰─${"─".repeat(inner + 1)}╯`);
  const body = bodyLines.map((line) => {
    const content = truncateToWidth(line, inner);
    const pad = Math.max(0, inner - visibleWidth(content));
    return `${theme.border("│")} ${content}${" ".repeat(pad)} ${theme.border("│")}`;
  });
  // Safety net: never exceed the viewport width (e.g. very narrow terminals).
  return [top, ...body, bottom].map((line) => truncateToWidth(line, width));
}

/** Warp-like context bar: repo · git status · cwd on the left, models · mode on the right. */
export class ContextBarComponent implements Component {
  private repo: RepoStatus;
  private cwd: string;
  private home: string | undefined;
  private orchestratorBadge: string;
  private workerBadge: string;
  private mode: WorkMode;
  private theme: Theme;

  constructor(init: {
    repo: RepoStatus;
    cwd: string;
    home?: string;
    orchestratorBadge: string;
    workerBadge: string;
    mode: WorkMode;
    theme?: Theme;
  }) {
    this.repo = init.repo;
    this.cwd = init.cwd;
    this.home = init.home;
    this.orchestratorBadge = init.orchestratorBadge;
    this.workerBadge = init.workerBadge;
    this.mode = init.mode;
    this.theme = init.theme ?? getTheme();
  }

  setTheme(theme: Theme): void {
    this.theme = theme;
  }

  update(patch: Partial<{
    repo: RepoStatus;
    cwd: string;
    orchestratorBadge: string;
    workerBadge: string;
    mode: WorkMode;
  }>): void {
    if (patch.repo) this.repo = patch.repo;
    if (patch.cwd !== undefined) this.cwd = patch.cwd;
    if (patch.orchestratorBadge !== undefined) this.orchestratorBadge = patch.orchestratorBadge;
    if (patch.workerBadge !== undefined) this.workerBadge = patch.workerBadge;
    if (patch.mode) this.mode = patch.mode;
  }

  invalidate(): void {}

  render(width: number): string[] {
    const t = this.theme;
    const repoName = (this.repo.repoName ?? "workspace").toUpperCase();
    const gitText = this.repo.isRepo
      ? `${t.dim("⎇")} ${this.repo.dirty ? t.warn(formatRepoStatus(this.repo)) : t.success(formatRepoStatus(this.repo))}`
      : t.faint("no git");
    const path = t.dim(shortenPath(this.cwd, this.home, Math.floor(width * 0.4)));
    const left = `${t.title("▟▛")} ${t.title(repoName)}  ${gitText}  ${path}`;

    const modeStyle =
      this.mode === "plan" ? t.info : this.mode === "workflow" ? t.accent2 : t.success;
    const right = [
      `${t.orchestrator("orch")} ${t.dim(this.orchestratorBadge)}`,
      `${t.worker("wrk")} ${t.dim(this.workerBadge)}`,
      modeStyle(`⏵ ${this.mode}`),
    ].join("  ");

    return [padLine(joinLeftRight(left, right, width), width)];
  }
}

/** Small, tasteful, non-busy banner. */
export class BannerComponent implements Component {
  private theme: Theme;
  private visibleBanner: boolean;

  constructor(theme?: Theme, visible = true) {
    this.theme = theme ?? getTheme();
    this.visibleBanner = visible;
  }

  setTheme(theme: Theme): void {
    this.theme = theme;
  }

  setVisible(visible: boolean): void {
    this.visibleBanner = visible;
  }

  invalidate(): void {}

  render(width: number): string[] {
    if (!this.visibleBanner) return [];
    const t = this.theme;
    const logoWidth = Math.max(...OLAP_LOGO.map((line) => line.length));
    if (width < logoWidth + 2) {
      const mark = `${t.accent("◆")} ${t.title("OLAP")}  ${t.dim("orchestrated loop")}`;
      return [centerLine(mark, width)];
    }
    const logo = OLAP_LOGO.map((line) =>
      centerLine(colorizeLogoLine(line.padEnd(logoWidth), t), width),
    );
    const tagline = centerLine(t.dim("orchestrated loop · architect plans, worker builds"), width);
    return ["", ...logo, tagline, ""];
  }
}

/** A thin themed horizontal separator, optionally with a small inline label. */
export class RuleComponent implements Component {
  private theme: Theme;
  private label: string;

  constructor(theme?: Theme, label = "") {
    this.theme = theme ?? getTheme();
    this.label = label;
  }

  setTheme(theme: Theme): void {
    this.theme = theme;
  }

  setLabel(label: string): void {
    this.label = label;
  }

  invalidate(): void {}

  render(width: number): string[] {
    if (width <= 0) return [""];
    const t = this.theme;
    if (!this.label) {
      return [t.border("─".repeat(width))];
    }
    const tag = ` ${this.label} `;
    const dashes = Math.max(0, width - tag.length - 1);
    return [truncateToWidth(`${t.border("──")}${t.faint(tag)}${t.border("─".repeat(dashes))}`, width)];
  }
}

export type ConversationEntry =
  | { kind: "user"; text: string }
  | { kind: "event"; event: RunEvent }
  | { kind: "note"; text: string; tone: "info" | "success" | "warn" | "error" | "dim" }
  | { kind: "routing"; strategy: "direct" | "loop"; reason: string }
  | { kind: "brief"; role: "orchestrator" | "worker"; text: string }
  | { kind: "command"; role: "orchestrator" | "worker"; command: string }
  | { kind: "agent"; agentKind: "text" | "thought" | "tool" | "status" | "error"; content: string }
  | { kind: "output"; stream: "stdout" | "stderr"; line: string }
  | { kind: "diff"; summary: DiffSummary }
  | { kind: "review"; review: ArchitectReview };

const MAX_ENTRIES = 500;
const MAX_VISIBLE_LINES = 48;
/** No worker sub-activity for this long while running ⇒ show a stall warning. */
const STALL_THRESHOLD_MS = 12_000;

/** Scrolling transcript of prompts, loop events, worker output, and reviews, with a live status row. */
export class ConversationComponent implements Component {
  private entries: ConversationEntry[] = [];
  private theme: Theme;
  private running = false;
  private phaseLabel = "";
  private frame = 0;
  private startedAt = 0;
  /** Last sub-activity label (e.g. "edit src/x.ts") for the live peek row. */
  private activity = "";
  private activityAt = 0;

  constructor(theme?: Theme) {
    this.theme = theme ?? getTheme();
  }

  setTheme(theme: Theme): void {
    this.theme = theme;
  }

  private push(entry: ConversationEntry): void {
    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) {
      this.entries.splice(0, this.entries.length - MAX_ENTRIES);
    }
  }

  addUser(text: string): void {
    this.push({ kind: "user", text });
  }

  addEvent(event: RunEvent): void {
    this.push({ kind: "event", event });
  }

  addNote(text: string, tone: "info" | "success" | "warn" | "error" | "dim" = "dim"): void {
    this.push({ kind: "note", text, tone });
  }

  addOutput(stream: "stdout" | "stderr", line: string): void {
    this.push({ kind: "output", stream, line });
  }

  addRouting(strategy: "direct" | "loop", reason: string): void {
    this.push({ kind: "routing", strategy, reason });
  }

  addBrief(role: "orchestrator" | "worker", text: string): void {
    this.push({ kind: "brief", role, text });
  }

  addCommand(role: "orchestrator" | "worker", command: string): void {
    this.push({ kind: "command", role, command });
  }

  addAgent(
    agentKind: "text" | "thought" | "tool" | "status" | "error",
    content: string,
  ): void {
    this.push({ kind: "agent", agentKind, content });
    // Any agent output counts as liveness for stall detection.
    this.activityAt = Date.now();
    if (agentKind === "tool") this.activity = content;
  }

  addReview(review: ArchitectReview): void {
    this.push({ kind: "review", review });
  }

  addDiff(summary: DiffSummary): void {
    this.push({ kind: "diff", summary });
  }

  /** Record the current sub-activity (tool/file) for the live peek row. */
  setActivity(label: string): void {
    this.activity = label;
    this.activityAt = Date.now();
  }

  clear(): void {
    this.entries = [];
    this.running = false;
    this.phaseLabel = "";
    this.activity = "";
    this.activityAt = 0;
  }

  setRunning(running: boolean, label = ""): void {
    this.running = running;
    this.phaseLabel = label;
    if (running && this.startedAt === 0) this.startedAt = Date.now();
    if (running) this.activityAt = Date.now();
    if (!running) {
      this.startedAt = 0;
      this.activity = "";
      this.activityAt = 0;
    }
  }

  setPhase(label: string): void {
    this.phaseLabel = label;
  }

  setFrame(frame: number): void {
    this.frame = frame;
  }

  isRunning(): boolean {
    return this.running;
  }

  invalidate(): void {}

  private renderEntry(entry: ConversationEntry, width: number): string[] {
    const t = this.theme;
    switch (entry.kind) {
      case "user": {
        const prefix = t.accent("▟▛ ");
        return wrap(entry.text, width, prefix.length === 0 ? 2 : 2).map((line, i) =>
          truncateToWidth(i === 0 ? `${prefix}${t.text(line)}` : `   ${t.text(line)}`, width),
        );
      }
      case "event": {
        const e = entry.event;
        const roleStyle = e.phase === "architect" ? t.orchestrator : t.worker;
        const tag = roleStyle(e.phase === "architect" ? "◆ orch" : "◇ wrk");
        const type = t.type(e.type);
        const tokens = t.tokens(`↑${formatTokenCount(e.tokens_in)} ↓${formatTokenCount(e.tokens_out)}`);
        const head = `  ${tag} ${type} ${tokens}`;
        const headLine = truncateToWidth(head, width);
        const msgLines = wrap(e.message, width, 4).map((line) =>
          truncateToWidth(`    ${t.dim(line)}`, width),
        );
        return [headLine, ...msgLines];
      }
      case "note": {
        const style =
          entry.tone === "success"
            ? t.success
            : entry.tone === "warn"
              ? t.warn
              : entry.tone === "error"
                ? t.error
                : entry.tone === "info"
                  ? t.info
                  : t.dim;
        return wrap(entry.text, width, 2).map((line) => truncateToWidth(`  ${style(line)}`, width));
      }
      case "routing": {
        const mode = entry.strategy === "direct" ? t.info("direct") : t.accent("loop");
        const head = `  ${t.dim("route")} ${mode} ${t.dim("—")} ${t.dim(entry.reason)}`;
        return [truncateToWidth(head, width)];
      }
      case "brief": {
        const roleStyle = entry.role === "orchestrator" ? t.orchestrator : t.worker;
        const tag = roleStyle(entry.role === "orchestrator" ? "◆ orch brief" : "◇ wrk brief");
        const head = `  ${tag}`;
        const body = wrap(entry.text, width, 4).map((line) =>
          truncateToWidth(`    ${t.text(line)}`, width),
        );
        return [truncateToWidth(head, width), ...body];
      }
      case "command": {
        const roleStyle = entry.role === "orchestrator" ? t.orchestrator : t.worker;
        const tag = roleStyle(entry.role === "orchestrator" ? "◆ orch cmd" : "◇ wrk cmd");
        // The command is already compacted (long prompts elided) upstream, so we
        // can wrap it fully instead of hiding the payload behind an ellipsis.
        const body = wrap(entry.command, width, 4).map((line, i) =>
          truncateToWidth(i === 0 ? `  ${tag} ${t.faint(line)}` : `    ${t.faint(line)}`, width),
        );
        return body.length > 0 ? body : [truncateToWidth(`  ${tag}`, width)];
      }
      case "agent": {
        if (entry.agentKind === "thought") {
          // Collapse reasoning to a single dimmed line so it doesn't dominate.
          const oneLine = entry.content.replace(/\s+/g, " ").trim();
          return [truncateToWidth(`    ${t.faint(`thought ${oneLine}`)}`, width)];
        }
        if (entry.agentKind === "tool") {
          // Tool calls render as a status line: "● tool name(args)".
          return [truncateToWidth(`    ${t.accent2("●")} ${t.accent2("tool")} ${t.text(entry.content)}`, width)];
        }
        if (entry.agentKind === "status") {
          return [truncateToWidth(`    ${t.dim(`· ${entry.content}`)}`, width)];
        }
        if (entry.agentKind === "error") {
          return wrap(entry.content, width, 6).map((line, i) =>
            truncateToWidth(i === 0 ? `    ${t.error("✗")} ${t.error(line)}` : `      ${t.error(line)}`, width),
          );
        }
        const prefix = t.worker("    wrk ");
        const body = wrap(entry.content, width, 8).map((line, i) =>
          truncateToWidth(i === 0 ? `${prefix}${t.text(line)}` : `          ${t.text(line)}`, width),
        );
        return body.length > 0 ? body : [truncateToWidth(prefix, width)];
      }
      case "diff": {
        const d = entry.summary;
        const head = `  ${t.accent("◈ changes")} ${d.changed ? t.success(formatDiffSummary(d)) : t.dim("no changes")}`;
        const lines = [truncateToWidth(head, width)];
        for (const file of d.files.slice(0, 8)) {
          const stat = file.binary ? t.dim("binary") : `${t.success(`+${file.insertions}`)} ${t.error(`-${file.deletions}`)}`;
          lines.push(truncateToWidth(`      ${t.dim(file.path)} ${stat}`, width));
        }
        if (d.files.length > 8) {
          lines.push(truncateToWidth(`      ${t.dim(`… +${d.files.length - 8} more files`)}`, width));
        }
        return lines;
      }
      case "output": {
        const style = entry.stream === "stderr" ? t.warn : t.faint;
        return [truncateToWidth(`    ${style("│")} ${style(entry.line)}`, width)];
      }
      case "review": {
        const r = entry.review;
        const verdictStyle =
          r.verdict === "pass" ? t.success : r.verdict === "fail" ? t.error : t.warn;
        const head = `  ${t.orchestrator("◆ review")} ${verdictStyle(r.verdict.toUpperCase())} ${t.dim(`#${r.iteration}`)}`;
        const lines = [truncateToWidth(head, width)];
        for (const finding of r.findings) {
          const fstyle =
            finding.severity === "error" ? t.error : finding.severity === "warn" ? t.warn : t.dim;
          lines.push(truncateToWidth(`    ${fstyle("•")} ${t.dim(finding.message)}`, width));
        }
        return lines;
      }
    }
  }

  render(width: number): string[] {
    const lines: string[] = [];
    for (const entry of this.entries) {
      lines.push(...this.renderEntry(entry, width));
    }
    const tail =
      lines.length > MAX_VISIBLE_LINES ? lines.slice(-MAX_VISIBLE_LINES) : lines;
    const clipped = lines.length > tail.length;
    const out = clipped
      ? [truncateToWidth(this.theme.dim(`  … ${lines.length - tail.length} earlier lines hidden`), width), ...tail]
      : tail;
    if (this.running) {
      const t = this.theme;
      const elapsed = this.startedAt > 0 ? formatDuration(Date.now() - this.startedAt) : "";
      const spin = t.spinner(spinnerFrame(this.frame));
      const label = t.text(this.phaseLabel || "Working");
      const time = elapsed ? t.faint(`(${elapsed})`) : "";
      const idleMs = this.activityAt > 0 ? Date.now() - this.activityAt : 0;
      const stalled = idleMs > STALL_THRESHOLD_MS;
      const peek = this.activity
        ? stalled
          ? t.warn(`⚠ idle ${formatDuration(idleMs)} · last: ${this.activity}`)
          : t.faint(`· ${this.activity}`)
        : stalled
          ? t.warn(`⚠ idle ${formatDuration(idleMs)}`)
          : "";
      out.push(truncateToWidth(`  ${spin} ${label} ${time} ${peek}`.trimEnd(), width));
    }
    return out;
  }
}

/** Orchestrator vs worker usage, sub-agent count, a real context-pack gauge, and live token totals. */
export class UsagePanelComponent implements Component {
  private usage: UsageSnapshot;
  private contextUsed = 0;
  private contextMax = 1;
  private contextTruncated = false;
  private orchestratorModel = "";
  private workerModel = "";
  private activeRole: "orchestrator" | "worker" | null = null;
  private frame = 0;
  private theme: Theme;
  private visiblePanel = true;

  constructor(init?: {
    usage?: UsageSnapshot;
    orchestratorModel?: string;
    workerModel?: string;
    theme?: Theme;
  }) {
    this.usage = init?.usage ?? {
      orchestrator: { tokens_in: 0, tokens_out: 0, calls: 0 },
      worker: { tokens_in: 0, tokens_out: 0, calls: 0 },
      subagents_spawned: 0,
      subagents_active: 0,
    };
    this.orchestratorModel = init?.orchestratorModel ?? "";
    this.workerModel = init?.workerModel ?? "";
    this.theme = init?.theme ?? getTheme();
  }

  setTheme(theme: Theme): void {
    this.theme = theme;
  }

  setVisible(visible: boolean): void {
    this.visiblePanel = visible;
  }

  isVisible(): boolean {
    return this.visiblePanel;
  }

  setModels(orchestrator: string, worker: string): void {
    this.orchestratorModel = orchestrator;
    this.workerModel = worker;
  }

  setActiveRole(role: "orchestrator" | "worker" | null): void {
    this.activeRole = role;
  }

  setFrame(frame: number): void {
    this.frame = frame;
  }

  update(patch: {
    usage?: UsageSnapshot;
    contextUsed?: number;
    contextMax?: number;
    contextTruncated?: boolean;
  }): void {
    if (patch.usage) this.usage = patch.usage;
    if (patch.contextUsed !== undefined) this.contextUsed = patch.contextUsed;
    if (patch.contextMax !== undefined) this.contextMax = patch.contextMax;
    if (patch.contextTruncated !== undefined) this.contextTruncated = patch.contextTruncated;
  }

  reset(): void {
    this.usage = {
      orchestrator: { tokens_in: 0, tokens_out: 0, calls: 0 },
      worker: { tokens_in: 0, tokens_out: 0, calls: 0 },
      subagents_spawned: 0,
      subagents_active: 0,
    };
    this.contextUsed = 0;
    this.contextTruncated = false;
  }

  invalidate(): void {}

  private gaugeText(label: string, used: number, max: number, width: number): string {
    const t = this.theme;
    const g = gauge(used, max, width);
    return `${t.dim(label)} ${t.bar(g.fill)}${t.barTrack(g.track)} ${t.dim(`${percentOf(used, max)}%`)}`;
  }

  render(width: number): string[] {
    if (!this.visiblePanel) return [];
    const t = this.theme;
    const orchModel = formatModelBadge("", this.orchestratorModel).replace(/^:/, "");
    const idle =
      this.usage.orchestrator.calls === 0 &&
      this.usage.worker.calls === 0 &&
      this.contextUsed === 0;
    if (idle) {
      // Idle: the context bar already shows the orchestrator/worker models, so
      // the panel stays out of the way until a run produces usage.
      return [];
    }
    const orchActive = this.activeRole === "orchestrator";
    const wrkActive = this.activeRole === "worker";
    const orchMark = orchActive ? t.spinner(spinnerFrame(this.frame)) : t.orchestrator("◆");
    const wrkMark = wrkActive ? t.spinner(spinnerFrame(this.frame)) : t.worker("◇");
    const orch = `${orchMark} ${t.orchestrator("orchestrator")} ${t.dim(orchModel)} ${t.faint(formatRoleUsage(this.usage.orchestrator))}${orchActive ? ` ${t.accent("working")}` : ""}`;
    const wrk = `${wrkMark} ${t.worker("worker")} ${t.dim(this.workerModel)} ${t.faint(formatRoleUsage(this.usage.worker))}${wrkActive ? ` ${t.accent("working")}` : ""}`;
    const sub = `${t.dim("sub-agents")} ${t.accent(String(this.usage.subagents_spawned))} ${t.faint(`(${this.usage.subagents_active} active)`)}`;
    const totalIn = this.usage.orchestrator.tokens_in + this.usage.worker.tokens_in;
    const totalOut = this.usage.orchestrator.tokens_out + this.usage.worker.tokens_out;
    const pack = this.gaugeText("pack", this.contextUsed, this.contextMax, 8);
    const trunc = this.contextTruncated ? ` ${t.warn("⚠ truncated")}` : "";
    const tokens = `${t.dim("tokens")} ${t.tokens(`↑${formatTokenCount(totalIn)} ↓${formatTokenCount(totalOut)}`)}`;
    const gauges = `${pack}${trunc}    ${tokens}`;
    return [
      truncateToWidth(` ${orch}`, width),
      truncateToWidth(` ${wrk}    ${sub}`, width),
      truncateToWidth(` ${gauges}`, width),
    ];
  }
}

/** Footer: command hints on the left, live config summary on the right. */
export class FooterComponent implements Component {
  private hints: readonly string[];
  private mode: WorkMode;
  private access: AccessConfig;
  private themeName: string;
  private theme: Theme;

  constructor(init: {
    hints: readonly string[];
    mode: WorkMode;
    access: AccessConfig;
    themeName: string;
    theme?: Theme;
  }) {
    this.hints = init.hints;
    this.mode = init.mode;
    this.access = init.access;
    this.themeName = init.themeName;
    this.theme = init.theme ?? getTheme();
  }

  setTheme(theme: Theme): void {
    this.theme = theme;
  }

  update(patch: Partial<{ mode: WorkMode; access: AccessConfig; themeName: string }>): void {
    if (patch.mode) this.mode = patch.mode;
    if (patch.access) this.access = patch.access;
    if (patch.themeName) this.themeName = patch.themeName;
  }

  invalidate(): void {}

  render(width: number): string[] {
    const t = this.theme;
    const left = t.shortcut(this.hints.join("  "));
    const right = [
      t.dim(this.mode),
      t.dim(this.access.sandbox),
      t.faint(this.themeName),
    ].join(t.faint(" · "));
    return [padLine(joinLeftRight(` ${left}`, `${right} `, width), width)];
  }
}

export class HelpOverlayComponent implements Component {
  private theme: Theme;

  constructor(theme?: Theme) {
    this.theme = theme ?? getTheme();
  }

  setTheme(theme: Theme): void {
    this.theme = theme;
  }

  invalidate(): void {}

  render(width: number): string[] {
    const body = HELP_LINES.map((line) => (line ? this.theme.text(line) : ""));
    return frame("Help", body, width, this.theme);
  }
}

/**
 * Generic titled overlay that wraps an interactive child (SelectList / SettingsList),
 * forwarding keyboard input and framing the child in a themed box.
 */
export class OverlayPanel implements Component, Focusable {
  focused = false;
  private title: string;
  private body: Component;
  private theme: Theme;
  private hint: string;

  constructor(title: string, body: Component, theme?: Theme, hint = "↑↓ move · Enter select · Esc close") {
    this.title = title;
    this.body = body;
    this.theme = theme ?? getTheme();
    this.hint = hint;
  }

  setTheme(theme: Theme): void {
    this.theme = theme;
  }

  setTitle(title: string): void {
    this.title = title;
  }

  handleInput(data: string): void {
    (this.body as { handleInput?: (d: string) => void }).handleInput?.(data);
  }

  invalidate(): void {
    this.body.invalidate?.();
  }

  render(width: number): string[] {
    const inner = Math.max(10, width - 4);
    const bodyLines = this.body.render(inner);
    const hintLine = this.theme.faint(this.hint);
    return frame(this.title, [...bodyLines, "", hintLine], width, this.theme);
  }
}

/** Word-wrap plain text to a width, accounting for an indent on continuation lines. */
function wrap(text: string, width: number, indent: number): string[] {
  const max = Math.max(8, width - indent);
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (current.length === 0) {
      current = word;
    } else if (current.length + 1 + word.length <= max) {
      current += ` ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}
