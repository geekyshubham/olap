import type {
  CostSnapshot,
  OlapConfig,
  ResolvedRole,
  RoleId,
  RoleUsage,
  TokenPrice,
  UsageSnapshot,
} from "../types.js";

type RoleMap = Record<RoleId, ResolvedRole>;

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function priceFor(config: OlapConfig, role: ResolvedRole): TokenPrice | undefined {
  const adapterPrices = config.cost.prices_per_million_tokens[role.adapter];
  if (!adapterPrices) return undefined;
  return adapterPrices[role.model] ?? adapterPrices["*"];
}

function roleCost(usage: RoleUsage, price: TokenPrice | undefined): number {
  if (!price) return 0;
  return roundUsd((usage.tokens_in / 1_000_000) * price.input + (usage.tokens_out / 1_000_000) * price.output);
}

export function estimateUsageCost(
  config: OlapConfig,
  usage: UsageSnapshot,
  roles: RoleMap,
): CostSnapshot {
  if (!config.cost.enabled) {
    return {
      enabled: false,
      currency: config.cost.currency,
      orchestrator_usd: 0,
      worker_usd: 0,
      total_usd: 0,
      single_model_baseline_usd: 0,
      savings_usd: 0,
      savings_percent: 0,
      pricing_complete: false,
    };
  }

  const orchestratorPrice = priceFor(config, roles.orchestrator);
  const workerPrice = priceFor(config, roles.worker);
  const orchestrator = roleCost(usage.orchestrator, orchestratorPrice);
  const worker = roleCost(usage.worker, workerPrice);
  const total = roundUsd(orchestrator + worker);

  const combinedUsage: RoleUsage = {
    tokens_in: usage.orchestrator.tokens_in + usage.worker.tokens_in,
    tokens_out: usage.orchestrator.tokens_out + usage.worker.tokens_out,
    calls: usage.orchestrator.calls + usage.worker.calls,
  };
  const baseline = roleCost(combinedUsage, orchestratorPrice);
  const savings = roundUsd(Math.max(0, baseline - total));
  const savingsPercent = baseline > 0 ? Math.round((savings / baseline) * 100) : 0;
  const budget = config.cost.session_budget_usd > 0 ? config.cost.session_budget_usd : undefined;
  return {
    enabled: true,
    currency: config.cost.currency,
    orchestrator_usd: orchestrator,
    worker_usd: worker,
    total_usd: total,
    single_model_baseline_usd: baseline,
    savings_usd: savings,
    savings_percent: savingsPercent,
    pricing_complete: !!orchestratorPrice && !!workerPrice,
    budget_usd: budget,
    budget_used_percent: budget ? Math.round((total / budget) * 100) : undefined,
    budget_exceeded: budget ? total > budget : false,
  };
}

export function formatUsd(value: number): string {
  if (value === 0) return "$0.0000";
  if (value < 0.0001) return "<$0.0001";
  return `$${value.toFixed(4)}`;
}

export function formatCostSummary(cost: CostSnapshot, estimated = false): string {
  if (!cost.enabled) return "cost estimates disabled";
  if (!cost.pricing_complete) {
    return "cost n/a — add cost.prices_per_million_tokens for these models";
  }
  const tilde = estimated ? "~" : "";
  const suffix = estimated ? " (est)" : "";
  const parts = [
    `cost ${tilde}${formatUsd(cost.total_usd)}`,
    `single-model ${tilde}${formatUsd(cost.single_model_baseline_usd)}`,
    `saved ${cost.savings_percent}%${suffix}`,
  ];
  if (cost.budget_usd) {
    parts.push(`budget ${cost.budget_used_percent ?? 0}%`);
  }
  return parts.join(" · ");
}
