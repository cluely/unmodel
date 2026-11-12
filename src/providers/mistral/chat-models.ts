// Hand-maintained overlay on the generated mistral catalog — refresh from
//   https://docs.mistral.ai/getting-started/models   (ids, lifecycle dates)
//   https://docs.mistral.ai/models/<card>             (each card's `"names"` alias array, in page source)
//   https://docs.mistral.ai/inference/pricing         (rates)
// Verified 2026-11-12.
//
// Two kinds of row, and no others:
//
// - **Vendor aliases models.dev does not carry.** Every Mistral model card
//   lists all the ids that serve its model. An alias row is the generated row
//   of the id it resolves to, re-keyed — never a second opinion on its numbers.
// - **Doc corrections to generated rows**, each quoting the page that wins.

import type { ModelInfo } from "../../core/catalog-types";
import { models } from "../../catalog/mistral.gen";

/**
 * Mistral Large 4 as its card states it — "November 5, 2026 GA Mistral
 * Ecosystem Open Weight License v 26.10", with the Weights tab linking
 * huggingface.co/mistralai/Mistral-Large-4-1T-A52B
 * (https://docs.mistral.ai/models/mistral-large-4-0, 2026-11-12). models.dev
 * still carries the October Public Preview (`status: "beta"`,
 * `openWeights: false`). Rates match the pricing page: "Mistral Large 4 ↗ $0.7
 * $0.07 $2.1".
 */
const { status: _publicPreview, ...large4 } = models["mistral-large-4"];
const LARGE_4 = { ...large4, openWeights: true } as const;

/**
 * Mistral Medium 3.5, the row behind the documented `mistral-medium-latest`
 * alias. Its rates ($1.5 / $0.15 cached / $7.5) survive only on the archived
 * pricing page — "Mistral Medium 3.5 ↗ $1.5 $0.15 $7.5"
 * (http://web.archive.org/web/20260915134103/https://docs.mistral.ai/inference/pricing);
 * the live page dropped the row when the model was deprecated.
 */
const MEDIUM_3_5 = models["mistral-medium-latest"];

/**
 * Ministral 3 3B: "ministral-3b-2512 +1 … Context i 256k"
 * (https://docs.mistral.ai/models/ministral-3-3b-25-12, 2026-11-12). models.dev
 * carries 131072, which refuses valid 128k–256k prompts as `over_context`.
 */
const MINISTRAL_3B = models["ministral-3b-2512"];

/**
 * DeepSeek V4.1 Flash 1017 takes images: "A third-party open weight model from
 * DeepSeek with text and image inputs and a 1M-token context window"
 * (https://docs.mistral.ai/getting-started/models, 2026-11-12). models.dev
 * carries text only, which refuses every `image_url` part.
 */
const DEEPSEEK_V4_1_FLASH = models["deepseek-v4-1-flash-1017"];

/** Z.ai GLM 5.3, the row its two aliases resolve to. */
const GLM_5_3 = models["zai-glm-5-3"];

/** The overlaid rows alone — aliases and corrections, nothing restated. */
const chatModelOverlay = {
  "mistral-large-4": LARGE_4,
  /** `"names":["mistral-large-4","mistral-large-4-0","mistral-large-latest"]`. */
  "mistral-large-4-0": { ...LARGE_4, id: "mistral-large-4-0" },
  /**
   * `"names":["mistral-medium-3-5","mistral-medium-3","mistral-medium-latest"]`
   * (https://docs.mistral.ai/models/mistral-medium-3-5-26-04, page source,
   * 2026-11-12), and the card reads "This model is deprecated. Use Mistral
   * Large 4 for new integrations. Deprecation date 10/31/2026" — it is served
   * until 4/30/2027.
   */
  "mistral-medium-3-5": { ...MEDIUM_3_5, id: "mistral-medium-3-5", status: "deprecated" },
  "mistral-medium-3": { ...MEDIUM_3_5, id: "mistral-medium-3", status: "deprecated" },
  /**
   * `"names":["ministral-14b-2512","ministral-14b-latest"]`
   * (https://docs.mistral.ai/models/ministral-3-14b-25-12, page source,
   * 2026-11-12); the vision guide's curl example sends
   * `"model": "ministral-14b-latest"`.
   */
  "ministral-14b-latest": { ...models["ministral-14b-2512"], id: "ministral-14b-latest" },
  "ministral-3b-2512": { ...MINISTRAL_3B, limit: { ...MINISTRAL_3B.limit, context: 262_144 } },
  "deepseek-v4-1-flash-1017": {
    ...DEEPSEEK_V4_1_FLASH,
    modalities: { input: ["text", "image"], output: ["text"] },
  },
  /**
   * `"names":["zai-glm-5-3","zai-glm-5","zai-glm-latest"]`
   * (https://docs.mistral.ai/models/zai-glm-5-3, page source, 2026-11-12).
   */
  "zai-glm-5": { ...GLM_5_3, id: "zai-glm-5" },
  "zai-glm-latest": { ...GLM_5_3, id: "zai-glm-latest" },
} as const satisfies Record<string, ModelInfo>;

/**
 * Catalog `mistral.chat` validates and prices against: the generated mistral
 * catalog with {@link chatModelOverlay} layered on top. `models` (the
 * generated table) stays exported unchanged beside it.
 */
export const chatModels = {
  ...models,
  ...chatModelOverlay,
} as const satisfies Record<string, ModelInfo>;

/** Every id `mistral.chat` catalogs — the generated ids plus the vendor aliases above. */
export type MistralChatModelId = keyof typeof chatModels;
