import { Editor, visibleWidth, type EditorTheme, type TUI } from "@earendil-works/pi-tui";

/**
 * Editor that drops pi-tui's redundant bottom rule while the input is empty.
 * pi-tui's Editor always draws a top AND bottom border; with an empty buffer
 * those two rules sandwich a blank line and read as a doubled separator above
 * the footer. When empty we keep only the top rule (one separator by the input).
 */
export class OlapEditor extends Editor {
  constructor(tui: TUI, theme: EditorTheme) {
    super(tui, theme);
  }

  render(width: number): string[] {
    const lines = super.render(width);
    if (this.getText() === "" && lines.length >= 2) {
      const last = lines[lines.length - 1];
      // With an empty buffer the editor's last line is either a plain horizontal
      // rule or a scroll indicator ("… more …"). Drop only the plain rule so a
      // single separator remains by the input.
      const isPlainRule =
        last.includes("─") &&
        !last.includes("more") &&
        !last.includes("↑") &&
        !last.includes("↓") &&
        visibleWidth(last) <= width;
      if (isPlainRule) {
        return lines.slice(0, -1);
      }
    }
    return lines;
  }
}