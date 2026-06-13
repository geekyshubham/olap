import type {
  AccessConfig,
  AdapterCommand,
  AdapterDetection,
  AdapterId,
  OlapConfig,
  ResolvedRole,
  RoleId,
  RunPhase,
} from "../types.js";

function shellQuote(arg: string): string {
  if (/^[A-Za-z0-9_./:=@-]+$/.test(arg)) {
    return arg;
  }
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

function adapterBinary(detection: AdapterDetection | undefined, id: AdapterId): string {
  return detection?.detected && detection.binary ? detection.binary : id;
}

function adapterOptions(config: OlapConfig, id: AdapterId) {
  return config.adapters.options[id] ?? { extra_args: [] };
}

function modelArgs(flag: string, model: string | undefined): string[] {
  return model ? [flag, model] : [];
}

/** Model to use for a phase: prefer the role model when its adapter matches, else per-adapter option. */
function modelForPhase(config: OlapConfig, adapterId: AdapterId, role: RoleId): string | undefined {
  const roleConfig = config.roles[role];
  if (roleConfig.adapter === adapterId && roleConfig.model) {
    return roleConfig.model;
  }
  return adapterOptions(config, adapterId).model;
}

/** Effort/reasoning level for a phase (only meaningful when the role's adapter matches). */
function effortForPhase(config: OlapConfig, adapterId: AdapterId, role: RoleId): string | undefined {
  const roleConfig = config.roles[role];
  if (roleConfig.adapter === adapterId) return roleConfig.effort;
  return undefined;
}

/** Map an effort level to each CLI's real flag. "default"/empty emits nothing. */
export function effortArgs(adapterId: AdapterId, effort: string | undefined): string[] {
  if (!effort || effort === "default") return [];
  switch (adapterId) {
    case "kiro":
    case "claude":
      return ["--effort", effort];
    case "codex": {
      // codex reasoning effort tops out at "high".
      const level = effort === "xhigh" || effort === "max" ? "high" : effort;
      return ["-c", `model_reasoning_effort="${level}"`];
    }
    default:
      return [];
  }
}

/** Model flag followed by the effort flag, for splicing into a command's argv. */
function modelAndEffortArgs(
  adapterId: AdapterId,
  model: string | undefined,
  effort: string | undefined,
): string[] {
  return [...modelArgs("--model", model), ...effortArgs(adapterId, effort)];
}

/**
 * grok / claude share the same permission-mode vocabulary
 * (default | acceptEdits | plan | bypassPermissions).
 */
export function permissionMode(access: AccessConfig): string {
  if (access.sandbox === "read-only") return "plan";
  if (access.sandbox === "danger-full-access") return "bypassPermissions";
  switch (access.approval) {
    case "never":
      return "bypassPermissions";
    case "untrusted":
      return "default";
    default:
      return "acceptEdits";
  }
}

/** gemini approval-mode vocabulary (plan | default | auto_edit | yolo). */
export function geminiApprovalMode(access: AccessConfig): string {
  if (access.sandbox === "read-only") return "plan";
  if (access.sandbox === "danger-full-access") return "yolo";
  switch (access.approval) {
    case "never":
      return "yolo";
    case "untrusted":
      return "default";
    default:
      return "auto_edit";
  }
}

/** codex consumes our access vocabulary directly. */
export function codexSandbox(access: AccessConfig): string {
  return access.sandbox;
}

export function codexApproval(access: AccessConfig): string {
  return access.approval;
}

function codexNetworkArgs(access: AccessConfig): string[] {
  if (access.network && access.sandbox === "workspace-write") {
    return ["-c", "sandbox_workspace_write.network_access=true"];
  }
  return [];
}

/** kiro-cli chat trust flags mapped from access (`--trust-all-tools` / `--trust-tools=`). */
export function kiroTrustArgs(access: AccessConfig, phase: "architect" | "worker"): string[] {
  if (phase === "architect" || access.sandbox === "read-only") {
    return ["--trust-tools=fs_read"];
  }
  if (access.sandbox === "danger-full-access" || access.approval === "never") {
    return ["--trust-all-tools"];
  }
  if (access.approval === "untrusted") {
    return ["--trust-tools="];
  }
  return ["--trust-tools=fs_read,fs_write"];
}

export function buildArchitectCommand(
  adapterId: AdapterId,
  prompt: string,
  config: OlapConfig,
  detection?: AdapterDetection,
): AdapterCommand {
  const binary = adapterBinary(detection, adapterId);
  const model = modelForPhase(config, adapterId, "orchestrator");
  const effort = effortForPhase(config, adapterId, "orchestrator");
  const opts = adapterOptions(config, adapterId);

  switch (adapterId) {
    case "grok":
      return {
        adapter: adapterId,
        binary,
        argv: [
          binary,
          "--permission-mode",
          "plan",
          "--output-format",
          "json",
          ...modelAndEffortArgs(adapterId, model, effort),
          ...opts.extra_args,
          "-p",
          prompt,
        ],
        shell: "",
        dry_run: true,
        phase: "architect",
      };
    case "claude":
      return {
        adapter: adapterId,
        binary,
        argv: [
          binary,
          "--print",
          "--permission-mode",
          "plan",
          "--output-format",
          "json",
          ...modelAndEffortArgs(adapterId, model, effort),
          ...opts.extra_args,
          prompt,
        ],
        shell: "",
        dry_run: true,
        phase: "architect",
      };
    case "gemini":
      return {
        adapter: adapterId,
        binary,
        argv: [
          binary,
          "--approval-mode",
          "plan",
          "--output-format",
          "json",
          ...modelAndEffortArgs(adapterId, model, effort),
          ...opts.extra_args,
          "--prompt",
          prompt,
        ],
        shell: "",
        dry_run: true,
        phase: "architect",
      };
    case "codex":
      return {
        adapter: adapterId,
        binary,
        argv: [
          binary,
          "exec",
          "--sandbox",
          "read-only",
          "--json",
          ...modelAndEffortArgs(adapterId, model, effort),
          ...opts.extra_args,
          prompt,
        ],
        shell: "",
        dry_run: true,
        phase: "architect",
      };
    case "kiro":
      return {
        adapter: adapterId,
        binary,
        argv: [
          binary,
          "chat",
          "--no-interactive",
          ...kiroTrustArgs(config.access, "architect"),
          ...modelAndEffortArgs(adapterId, model, effort),
          ...opts.extra_args,
          prompt,
        ],
        shell: "",
        dry_run: true,
        phase: "architect",
      };
  }
}

export function buildWorkerCommand(
  adapterId: AdapterId,
  task: string,
  config: OlapConfig,
  detection?: AdapterDetection,
): AdapterCommand {
  const binary = adapterBinary(detection, adapterId);
  const model = modelForPhase(config, adapterId, "worker");
  const effort = effortForPhase(config, adapterId, "worker");
  const opts = adapterOptions(config, adapterId);
  const access = config.access;

  switch (adapterId) {
    case "grok":
      return {
        adapter: adapterId,
        binary,
        argv: [
          binary,
          "--permission-mode",
          permissionMode(access),
          "--output-format",
          "json",
          ...modelAndEffortArgs(adapterId, model, effort),
          ...opts.extra_args,
          "-p",
          task,
        ],
        shell: "",
        dry_run: config.worker.dry_run,
        phase: "worker",
      };
    case "claude":
      return {
        adapter: adapterId,
        binary,
        argv: [
          binary,
          "--print",
          "--permission-mode",
          permissionMode(access),
          "--output-format",
          "json",
          ...modelAndEffortArgs(adapterId, model, effort),
          ...opts.extra_args,
          task,
        ],
        shell: "",
        dry_run: config.worker.dry_run,
        phase: "worker",
      };
    case "gemini":
      return {
        adapter: adapterId,
        binary,
        argv: [
          binary,
          "--approval-mode",
          geminiApprovalMode(access),
          "--output-format",
          "json",
          ...modelAndEffortArgs(adapterId, model, effort),
          ...opts.extra_args,
          "--prompt",
          task,
        ],
        shell: "",
        dry_run: config.worker.dry_run,
        phase: "worker",
      };
    case "codex":
      return {
        adapter: adapterId,
        binary,
        argv: [
          binary,
          "exec",
          "--sandbox",
          codexSandbox(access),
          "--ask-for-approval",
          codexApproval(access),
          ...codexNetworkArgs(access),
          "--json",
          ...modelAndEffortArgs(adapterId, model, effort),
          ...opts.extra_args,
          task,
        ],
        shell: "",
        dry_run: config.worker.dry_run,
        phase: "worker",
      };
    case "kiro":
      return {
        adapter: adapterId,
        binary,
        argv: [
          binary,
          "chat",
          "--no-interactive",
          ...kiroTrustArgs(access, "worker"),
          ...modelAndEffortArgs(adapterId, model, effort),
          ...opts.extra_args,
          task,
        ],
        shell: "",
        dry_run: config.worker.dry_run,
        phase: "worker",
      };
  }
}

export function finalizeAdapterCommand(command: AdapterCommand): AdapterCommand {
  return {
    ...command,
    shell: command.argv.map(shellQuote).join(" "),
  };
}

/** Resolve a role to a concrete adapter + model + detection. */
export function resolveRole(
  config: OlapConfig,
  role: RoleId,
  detections: AdapterDetection[],
): ResolvedRole {
  const adapter = config.roles[role].adapter;
  const model = config.roles[role].model || adapterOptions(config, adapter).model || "";
  const detection = detections.find((d) => d.id === adapter);
  return {
    role,
    adapter,
    model,
    detection,
    available: detection?.detected ?? false,
  };
}

export function resolveRoles(
  config: OlapConfig,
  detections: AdapterDetection[],
): Record<RoleId, ResolvedRole> {
  return {
    orchestrator: resolveRole(config, "orchestrator", detections),
    worker: resolveRole(config, "worker", detections),
  };
}

export function buildAdapterCommands(options: {
  adapterId: AdapterId;
  task: string;
  architectPrompt: string;
  config: OlapConfig;
  detection?: AdapterDetection;
  workerAdapterId?: AdapterId;
  workerDetection?: AdapterDetection;
}): AdapterCommand[] {
  const workerAdapter = options.workerAdapterId ?? options.adapterId;
  const workerDetection = options.workerDetection ?? options.detection;
  return [
    finalizeAdapterCommand(
      buildArchitectCommand(
        options.adapterId,
        options.architectPrompt,
        options.config,
        options.detection,
      ),
    ),
    finalizeAdapterCommand(
      buildWorkerCommand(workerAdapter, options.task, options.config, workerDetection),
    ),
  ];
}

/** Build architect + worker commands using the configured roles. */
export function buildRoleCommands(options: {
  config: OlapConfig;
  detections: AdapterDetection[];
  task: string;
  architectPrompt: string;
}): { commands: AdapterCommand[]; roles: Record<RoleId, ResolvedRole> } {
  const roles = resolveRoles(options.config, options.detections);
  return {
    roles,
    commands: buildAdapterCommands({
      adapterId: roles.orchestrator.adapter,
      detection: roles.orchestrator.detection,
      workerAdapterId: roles.worker.adapter,
      workerDetection: roles.worker.detection,
      task: options.task,
      architectPrompt: options.architectPrompt,
      config: options.config,
    }),
  };
}

export function commandForPhase(
  commands: AdapterCommand[],
  phase: RunPhase,
): AdapterCommand | undefined {
  return commands.find((command) => command.phase === phase);
}
