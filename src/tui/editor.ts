import { Editor, type EditorTheme, type TUI } from "@earendil-works/pi-tui";
import { makeEditorTheme, type Theme } from "./theme.js";

/**
 * Editor wrapper that supports live theming of the border + autocomplete list.
 * It keeps pi-tui's full input box (a rule above and below the prompt) so the
 * input area is clearly bordered.
 */
export class OlapEditor extends Editor {
  constructor(tui: TUI, theme: EditorTheme) {
    super(tui, theme);
  }

  /** Apply a new theme to the border and slash-command autocomplete list. */
  applyTheme(theme: Theme): void {
    const editorTheme = makeEditorTheme(theme);
    this.borderColor = editorTheme.borderColor;
    (this as unknown as { theme: EditorTheme }).theme = editorTheme;
  }
}