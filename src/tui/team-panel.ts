import { truncateToWidth, type Component } from "@earendil-works/pi-tui";
import type { Agent } from "../domain/agent.js";
import type { Task } from "../domain/task.js";
import { getTheme, type Theme } from "./theme.js";

export interface TeamPanelSnapshot {
  agents: Agent[];
  tasks: Task[];
  running: number;
  queued: number;
  watchActive: boolean;
}

const STATUS_ICON: Record<string, string> = {
  running: "▶",
  idle: "○",
  error: "✗",
  disabled: "—",
  in_progress: "▶",
  todo: "◇",
  review: "◎",
  done: "✓",
  failed: "✗",
  retrying: "↻",
};

export class TeamPanelComponent implements Component {
  private snapshot: TeamPanelSnapshot = {
    agents: [],
    tasks: [],
    running: 0,
    queued: 0,
    watchActive: false,
  };
  private theme: Theme;

  constructor(theme?: Theme) {
    this.theme = theme ?? getTheme();
  }

  setTheme(theme: Theme): void {
    this.theme = theme;
  }

  invalidate(): void {
    // static render from snapshot
  }

  update(snapshot: Partial<TeamPanelSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...snapshot };
  }

  render(width: number): string[] {
    const t = this.theme;
    const lines: string[] = [];
    const watch = this.snapshot.watchActive
      ? t.accent("WATCH")
      : t.faint("watch off");
    lines.push(
      truncateToWidth(
        `${t.title("Team")} ${watch}  ${t.dim(`running ${this.snapshot.running} · queued ${this.snapshot.queued}`)}`,
        width,
      ),
    );

    const agents = this.snapshot.agents.slice(0, 6);
    if (agents.length === 0) {
      lines.push(t.faint(truncateToWidth("  Deploy: olap org deploy startup-mvp", width)));
    } else {
      for (const a of agents) {
        const icon = STATUS_ICON[a.status] ?? "·";
        const task = a.current_task ? t.dim(` → ${a.current_task.slice(0, 12)}`) : "";
        lines.push(
          truncateToWidth(
            `  ${t.accent(icon)} ${a.name} ${t.dim(`(${a.display_role})`)}${task}`,
            width,
          ),
        );
      }
    }

    const tasks = this.snapshot.tasks
      .filter((tk) => tk.status !== "done" && tk.status !== "cancelled")
      .slice(0, 4);
    if (tasks.length > 0) {
      lines.push(t.dim(truncateToWidth("  Tasks:", width)));
      for (const tk of tasks) {
        const icon = STATUS_ICON[tk.status] ?? "·";
        lines.push(
          truncateToWidth(`    ${icon} ${tk.title.slice(0, Math.max(10, width - 20))}`, width),
        );
      }
    }
    return lines;
  }
}