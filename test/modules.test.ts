import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/config/defaults.js";
import { listModules, enabledModules } from "../src/modules/registry.js";

describe("module registry", () => {
  it("exposes the built-in Pi TUI module", () => {
    const modules = listModules(DEFAULT_CONFIG);
    expect(modules).toContainEqual(
      expect.objectContaining({
        name: "pi-tui",
        package: "@earendil-works/pi-tui",
        source: "built-in",
        enabled: true,
      }),
    );
  });

  it("includes configured Pi modules", () => {
    const config = {
      ...DEFAULT_CONFIG,
      modules: [
        {
          name: "review-skill-pack",
          kind: "skill",
          enabled: true,
          package: "@example/pi-review-skills",
        },
        {
          name: "quiet-theme",
          kind: "theme",
          enabled: false,
          entry: "./themes/quiet.ts",
        },
      ],
    };
    const modules = listModules(config);

    expect(modules).toContainEqual(
      expect.objectContaining({
        name: "review-skill-pack",
        kind: "skill",
        source: "config",
      }),
    );
    expect(enabledModules(config).map((module) => module.name)).not.toContain("quiet-theme");
  });
});
