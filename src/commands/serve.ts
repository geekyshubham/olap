import { OrchestratorEngine } from "../orchestrator/engine.js";
import { ensureOlapWorkspace } from "../services/bootstrap.js";

export interface ServeOptions {
  cwd?: string;
  once?: boolean;
  tickIntervalMs?: number;
  logFormat?: "json" | "text";
}

export async function serveCommand(options: ServeOptions = {}): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  await ensureOlapWorkspace(cwd);

  const engine = new OrchestratorEngine({
    cwd,
    once: options.once,
    tickIntervalMs: options.tickIntervalMs,
  });
  await engine.init();

  const format = options.logFormat ?? "json";
  engine.events.on((event) => {
    if (format === "json") {
      console.log(JSON.stringify({ ts: new Date().toISOString(), ...event }));
    } else {
      console.log(`[${event.type}]`, JSON.stringify(event));
    }
  });

  const shutdown = async () => {
    await engine.stop();
    process.exit(options.once ? (await exitCodeOnce(engine)) : 0);
  };

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());

  await engine.startWatch();
  if (options.once) {
    await waitForIdle(engine);
    await engine.stop();
    return exitCodeOnce(engine);
  }
  await engine.waitForStop();
  return 0;
}

async function waitForIdle(engine: OrchestratorEngine): Promise<void> {
  return new Promise((resolve) => {
    const check = () => {
      void engine.tick().then(() => {
        const unsub = engine.events.on((e) => {
          if (e.type === "orchestrator:tick" && e.running === 0 && e.queued === 0) {
            unsub();
            resolve();
          }
        });
      });
    };
    check();
    const interval = setInterval(check, 5000);
    engine.events.on((e) => {
      if (e.type === "orchestrator:stopped") {
        clearInterval(interval);
        resolve();
      }
    });
  });
}

async function exitCodeOnce(engine: OrchestratorEngine): Promise<number> {
  const tasks = await engine.getStores().tasks.list();
  const failed = tasks.some((t) => t.status === "failed");
  return failed ? 1 : 0;
}