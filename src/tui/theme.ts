import type { EditorTheme } from "@earendil-works/pi-tui";

const dim = (s: string) => `\x1b[90m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const magenta = (s: string) => `\x1b[35m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;

export const olapTheme = {
  header: (s: string) => bold(cyan(s)),
  subheader: (s: string) => dim(s),
  accent: (s: string) => cyan(s),
  success: (s: string) => green(s),
  muted: (s: string) => dim(s),
  panel: (s: string) => dim(s),
  time: (s: string) => dim(s),
  type: (s: string) => yellow(s),
  tokens: (s: string) => dim(s),
  architect: (s: string) => magenta(s),
  worker: (s: string) => green(s),
  footer: (s: string) => dim(s),
  rule: (s: string) => dim(s),
  shortcut: (s: string) => yellow(s),
  budgetOk: (s: string) => green(s),
  budgetWarn: (s: string) => yellow(s),
  budgetCritical: (s: string) => red(s),
};

export const editorTheme: EditorTheme = {
  borderColor: (s) => dim(s),
  selectList: {
    selectedPrefix: (s) => cyan(s),
    selectedText: (s) => bold(s),
    description: (s) => dim(s),
    scrollInfo: (s) => dim(s),
    noMatch: (s) => dim(s),
  },
};
