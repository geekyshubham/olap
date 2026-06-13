import type { RoleUsage, RunEvent, RunPhase } from "../types.js";

export interface MetricsSnapshot {
  adapter: string;
  contextUsed: number;
  contextMax: number;
  tokensIn: number;
  tokensOut: number;
  efficiency: number;
  budgetUsed: number;
  budgetMax: number;
  contextPacked: boolean;
}

export function progressBar(used: number, max: number, width: number): string {
  const pct = max > 0 ? Math.min(1, used / max) : 0;
  const filled = Math.round(pct * width);
  return "█".repeat(filled) + "░".repeat(Math.max(0, width - filled));
}

/** Like progressBar but returns filled/track segments separately for theming. */
export function gauge(used: number, max: number, width: number): { fill: string; track: string } {
  const pct = max > 0 ? Math.min(1, used / max) : 0;
  const filled = Math.round(pct * width);
  return {
    fill: "█".repeat(filled),
    track: "░".repeat(Math.max(0, width - filled)),
  };
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

export function spinnerFrame(frame: number): string {
  return SPINNER_FRAMES[Math.abs(frame) % SPINNER_FRAMES.length];
}

export function formatAnimationRail(frame: number, width: number): string {
  if (width <= 0) return "";
  const active = Math.abs(frame) % width;
  return Array.from({ length: width }, (_, index) => (index === active ? "◆" : "◇")).join("");
}

export function formatShortcutDeck(items: readonly string[], width: number): string {
  const deck = items.join("  ");
  if (deck.length <= width) return deck;
  if (width <= 1) return "…";
  return `${deck.slice(0, width - 1)}…`;
}

export function percentOf(used: number, max: number): number {
  if (max <= 0) return 0;
  return Math.min(100, Math.round((used / max) * 100));
}

export function formatTokenCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 10_000) return `${Math.round(value / 1_000)}k`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

export function formatEventTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "--:--:--";
  return date.toISOString().slice(11, 19);
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes}m${rest.toString().padStart(2, "0")}s`;
}

/** Replace the home dir with ~ and truncate the middle if the path is long. */
export function shortenPath(path: string, home: string | undefined, maxWidth = 40): string {
  let display = path;
  if (home && (path === home || path.startsWith(`${home}/`))) {
    display = `~${path.slice(home.length)}`;
  }
  if (display.length <= maxWidth) return display;
  const segments = display.split("/");
  if (segments.length <= 2) return `…${display.slice(display.length - maxWidth + 1)}`;
  const tail: string[] = [];
  let length = 0;
  for (let i = segments.length - 1; i >= 0; i--) {
    const next = segments[i];
    if (length + next.length + 1 > maxWidth - 2 && tail.length > 0) break;
    tail.unshift(next);
    length += next.length + 1;
  }
  return `…/${tail.join("/")}`;
}

const PHASE_LABEL: Record<RunPhase, string> = {
  architect: "ARC",
  worker: "WRK",
};

export function formatPhaseLabel(phase: RunPhase): string {
  return PHASE_LABEL[phase];
}

export function formatModelBadge(adapter: string, model: string): string {
  return model ? `${adapter}:${model}` : adapter;
}

export function formatRoleUsage(usage: RoleUsage): string {
  return `↑${formatTokenCount(usage.tokens_in)} ↓${formatTokenCount(usage.tokens_out)} · ${usage.calls} calls`;
}

export function formatTimelineEvent(event: RunEvent, maxMessageWidth: number): string {
  const time = formatEventTime(event.ts);
  const phase = formatPhaseLabel(event.phase).padEnd(3);
  const type = event.type.padEnd(10).slice(0, 10);
  const tokens = `↑${formatTokenCount(event.tokens_in)} ↓${formatTokenCount(event.tokens_out)}`;
  const message =
    event.message.length > maxMessageWidth
      ? `${event.message.slice(0, Math.max(0, maxMessageWidth - 1))}…`
      : event.message;
  return `${time} ${phase} ${type} ${tokens}  ${message}`;
}

export function timelineMessageWidth(lineWidth: number): number {
  const reserved = "00:00:00 ARC plan     ↑1.0k ↓1.0k  ".length;
  return Math.max(8, lineWidth - reserved);
}

export function formatCompactMetrics(metrics: MetricsSnapshot): string {
  const ctxPct = percentOf(metrics.contextUsed, metrics.contextMax);
  const budgetPct = percentOf(metrics.budgetUsed, metrics.budgetMax);
  const pack = metrics.contextPacked ? "packed" : "packing";
  return [
    `ctx ${progressBar(metrics.contextUsed, metrics.contextMax, 10)} ${ctxPct}%`,
    `budget ${progressBar(metrics.budgetUsed, metrics.budgetMax, 10)} ${budgetPct}%`,
    `in ${formatTokenCount(metrics.tokensIn)} out ${formatTokenCount(metrics.tokensOut)}`,
    `eff ${metrics.efficiency.toFixed(2)}`,
    pack,
  ].join("  ");
}

export function budgetSeverity(pct: number): "ok" | "warn" | "critical" {
  if (pct >= 95) return "critical";
  if (pct >= 80) return "warn";
  return "ok";
}
