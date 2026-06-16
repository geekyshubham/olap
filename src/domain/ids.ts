import { randomBytes } from "node:crypto";

const PREFIXES = {
  task: "tsk",
  agent: "agt",
  goal: "gol",
  message: "msg",
  run: "run",
} as const;

export type IdPrefix = keyof typeof PREFIXES;

/** Generate a prefixed id like `tsk_a1b2c3d4`. */
export function createId(prefix: IdPrefix): string {
  return `${PREFIXES[prefix]}_${randomBytes(4).toString("hex")}`;
}

/** Sanitize user-provided ids for filesystem paths. */
export function sanitizeId(id: string): string {
  const cleaned = id.replace(/[^A-Za-z0-9._-]/g, "");
  if (!cleaned) throw new Error(`Invalid id: ${id}`);
  return cleaned;
}