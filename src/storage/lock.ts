import fs from "node:fs/promises";

export interface LockInfo {
  pid: number;
  acquired_at: string;
  hostname: string;
}

export async function acquireLock(lockPath: string): Promise<boolean> {
  const info: LockInfo = {
    pid: process.pid,
    acquired_at: new Date().toISOString(),
    hostname: process.env.HOSTNAME ?? "localhost",
  };
  try {
    await fs.writeFile(lockPath, JSON.stringify(info, null, 2), { flag: "wx" });
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    const existing = await readLock(lockPath);
    if (existing && !(await isProcessAlive(existing.pid))) {
      await fs.unlink(lockPath).catch(() => undefined);
      return acquireLock(lockPath);
    }
    return false;
  }
}

export async function releaseLock(lockPath: string): Promise<void> {
  const existing = await readLock(lockPath);
  if (existing?.pid === process.pid) {
    await fs.unlink(lockPath).catch(() => undefined);
  }
}

export async function touchLock(lockPath: string): Promise<void> {
  const existing = await readLock(lockPath);
  if (existing?.pid === process.pid) {
    existing.acquired_at = new Date().toISOString();
    await fs.writeFile(lockPath, JSON.stringify(existing, null, 2));
  }
}

async function readLock(lockPath: string): Promise<LockInfo | null> {
  try {
    const raw = await fs.readFile(lockPath, "utf-8");
    return JSON.parse(raw) as LockInfo;
  } catch {
    return null;
  }
}

async function isProcessAlive(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}