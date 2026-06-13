import { lstat, readFile, readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import type { ContextPack, ContextPackFile, OlapConfig } from "../types.js";

const DEFAULT_PATHS = [
  "olap.config.yaml",
  "package.json",
  "README.md",
  "src",
  "test",
];

const SKIP_DIRS = new Set(["node_modules", "dist", ".git", ".olap"]);
const MAX_FILE_BYTES = 512 * 1024;

/** True when `target` resolves under `root` (prevents absolute / traversal include paths). */
export function isPathWithinRoot(root: string, target: string): boolean {
  const resolvedRoot = resolve(root);
  const resolvedTarget = resolve(root, target);
  return resolvedTarget === resolvedRoot || resolvedTarget.startsWith(`${resolvedRoot}/`);
}

export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

/** Compact list of packed files with their token sizes, for prompt headers. */
export function renderContextDigest(pack: ContextPack | undefined, maxFiles = 16): string {
  if (!pack || pack.files.length === 0) return "(no repository context available)";
  const shown = pack.files.slice(0, maxFiles);
  const lines = shown.map((f) => `- ${f.path} (~${f.tokens} tok)`);
  if (pack.files.length > shown.length) {
    lines.push(`- … +${pack.files.length - shown.length} more files`);
  }
  return lines.join("\n");
}

/**
 * Render packed file *contents* (not just names) up to a token budget so the
 * orchestrator/worker prompt carries real repository context. Truncates the
 * last file and marks where the budget ran out.
 */
export function renderContextExcerpt(
  pack: ContextPack | undefined,
  maxTokens: number,
): string {
  if (!pack || pack.files.length === 0) return "";
  const budgetChars = Math.max(0, maxTokens) * 4;
  const sections: string[] = [];
  let used = 0;
  for (const file of pack.files) {
    if (used >= budgetChars) {
      sections.push(`... [context truncated to ~${maxTokens} tokens]`);
      break;
    }
    const header = `===== ${file.path} =====\n`;
    const remaining = budgetChars - used - header.length;
    if (remaining <= 0) {
      sections.push(`... [context truncated to ~${maxTokens} tokens]`);
      break;
    }
    const body =
      file.content.length > remaining
        ? `${file.content.slice(0, remaining)}\n... [file truncated]`
        : file.content;
    const section = header + body;
    sections.push(section);
    used += section.length + 1;
  }
  return sections.join("\n\n");
}

async function readTextFile(abs: string): Promise<string | undefined> {
  let info;
  try {
    info = await lstat(abs);
  } catch {
    return undefined;
  }
  if (info.isSymbolicLink() || !info.isFile() || info.size > MAX_FILE_BYTES) {
    return undefined;
  }
  try {
    const content = await readFile(abs, "utf8");
    if (content.includes("\u0000")) return undefined;
    return content;
  } catch {
    return undefined;
  }
}

async function collectFiles(cwd: string, relPaths: string[]): Promise<string[]> {
  const files: string[] = [];
  const visited = new Set<string>();
  const root = resolve(cwd);

  async function walk(rel: string): Promise<void> {
    if (rel.startsWith("/") || rel.startsWith("\\") || /^[A-Za-z]:[\\/]/.test(rel)) {
      return;
    }
    const abs = resolve(root, rel);
    if (!isPathWithinRoot(root, abs)) return;
    if (visited.has(abs)) return;
    visited.add(abs);

    let info;
    try {
      info = await lstat(abs);
    } catch {
      return;
    }

    if (info.isSymbolicLink()) return;

    if (info.isDirectory()) {
      if (SKIP_DIRS.has(rel.split("/").pop() ?? rel)) return;
      const entries = await readdir(abs);
      for (const entry of entries.sort()) {
        await walk(join(rel, entry));
      }
      return;
    }

    if (info.isFile()) {
      if (info.size > MAX_FILE_BYTES) return;
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
  let availableTokens = 0;
  let truncated = false;

  const root = resolve(cwd);
  for (const rel of paths) {
    const abs = resolve(root, rel);
    const content = await readTextFile(abs);
    if (content === undefined) continue;

    const body = `# ${relative(root, abs)}\n${content}`;
    const tokens = estimateTokens(body);
    // Track the full discovered size regardless of the budget cap so the UI can
    // report real coverage (packed/available) rather than a perpetual 100%.
    availableTokens += tokens;

    if (totalTokens + tokens > maxTokens) {
      truncated = true;
      const remaining = maxTokens - totalTokens;
      if (remaining <= 0) continue;

      let charBudget = remaining * 4;
      let clipped = `${body.slice(0, charBudget)}\n... [truncated]`;
      while (estimateTokens(clipped) > remaining && charBudget > 0) {
        charBudget -= 4;
        clipped = `${body.slice(0, charBudget)}\n... [truncated]`;
      }

      const clippedTokens = estimateTokens(clipped);
      packFiles.push({ path: rel, tokens: clippedTokens, content: clipped });
      totalTokens += clippedTokens;
      // Keep scanning remaining files (read-only) to finish the availability tally.
      continue;
    }

    packFiles.push({ path: rel, tokens, content: body });
    totalTokens += tokens;
  }

  return {
    generated_at: now.toISOString(),
    max_tokens: maxTokens,
    total_tokens: totalTokens,
    available_tokens: Math.max(availableTokens, totalTokens),
    truncated,
    files: packFiles,
  };
}
