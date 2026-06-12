import {
  truncateToWidth,
  visibleWidth,
  type Component,
} from "@earendil-works/pi-tui";
import type { RunEvent } from "../types.js";
import {
  budgetSeverity,
  formatAdapterLine,
  formatCompactMetrics,
  formatTimelineEvent,
  percentOf,
  progressBar,
  timelineMessageWidth,
  type MetricsSnapshot,
} from "./format.js";
import { HELP_LINES, SHORTCUT_HINTS } from "./keyboard.js";
import { olapTheme } from "./theme.js";

export class HeaderComponent implements Component {
  constructor(
    private title: string,
    private status: "idle" | "running" | "done" = "idle",
  ) {}

  setTitle(title: string): void {
    this.title = title;
  }

  setStatus(status: "idle" | "running" | "done"): void {
    this.status = status;
  }

  invalidate(): void {}

  render(width: number): string[] {
    const brand = olapTheme.header(" OLAP ");
    const tag = olapTheme.subheader(" architect/worker harness ");
    const statusBadge =
      this.status === "running"
        ? olapTheme.budgetWarn(" ● running ")
        : this.status === "done"
          ? olapTheme.success(" ✓ done ")
          : olapTheme.muted(" ○ idle ");
    const title = olapTheme.accent(` ${this.title} `);
    const top = padLine(`${brand}${tag}${statusBadge}${title}`, width);
    const rule = olapTheme.rule("─".repeat(Math.max(0, width)));
    return [top, rule];
  }
}

export class TimelineComponent implements Component {
  constructor(private events: RunEvent[] = []) {}

  setEvents(events: RunEvent[]): void {
    this.events = events;
  }

  clear(): void {
    this.events = [];
  }

  invalidate(): void {}

  render(width: number): string[] {
    const inner = Math.max(20, width - 4);
    const header = olapTheme.accent(" Timeline ");
    const borderTop = olapTheme.panel(
      `┌${header}${"─".repeat(Math.max(0, inner - visibleWidth(header) - 1))}┐`,
    );

    if (this.events.length === 0) {
      const empty = [
        olapTheme.muted(" Waiting for a task... "),
        olapTheme.footer(" Architect replies stay compact; workers carry verbose implementation. "),
      ];
      return [borderTop, ...empty.map((line) => panelLine(line, inner)), panelBottom(inner)];
    }

    const latest = this.events.slice(-10);
    const hidden = this.events.length - latest.length;
    const msgWidth = timelineMessageWidth(inner);
    const lines = latest.map((event) => {
      const row = formatTimelineEvent(event, msgWidth);
      const [time, phase, type, ...rest] = row.split(" ");
      const tokensAndMessage = rest.join(" ");
      const [tokens, ...messageParts] = tokensAndMessage.split("  ");
      const message = messageParts.join("  ");
      const phaseStyled =
        event.phase === "architect"
          ? olapTheme.architect(phase)
          : olapTheme.worker(phase);

      const styled = [
        olapTheme.time(time),
        phaseStyled,
        olapTheme.type(type),
        olapTheme.tokens(tokens),
        message,
      ].join(" ");

      return panelLine(truncateToWidth(styled, inner), inner);
    });

    if (hidden > 0) {
      lines.unshift(
        panelLine(olapTheme.footer(` ...${hidden} earlier events compacted `), inner),
      );
    }

    return [borderTop, ...lines, panelBottom(inner)];
  }
}

export class StatusFooterComponent implements Component {
  private metrics: MetricsSnapshot;

  constructor(metrics: MetricsSnapshot) {
    this.metrics = metrics;
  }

  update(metrics: MetricsSnapshot): void {
    this.metrics = metrics;
  }

  reset(metrics: MetricsSnapshot): void {
    this.metrics = metrics;
  }

  invalidate(): void {}

  render(width: number): string[] {
    const compact = truncateToWidth(
      olapTheme.footer(formatCompactMetrics(this.metrics)),
      width,
    );
    const budgetPct = percentOf(this.metrics.budgetUsed, this.metrics.budgetMax);
    const severity = budgetSeverity(budgetPct);
    const budgetStyle =
      severity === "critical"
        ? olapTheme.budgetCritical
        : severity === "warn"
          ? olapTheme.budgetWarn
          : olapTheme.budgetOk;

    const budgetDetail = truncateToWidth(
      budgetStyle(
        ` architect ${progressBar(this.metrics.budgetUsed, this.metrics.budgetMax, 16)} ${this.metrics.budgetUsed}/${this.metrics.budgetMax} (${budgetPct}%) `,
      ),
      width,
    );
    const adapterLine = truncateToWidth(
      olapTheme.footer(formatAdapterLine(this.metrics)),
      width,
    );

    return [compact, budgetDetail, adapterLine];
  }
}

export class ShortcutsComponent implements Component {
  invalidate(): void {}

  render(width: number): string[] {
    const hints = SHORTCUT_HINTS.join(" │ ");
    return [
      truncateToWidth(olapTheme.shortcut(` ${hints} `), width),
      truncateToWidth(
        olapTheme.footer(" Describe a coding task below - simulated loop, zero external model spend. "),
        width,
      ),
    ];
  }
}

export class HelpOverlayComponent implements Component {
  invalidate(): void {}

  render(width: number): string[] {
    const inner = Math.max(40, Math.min(width - 4, 72));
    const title = olapTheme.accent(" Help ");
    const top = olapTheme.panel(
      `╭${title}${"─".repeat(Math.max(0, inner - visibleWidth(title) - 1))}╮`,
    );
    const body = HELP_LINES.map((line) =>
      panelLine(line ? olapTheme.footer(` ${line} `) : olapTheme.footer(" "), inner),
    );
    return [top, ...body, panelBottom(inner, "╰", "╯")];
  }
}

export function panelLine(content: string, innerWidth: number): string {
  const line = `│ ${truncateToWidth(content, innerWidth)} `;
  const pad = Math.max(0, innerWidth + 2 - visibleWidth(line));
  return olapTheme.panel(line + " ".repeat(pad) + "│");
}

export function panelBottom(innerWidth: number, left = "└", right = "┘"): string {
  return olapTheme.panel(`${left}${"─".repeat(innerWidth + 2)}${right}`);
}

export function padLine(line: string, width: number): string {
  const visible = visibleWidth(line);
  if (visible >= width) return truncateToWidth(line, width);
  return line + " ".repeat(width - visible);
}
