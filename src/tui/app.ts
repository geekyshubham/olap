import {
  Container,
  Editor,
  ProcessTerminal,
  Spacer,
  TUI,
} from "@earendil-works/pi-tui";
import { detectAdapters, pickAdapter } from "../adapters/detect.js";
import { readConfig } from "../config/read.js";
import { generateContextPack } from "../context/pack.js";
import { createRunId, writeRunArtifacts } from "../run/artifacts.js";
import { simulateArchitectWorkerLoop, summarizeTokens } from "../run/simulator.js";
import { completeSession, createSessionId, registerSession } from "../sessions/registry.js";
import {
  HeaderComponent,
  HelpOverlayComponent,
  ShortcutsComponent,
  StatusFooterComponent,
  TimelineComponent,
} from "./components.js";
import { resolveGlobalKey } from "./keyboard.js";
import { editorTheme } from "./theme.js";

export async function startTui(cwd = process.cwd()): Promise<void> {
  const config = await readConfig(cwd);
  const detections = await detectAdapters();
  const adapter = pickAdapter(
    detections,
    config.adapters.preferred,
    config.adapters.fallback,
  );

  const terminal = new ProcessTerminal();
  const tui = new TUI(terminal);

  const header = new HeaderComponent("architect/worker orchestration");
  const timeline = new TimelineComponent();
  const footer = new StatusFooterComponent({
    adapter: adapter?.id ?? "none",
    contextUsed: 0,
    contextMax: config.architect.context_pack_max_tokens,
    tokensIn: 0,
    tokensOut: 0,
    efficiency: 0,
    budgetUsed: 0,
    budgetMax: config.architect.output_budget_tokens,
    contextPacked: false,
  });
  const shortcuts = new ShortcutsComponent();
  const help = new HelpOverlayComponent();

  const layout = new Container();
  layout.addChild(header);
  layout.addChild(new Spacer(1));
  layout.addChild(timeline);
  layout.addChild(new Spacer(1));
  layout.addChild(footer);
  layout.addChild(shortcuts);

  const editor = new Editor(tui, editorTheme);
  editor.onSubmit = async (text) => {
    const task = text.trim();
    if (!task) return;

    if (task === "/help") {
      tui.showOverlay(help, { width: "80%", maxHeight: "70%" });
      tui.requestRender();
      return;
    }

    if (task === "/clear") {
      timeline.clear();
      footer.reset({
        adapter: adapter?.id ?? "none",
        contextUsed: 0,
        contextMax: config.architect.context_pack_max_tokens,
        tokensIn: 0,
        tokensOut: 0,
        efficiency: 0,
        budgetUsed: 0,
        budgetMax: config.architect.output_budget_tokens,
        contextPacked: false,
      });
      header.setTitle("architect/worker orchestration");
      header.setStatus("idle");
      tui.requestRender();
      return;
    }

    header.setStatus("running");
    tui.requestRender();

    const runId = createRunId();
    const sessionId = createSessionId();
    const contextPack = await generateContextPack(cwd, config);
    const simulation = simulateArchitectWorkerLoop(task, config, {
      runId,
      sessionId,
      adapterId: adapter?.id ?? "none",
      contextPack,
      detection: adapter,
    });
    const { events, report } = simulation;
    const summary = summarizeTokens(events);
    const budgetUsed = events
      .filter((e) => e.phase === "architect")
      .reduce((sum, e) => sum + e.tokens_out, 0);
    const contextUsed = contextPack.total_tokens;

    const session = await registerSession({
      cwd,
      task,
      adapter: adapter?.id ?? "none",
      runId,
      sessionId,
    });
    const lastReview = simulation.reviews.at(-1);
    if (lastReview?.verdict === "pass") {
      await completeSession(cwd, sessionId, "completed");
    }

    await writeRunArtifacts({
      cwd,
      runId,
      task,
      config,
      events,
      report,
      contextPack,
      reviews: simulation.reviews,
      adapterCommands: simulation.adapterCommands,
      summary: simulation.summary,
      session,
    });

    timeline.setEvents(events);
    footer.update({
      adapter: adapter?.id ?? "none",
      contextUsed,
      contextMax: config.architect.context_pack_max_tokens,
      tokensIn: summary.tokens_in,
      tokensOut: summary.tokens_out,
      efficiency: summary.efficiency,
      budgetUsed,
      budgetMax: config.architect.output_budget_tokens,
      contextPacked: contextUsed <= config.architect.context_pack_max_tokens,
    });
    header.setTitle(`run ${runId} complete`);
    header.setStatus("done");
    tui.requestRender();
  };

  layout.addChild(new Spacer(1));
  layout.addChild(editor);

  tui.addChild(layout);
  tui.setFocus(editor);

  tui.addInputListener((data) => {
    const action = resolveGlobalKey(data);
    if (!action) return undefined;

    if (action.type === "quit") {
      tui.stop();
      process.exit(0);
    } else if (action.type === "clear-output") {
      timeline.clear();
      header.setTitle("architect/worker orchestration");
      header.setStatus("idle");
      tui.requestRender();
    } else if (action.type === "toggle-help") {
      tui.showOverlay(help, { width: "80%", maxHeight: "70%" });
      tui.requestRender();
    } else if (action.type === "focus-input") {
      tui.setFocus(editor);
    }

    return { consume: true };
  });

  tui.start();
}
