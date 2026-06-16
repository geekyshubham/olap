import { describe, expect, it } from "vitest";
import { getTeamTemplate, resolveJobModel } from "../src/templates/teams.js";
import { cloneConfig } from "../src/config/read.js";

describe("team templates", () => {
  it("includes startup-mvp", () => {
    const t = getTeamTemplate("startup-mvp");
    expect(t?.agents.some((a) => a.display_role.includes("QA"))).toBe(true);
    expect(t?.agents.some((a) => a.job_type === "reviewer")).toBe(true);
  });

  it("resolves job models from config", () => {
    const config = cloneConfig();
    const worker = resolveJobModel(config, "worker");
    expect(worker.adapter).toBe("grok");
    expect(worker.model).toBe("grok-composer-2.5-fast");
    const architect = resolveJobModel(config, "architect");
    expect(architect.adapter).toBe("kiro");
    expect(architect.model).toBe("claude-opus-4.8");
  });
});