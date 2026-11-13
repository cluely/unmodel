// Hand-maintained overlay on the generated azure catalog — refresh from
//   https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/reasoning
//     ("API and feature support", the GPT-6 reasoning models tab)
//   https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/models-sold-directly-by-azure
//     (per-model input / output limits)
// Verified 2026-11-12.
//
// Doc corrections to generated rows, and nothing else: each one quotes the
// Azure page that wins over the models.dev row. Azure re-serves other labs'
// models, and where its own pages state a different surface than the lab's,
// the Azure page is the one an `azure.chat` request meets — so the lab's rules
// (e.g. openai.chat's GPT-6 sampling rule) are not imported here.

import type { ModelInfo } from "../../core/catalog-types";
import { models } from "../../catalog/azure.gen";

/**
 * DeepSeek-V4.1-Flash output. models.dev carries `limit.output` 128000; Azure
 * lists it beside its V4 siblings at "| `DeepSeek-V4.1-Flash` |
 * chat-completion (with reasoning content) | - **Input:** text (1,000,000
 * tokens) - **Output:** text (384,000 tokens) |" (Foundry Models sold by
 * Azure, 2026-11-12) — the generated deepseek-v4-flash and deepseek-v4-pro
 * rows already carry 384000. Without it, `max_completion_tokens` above 128000
 * is refused as `over_output_limit`.
 */
const DEEPSEEK_V4_1_FLASH_MAX_OUTPUT = 384_000;
const DEEPSEEK_V4_1_FLASH = models["deepseek-v4.1-flash"];

/** The overlaid rows alone — corrections, nothing restated. */
const chatModelOverlay = {
  /**
   * GPT-6 sampling. models.dev carries `temperature: false` on all five GPT-6
   * rows, which refuses every `temperature` / `top_p` other than 1. Azure's
   * GPT-6 feature table reads "| `temperature` | ✅ | ✅ | ✅ | ✅ | ✅ |" and
   * "| `top_p` | ✅ | ✅ | ✅ | ✅ | ✅ |" across gpt-6-astra, gpt-6-sol,
   * gpt-6-luna, gpt-6.1-sol and gpt-6.1-terra (reasoning how-to,
   * 2026-11-12). The same page's "Unsupported parameters" section reads
   * "Reasoning models other than GPT-6 Astra don't support the following
   * parameters: - `temperature`, `top_p`, …" — agreeing for Astra,
   * contradicting the table for the other four. With the page split, the
   * refusal is withheld on all five: refusing a value Azure documents as
   * supported is the failure this library must not have, and a false accept
   * is the lesser one.
   */
  "gpt-6-astra": withAdjustableSampling(models["gpt-6-astra"]),
  "gpt-6-sol": withAdjustableSampling(models["gpt-6-sol"]),
  "gpt-6-luna": withAdjustableSampling(models["gpt-6-luna"]),
  "gpt-6.1-sol": withAdjustableSampling(models["gpt-6.1-sol"]),
  "gpt-6.1-terra": withAdjustableSampling(models["gpt-6.1-terra"]),
  "deepseek-v4.1-flash": {
    ...DEEPSEEK_V4_1_FLASH,
    limit: { ...DEEPSEEK_V4_1_FLASH.limit, output: DEEPSEEK_V4_1_FLASH_MAX_OUTPUT },
  },
} as const satisfies Record<string, ModelInfo>;

/**
 * Catalog `azure.chat` validates and prices against (through the
 * deployment-name resolution in ./deployment-catalog.ts): the generated azure
 * catalog with {@link chatModelOverlay} layered on top. `models` (the
 * generated table) stays exported unchanged beside it.
 */
export const chatModels = {
  ...models,
  ...chatModelOverlay,
} as const satisfies Record<string, ModelInfo>;

function withAdjustableSampling(info: ModelInfo): ModelInfo {
  return { ...info, temperature: true };
}
