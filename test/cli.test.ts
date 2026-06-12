import { describe, expect, it } from "vitest";
import { createCliProgram } from "../src/cli.js";

describe("cli", () => {
  it("starts the TUI when no command is provided", async () => {
    let started = false;
    const program = createCliProgram({
      startTui: async () => {
        started = true;
      },
    });

    await program.parseAsync(["node", "olap"], { from: "node" });

    expect(started).toBe(true);
  });
});
