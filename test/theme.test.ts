import { afterEach, describe, expect, it } from "vitest";
import {
  color,
  getTheme,
  getThemeByName,
  listThemes,
  makeEditorTheme,
  makeSelectListTheme,
  makeSettingsListTheme,
  nextThemeName,
  setTheme,
  themeNames,
} from "../src/tui/theme.js";

afterEach(() => {
  setTheme("olap-dark");
});

describe("theme registry", () => {
  it("registers the expected themes", () => {
    const names = themeNames();
    expect(names).toContain("olap-dark");
    expect(names).toContain("grok-night");
    expect(names).toContain("mono");
    expect(names).toContain("solarized-dark");
    expect(names).toContain("light");
    expect(listThemes().length).toBe(names.length);
  });

  it("switches active theme and ignores unknown names", () => {
    expect(setTheme("grok-night").name).toBe("grok-night");
    expect(getTheme().name).toBe("grok-night");
    expect(setTheme("does-not-exist").name).toBe("grok-night");
    expect(getThemeByName("mono")?.name).toBe("mono");
  });

  it("cycles to the next theme", () => {
    const names = themeNames();
    expect(nextThemeName(names[0])).toBe(names[1]);
    expect(nextThemeName(names[names.length - 1])).toBe(names[0]);
  });

  it("produces 24-bit color escapes", () => {
    expect(color("#ff0000")("x")).toContain("\x1b[38;2;255;0;0m");
    expect(color("#00ff00", true)("x")).toContain("\x1b[1;38;2;0;255;0m");
  });

  it("derives editor, select, and settings themes", () => {
    const theme = getTheme();
    const editor = makeEditorTheme(theme);
    expect(typeof editor.borderColor).toBe("function");
    expect(typeof editor.selectList.selectedPrefix).toBe("function");

    const select = makeSelectListTheme(theme);
    expect(typeof select.description).toBe("function");

    const settings = makeSettingsListTheme(theme);
    expect(typeof settings.cursor).toBe("string");
    expect(typeof settings.label).toBe("function");
  });
});
