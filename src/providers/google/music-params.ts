/**
 * The music adapter's **data**: the model list, the per-model narrowing table,
 * and the format spec where the category has one.
 *
 * A leaf rather than a section of the adapter beside it, because
 * `unmodel/google/values` publishes these arrays for client-side pickers and the
 * adapter imports this provider's validator, its zod schema and the compile
 * helpers in `core/unified/derive`. The adapter reads the very same objects, so
 * what is published and what is sent cannot drift.
 *
 * Import-free at runtime on purpose (the `./music` import below is type-only
 * and erased at emit) — the same rule as `./tts-constraints`: one runtime edge
 * from here to the validator would pull the generated catalog into
 * `unmodel/google/values`.
 */

import { EXTRA, type AudioFormatSpec } from "../../core/unified/derive";
import type { MusicModelParamTable } from "../../core/unified/vocabulary/music";
import type { GoogleInteractionServiceTier } from "./music";

/**
 * The music-generation guide — the page the wire shapes in `./music` are
 * audited against (fetched 2026-08-24).
 */
export const LYRIA_MUSIC_DOCS_URL = "https://ai.google.dev/gemini-api/docs/music-generation";

/** The Interactions API REST reference — the surface Lyria 3 rides. */
export const INTERACTIONS_API_DOCS_URL = "https://ai.google.dev/api/interactions-api";

/**
 * The two batch Lyria ids the guide's model table documents — the `google/…`
 * refs. Pro first: it is the full-song model and the one with an output-format
 * control.
 */
export const MODELS = ["lyria-3-pro-preview", "lyria-3-clip-preview"] as const;

/** A batch Lyria 3 model id. */
export type GoogleLyriaModelId = (typeof MODELS)[number];

/**
 * The realtime Lyria id. NOT in {@link MODELS}: it has no batch REST surface
 * at all — it streams over the Live API WebSocket (`BidiGenerateMusic`;
 * `@google/genai`'s `ai.live.music.connect()`), which a request-validation
 * library cannot build a fetchable body for. `./music` rejects it by name so
 * the error says where the model actually lives instead of "unknown model".
 */
export const LYRIA_REALTIME_MODEL_ID = "lyria-realtime-exp";

/**
 * "you can provide up to 10 images alongside your text prompt" — the guide's
 * image-input section. Enforced on `input`'s image blocks by `./music`.
 */
export const LYRIA_MAX_INPUT_IMAGES = 10;

/** Clip's fixed length: "30-second" songs, no duration control anywhere. */
export const LYRIA_CLIP_DURATION_SECONDS = 30;

/**
 * `response_format` (audio) — two canonical codecs, matching the only two
 * output formats the guide documents for Lyria 3: "MP3 (default)" and, on Pro,
 * WAV via `response_format: { type: "audio" }`.
 *
 * WAV is spelled `pcm_s16le` in the canonical vocabulary (the same split
 * `./tts-params` documents: WAV is PCM in a container, not a sixth codec).
 * No `sampleRates`/`bitrates` lists and no `defaults`: neither page enumerates
 * any, and a list invented here would refuse requests the API fulfils.
 * `bit_rate` is documented "Only applicable for compressed formats (MP3,
 * Opus)" on the Interactions reference, so it is `unavailable` on the PCM arm.
 */
export const FORMAT: AudioFormatSpec = {
  codecs: { mp3: "audio/mp3", pcm_s16le: "audio/wav" },
  containers: { pcm_s16le: ["wav"] },
  unavailable: { pcm_s16le: ["bitrate"] },
  source: LYRIA_MUSIC_DOCS_URL,
};

/**
 * The generic Interactions-API mechanics a unified caller can still reach —
 * request plumbing, not music knobs (the guide steers everything musical
 * through the prompt). All four ride the top level of the wire body verbatim.
 */
export const SHARED_EXTRAS = {
  store: EXTRA as boolean,
  background: EXTRA as boolean,
  service_tier: EXTRA as GoogleInteractionServiceTier,
  labels: EXTRA as Record<string, string>,
} as const;

/**
 * Per-model rows. The codec split is the guide's own: "This WAV format option
 * is available for Lyria 3 Pro only", and the model table lists no
 * output-format control for Clip at all — so Clip's row offers `mp3` (the
 * default it always emits) and nothing to switch.
 */
export const GOOGLE_MUSIC_MODEL_PARAMS = {
  "lyria-3-pro-preview": { codecs: ["mp3", "pcm_s16le"], extras: SHARED_EXTRAS },
  "lyria-3-clip-preview": { codecs: ["mp3"], extras: SHARED_EXTRAS },
} as const satisfies MusicModelParamTable;
