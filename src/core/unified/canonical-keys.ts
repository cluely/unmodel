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
  // Five words. A clip goes in, an audio track goes in, and the geometry of
  // what comes out is the geometry of what went in — so there is no `size`,
  // no `duration` and no `aspectRatio` to state. `sync_mode` / `loop_mode` are
  // per-model extras rather than vocabulary: see `vocabulary/lipsync.ts`.
  lipsync: (["model", "source", "audio", "seed", "providerOptions"] as const),
  // The still-driven twin, and the same five words with `source` spelled
  // `image` — because it is one, and because the difference between a clip and
  // a still is the whole reason the two categories are separate.
  avatar: (["model", "image", "audio", "seed", "providerOptions"] as const),
  // Five words again, and only one of them is shared with the pair above.
  // `factor` is the category's whole reason for existing — how much BIGGER,
  // where `imageEdit` asks how the result should LOOK — and `prompt` is here
  // because three of the ten routes steer on one and it means the same thing at
  // all three. No `seed`: an upscaler re-renders a picture it was handed, so
  // the sampling noise a seed pins is a per-model extra where it exists at all.
  upscale: (["model", "source", "factor", "prompt", "providerOptions"] as const),
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
