import { describe, expect, it } from "vitest";
import {
  buildArchitectCommand,
  buildWorkerCommand,
  effortArgs,
  finalizeAdapterCommand,
  kiroTrustArgs,
} from "../src/adapters/build.js";
import { DEFAULT_CONFIG } from "../src/config/defaults.js";
import type { AccessConfig, OlapConfig } from "../src/types.js";

function withAccess(access: Partial<AccessConfig>): OlapConfig {
  const config = structuredClone(DEFAULT_CONFIG);
  config.access = { ...config.access, ...access };
  return config;
}

describe("kiro adapter", () => {
  it("builds a non-interactive read-only architect command", () => {
    const cmd = finalizeAdapterCommand(
      buildArchitectCommand("kiro", "plan this", DEFAULT_CONFIG, {
        id: "kiro",
        detected: true,
        binary: "/bin/kiro-cli",
      }),
    );
    expect(cmd.argv).toContain("chat");
    expect(cmd.argv).toContain("--no-interactive");
    expect(cmd.argv).toContain("--trust-tools=fs_read");
    expect(cmd.argv).toContain("plan this");
    // No --model when the role's adapter isn't kiro (defers to Kiro's default)
    expect(cmd.argv).not.toContain("--model");
    expect(cmd.shell).toContain("/bin/kiro-cli");
  });

  it("passes --model when the role pins a kiro model", () => {
    const config = structuredClone(DEFAULT_CONFIG);
    config.roles.orchestrator = { adapter: "kiro", model: "claude-opus-4.8" };
    const cmd = buildArchitectCommand("kiro", "plan", config);
    expect(cmd.argv).toContain("--model");
    expect(cmd.argv).toContain("claude-opus-4.8");
  });

  it("maps access policy to kiro trust flags for the worker", () => {
    const def = buildWorkerCommand("kiro", "do it", DEFAULT_CONFIG);
    expect(def.argv).toContain("--trust-tools=fs_read,fs_write");

    const trustAll = buildWorkerCommand("kiro", "do it", withAccess({ approval: "never" }));
    expect(trustAll.argv).toContain("--trust-all-tools");

    const readOnly = buildWorkerCommand("kiro", "do it", withAccess({ sandbox: "read-only" }));
    expect(readOnly.argv).toContain("--trust-tools=fs_read");

    const untrusted = buildWorkerCommand("kiro", "do it", withAccess({ approval: "untrusted" }));
    expect(untrusted.argv).toContain("--trust-tools=");
  });

  it("kiroTrustArgs covers the policy table", () => {
    const base: AccessConfig = {
      approval: "on-failure",
      sandbox: "workspace-write",
      network: false,
    };
    expect(kiroTrustArgs(base, "architect")).toEqual(["--trust-tools=fs_read"]);
    expect(kiroTrustArgs(base, "worker")).toEqual(["--trust-tools=fs_read,fs_write"]);
    expect(kiroTrustArgs({ ...base, sandbox: "danger-full-access" }, "worker")).toEqual([
      "--trust-all-tools",
    ]);
  });

  it("maps effort per adapter and embeds it in commands", () => {
    expect(effortArgs("kiro", "high")).toEqual(["--effort", "high"]);
    expect(effortArgs("claude", "max")).toEqual(["--effort", "max"]);
    expect(effortArgs("codex", "max")).toEqual(["-c", 'model_reasoning_effort="high"']);
    expect(effortArgs("grok", "high")).toEqual([]);
    expect(effortArgs("kiro", "default")).toEqual([]);

    const config = structuredClone(DEFAULT_CONFIG);
    config.roles.worker = { adapter: "kiro", model: "", effort: "high" };
    const cmd = buildWorkerCommand("kiro", "do it", config);
    expect(cmd.argv).toContain("--effort");
    expect(cmd.argv).toContain("high");
  });
});
