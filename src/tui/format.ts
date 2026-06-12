import type { RunEvent, RunPhase } from "../types.js";

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

const PHASE_LABEL: Record<RunPhase, string> = {
  architect: "ARC",
  worker: "WRK",
};

export function formatPhaseLabel(phase: RunPhase): string {
  return PHASE_LABEL[phase];
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
  ].join(" │ ");
}

export function formatAdapterLine(metrics: MetricsSnapshot): string {
  return `adapter ${metrics.adapter} │ context ${metrics.contextUsed}/${metrics.contextMax} │ architect budget ${metrics.budgetUsed}/${metrics.budgetMax}`;
}

export function budgetSeverity(pct: number): "ok" | "warn" | "critical" {
  if (pct >= 95) return "critical";
  if (pct >= 80) return "warn";
  return "ok";
}
