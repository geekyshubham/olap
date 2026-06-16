import { SelectList } from "@earendil-works/pi-tui";
import type { AdapterId, OlapConfig, RoleId } from "../types.js";
import { defaultModelFor, findModel } from "../adapters/models.js";
import { resolveModelsForRole } from "../adapters/discover.js";
import { OlapSettingsList, type OlapSettingItem } from "./settings-list.js";
import { getTheme, makeSelectListTheme, themeNames, type Theme } from "./theme.js";

import { ADAPTER_IDS } from "../adapters/registry.js";

const ADAPTERS: AdapterId[] = ADAPTER_IDS;
const MODES = ["plan", "build", "workflow"];
const APPROVALS = ["untrusted", "on-failure", "on-request", "never"];
const SANDBOXES = ["read-only", "workspace-write", "danger-full-access"];
const TOGGLE = ["off", "on"];

const LOOP_POLICIES = ["auto", "always", "never"];
const MAX_ITERATIONS = ["1", "2", "3", "4", "5", "6", "8", "10"];
const EFFORTS = ["default", "low", "medium", "high", "xhigh", "max"];

export interface SettingsHooks {
  /** Called after any mutation so the app can persist and refresh the UI. */
  onChange: () => void;
  /** Apply a theme by name immediately (live preview). */
  onThemeChange: (name: string) => void;
  onCancel: () => void;
}

function modelLabel(adapter: AdapterId, model: string): string {
  const info = findModel(adapter, model);
  return info ? `${model} — ${info.label}` : model;
}

/** Standalone model picker for `/model <role>`. */
export function buildModelSelectList(
  adapter: AdapterId,
  role: RoleId,
  theme: Theme,
  onSelect: (modelId: string) => void,
  onCancel: () => void,
): SelectList {
  const models = resolveModelsForRole(adapter, role);
  const items =
    models.length > 0
      ? models.map((model) => ({
          value: model.id,
          label: model.label,
          description: `${model.id} · ${model.description}`,
        }))
      : [
          {
            value: "",
            label: "Use the CLI's default model",
            description: `${adapter} manages its own models (run \`olap models\` after detection)`,
          },
        ];
  const list = new SelectList(items, 8, makeSelectListTheme(theme));
  list.onSelect = (item) => onSelect(item.value);
  list.onCancel = onCancel;
  return list;
}

/**
 * Full settings panel. Mutates the passed config in place and notifies via hooks
 * so the app can persist to olap.config.yaml and refresh the live UI.
 */
export function buildSettingsList(
  config: OlapConfig,
  theme: Theme,
  hooks: SettingsHooks,
  focusId?: string,
): OlapSettingsList {
  const holder: { list?: OlapSettingsList } = {};

  const modelSubmenu = (role: RoleId) => (_current: string, done: (value?: string) => void) =>
    buildModelSelectList(
      config.roles[role].adapter,
      role,
      getTheme(),
      (modelId) => done(modelId),
      () => done(undefined),
    );

  const items: OlapSettingItem[] = [
    {
      id: "orchestrator.adapter",
      label: "Orchestrator CLI",
      description: "Which coding CLI runs the planning/review role.",
      value: config.roles.orchestrator.adapter,
      values: ADAPTERS,
    },
    {
      id: "orchestrator.model",
      label: "Orchestrator model",
      description: "Model used for planning and reviews.",
      value: modelLabel(config.roles.orchestrator.adapter, config.roles.orchestrator.model),
      submenu: modelSubmenu("orchestrator"),
    },
    {
      id: "orchestrator.effort",
      label: "Orchestrator effort",
      description: "Reasoning effort (claude/kiro --effort, codex reasoning effort). Ignored where unsupported.",
      value: config.roles.orchestrator.effort ?? "default",
      values: EFFORTS,
    },
    {
      id: "worker.adapter",
      label: "Worker CLI",
      description: "Which coding CLI does the implementation.",
      value: config.roles.worker.adapter,
      values: ADAPTERS,
    },
    {
      id: "worker.model",
      label: "Worker model",
      description: "Model used for the agentic coding worker.",
      value: modelLabel(config.roles.worker.adapter, config.roles.worker.model),
      submenu: modelSubmenu("worker"),
    },
    {
      id: "worker.effort",
      label: "Worker effort",
      description: "Reasoning effort for the worker. Ignored where the CLI has no effort flag.",
      value: config.roles.worker.effort ?? "default",
      values: EFFORTS,
    },
    {
      id: "ui.mode",
      label: "Mode",
      description: "plan = plan only · build = full loop · workflow = loop + validation gates.",
      value: config.ui.mode,
      values: MODES,
    },
    {
      id: "ui.theme",
      label: "Theme",
      description: "Color theme (applies immediately).",
      value: config.ui.theme,
      values: themeNames(),
    },
    {
      id: "ui.confirm_before_run",
      label: "Confirm before run",
      description: "Show a run-plan confirmation overlay before starting a task.",
      value: config.ui.confirm_before_run ? "on" : "off",
      values: TOGGLE,
    },
    {
      id: "access.approval",
      label: "Approval",
      description: "How aggressively the worker is allowed to act.",
      value: config.access.approval,
      values: APPROVALS,
    },
    {
      id: "access.sandbox",
      label: "Sandbox",
      description: "Filesystem access granted to the worker.",
      value: config.access.sandbox,
      values: SANDBOXES,
    },
    {
      id: "access.network",
      label: "Network",
      description: "Allow the worker network access (sandbox dependent).",
      value: config.access.network ? "on" : "off",
      values: TOGGLE,
    },
    {
      id: "worker.loop_policy",
      label: "Loop policy",
      description: "auto = route from task · always = review loop · never = single worker pass.",
      value: config.worker.loop_policy,
      values: LOOP_POLICIES,
    },
    {
      id: "worker.max_iterations",
      label: "Max iterations",
      description: "Architect/worker review loop depth (when not direct).",
      value: String(config.worker.max_iterations),
      values: MAX_ITERATIONS,
    },
    {
      id: "worker.stop_on_first_pass",
      label: "Stop on first pass",
      description: "End the loop when the orchestrator review passes.",
      value: config.worker.stop_on_first_pass ? "on" : "off",
      values: TOGGLE,
    },
  ];

  const onChange = (id: string, value: string): void => {
    switch (id) {
      case "orchestrator.adapter": {
        config.roles.orchestrator.adapter = value as AdapterId;
        const model = defaultModelFor(value as AdapterId, "orchestrator");
        config.roles.orchestrator.model = model;
        holder.list?.updateValue("orchestrator.model", modelLabel(value as AdapterId, model));
        break;
      }
      case "orchestrator.model": {
        config.roles.orchestrator.model = value;
        holder.list?.updateValue(
          "orchestrator.model",
          modelLabel(config.roles.orchestrator.adapter, value),
        );
        break;
      }
      case "worker.adapter": {
        config.roles.worker.adapter = value as AdapterId;
        const model = defaultModelFor(value as AdapterId, "worker");
        config.roles.worker.model = model;
        holder.list?.updateValue("worker.model", modelLabel(value as AdapterId, model));
        break;
      }
      case "worker.model": {
        config.roles.worker.model = value;
        holder.list?.updateValue("worker.model", modelLabel(config.roles.worker.adapter, value));
        break;
      }
      case "orchestrator.effort":
        config.roles.orchestrator.effort = value;
        break;
      case "worker.effort":
        config.roles.worker.effort = value;
        break;
      case "ui.mode":
        config.ui.mode = value as OlapConfig["ui"]["mode"];
        break;
      case "ui.theme":
        config.ui.theme = value;
        hooks.onThemeChange(value);
        break;
      case "ui.confirm_before_run":
        config.ui.confirm_before_run = value === "on";
        break;
      case "access.approval":
        config.access.approval = value as OlapConfig["access"]["approval"];
        break;
      case "access.sandbox":
        config.access.sandbox = value as OlapConfig["access"]["sandbox"];
        break;
      case "access.network":
        config.access.network = value === "on";
        break;
      case "worker.loop_policy":
        config.worker.loop_policy = value as OlapConfig["worker"]["loop_policy"];
        break;
      case "worker.max_iterations":
        config.worker.max_iterations = Number.parseInt(value, 10) || config.worker.max_iterations;
        break;
      case "worker.stop_on_first_pass":
        config.worker.stop_on_first_pass = value === "on";
        break;
    }
    hooks.onChange();
  };

  const list = new OlapSettingsList(items, theme, onChange, hooks.onCancel, 12, focusId);
  holder.list = list;
  return list;
}
