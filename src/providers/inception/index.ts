/**
 * unmodel/inception — Inception Labs' OpenAI-compatible Chat Completions
 * endpoint (the Mercury diffusion-LLM family: mercury-3, mercury-2.5,
 * mercury-2), validated against the generated models.dev catalog.
 *
 * Sources, checked 2026-11-12: https://docs.inceptionlabs.ai/get-started/models,
 * https://docs.inceptionlabs.ai/resources/faq,
 * https://docs.inceptionlabs.ai/capabilities/reasoning-efforts and
 * https://api.inceptionlabs.ai/openapi.json.
 *
 * TEMPERATURE: "`temperature` on `mercury-3`, `mercury-2.5`, and `mercury-2`
 * is restricted to the range 0.5–1.0. Values outside that range are silently
 * reset to the model's default … and the response includes a `warning` field
 * noting the reset" (FAQ). The API fulfils such a request, so
 * `checkTemperatureRange` below warns rather than refuses.
 *
 * REASONING EFFORT: `reasoning_effort` "accepts four values" — `instant`,
 * `low`, `medium`, `high` — and "`mercury-3` defaults to `low`, while
 * `mercury-2.5` and `mercury-2` default to `medium`". No source says another
 * value is refused, so nothing beyond the shared dialect is enforced.
 *
 * PRICING: mercury-3's catalog rates are a launch promotion with no published
 * end date — "Mercury 3 is 50% off at launch: $0.10 per million input tokens
 * and $0.35 per million output tokens (regularly $0.20 and $0.70)" (models
 * page). `costUSD` prices what the API bills today.
 *
 * SUNSET: "Mercury 2 and Mercury 2.5 are no longer available to new users.
 * Existing customers with usage before October 19, 2026 will keep access until
 * November 15, 2026. Enterprise customers remain supported under their
 * agreements." (https://www.inceptionlabs.ai/models, 2026-11-12). Both stay
 * validated for the keys that still reach them; any other key gets a 404,
 * "The requested model is not available for your account"
 * (https://docs.inceptionlabs.ai/resources/error-codes).
 *
 * NOT VALIDATED HERE: POST /v1/fim/completions and /v1/edit/completions
 * (mercury-edit-2 — in the generated catalog, but not on the chat endpoint's
 * model listing) and POST /v1/decisions (mercury-decide).
 */
import { createOpenAICompatible } from "../openai-compatible";
import type { ChatCompletionsBodyBase } from "../openai-compatible/wire";
import type { ModelInfo } from "../../core/catalog-types";
import type { PipelineContext } from "../../core/pipeline";
import { models, provider } from "../../catalog/inception.gen";
import type { InceptionTextModelId } from "../../catalog/inception.gen";
import { availability } from "../../catalog/availability/inception.gen";

const { chat, chatUrl, checkChat, estimateChatTokens } =
  createOpenAICompatible<InceptionTextModelId, typeof availability, "inception">({
    id: provider.id,
    // Documented base URL is https://api.inceptionlabs.ai/v1
    // (https://docs.inceptionlabs.ai/get-started/get-started); the generated
    // catalog's `api` field carries a trailing slash the factory must not see.
    baseUrl: "https://api.inceptionlabs.ai/v1",
    catalog: models,
    availability,
    extraChecks: [checkTemperatureRange],
  });

/** POST https://api.inceptionlabs.ai/v1/chat/completions */
const CHAT_COMPLETIONS_URL = chatUrl;

export { chat, checkChat, estimateChatTokens, CHAT_COMPLETIONS_URL, models, provider };
export type {
  InceptionModelId,
  InceptionTextModelId,
  InceptionImageModelId,
  InceptionAudioModelId,
  InceptionVideoModelId,
} from "../../catalog/inception.gen";

// Declaration-portability carriers. One type-only line; see
// src/core/carriers.ts for why a consumer that emits its own `.d.ts` cannot
// name this entry's inferred result types without it (TS2742 / TS2883).
export type * from "../../core/carriers";

const OPENAPI_SOURCE = "https://api.inceptionlabs.ai/openapi.json (checked 2026-11-12)";

/** "What sampling temperature to use, between 0.5 and 1." — ChatCompletionRequest.temperature */
const TEMPERATURE_RANGE = { min: 0.5, max: 1 } as const;

/**
 * The value each model substitutes for an out-of-range temperature, from the
 * same OpenAPI field: "For `mercury-2`, the default is 0.75; out-of-range
 * values are reset to 0.75 with a `warning` in the response. For
 * `mercury-2.5`, the default is 1; out-of-range values are reset to 1 with a
 * `warning` in the response. For `mercury-3`, the default is 1; out-of-range
 * values are reset to 1 with a `warning` in the response."
 */
const TEMPERATURE_DEFAULTS = {
  "mercury-2": 0.75,
  "mercury-2.5": 1,
  "mercury-3": 1,
} as const satisfies Partial<Record<InceptionTextModelId, number>>;

/**
 * An out-of-range temperature is reset to the model's default, not refused,
 * so the request runs at a temperature the caller did not ask for.
 */
function checkTemperatureRange(
  params: ChatCompletionsBodyBase,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const { model, temperature } = params;
  if (typeof temperature !== "number" || !hasTemperatureDefault(model)) return;
  if (temperature >= TEMPERATURE_RANGE.min && temperature <= TEMPERATURE_RANGE.max) return;
  const fallback = TEMPERATURE_DEFAULTS[model];
  ctx.report({
    code: "invalid_shape",
    severity: "warning",
    path: ["temperature"],
    model,
    message: `\`temperature\` is ${temperature}; ${model} accepts ${TEMPERATURE_RANGE.min}–${TEMPERATURE_RANGE.max} and resets any other value to its default ${fallback} without an error, so the request runs at ${fallback}.`,
    meta: { ...TEMPERATURE_RANGE, value: temperature, default: fallback, source: OPENAPI_SOURCE },
  });
}

function hasTemperatureDefault(model: string): model is keyof typeof TEMPERATURE_DEFAULTS {
  return Object.hasOwn(TEMPERATURE_DEFAULTS, model);
}
