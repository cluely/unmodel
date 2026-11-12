// Hand-maintained overlay on the generated google catalog — refresh from
//   https://ai.google.dev/gemini-api/docs/generate-content/speech-generation
//   https://ai.google.dev/gemini-api/docs/deprecations
//   https://ai.google.dev/gemini-api/docs/pricing
//   https://ai.google.dev/gemini-api/docs/models/<id>   (the hand rows below)
//
// Three kinds of entry ride on top of `src/catalog/google.gen.ts` here, and
// each is a human reading a vendor page rather than models.dev:
//
// 1. The Gemini TTS rows from ./tts-models, for the ids models.dev carries.
//    Those hand rows ARE the generated rows field for field (tts-models.test.ts
//    asserts it) plus two documented corrections — the 32k TTS context window
//    and the November 17, 2026 shutdown as `status: "deprecated"` — so taking
//    the hand row wholesale is what makes `google.chat` and `google.tts` say
//    the same thing about the same id.
// 2. A doc-sourced `limit.context` for `gemini-2.5-flash-image`: its model page
//    says 65,536 where models.dev carries 32,768, and the lower figure refused
//    32k–65k-token prompts the API accepts.
// 3. generateContent ids models.dev's google section does not carry at all
//    (`chatSupplementModels`): the Gemini 3.8 TTS pair (mirrored from
//    ./tts-models), Nano Banana 2.1 and Gemini Robotics-ER 2. Without a row
//    `google.chat` validates them with an `unknown_model` warning, no
//    per-model arm and no cost estimate.
//
// Everything else about the generated rows (pricing, modalities) is already
// correct and is deliberately NOT restated.

import type { ModelInfo } from "../../core/catalog-types";
import { models } from "../../catalog/google.gen";
import { GEMINI_TTS_MODEL_IDS } from "./constraints";
import { ttsModels, type GoogleTtsModelId } from "./tts-models";

/** The generated rows, looked up by an id that may not be a key of theirs. */
const generated: Readonly<Record<string, ModelInfo | undefined>> = models;

/**
 * The hand TTS rows for the ids models.dev carries.
 *
 * Keys are OPTIONAL because the loop below guards: the type says exactly what
 * the guard does, so `chatModels` types those ids as "the generated row or the
 * hand one" instead of pretending it knows which. A required mapped type here
 * would be the lie — `Record<string, ModelInfo>` was merely the erasure.
 */
type TtsModelOverrides = { readonly [Id in GoogleTtsModelId]?: (typeof ttsModels)[Id] };

/** The doc-corrected TTS rows (32k context, deprecated status) for the ids models.dev carries. */
export const ttsModelOverrides: TtsModelOverrides = Object.fromEntries(
  GEMINI_TTS_MODEL_IDS.flatMap((id) => {
    // Guard rather than assume: a TTS id models.dev does not carry (the 3.8
    // pair today) is not an override of anything — its row arrives through
    // `chatSupplementModels` below instead.
    if (generated[id] === undefined) return [];
    return [[id, ttsModels[id]]];
  }),
);

/**
 * "**Input token limit** 65,536 / **Output token limit** 32,768" —
 * https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash-image
 * (2026-11-12). models.dev carries `context: 32768`, which refuses a
 * 32k–65k-token prompt the API accepts; `chat.test.ts` pins both halves so the
 * correction retires the day the upstream row is fixed.
 */
export const GEMINI_25_FLASH_IMAGE_CONTEXT_TOKENS = 65536;

type FlashImageOverride = {
  readonly "gemini-2.5-flash-image"?: Omit<ModelInfo, "limit"> & {
    limit: Omit<ModelInfo["limit"], "context"> & {
      context: typeof GEMINI_25_FLASH_IMAGE_CONTEXT_TOKENS;
    };
  };
};

/** The generated `gemini-2.5-flash-image` row with its documented context, or nothing if models.dev dropped the id. */
function flashImageContextOverride(): FlashImageOverride {
  const info = generated["gemini-2.5-flash-image"];
  if (info === undefined) return {};
  return {
    "gemini-2.5-flash-image": {
      ...info,
      limit: { ...info.limit, context: GEMINI_25_FLASH_IMAGE_CONTEXT_TOKENS },
    },
  };
}

/**
 * generateContent ids absent from models.dev's google section (verified
 * 2026-11-12 against https://models.dev/api.json), each transcribed from its
 * model page and the pricing page. Every row is a human reading a vendor page;
 * the quotes are the provenance.
 *
 * `as const satisfies`, so the per-model arms in ./chat derive from these rows
 * exactly as they do from the generated ones.
 */
export const chatSupplementModels = {
  // The Gemini 3.8 TTS pair, owned by ./tts-models (the dedicated surface) and
  // mirrored here so the same ids stay valid on `google.chat`.
  "gemini-3.8-flash-tts": ttsModels["gemini-3.8-flash-tts"],
  "gemini-3.8-flash-lite-tts": ttsModels["gemini-3.8-flash-lite-tts"],
  /**
   * https://ai.google.dev/gemini-api/docs/models/gemini-nano-banana-2.1 (2026-11-12):
   * "Input token limit 131,072 / Output token limit 32,768"; inputs Text,
   * Image, Video, PDF → Image and Text; "Configurable Thinking levels
   * (`minimal`, `medium` default, and `high`)"; context caching, function
   * calling, structured outputs and code execution carry not-supported badges.
   * Pricing (https://ai.google.dev/gemini-api/docs/pricing, 2026-11-12): $1.50
   * per 1M input, "$7.50 (text and thinking) / $30.00 (images)" per 1M output —
   * `output` carries the image rate, as the generated Nano Banana rows do, so
   * a text-only answer is over-estimated rather than an image under-estimated.
   * No context caching on the Gemini API, so no `cacheRead`. The image
   * generation guide's REST sample posts to
   * `/v1/models/gemini-nano-banana-2.1:generateContent`. The changelog
   * deprecates `gemini-3.1-flash-image` in its favour (no shutdown date).
   */
  "gemini-nano-banana-2.1": {
    id: "gemini-nano-banana-2.1",
    name: "Nano Banana 2.1",
    family: "gemini-flash",
    attachment: true,
    reasoning: true,
    toolCall: false,
    structuredOutput: false,
    openWeights: false,
    releaseDate: "2026-10-06",
    lastUpdated: "2026-10-06",
    modalities: { input: ["text", "image", "video", "pdf"], output: ["text", "image"] },
    limit: { context: 131072, output: 32768 },
    cost: { input: 1.5, output: 30 },
  },
  /**
   * https://ai.google.dev/gemini-api/docs/models/gemini-robotics-er-2-preview (2026-11-12):
   * "Input token limit 131,072 / Output token limit 65,536"; inputs text,
   * images, video, audio → text; structured outputs supported; the thinking
   * guide's table: "gemini-robotics-er-2-preview — On (high) — minimal, low,
   * medium, high". Pricing (pricing page, 2026-11-12): "$1.00 (text / image /
   * video / audio) through December 31, 2026. $2.00 … starting January 1,
   * 2027." input and "$5.00 through December 31, 2026. $10.00 starting January
   * 1, 2027." output; cached $0.10 → $0.20 on the same dates — the rows below
   * are the rates in force today and must move on 2027-01-01. Deprecations:
   * "July 30, 2026 — No shutdown date announced".
   *
   * `toolCall: true` is the permissive reading: the model page states nothing
   * about function calling, and `false` would refuse `tools` on a model whose
   * page does not say it rejects them.
   */
  "gemini-robotics-er-2-preview": {
    id: "gemini-robotics-er-2-preview",
    name: "Gemini Robotics-ER 2 Preview",
    family: "gemini",
    attachment: true,
    reasoning: true,
    toolCall: true,
    structuredOutput: true,
    openWeights: false,
    releaseDate: "2026-07-30",
    lastUpdated: "2026-07-30",
    modalities: { input: ["text", "image", "video", "audio"], output: ["text"] },
    limit: { context: 131072, output: 65536 },
    cost: { input: 1, output: 5, cacheRead: 0.1, inputAudio: 1 },
  },
} as const satisfies Record<string, ModelInfo>;

/**
 * Catalog consumed by the generateContent validator: the generated google
 * catalog with the doc-corrected TTS rows and the Nano Banana context layered
 * on top, plus the hand rows above.
 *
 * `as const satisfies`, not `: Record<string, ModelInfo>` — the annotation
 * type-checks exactly the same rows and then erases every one of them: `keyof`
 * collapses to `string` and each row's `reasoning` / `toolCall` /
 * `temperature` / `modalities` flags widen to their base types, so a per-model
 * type derived from this table ("the ids whose `reasoning` is false") is not
 * merely imprecise, it is underivable. `satisfies` keeps the check and the
 * literals both.
 *
 * The overridden ids type as a UNION of the generated row and the corrected
 * one, because the override tables declare optional keys — which is the same
 * thing their guards do at run time. That is deliberately not tightened by
 * re-authoring those rows as literals here: it would trade a runtime
 * `unknown_model` for a build break the day models.dev drops an id.
 */
export const chatModels = {
  ...models,
  ...ttsModelOverrides,
  ...flashImageContextOverride(),
  ...chatSupplementModels,
} as const satisfies Record<string, ModelInfo>;
