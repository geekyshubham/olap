import { matchesKey } from "@earendil-works/pi-tui";

export interface KeyboardAction {
  type: "quit" | "clear-output" | "toggle-help" | "focus-input";
}

export function resolveGlobalKey(data: string): KeyboardAction | undefined {
  if (matchesKey(data, "ctrl+c")) return { type: "quit" };
  if (matchesKey(data, "ctrl+l")) return { type: "clear-output" };
  if (matchesKey(data, "escape")) return { type: "toggle-help" };
  if (matchesKey(data, "ctrl+o")) return { type: "focus-input" };
  return undefined;
}

export const SHORTCUT_HINTS = [
  "^C quit",
  "^L clear timeline",
  "^O focus input",
  "Esc help",
  "Enter submit",
  "/help commands",
] as const;

export const HELP_LINES = [
  "OLAP harness - architect/worker orchestration (simulated, no paid model calls).",
  "",
  "Submit any coding task to run a compact architect plan plus worker iterations.",
  "Artifacts are written to .olap/runs/<run-id>/ after each submission.",
  "",
  "Commands:",
  "  /help     Show this overlay",
  "  /clear    Reset timeline and metrics",
  "",
  "Shortcuts:",
  "  Ctrl+C    Quit",
  "  Ctrl+L    Clear timeline output",
  "  Ctrl+O    Focus task input",
  "  Escape    Toggle help overlay",
  "  Enter     Submit task from editor",
] as const;
