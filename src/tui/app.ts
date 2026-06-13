import {
  CombinedAutocompleteProvider,
  Container,
  matchesKey,
  ProcessTerminal,
  TUI,
  type Component,
  type OverlayHandle,
} from "@earendil-works/pi-tui";
import { homedir } from "node:os";
import { detectAdapters } from "../adapters/detect.js";
import { canDiscover, loadModels, resolveConfigModels } from "../adapters/discover.js";
import { readConfig } from "../config/read.js";
import { writeConfig } from "../config/write.js";
import { generateContextPack } from "../context/pack.js";
import { getRepoStatus } from "../git/status.js";
import { formatDiffSummary } from "../git/status.js";
import { createRunId, writeRunArtifacts } from "../run/artifacts.js";
import { runOrchestratedLoop, terminalSessionStatus, type LoopUpdate } from "../run/loop.js";
import { buildRunPlan } from "../run/routing.js";
import { completeSession, createSessionId, registerSession } from "../sessions/registry.js";
import {
  buildToolInvocation,
  formatToolCommand,
  runToolCommand,
  type ToolName,
} from "../commands/tools.js";
import { checkForUpdate, formatUpdateNotice } from "../update-check.js";
import { PACKAGE_NAME, VERSION } from "../version.js";
import type { RoleId, WorkMode } from "../types.js";
import {
  BannerComponent,
  ContextBarComponent,
  ConversationComponent,
  FooterComponent,
  HelpOverlayComponent,
  OverlayPanel,
  RunPlanOverlay,
  UsagePanelComponent,
} from "./components.js";
import { OlapEditor } from "./editor.js";
import { formatModelBadge } from "./format.js";
import { resolveGlobalKey, SHORTCUT_HINTS, SHORTCUT_HINTS_RUNNING, SLASH_COMMANDS } from "./keyboard.js";
import { buildModelSelectList, buildSettingsList } from "./overlays.js";
import {
  getTheme,
  makeEditorTheme,
  mutedThemeFor,
  setTheme,
  themeNames,
  type Theme,
} from "./theme.js";

const MODES: WorkMode[] = ["plan", "build", "workflow"];

function splitToolArgs(input: string): string[] {
  const matches = input.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
  return matches.map((arg) => {
    if (
      (arg.startsWith('"') && arg.endsWith('"')) ||
      (arg.startsWith("'") && arg.endsWith("'"))
    ) {
      return arg.slice(1, -1);
    }
    return arg;
  });
}

export async function startTui(cwd = process.cwd()): Promise<void> {
  let config = await readConfig(cwd);
  setTheme(config.ui.theme);
  let theme: Theme = getTheme();

  const [detections, repo] = await Promise.all([detectAdapters(), getRepoStatus(cwd)]);

  const terminal = new ProcessTerminal();
  const tui = new TUI(terminal);

  const roleBadge = (role: RoleId): string =>
    config.roles[role].model || config.roles[role].adapter;

  const contextBar = new ContextBarComponent({
    repo,
    cwd,
    home: homedir(),
    orchestratorBadge: roleBadge("orchestrator"),
    workerBadge: roleBadge("worker"),
    mode: config.ui.mode,
    theme,
  });
  const banner = new BannerComponent(theme, config.ui.banner);
  const conversation = new ConversationComponent(theme, { rows: () => terminal.rows });
  const usage = new UsagePanelComponent({
    orchestratorModel: formatModelBadge(config.roles.orchestrator.adapter, config.roles.orchestrator.model),
    workerModel: formatModelBadge(config.roles.worker.adapter, config.roles.worker.model),
    theme,
  });
  usage.update({ contextMax: config.architect.context_pack_max_tokens });
  const reservedRows = (): number => {
    const bannerRows = config.ui.banner ? 9 : 0;
    const contextBarRows = 1;
    const usageRows = usage.chromeRowCount();
    const editorRows = 2;
    const footerRows = 1;
    return bannerRows + contextBarRows + usageRows + editorRows + footerRows;
  };
  conversation.setReservedRows(reservedRows());
  const footer = new FooterComponent({
    hints: SHORTCUT_HINTS,
    mode: config.ui.mode,
    access: config.access,
    themeName: config.ui.theme,
    theme,
  });
  const help = new HelpOverlayComponent(theme);
  const editor = new OlapEditor(tui, makeEditorTheme(theme));
  editor.setAutocompleteProvider(
    new CombinedAutocompleteProvider(
      SLASH_COMMANDS.map((c) => ({ name: c.name, description: c.description })),
      cwd,
    ),
  );

  const layout = new Container();
  layout.addChild(banner);
  layout.addChild(contextBar);
  layout.addChild(conversation);
  layout.addChild(usage);
  layout.addChild(editor);
  layout.addChild(footer);
  tui.addChild(layout);
  tui.setFocus(editor);

  // ---- live state ----
  let frame = 0;
  let spinnerTimer: NodeJS.Timeout | undefined;
  let activeOverlay: { handle: OverlayHandle; kind: "help" | "interactive" | "confirm" } | undefined;
  let activeOverlayComponent: (Component & { setTheme?: (t: Theme) => void }) | undefined;
  let abortController: AbortController | undefined;
  let pendingTask: string | undefined;
  let cancelledByUser = false;

  const startSpinner = (): void => {
    if (spinnerTimer) return;
    spinnerTimer = setInterval(() => {
      frame += 1;
      conversation.setFrame(frame);
      usage.setFrame(frame);
      tui.requestRender();
    }, 90);
    spinnerTimer.unref?.();
  };
  const stopSpinner = (): void => {
    if (spinnerTimer) {
      clearInterval(spinnerTimer);
      spinnerTimer = undefined;
    }
  };

  const cancelRun = (): void => {
    if (!abortController) return;
    cancelledByUser = true;
    abortController.abort();
    conversation.addNote("Run cancelled", "warn");
    tui.requestRender();
  };
  const openRunPlan = (task: string): void => {
    closeOverlay();
    const plan = buildRunPlan(task, config);
    const overlay = new RunPlanOverlay(plan, theme);
    const handle = tui.showOverlay(overlay, { width: "72%", maxHeight: "70%", minWidth: 48 });
    activeOverlay = { handle, kind: "confirm" };
    activeOverlayComponent = overlay;
    pendingTask = task;
    dimChrome();
    tui.requestRender();
  };

  const persist = (): void => {
    writeConfig(cwd, config).catch(() => undefined);
  };

  const refreshChrome = (): void => {
    contextBar.update({
      orchestratorBadge: roleBadge("orchestrator"),
      workerBadge: roleBadge("worker"),
      mode: config.ui.mode,
    });
    usage.setModels(
      formatModelBadge(config.roles.orchestrator.adapter, config.roles.orchestrator.model),
      formatModelBadge(config.roles.worker.adapter, config.roles.worker.model),
    );
    footer.update({ mode: config.ui.mode, access: config.access, themeName: config.ui.theme });
    banner.setVisible(config.ui.banner);
    conversation.setReservedRows(reservedRows());
  };

  const setChromeTheme = (t: Theme): void => {
    contextBar.setTheme(t);
    banner.setTheme(t);
    conversation.setTheme(t);
    usage.setTheme(t);
    footer.setTheme(t);
    editor.borderColor = t.border;
  };

  const applyTheme = (name: string): void => {
    setTheme(name);
    theme = getTheme();
    // If an overlay is open (e.g. changing theme in settings), keep the
    // background dimmed; otherwise apply the full theme to the chrome.
    setChromeTheme(activeOverlay ? mutedThemeFor(theme) : theme);
    help.setTheme(theme);
    activeOverlayComponent?.setTheme?.(theme);
    tui.requestRender();
  };

  // Dim the background chrome while an overlay is open so the dialog stands out.
  const dimChrome = (): void => setChromeTheme(mutedThemeFor(theme));
  const restoreChrome = (): void => setChromeTheme(theme);

  const closeOverlay = (): void => {
    if (!activeOverlay) return;
    activeOverlay.handle.hide();
    activeOverlay = undefined;
    activeOverlayComponent = undefined;
    restoreChrome();
    tui.setFocus(editor);
    tui.requestRender();
  };

  const openSettings = (focusId?: string): void => {
    closeOverlay();
    const list = buildSettingsList(
      config,
      theme,
      {
        onChange: () => {
          persist();
          refreshChrome();
          tui.requestRender();
        },
        onThemeChange: (name) => applyTheme(name),
        onCancel: () => closeOverlay(),
      },
      focusId,
    );
    const panel = new OverlayPanel(
      "Settings — models · effort · mode · theme · access",
      list,
      theme,
      "↑↓ move · ←→ change · Enter open submenu · Esc close",
    );
    const handle = tui.showOverlay(panel, { width: "72%", maxHeight: "82%", minWidth: 48 });
    activeOverlay = { handle, kind: "interactive" };
    activeOverlayComponent = panel;
    dimChrome();
    tui.requestRender();
  };

  const openModelSelect = (role: RoleId): void => {
    closeOverlay();
    const adapter = config.roles[role].adapter;
    const list = buildModelSelectList(
      adapter,
      role,
      theme,
      (modelId) => {
        config.roles[role].model = modelId;
        persist();
        refreshChrome();
        closeOverlay();
      },
      () => closeOverlay(),
    );
    const panel = new OverlayPanel(`Select ${role} model (${adapter})`, list, theme);
    const handle = tui.showOverlay(panel, { width: "60%", maxHeight: "70%", minWidth: 44 });
    activeOverlay = { handle, kind: "interactive" };
    activeOverlayComponent = panel;
    dimChrome();
    tui.requestRender();
  };

  const openHelp = (): void => {
    closeOverlay();
    const handle = tui.showOverlay(help, { width: "76%", maxHeight: "80%", minWidth: 48 });
    activeOverlay = { handle, kind: "help" };
    activeOverlayComponent = help;
    dimChrome();
    tui.requestRender();
  };

  const doClear = (): void => {
    if (abortController || conversation.isRunning()) {
      conversation.addNote("Cannot clear while a run is active", "warn");
      tui.requestRender();
      return;
    }
    conversation.clear();
    usage.reset();
    tui.requestRender();
  };

  const runToolFromTui = async (tool: ToolName, rawArg: string): Promise<void> => {
    const args = splitToolArgs(rawArg);
    const invocation = buildToolInvocation(tool, args);
    editor.disableSubmit = true;
    cancelledByUser = false;
    footer.setHints(SHORTCUT_HINTS_RUNNING);
    conversation.addUser(`/${tool}${rawArg ? ` ${rawArg}` : ""}`);
    conversation.setRunning(true, `Running ${formatToolCommand(invocation)}`);
    startSpinner();
    abortController = new AbortController();
    tui.requestRender();

    try {
      const result = await runToolCommand(tool, args, {
        cwd,
        signal: abortController.signal,
        onLine: (stream, line) => {
          conversation.addOutput(stream, line);
          tui.requestRender();
        },
      });
      conversation.setRunning(false);
      if (cancelledByUser) {
        conversation.addNote(`${tool} cancelled`, "warn");
      } else if (result.ok) {
        conversation.addNote(`${tool} completed: ${result.command}`, "success");
      } else {
        conversation.addNote(
          `${tool} failed${result.exitCode === null ? "" : ` (exit ${result.exitCode})`}`,
          "error",
        );
        if (result.missingBinary) {
          conversation.addNote(result.installHint, "warn");
        }
      }
    } catch (error) {
      conversation.setRunning(false);
      conversation.addNote(
        `${tool} failed: ${error instanceof Error ? error.message : String(error)}`,
        "error",
      );
    } finally {
      footer.setHints(SHORTCUT_HINTS);
      stopSpinner();
      editor.disableSubmit = false;
      abortController = undefined;
      tui.requestRender();
    }
  };

  // ---- commands ----
  const handleCommand = async (input: string): Promise<void> => {
    const [cmd, ...rest] = input.slice(1).trim().split(/\s+/);
    const arg = rest.join(" ").trim();
    switch (cmd) {
      case "help":
        openHelp();
        break;
      case "settings":
        openSettings();
        break;
      case "access":
        openSettings("access.approval");
        break;
      case "models":
        openSettings("orchestrator.model");
        break;
      case "effort":
        openSettings("orchestrator.effort");
        break;
      case "model": {
        const role = arg as RoleId;
        if (role === "orchestrator" || role === "worker") openModelSelect(role);
        else conversation.addNote("Usage: /model orchestrator | worker", "warn");
        break;
      }
      case "mode": {
        if (arg && MODES.includes(arg as WorkMode)) {
          config.ui.mode = arg as WorkMode;
          persist();
          refreshChrome();
        } else {
          openSettings("ui.mode");
        }
        break;
      }
      case "theme": {
        if (arg && themeNames().includes(arg)) {
          config.ui.theme = arg;
          applyTheme(arg);
          persist();
          refreshChrome();
        } else {
          openSettings("ui.theme");
        }
        break;
      }
      case "adapters": {
        for (const d of detections) {
          conversation.addNote(
            d.detected ? `${d.id}: detected (${d.binary})` : `${d.id}: not found`,
            d.detected ? "success" : "dim",
          );
        }
        break;
      }
      case "usage":
        usage.setVisible(!usage.isVisible());
        conversation.setReservedRows(reservedRows());
        conversation.addNote(`Usage panel ${usage.isVisible() ? "shown" : "hidden"}`, "dim");
        break;
      case "graphify":
        void runToolFromTui("graphify", arg);
        return;
      case "headroom":
        void runToolFromTui("headroom", arg);
        return;
      case "clear":
        doClear();
        return;
      case "quit":
      case "exit":
        cleanupAndExit();
        return;
      default:
        conversation.addNote(`Unknown command: /${cmd}. Try /help.`, "warn");
    }
    tui.requestRender();
  };

  const handleUpdate = (update: LoopUpdate): void => {
    switch (update.type) {
      case "phase":
        if (update.label) conversation.setPhase(update.label);
        if (update.phase === "work") usage.setActiveRole("worker");
        else if (update.phase === "context" || update.phase === "plan" || update.phase === "review")
          usage.setActiveRole("orchestrator");
        else if (update.phase === "done") usage.setActiveRole(null);
        break;
      case "event":
        if (update.event) conversation.addEvent(update.event);
        break;
      case "review":
        if (update.review) conversation.addReview(update.review);
        break;
      case "output":
        if (update.line) conversation.addOutput(update.stream ?? "stdout", update.line);
        break;
      case "routing":
        if (update.strategy && update.reason) {
          conversation.addRouting(update.strategy, update.reason);
        }
        break;
      case "brief":
        if (update.role && update.text) conversation.addBrief(update.role, update.text);
        break;
      case "command":
        if (update.role && update.command) conversation.addCommand(update.role, update.command);
        break;
      case "agent": {
        if (update.agentKind && update.content) {
          const orchPrefix = update.content.startsWith("◆ ");
          conversation.addAgent(
            update.agentKind,
            orchPrefix ? update.content.slice(2) : update.content,
            update.role ?? (orchPrefix ? "orchestrator" : "worker"),
          );
        }
        break;
      }
      case "activity":
        if (update.activity) {
          const { tool, file } = update.activity;
          const label = file ? `${tool ?? "edit"} ${file}` : tool;
          if (label) conversation.setActivity(label);
        }
        break;
      case "diff":
        if (update.diff) conversation.addDiff(update.diff);
        break;
      case "validator":
        if (update.validators) {
          for (const v of update.validators) {
            conversation.addNote(
              `validator ${v.name}: ${v.ok ? "pass" : `fail (exit ${v.exitCode})`}`,
              v.ok ? "success" : "error",
            );
          }
        }
        break;
      case "usage":
      case "final":
        if (update.usage) {
          usage.update({ usage: update.usage, cost: update.cost });
          conversation.setReservedRows(reservedRows());
        }
        break;
      case "error":
        if (update.error) conversation.addNote(update.error, "error");
        break;
    }
    tui.requestRender();
  };

  const runTask = async (task: string): Promise<void> => {
    editor.disableSubmit = true;
    cancelledByUser = false;
    footer.setHints(SHORTCUT_HINTS_RUNNING);
    conversation.addUser(task);
    conversation.setRunning(true, "Starting run");
    startSpinner();
    tui.requestRender();

    const runId = createRunId();
    conversation.setRunId(runId);
    const sessionId = createSessionId();
    abortController = new AbortController();

    try {
      const resolved = await resolveConfigModels(config, detections);
      if (resolved.warnings.length > 0) {
        for (const warning of resolved.warnings) {
          conversation.addNote(`Model fallback: ${warning}`, "warn");
        }
        config = resolved.config;
        tui.requestRender();
      }

      const contextPack = await generateContextPack(cwd, config);
      usage.update({
        contextUsed: contextPack.total_tokens,
        contextMax: config.architect.context_pack_max_tokens,
        contextAvailable: contextPack.available_tokens,
      });

      const result = await runOrchestratedLoop({
        task,
        config,
        cwd,
        detections,
        contextPack,
        runId,
        sessionId,
        signal: abortController.signal,
        onUpdate: handleUpdate,
      });

      let session = await registerSession({
        cwd,
        task,
        adapter: result.roles.worker.adapter,
        runId,
        sessionId,
      });
      session =
        (await completeSession(cwd, sessionId, terminalSessionStatus(result))) ?? session;
      await writeRunArtifacts({
        cwd,
        runId,
        task,
        config,
        events: result.events,
        report: result.report,
        brief: result.brief,
        contextPack,
        reviews: result.reviews,
        adapterCommands: result.adapterCommands,
        summary: result.summary,
        diff: result.diff,
        session,
      });

      conversation.setRunning(false);
      if (cancelledByUser) {
        conversation.addNote(`Run ${runId} cancelled · artifacts in .olap/runs/${runId}`, "warn");
      } else {
        const changeNote = result.executed ? ` · ${formatDiffSummary(result.diff)}` : "";
        conversation.addNote(
          `Run ${runId} ${result.status}${changeNote} · artifacts in .olap/runs/${runId}`,
          result.status === "completed" ? "success" : "error",
        );
      }

      getRepoStatus(cwd)
        .then((next) => {
          contextBar.update({ repo: next });
          tui.requestRender();
        })
        .catch(() => undefined);
    } catch (error) {
      conversation.setRunning(false);
      conversation.addNote(
        `Run failed: ${error instanceof Error ? error.message : String(error)}`,
        "error",
      );
    } finally {
      footer.setHints(SHORTCUT_HINTS);
      stopSpinner();
      usage.setActiveRole(null);
      editor.disableSubmit = false;
      abortController = undefined;
      tui.requestRender();
    }
  };

  editor.onSubmit = (text) => {
    const input = text.trim();
    editor.setText("");
    if (!input) return;
    editor.addToHistory(input);
    if (input.startsWith("/")) {
      void handleCommand(input);
      return;
    }
    if (config.ui.confirm_before_run) {
      openRunPlan(input);
      return;
    }
    void runTask(input);
  };

  const cleanupAndExit = (): void => {
    stopSpinner();
    abortController?.abort();
    tui.stop();
    process.exit(0);
  };

  tui.addInputListener((data) => {
    // Ctrl+C cancels an active run; only quits when idle.
    if (matchesKey(data, "ctrl+c")) {
      if (abortController) {
        cancelRun();
      } else {
        cleanupAndExit();
      }
      return { consume: true };
    }
    // Pre-run confirmation overlay.
    if (activeOverlay?.kind === "confirm") {
      if (matchesKey(data, "enter")) {
        const task = pendingTask;
        pendingTask = undefined;
        closeOverlay();
        if (task) void runTask(task);
      } else if (matchesKey(data, "escape")) {
        pendingTask = undefined;
        closeOverlay();
        conversation.addNote("Run cancelled before start", "dim");
        tui.requestRender();
      } else if (data === "e") {
        const task = pendingTask;
        pendingTask = undefined;
        closeOverlay();
        if (task) {
          editor.setText(task);
          tui.requestRender();
        }
      }
      return { consume: true };
    }
    if (activeOverlay?.kind === "help") {
      if (matchesKey(data, "escape")) {
        closeOverlay();
      }
      return { consume: true };
    }
    if (activeOverlay?.kind === "interactive") {
      return undefined;
    }
    // No overlay open below.
    // Esc cancels a running task.
    if (matchesKey(data, "escape") && abortController) {
      cancelRun();
      return { consume: true };
    }
    // Transcript scrolling (PgUp/PgDn always; arrows only when the input is empty).
    if (matchesKey(data, "pageUp")) {
      conversation.pageUp();
      tui.requestRender();
      return { consume: true };
    }
    if (matchesKey(data, "pageDown")) {
      conversation.pageDown();
      tui.requestRender();
      return { consume: true };
    }
    if (matchesKey(data, "up") && editor.getText() === "" && conversation.canScroll()) {
      conversation.scrollUp(1);
      tui.requestRender();
      return { consume: true };
    }
    if (matchesKey(data, "down") && editor.getText() === "" && conversation.canScroll()) {
      conversation.scrollDown(1);
      tui.requestRender();
      return { consume: true };
    }
    const action = resolveGlobalKey(data);
    if (action?.type === "clear") {
      doClear();
      return { consume: true };
    }
    return undefined;
  });

  const discoverModelsInBackground = (): void => {
    for (const detection of detections) {
      if (!detection.detected || !detection.binary || !canDiscover(detection.id)) continue;
      // Populate the model cache silently so the pickers reflect the CLI's real models.
      loadModels(detection.id, detection).catch(() => undefined);
    }
  };

  const checkUpdateInBackground = (): void => {
    checkForUpdate({ current: VERSION, packageName: PACKAGE_NAME })
      .then((info) => {
        if (info?.updateAvailable) {
          conversation.addNote(formatUpdateNotice(info, PACKAGE_NAME), "warn");
          tui.requestRender();
        }
      })
      .catch(() => undefined);
  };

  discoverModelsInBackground();
  checkUpdateInBackground();
  tui.start();
}
