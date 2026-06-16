import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

export async function atomicWrite(filePath: string, content: string): Promise<void> {
  const dir = path.dirname(filePath);
  await ensureDir(dir);
  const tmp = path.join(dir, `.${path.basename(filePath)}.${randomBytes(4).toString("hex")}.tmp`);
  try {
    await fs.writeFile(tmp, content, "utf-8");
    await fs.rename(tmp, filePath);
  } catch (err) {
    await fs.unlink(tmp).catch(() => undefined);
    throw err;
  }
}

function isENOENT(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as NodeJS.ErrnoException).code === "ENOENT";
}

export async function readYaml<T>(filePath: string): Promise<T | null> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return parseYaml(content) as T;
  } catch (err) {
    if (isENOENT(err)) return null;
    throw err;
  }
}

export async function writeYaml<T>(filePath: string, data: T): Promise<void> {
  await atomicWrite(filePath, stringifyYaml(data, { indent: 2, lineWidth: 120 }));
}

export async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return JSON.parse(content) as T;
  } catch (err) {
    if (isENOENT(err)) return null;
    throw err;
  }
}

export async function writeJson<T>(filePath: string, data: T): Promise<void> {
  await atomicWrite(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

export async function listFiles(dir: string, ext: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && e.name.endsWith(ext))
      .map((e) => path.join(dir, e.name));
  } catch (err) {
    if (isENOENT(err)) return [];
    throw err;
  }
}

export async function removeFile(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch (err) {
    if (!isENOENT(err)) throw err;
  }
}