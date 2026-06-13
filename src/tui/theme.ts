import type { EditorTheme } from "@earendil-works/pi-tui";

export type Style = (s: string) => string;

export interface Palette {
  name: string;
  label: string;
  fg: string;
  dim: string;
  faint: string;
  accent: string;
  accent2: string;
  orchestrator: string;
  worker: string;
  success: string;
  warn: string;
  error: string;
  info: string;
  border: string;
  bar: string;
  barTrack: string;
}

export interface Theme {
  name: string;
  label: string;
  palette: Palette;
  title: Style;
  subtitle: Style;
  accent: Style;
  accent2: Style;
  text: Style;
  dim: Style;
  faint: Style;
  success: Style;
  warn: Style;
  error: Style;
  info: Style;
  orchestrator: Style;
  worker: Style;
  border: Style;
  time: Style;
  type: Style;
  tokens: Style;
  shortcut: Style;
  bar: Style;
  barTrack: Style;
  spinner: Style;
}

function rgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  const value = Number.parseInt(clean, 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** Build a 24-bit color style; `bold` adds the SGR bold attribute. */
export function color(hex: string, bold = false): Style {
  const [r, g, b] = rgb(hex);
  const prefix = bold ? `\x1b[1;38;2;${r};${g};${b}m` : `\x1b[38;2;${r};${g};${b}m`;
  return (s: string) => `${prefix}${s}\x1b[0m`;
}

export const PALETTES: Palette[] = [
  {
    name: "olap-dark",
    label: "OLAP Dark",
    fg: "#d4d7dd",
    dim: "#8b90a0",
    faint: "#5a5f6e",
    accent: "#41d1c7",
    accent2: "#6aa9ff",
    orchestrator: "#c792ea",
    worker: "#7ee787",
    success: "#7ee787",
    warn: "#f2cc60",
    error: "#ff7b72",
    info: "#6aa9ff",
    border: "#3a3f4b",
    bar: "#41d1c7",
    barTrack: "#2a2e38",
  },
  {
    name: "grok-night",
    label: "Grok Night",
    fg: "#e8e6f0",
    dim: "#9a92b5",
    faint: "#635b7d",
    accent: "#b388ff",
    accent2: "#ff79c6",
    orchestrator: "#bd93f9",
    worker: "#50fa7b",
    success: "#50fa7b",
    warn: "#f1fa8c",
    error: "#ff5555",
    info: "#8be9fd",
    border: "#44415a",
    bar: "#b388ff",
    barTrack: "#2d2a3e",
  },
  {
    name: "mono",
    label: "Monochrome",
    fg: "#e6e6e6",
    dim: "#9e9e9e",
    faint: "#6b6b6b",
    accent: "#ffffff",
    accent2: "#cfcfcf",
    orchestrator: "#d6d6d6",
    worker: "#b4b4b4",
    success: "#cccccc",
    warn: "#bdbdbd",
    error: "#f4f4f4",
    info: "#cfcfcf",
    border: "#4a4a4a",
    bar: "#d0d0d0",
    barTrack: "#333333",
  },
  {
    name: "solarized-dark",
    label: "Solarized Dark",
    fg: "#93a1a1",
    dim: "#657b83",
    faint: "#586e75",
    accent: "#2aa198",
    accent2: "#268bd2",
    orchestrator: "#6c71c4",
    worker: "#859900",
    success: "#859900",
    warn: "#b58900",
    error: "#dc322f",
    info: "#268bd2",
    border: "#0a4f57",
    bar: "#2aa198",
    barTrack: "#073642",
  },
  {
    name: "light",
    label: "Daylight",
    fg: "#2b2f36",
    dim: "#5c6370",
    faint: "#9aa0ad",
    accent: "#0a7ea4",
    accent2: "#2660a4",
    orchestrator: "#7b3fb5",
    worker: "#1f8a4c",
    success: "#1f8a4c",
    warn: "#b06d00",
    error: "#c0392b",
    info: "#2660a4",
    border: "#c5cad3",
    bar: "#0a7ea4",
    barTrack: "#e1e4ea",
  },
];

export function makeTheme(palette: Palette): Theme {
  return {
    name: palette.name,
    label: palette.label,
    palette,
    title: color(palette.accent, true),
    subtitle: color(palette.dim),
    accent: color(palette.accent),
    accent2: color(palette.accent2),
    text: color(palette.fg),
    dim: color(palette.dim),
    faint: color(palette.faint),
    success: color(palette.success),
    warn: color(palette.warn),
    error: color(palette.error),
    info: color(palette.info),
    orchestrator: color(palette.orchestrator),
    worker: color(palette.worker),
    border: color(palette.border),
    time: color(palette.faint),
    type: color(palette.accent2),
    tokens: color(palette.dim),
    shortcut: color(palette.dim),
    bar: color(palette.bar),
    barTrack: color(palette.barTrack),
    spinner: color(palette.accent, true),
  };
}

const THEME_REGISTRY = new Map<string, Theme>(
  PALETTES.map((palette) => [palette.name, makeTheme(palette)]),
);

let activeTheme: Theme = THEME_REGISTRY.get("olap-dark") ?? makeTheme(PALETTES[0]);

export function getTheme(): Theme {
  return activeTheme;
}

export function setTheme(name: string): Theme {
  const next = THEME_REGISTRY.get(name);
  if (next) activeTheme = next;
  return activeTheme;
}

export function getThemeByName(name: string): Theme | undefined {
  return THEME_REGISTRY.get(name);
}

export function listThemes(): Theme[] {
  return [...THEME_REGISTRY.values()];
}

export function themeNames(): string[] {
  return [...THEME_REGISTRY.keys()];
}

/** Cycle to the next theme name in registry order. */
export function nextThemeName(current: string): string {
  const names = themeNames();
  const index = names.indexOf(current);
  return names[(index + 1) % names.length];
}

export function makeEditorTheme(theme: Theme): EditorTheme {
  return {
    borderColor: theme.border,
    selectList: {
      selectedPrefix: theme.accent,
      selectedText: theme.title,
      description: theme.dim,
      scrollInfo: theme.faint,
      noMatch: theme.faint,
    },
  };
}

/** A faded clone of a theme: nearly all colors collapse to the faint tone,
 *  used to dim the background chrome while an overlay is open. */
export function mutedThemeFor(theme: Theme): Theme {
  const p = theme.palette;
  const f = p.faint;
  return makeTheme({
    ...p,
    name: `${p.name}-muted`,
    fg: f,
    dim: f,
    accent: f,
    accent2: f,
    orchestrator: f,
    worker: f,
    success: f,
    warn: f,
    error: f,
    info: f,
    bar: f,
    barTrack: p.barTrack,
    border: f,
  });
}

export function makeSelectListTheme(theme: Theme) {
  return {
    selectedPrefix: theme.accent,
    selectedText: theme.title,
    description: theme.dim,
    scrollInfo: theme.faint,
    noMatch: theme.faint,
  };
}

export function makeSettingsListTheme(theme: Theme) {
  return {
    label: (text: string, selected: boolean) => (selected ? theme.title(text) : theme.text(text)),
    value: (text: string, selected: boolean) =>
      selected ? theme.accent(text) : theme.dim(text),
    description: theme.dim,
    cursor: theme.accent("›"),
    hint: theme.faint,
  };
}
