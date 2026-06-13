import { SelectList } from "@earendil-works/pi-tui";
import type { AdapterId, OlapConfig, RoleId } from "../types.js";
import { defaultModelFor, findModel } from "../adapters/models.js";
import { resolveModelsForRole } from "../adapters/discover.js";
import { OlapSettingsList, type OlapSettingItem } from "./settings-list.js";
import { makeSelectListTheme, themeNames, type Theme } from "./theme.js";

const ADAPTERS: AdapterId[] = ["grok", "claude", "gemini", "codex", "kiro"];
const MODES = ["plan", "build", "workflow"];
const APPROVALS = ["untrusted", "on-failure", "on-request", "never"];
const SANDBOXES = ["read-only", "workspace-write", "danger-full-access"];
const EXECUTIONS = ["dry-run", "live"];
const TOGGLE = ["off", "on"];
const PARALLEL = ["1", "2", "3", "4", "5", "6"];
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
      theme,
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
      id: "access.execution",
      label: "Execution",
      description: "dry-run simulates; live spawns the real worker CLI (uses your API key).",
      value: config.access.execution,
      values: EXECUTIONS,
    },
    {
      id: "subagents.enabled",
      label: "Sub-agents",
      description: "Spawn worker sub-agents per iteration.",
      value: config.subagents.enabled ? "on" : "off",
      values: TOGGLE,
    },
    {
      id: "subagents.max_parallel",
      label: "Max parallel sub-agents",
      description: "Upper bound on concurrently active sub-agents.",
      value: String(config.subagents.max_parallel),
      values: PARALLEL,
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
      case "access.approval":
        config.access.approval = value as OlapConfig["access"]["approval"];
        break;
      case "access.sandbox":
        config.access.sandbox = value as OlapConfig["access"]["sandbox"];
        break;
      case "access.network":
        config.access.network = value === "on";
        break;
      case "access.execution":
        config.access.execution = value as OlapConfig["access"]["execution"];
        break;
      case "subagents.enabled":
        config.subagents.enabled = value === "on";
        break;
      case "subagents.max_parallel":
        config.subagents.max_parallel = Number.parseInt(value, 10) || config.subagents.max_parallel;
        break;
    }
    hooks.onChange();
  };

  const list = new OlapSettingsList(items, theme, onChange, hooks.onCancel, 12, focusId);
  holder.list = list;
  return list;
}
