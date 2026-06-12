import type {
  AdapterCommand,
  AdapterDetection,
  AdapterId,
  OlapConfig,
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

export function buildArchitectCommand(
  adapterId: AdapterId,
  prompt: string,
  config: OlapConfig,
  detection?: AdapterDetection,
): AdapterCommand {
  const binary = adapterBinary(detection, adapterId);
  const opts = adapterOptions(config, adapterId);
  const model = opts.model;

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
          ...modelArgs("--model", model),
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
          ...modelArgs("--model", model),
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
          ...modelArgs("--model", model),
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
          ...modelArgs("--model", model),
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
  const opts = adapterOptions(config, adapterId);
  const model = opts.model;

  switch (adapterId) {
    case "grok":
      return {
        adapter: adapterId,
        binary,
        argv: [
          binary,
          "--permission-mode",
          "bypassPermissions",
          "--output-format",
          "json",
          ...modelArgs("--model", model),
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
          "bypassPermissions",
          "--output-format",
          "json",
          ...modelArgs("--model", model),
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
          "yolo",
          "--output-format",
          "json",
          ...modelArgs("--model", model),
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
          "workspace-write",
          "--ask-for-approval",
          "never",
          "--json",
          ...modelArgs("--model", model),
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

export function buildAdapterCommands(options: {
  adapterId: AdapterId;
  task: string;
  architectPrompt: string;
  config: OlapConfig;
  detection?: AdapterDetection;
}): AdapterCommand[] {
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
      buildWorkerCommand(options.adapterId, options.task, options.config, options.detection),
    ),
  ];
}

export function commandForPhase(
  commands: AdapterCommand[],
  phase: RunPhase,
): AdapterCommand | undefined {
  return commands.find((command) => command.phase === phase);
}
