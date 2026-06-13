import {
  CombinedAutocompleteProvider,
  Container,
  Editor,
  matchesKey,
  ProcessTerminal,
  TUI,
  type OverlayHandle,
} from "@earendil-works/pi-tui";
import { homedir } from "node:os";
import { detectAdapters } from "../adapters/detect.js";
import { canDiscover, loadModels } from "../adapters/discover.js";
import { readConfig } from "../config/read.js";
import { writeConfig } from "../config/write.js";
import { generateContextPack } from "../context/pack.js";
import { getRepoStatus } from "../git/status.js";
import { createRunId, writeRunArtifacts } from "../run/artifacts.js";
import { runOrchestratedLoop, type LoopUpdate } from "../run/loop.js";
import { completeSession, createSessionId, registerSession } from "../sessions/registry.js";
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
  RuleComponent,
  UsagePanelComponent,
} from "./components.js";
import { formatModelBadge } from "./format.js";
import { resolveGlobalKey, SHORTCUT_HINTS, SLASH_COMMANDS } from "./keyboard.js";
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

export async function startTui(cwd = process.cwd()): Promise<void> {
  const config = await readConfig(cwd);
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
  const conversation = new ConversationComponent(theme);
  const usage = new UsagePanelComponent({
    orchestratorModel: formatModelBadge(config.roles.orchestrator.adapter, config.roles.orchestrator.model),
    workerModel: formatModelBadge(config.roles.worker.adapter, config.roles.worker.model),
    theme,
  });
  usage.update({ contextMax: config.architect.context_pack_max_tokens, budgetMax: config.architect.output_budget_tokens });
  const footer = new FooterComponent({
    hints: SHORTCUT_HINTS,
    mode: config.ui.mode,
    access: config.access,
    themeName: config.ui.theme,
    theme,
  });
  const help = new HelpOverlayComponent(theme);
  const editor = new Editor(tui, makeEditorTheme(theme));
  editor.setAutocompleteProvider(
    new CombinedAutocompleteProvider(
      SLASH_COMMANDS.map((c) => ({ name: c.name, description: c.description })),
      cwd,
    ),
  );

  const topRule = new RuleComponent(theme);

  const layout = new Container();
  layout.addChild(banner);
  layout.addChild(contextBar);
  layout.addChild(topRule);
  layout.addChild(conversation);
  layout.addChild(usage);
  layout.addChild(editor);
  layout.addChild(footer);
  tui.addChild(layout);
  tui.setFocus(editor);

  // ---- live state ----
  let frame = 0;
  let spinnerTimer: NodeJS.Timeout | undefined;
  let activeOverlay: { handle: OverlayHandle; kind: "help" | "interactive" } | undefined;
  let abortController: AbortController | undefined;

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
  };

  const setChromeTheme = (t: Theme): void => {
    contextBar.setTheme(t);
    banner.setTheme(t);
    conversation.setTheme(t);
    usage.setTheme(t);
    footer.setTheme(t);
    topRule.setTheme(t);
    editor.borderColor = t.border;
  };

  const applyTheme = (name: string): void => {
    setTheme(name);
    theme = getTheme();
    // If an overlay is open (e.g. changing theme in settings), keep the
    // background dimmed; otherwise apply the full theme to the chrome.
    setChromeTheme(activeOverlay ? mutedThemeFor(theme) : theme);
    help.setTheme(theme);
    tui.requestRender();
  };

  // Dim the background chrome while an overlay is open so the dialog stands out.
  const dimChrome = (): void => setChromeTheme(mutedThemeFor(theme));
  const restoreChrome = (): void => setChromeTheme(theme);

  const closeOverlay = (): void => {
    if (!activeOverlay) return;
    activeOverlay.handle.hide();
    activeOverlay = undefined;
    restoreChrome();
    tui.setFocus(editor);
    tui.requestRender();
  };

  const openSettings = (focusId?: string): void => {
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
    dimChrome();
    tui.requestRender();
  };

  const openModelSelect = (role: RoleId): void => {
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
    dimChrome();
    tui.requestRender();
  };

  const openHelp = (): void => {
    const handle = tui.showOverlay(help, { width: "76%", maxHeight: "80%", minWidth: 48 });
    activeOverlay = { handle, kind: "help" };
    dimChrome();
    tui.requestRender();
  };

  const doClear = (): void => {
    conversation.clear();
    usage.reset();
    tui.requestRender();
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
        conversation.addNote(`Usage panel ${usage.isVisible() ? "shown" : "hidden"}`, "dim");
        break;
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
      case "subagent":
      case "usage":
        if (update.usage) {
          usage.update({ usage: update.usage, budgetUsed: update.usage.orchestrator.tokens_out });
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
    conversation.addUser(task);
    conversation.setRunning(true, "Starting run");
    startSpinner();
    tui.requestRender();

    const runId = createRunId();
    const sessionId = createSessionId();
    abortController = new AbortController();

    try {
      const contextPack = await generateContextPack(cwd, config);
      usage.update({
        contextUsed: contextPack.total_tokens,
        contextMax: config.architect.context_pack_max_tokens,
        budgetMax: config.architect.output_budget_tokens,
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

      const session = await registerSession({
        cwd,
        task,
        adapter: result.roles.worker.adapter,
        runId,
        sessionId,
      });
      if (result.reviews.at(-1)?.verdict === "pass") {
        await completeSession(cwd, sessionId, "completed");
      }
      await writeRunArtifacts({
        cwd,
        runId,
        task,
        config,
        events: result.events,
        report: result.report,
        contextPack,
        reviews: result.reviews,
        adapterCommands: result.adapterCommands,
        summary: result.summary,
        session,
      });

      conversation.setRunning(false);
      conversation.addNote(
        `Run ${runId} ${result.status}${result.executed ? " · live" : " · dry-run"} · artifacts in .olap/runs/${runId}`,
        result.status === "completed" ? "success" : "error",
      );

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
    void runTask(input);
  };

  const cleanupAndExit = (): void => {
    stopSpinner();
    abortController?.abort();
    tui.stop();
    process.exit(0);
  };

  tui.addInputListener((data) => {
    if (matchesKey(data, "ctrl+c")) {
      cleanupAndExit();
      return { consume: true };
    }
    if (activeOverlay?.kind === "help") {
      if (matchesKey(data, "escape")) {
        closeOverlay();
      }
      return { consume: true };
    }
    if (activeOverlay?.kind === "interactive") {
      // Let the focused list/settings component handle navigation and escape.
      return undefined;
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
