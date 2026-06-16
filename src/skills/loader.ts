import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listFiles } from "../storage/fs-utils.js";

const VALID_SKILL = /^[a-z0-9-]+$/;
const BUNDLED_SKILLS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../skills",
);

export interface SkillLoaderOptions {
  /** Project-local skills under .olap/skills/ */
  projectSkillsDir?: string;
}

export class SkillLoader {
  private cache = new Map<string, string>();

  constructor(private readonly options: SkillLoaderOptions = {}) {}

  async loadSkills(names: string[]): Promise<string> {
    const parts: string[] = [];
    for (const name of names) {
      if (!VALID_SKILL.test(name)) continue;
      const cached = this.cache.get(name);
      if (cached) {
        parts.push(cached);
        continue;
      }
      const content = await this.readSkill(name);
      if (content) {
        this.cache.set(name, content);
        parts.push(content);
      }
    }
    return parts.join("\n\n---\n\n");
  }

  async listAvailable(): Promise<string[]> {
    const bundled = await listFiles(BUNDLED_SKILLS_DIR, ".md");
    const project = this.options.projectSkillsDir
      ? await listFiles(this.options.projectSkillsDir, ".md")
      : [];
    const names = new Set<string>();
    for (const f of [...bundled, ...project]) {
      names.add(path.basename(f, ".md"));
    }
    return [...names].sort();
  }

  private async readSkill(name: string): Promise<string | null> {
    const candidates = [
      this.options.projectSkillsDir
        ? path.join(this.options.projectSkillsDir, `${name}.md`)
        : null,
      path.join(BUNDLED_SKILLS_DIR, `${name}.md`),
    ].filter((p): p is string => p !== null);
    for (const filePath of candidates) {
      try {
        const raw = await readFile(filePath, "utf-8");
        return stripFrontmatter(raw);
      } catch {
        // try next
      }
    }
    return null;
  }
}

function stripFrontmatter(raw: string): string {
  if (!raw.startsWith("---")) return raw.trim();
  const end = raw.indexOf("---", 3);
  if (end === -1) return raw.trim();
  return raw.slice(end + 3).trim();
}