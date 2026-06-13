import { describe, expect, it } from "vitest";
import { visibleWidth, type Component } from "@earendil-works/pi-tui";
import { OlapSettingsList, type OlapSettingItem } from "../src/tui/settings-list.js";
import { getTheme } from "../src/tui/theme.js";

const theme = getTheme();
const UP = "\x1b[A";
const DOWN = "\x1b[B";
const LEFT = "\x1b[D";
const RIGHT = "\x1b[C";
const ENTER = "\r";
const ESC = "\x1b";

function valueItems(): OlapSettingItem[] {
  return [
    { id: "a", label: "Alpha", value: "x", values: ["x", "y", "z"] },
    { id: "b", label: "Beta", value: "1", values: ["1", "2"] },
  ];
}

describe("OlapSettingsList", () => {
  it("cycles the selected value with left/right arrows", () => {
    const changes: [string, string][] = [];
    const list = new OlapSettingsList(valueItems(), theme, (id, v) => changes.push([id, v]), () => {});
    list.handleInput(RIGHT);
    expect(changes.at(-1)).toEqual(["a", "y"]);
    list.handleInput(LEFT);
    expect(changes.at(-1)).toEqual(["a", "x"]);
    list.handleInput(LEFT); // wraps backward
    expect(changes.at(-1)).toEqual(["a", "z"]);
  });

  it("navigates rows with up/down and cycles the focused row", () => {
    const changes: [string, string][] = [];
    const list = new OlapSettingsList(valueItems(), theme, (id, v) => changes.push([id, v]), () => {});
    list.handleInput(DOWN);
    list.handleInput(RIGHT);
    expect(changes.at(-1)).toEqual(["b", "2"]);
    list.handleInput(UP);
    list.handleInput(RIGHT);
    expect(changes.at(-1)?.[0]).toBe("a");
  });

  it("honors focusId for the initial selection", () => {
    const changes: [string, string][] = [];
    const list = new OlapSettingsList(valueItems(), theme, (id, v) => changes.push([id, v]), () => {}, 12, "b");
    list.handleInput(RIGHT);
    expect(changes.at(-1)?.[0]).toBe("b");
  });

  it("updateValue reflects in the render", () => {
    const list = new OlapSettingsList(valueItems(), theme, () => {}, () => {});
    list.updateValue("a", "z");
    expect(list.render(60).join("\n")).toContain("z");
  });

  it("opens a submenu on Enter and applies its selection", () => {
    const changes: [string, string][] = [];
    let opened = false;
    const submenu: Component = {
      render: () => ["SUBMENU"],
      handleInput: (d) => {
        if (d === ENTER) done?.("new-model");
      },
      invalidate: () => {},
    };
    let done: ((v?: string) => void) | undefined;
    const items: OlapSettingItem[] = [
      {
        id: "m",
        label: "Model",
        value: "old",
        submenu: (_cur, cb) => {
          opened = true;
          done = cb;
          return submenu;
        },
      },
    ];
    const list = new OlapSettingsList(items, theme, (id, v) => changes.push([id, v]), () => {});
    list.handleInput(ENTER);
    expect(opened).toBe(true);
    expect(list.render(40).join("")).toContain("SUBMENU");
    list.handleInput(ENTER); // delegated to submenu → done("new-model")
    expect(changes.at(-1)).toEqual(["m", "new-model"]);
    // back on the main list after submenu closes
    expect(list.render(40).join("")).toContain("Model");
  });

  it("calls onCancel on Escape and stays width-safe", () => {
    let cancelled = false;
    const list = new OlapSettingsList(valueItems(), theme, () => {}, () => (cancelled = true));
    for (const width of [30, 60, 100]) {
      for (const line of list.render(width)) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
    }
    list.handleInput(ESC);
    expect(cancelled).toBe(true);
  });
});
