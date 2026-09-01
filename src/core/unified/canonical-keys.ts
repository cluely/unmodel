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
  // Five words a fourth time, and the first category whose two content words
  // are ALTERNATIVES rather than companions: a 3D route is asked for a thing
  // either by describing it (`prompt`) or by showing it (`image`), and the row
  // says which of the two that route reads. No `format`: the output mesh's
  // container is spelled five different ways across the two witnesses
  // (`geometry_file_format`, `export_format`, `output_format`, a `quad` flag
  // that forces FBX, and a separate convert CALL at Tripo), so it is not one
  // word yet. No `n`, no `size`, no `aspectRatio` — a mesh has no frame.
  "3d": (["model", "prompt", "image", "seed", "providerOptions"] as const),
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
  // Four words, the smallest list here, and the one whose interesting field is
  // interesting for its ABSENCE: omitting `durationSeconds` means the
  // provider's own default (8s at Sonilo, 10 at Mirelo, 30 at Stable Audio, a
  // prompt-read guess at ElevenLabs) and a 422 at CassetteAI, which requires
  // it. No `instrumental` and no `loop` — the first is meaningless for a noise,
  // the second has one witness. See `vocabulary/sfx.ts`.
  sfx: (["model", "prompt", "durationSeconds", "outputFormat", "providerOptions"] as const),
  // Five words, three of them REQUIRED — the only category where the majority
  // of the vocabulary has to be present. A recording goes in, a target voice
  // says what it should come out as, and there is no prompt, no length and no
  // frame because the answer to all three is "whatever the recording did".
  // No `seed` and no `removeBackgroundNoise`: one witness of two apiece. See
  // `vocabulary/sts.ts`.
  sts: (["model", "audio", "voice", "outputFormat", "providerOptions"] as const),
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
