import { describe, expect, it } from "vitest";
import {
  buildArchitectCommand,
  buildWorkerCommand,
  effortArgs,
  opencodePermissionArgs,
} from "../src/adapters/build.js";
import { DEFAULT_CONFIG } from "../src/config/defaults.js";
import type { AccessConfig } from "../src/types.js";

describe("opencode adapter", () => {
  it("builds zen orchestrator run with json output", () => {
    const config = structuredClone(DEFAULT_CONFIG);
    config.roles.orchestrator = { adapter: "opencode", model: "opencode/claude-opus-4-8" };
    const cmd = buildArchitectCommand("opencode", "plan task", config, {
      id: "opencode",
      detected: true,
      binary: "/bin/opencode",
    });
    expect(cmd.argv).toContain("run");
    expect(cmd.argv).toContain("--format");
    expect(cmd.argv).toContain("json");
    expect(cmd.argv).toContain("--model");
    expect(cmd.argv).toContain("opencode/claude-opus-4-8");
    expect(cmd.argv).not.toContain("--dangerously-skip-permissions");
  });

  it("maps access policy to opencode worker permissions", () => {
    const base: AccessConfig = {
      approval: "on-failure",
      sandbox: "workspace-write",
      network: false,
    };
    expect(opencodePermissionArgs(base, "architect")).toEqual([]);
    expect(opencodePermissionArgs(base, "worker")).toEqual([]);
    expect(
      opencodePermissionArgs({ ...base, approval: "never" }, "worker"),
    ).toEqual(["--dangerously-skip-permissions"]);
    expect(
      opencodePermissionArgs({ ...base, sandbox: "danger-full-access" }, "worker"),
    ).toEqual(["--dangerously-skip-permissions"]);
  });

  it("maps effort to --variant for opencode", () => {
    expect(effortArgs("opencode", "high")).toEqual(["--variant", "high"]);
    const config = structuredClone(DEFAULT_CONFIG);
    config.roles.worker = { adapter: "opencode", model: "opencode/gpt-5.3-codex", effort: "high" };
    const cmd = buildWorkerCommand("opencode", "implement", config);
    expect(cmd.argv).toContain("--variant");
    expect(cmd.argv).toContain("high");
  });
});