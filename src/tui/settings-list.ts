import {
  matchesKey,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
  type Component,
} from "@earendil-works/pi-tui";
import type { Theme } from "./theme.js";

export interface OlapSettingItem {
  id: string;
  label: string;
  description?: string;
  /** Current display value (right column). */
  value: string;
  /** If present, LEFT/RIGHT (and Enter) cycle through these values. */
  values?: string[];
  /** If present, Enter opens this submenu (e.g. a model picker). */
  submenu?: (current: string, done: (value?: string) => void) => Component;
}

/**
 * Settings panel with up/down row navigation and LEFT/RIGHT value cycling.
 * Enter opens submenus (or cycles a value forward). Initial focus is set by id,
 * directly (no synthetic key presses), so slash commands land on the right row.
 */
export class OlapSettingsList implements Component {
  private index: number;
  private submenu: Component | null = null;
  private submenuReturnIndex: number | null = null;

  constructor(
    private items: OlapSettingItem[],
    private theme: Theme,
    private onChange: (id: string, value: string) => void,
    private onCancel: () => void,
    private maxVisible = 12,
    focusId?: string,
  ) {
    const target = focusId ? items.findIndex((item) => item.id === focusId) : 0;
    this.index = target >= 0 ? target : 0;
  }

  setTheme(theme: Theme): void {
    this.theme = theme;
  }

  updateValue(id: string, value: string): void {
    const item = this.items.find((it) => it.id === id);
    if (item) item.value = value;
  }

  invalidate(): void {
    this.submenu?.invalidate?.();
  }

  private cycle(direction: 1 | -1): void {
    const item = this.items[this.index];
    if (!item?.values || item.values.length === 0) return;
    const current = item.values.indexOf(item.value);
    const base = current < 0 ? 0 : current;
    const next = (base + direction + item.values.length) % item.values.length;
    item.value = item.values[next];
    this.onChange(item.id, item.value);
  }

  private activate(): void {
    const item = this.items[this.index];
    if (!item) return;
    if (item.submenu) {
      this.submenuReturnIndex = this.index;
      this.submenu = item.submenu(item.value, (value) => {
        if (value !== undefined) {
          item.value = value;
          this.onChange(item.id, value);
        }
        this.submenu = null;
        if (this.submenuReturnIndex !== null) {
          this.index = this.submenuReturnIndex;
          this.submenuReturnIndex = null;
        }
      });
    } else if (item.values && item.values.length > 0) {
      this.cycle(1);
    }
  }

  handleInput(data: string): void {
    if (this.submenu) {
      this.submenu.handleInput?.(data);
      return;
    }
    if (matchesKey(data, "up")) {
      this.index = this.index === 0 ? this.items.length - 1 : this.index - 1;
    } else if (matchesKey(data, "down")) {
      this.index = this.index === this.items.length - 1 ? 0 : this.index + 1;
    } else if (matchesKey(data, "left")) {
      this.cycle(-1);
    } else if (matchesKey(data, "right")) {
      this.cycle(1);
    } else if (matchesKey(data, "enter") || matchesKey(data, "space")) {
      this.activate();
    } else if (matchesKey(data, "escape")) {
      this.onCancel();
    }
  }

  render(width: number): string[] {
    if (this.submenu) return this.submenu.render(width);
    const t = this.theme;
    const count = this.items.length;
    const start = Math.max(0, Math.min(this.index - Math.floor(this.maxVisible / 2), count - this.maxVisible));
    const startIndex = Math.max(0, start);
    const endIndex = Math.min(startIndex + this.maxVisible, count);
    const maxLabel = Math.min(26, Math.max(...this.items.map((item) => visibleWidth(item.label))));

    const lines: string[] = [];
    for (let i = startIndex; i < endIndex; i++) {
      const item = this.items[i];
      const selected = i === this.index;
      const cursor = selected ? t.accent("›") : " ";
      const label = (selected ? t.title : t.text)(item.label.padEnd(maxLabel));
      let value: string;
      if (selected && item.values && item.values.length > 0) {
        value = `${t.faint("‹")} ${t.accent(item.value)} ${t.faint("›")}`;
      } else if (selected && item.submenu) {
        value = `${t.accent(item.value)} ${t.faint("⏎")}`;
      } else {
        value = selected ? t.accent(item.value) : t.dim(item.value);
      }
      lines.push(truncateToWidth(`${cursor} ${label}  ${value}`, width));
    }

    if (startIndex > 0 || endIndex < count) {
      lines.push(truncateToWidth(t.faint(`   (${this.index + 1}/${count})`), width));
    }

    const selectedItem = this.items[this.index];
    if (selectedItem?.description) {
      lines.push("");
      for (const line of wrapTextWithAnsi(selectedItem.description, Math.max(8, width - 2))) {
        lines.push(truncateToWidth(t.dim(`  ${line}`), width));
      }
    }
    return lines;
  }
}
