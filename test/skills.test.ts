import { describe, expect, it } from "vitest";
import { SkillLoader } from "../src/skills/loader.js";

describe("SkillLoader", () => {
  it("loads bundled architect skill", async () => {
    const loader = new SkillLoader();
    const content = await loader.loadSkills(["architect"]);
    expect(content).toContain("Architect");
  });

  it("lists available skills", async () => {
    const loader = new SkillLoader();
    const names = await loader.listAvailable();
    expect(names).toContain("review");
    expect(names).toContain("qa");
  });
});