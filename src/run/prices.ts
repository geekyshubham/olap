import type { TokenPrice } from "../types.js";
import { MARKET_PRICES, type MarketPrice } from "./market-prices.js";

/** Normalize a model id for matching: lowercase, strip an `adapter:` prefix, turn dots/underscores/colons/spaces into dashes. */
export function normalizeModelId(model: string): string {
  return model
    .trim()
    .toLowerCase()
    .replace(/^[^:]*:/, "")
    .replace(/[._:\s]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Hand-curated aliases mapping OLAP/CLI model names to llm-prices ids. */
const MODEL_ALIASES: Record<string, string> = {
  "grok-composer": "grok-code-fast-1",
  "grok-composer-2-5-fast": "grok-code-fast-1",
  "grok-composer-2-5": "grok-code-fast-1",
  "grok-composer-fast": "grok-code-fast-1",
  "grok-code-fast": "grok-code-fast-1",
};

const VENDOR_BY_PREFIX: Array<[RegExp, string]> = [
  [/^claude/, "anthropic"],
  [/^grok/, "xai"],
  [/^gemini/, "google"],
  [/^(gpt|o[134]|codex|text-|chatgpt)/, "openai"],
  [/^deepseek/, "deepseek"],
  [/^qwen/, "qwen"],
  [/^(mistral|codestral|magistral|ministral|devstral|pixtral)/, "mistral"],
  [/^(nova|amazon)/, "amazon"],
  [/^(kimi|moonshot)/, "moonshot-ai"],
  [/^(minimax|abab)/, "minimax"],
];

const ADAPTER_VENDOR: Record<string, string> = {
  grok: "xai",
  claude: "anthropic",
  kiro: "anthropic",
  gemini: "google",
  codex: "openai",
  openai: "openai",
};

function vendorFor(adapter: string, normModel: string): string | undefined {
  for (const [re, vendor] of VENDOR_BY_PREFIX) {
    if (re.test(normModel)) return vendor;
  }
  return ADAPTER_VENDOR[adapter.trim().toLowerCase()];
}

const PRICE_BY_ID = new Map<string, MarketPrice>();
for (const price of MARKET_PRICES) {
  if (!PRICE_BY_ID.has(price.id)) PRICE_BY_ID.set(price.id, price);
}

/**
 * Resolve a market price (USD per 1M tokens) for an adapter/model from the bundled
 * llm-prices.com snapshot. Returns undefined when there is no confident match.
 */
export function resolveMarketPrice(adapter: string, model: string): TokenPrice | undefined {
  if (!model) return undefined;
  const norm = normalizeModelId(model);
  if (!norm) return undefined;
  const aliased = MODEL_ALIASES[norm] ?? norm;

  const exact = PRICE_BY_ID.get(aliased);
  if (exact) return { input: exact.input, output: exact.output };

  const vendor = vendorFor(adapter, aliased);
  let best: MarketPrice | undefined;
  for (const price of MARKET_PRICES) {
    if (vendor && price.vendor !== vendor) continue;
    if (aliased === price.id || aliased.startsWith(`${price.id}-`) || price.id.startsWith(`${aliased}-`)) {
      if (!best || price.id.length > best.id.length) best = price;
    }
  }
  if (best) return { input: best.input, output: best.output };
  return undefined;
}