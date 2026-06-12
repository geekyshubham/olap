import { describe, expect, it } from "vitest";
import { allValidatorsPassed, runValidators } from "../src/validators/runner.js";
import { createTempDir, writeFakeBinary } from "./helpers.js";

describe("validators", () => {
  it("runs validators from config using fake PATH binaries", async () => {
    const cwd = await createTempDir();
    const binDir = await createTempDir("olap-val-bin-");
    await writeFakeBinary(binDir, "ok-validator", '#!/bin/sh\nexit 0\n');
    await writeFakeBinary(binDir, "fail-validator", '#!/bin/sh\necho "nope" 1>&2\nexit 2\n');

    const previousPath = process.env.PATH;
    process.env.PATH = `${binDir}:/usr/bin:/bin`;

    try {
      const results = await runValidators(
        [
          { name: "ok", command: "ok-validator" },
          { name: "bad", command: "fail-validator" },
        ],
        cwd,
      );

      expect(results[0].ok).toBe(true);
      expect(results[1].ok).toBe(false);
      expect(results[1].stderr).toContain("nope");
      expect(allValidatorsPassed(results)).toBe(false);
      expect(allValidatorsPassed([results[0]])).toBe(true);
    } finally {
      process.env.PATH = previousPath;
    }
  });
});