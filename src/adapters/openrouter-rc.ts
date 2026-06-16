import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const RC_FILES = [".openrouterrc", ".openrouterrc.json"];

/** Merge the role model into the project `.openrouterrc` before spawning openrouter ask. */
export async function syncOpenrouterProjectModel(cwd: string, model: string): Promise<void> {
  const trimmed = model.trim();
  if (!trimmed) return;

  let target: string | undefined;
  let current: Record<string, unknown> = {};

  for (const name of RC_FILES) {
    const path = join(cwd, name);
    try {
      const text = await readFile(path, "utf8");
      const parsed = JSON.parse(text) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        target = path;
        current = parsed as Record<string, unknown>;
        break;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  if (current.model === trimmed) return;
  current.model = trimmed;
  await writeFile(
    target ?? join(cwd, RC_FILES[0]!),
    `${JSON.stringify(current, null, 2)}\n`,
    "utf8",
  );
}