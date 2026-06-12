import { mkdir, writeFile, chmod } from "node:fs/promises";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";

export async function createTempDir(prefix = "olap-test-"): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

export async function writeFakeBinary(
  dir: string,
  name: string,
  body = '#!/bin/sh\necho "fake"\n',
): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, body, "utf8");
  await chmod(path, 0o755);
  return path;
}

export async function writeFileInDir(
  dir: string,
  name: string,
  content: string,
): Promise<string> {
  const path = join(dir, name);
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, content, "utf8");
  return path;
}