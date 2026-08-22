/**
 * The canonical params vocabulary, per category — the one list that decides
 * whether a unified request is accepted.
 *
 * Its own module, and import-free, for two readers with opposite needs: the
 * kernel builds its envelope check from it (so every one of the six packs pays
 * for the module it lives in), and `unmodel/values` publishes it (so a form can
 * ask which fields a category takes). `./values.ts` re-exports it; nothing else
 * should reach past that.
 */

import type { UnifiedCategory } from "./types";

/**
 * The canonical vocabulary, written out per category.
 *
 * A second declaration of a type is a second thing to keep in step, and this
 * one decides whether a request is *rejected* — a vocabulary field added
 * without a matching entry here turns a call that type-checks into an
 * `unsupported_param` error at runtime. Declared `as const` so the literal
 * union is recoverable, and `test/types/canonical-keys.test-d.ts` fails
 * `tsc` in both directions the moment the two disagree.
 */
export const CANONICAL_KEY_LISTS = {
  image: ([
    "model",
    "prompt",
    "size",
    "aspectRatio",
    "dimensions",
    "resolution",
    "n",
    "seed",
    "negativePrompt",
    "outputFormat",
    "outputDelivery",
    "providerOptions",
  ] as const),
  imageEdit: ([
    "model",
    "operation",
    "prompt",
    "image",
    "strength",
    "size",
    "aspectRatio",
    "dimensions",
    "n",
    "seed",
    "outputFormat",
    "providerOptions",
  ] as const),
  video: ([
    "model",
    "prompt",
    "image",
    "video",
    "negativePrompt",
    "seed",
    "n",
    "duration",
    "resolution",
    "aspectRatio",
    "providerOptions",
  ] as const),
  tts: ([
    "model",
    "text",
    "voice",
    "speed",
    "outputFormat",
    "language",
    "providerOptions",
  ] as const),
  stt: ([
    "model",
    "audio",
    "languages",
    "diarization",
    "prompt",
    "language",
    "timestamps",
    "providerOptions",
  ] as const),
  music: ([
    "model",
    "prompt",
    "durationSeconds",
    "instrumental",
    "seed",
    "outputFormat",
    "providerOptions",
  ] as const),
  voiceClone: ([
    "model",
    "operation",
    "name",
    "samples",
    "language",
    "description",
    "noiseReduction",
    "visibility",
    "voiceId",
    "providerOptions",
  ] as const),
  voiceDesign: ([
    "model",
    "operation",
    "prompt",
    "previewText",
    "n",
    "seed",
    "guidance",
    "language",
    "providerOptions",
  ] as const),
} satisfies Readonly<Record<UnifiedCategory, readonly string[]>>;
