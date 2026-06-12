import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import type { ContextPack, ContextPackFile, OlapConfig } from "../types.js";

const DEFAULT_PATHS = [
  "olap.config.yaml",
  "package.json",
  "README.md",
  "src",
  "test",
];

const SKIP_DIRS = new Set(["node_modules", "dist", ".git", ".olap"]);

export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

async function collectFiles(cwd: string, relPaths: string[]): Promise<string[]> {
  const files: string[] = [];

  async function walk(rel: string): Promise<void> {
    const abs = join(cwd, rel);
    let info;
    try {
      info = await stat(abs);
    } catch {
      return;
    }

    if (info.isDirectory()) {
      if (SKIP_DIRS.has(rel.split("/").pop() ?? rel)) return;
      const entries = await readdir(abs);
      for (const entry of entries.sort()) {
        await walk(join(rel, entry));
      }
      return;
    }

    if (info.isFile()) {
      files.push(rel);
    }
  }

  for (const rel of relPaths) {
    await walk(rel);
  }

  return files.sort();
}

export async function generateContextPack(
  cwd: string,
  config: OlapConfig,
  includePaths: string[] = DEFAULT_PATHS,
  now = new Date(),
): Promise<ContextPack> {
  const maxTokens = config.architect.context_pack_max_tokens;
  const paths = await collectFiles(cwd, includePaths);
  const packFiles: ContextPackFile[] = [];
  let totalTokens = 0;
  let truncated = false;

  for (const rel of paths) {
    const abs = join(cwd, rel);
    let content: string;
    try {
      content = await readFile(abs, "utf8");
    } catch {
      continue;
    }

    const body = `# ${relative(cwd, abs)}\n${content}`;
    const tokens = estimateTokens(body);

    if (totalTokens + tokens > maxTokens) {
      truncated = true;
      const remaining = maxTokens - totalTokens;
      if (remaining <= 0) break;

      let charBudget = remaining * 4;
      let clipped = `${body.slice(0, charBudget)}\n... [truncated]`;
      while (estimateTokens(clipped) > remaining && charBudget > 0) {
        charBudget -= 4;
        clipped = `${body.slice(0, charBudget)}\n... [truncated]`;
      }

      const clippedTokens = estimateTokens(clipped);
      packFiles.push({ path: rel, tokens: clippedTokens, content: clipped });
      totalTokens += clippedTokens;
      break;
    }

    packFiles.push({ path: rel, tokens, content: body });
    totalTokens += tokens;
  }

  return {
    generated_at: now.toISOString(),
    max_tokens: maxTokens,
    total_tokens: totalTokens,
    truncated,
    files: packFiles,
  };
}
