import type { EndpointConstraints, FamilyRule, DenyRule } from "../../core/constraint-types";
import type { OpenaiImageModelId } from "../../catalog/openai.gen";
import type { SoraModelId } from "./videos-models";
import type { OpenaiSpeechModelId, OpenaiTranscriptionModelId } from "./audio-models";

/**
 * dall-e ids the images endpoints still accept. They are absent from
 * models.dev, so src/providers/openai/images-models.ts hand-supplements them.
 */
export type DallEModelId = "dall-e-2" | "dall-e-3";

/** Dated snapshot of gpt-image-2 the API accepts; absent from models.dev. */
export type GptImage2SnapshotId = "gpt-image-2-2026-04-21";

/**
 * The GPT-Image-2.5 Sunburst and Flare ids and their dated snapshots
 * ("Default snapshot: `gpt-image-2.5-sunburst-2026-09-08`" /
 * "`gpt-image-2.5-flare-2026-09-08`" on the model pages, 2026-11-12); absent
 * from models.dev, hand-supplemented in ./images-models.ts.
 */
export type GptImage25ModelId =
  | "gpt-image-2.5-sunburst"
  | "gpt-image-2.5-sunburst-2026-09-08"
  | "gpt-image-2.5-flare"
  | "gpt-image-2.5-flare-2026-09-08";

/** The GPT-Image-2.6 Sunburst and Flare ids (no dated snapshot); absent from models.dev. */
export type GptImage26ModelId = "gpt-image-2.6-sunburst" | "gpt-image-2.6-flare";

// ---------------------------------------------------------------------------
// Images — doc URLs. Every rule below cites one of these.
// ---------------------------------------------------------------------------

const IMAGES_CREATE_DOCS = "https://developers.openai.com/api/docs/api-reference/images/create";
const IMAGES_EDIT_DOCS = "https://developers.openai.com/api/docs/api-reference/images/createEdit";
const IMAGE_GUIDE_DOCS = "https://developers.openai.com/api/docs/guides/image-generation";

const GPT_IMAGE_SIZES = ["auto", "1024x1024", "1536x1024", "1024x1536"] as const;
const GPT_IMAGE_QUALITIES = ["auto", "low", "medium", "high"] as const;
/**
 * "`gpt-image-2.5-sunburst` and `gpt-image-2.5-flare`, including their
 * `2026-09-08` snapshots, also support `xhigh` and `max`." — images/create
 * reference. The image-generation guide extends the ladder to 2.6: "For the
 * Sunburst and Flare models in both GPT-Image-2.6 and GPT-Image-2.5, the
 * quality options are `low`, `medium`, `high`, `xhigh`, and `max`." (both
 * read 2026-11-12; the reference names only 2.5, the guide names both — the
 * permissive superset is kept).
 */
const GPT_IMAGE_25_QUALITIES = [...GPT_IMAGE_QUALITIES, "xhigh", "max"] as const;
const GPT_IMAGE_OUTPUT_FORMATS = ["png", "jpeg", "webp"] as const;
/**
 * GPT-Image-2.6 adds animated and vector output: "Released GPT-Image-2.6
 * Sunburst and GPT-Image-2.6 Flare for image generation and editing"
 * (changelog, 2026-11-04) with `output_format` `gif` and `svg` on the
 * images/create reference, read 2026-11-12. Both are access-gated ("Requires
 * access to the GIF preview for the selected model." / "SVG output requires a
 * supported image model and project access."), which a validator cannot see,
 * so the formats are accepted and only their documented pairings are checked
 * (checkGifAndSvgOutput in images-shared.ts).
 */
const GPT_IMAGE_26_OUTPUT_FORMATS = [...GPT_IMAGE_OUTPUT_FORMATS, "gif", "svg"] as const;
/**
 * "The supported complexity levels for Sunburst and Flare are `low`, `medium`,
 * and `high`." / "If you omit `complexity`, both models use `high`." —
 * image-generation guide, GPT-Image-2.6 section, read 2026-11-12.
 */
const GPT_IMAGE_26_COMPLEXITIES = ["low", "medium", "high"] as const;
const GPT_IMAGE_MODERATIONS = ["low", "auto"] as const;
const DALL_E_RESPONSE_FORMATS = ["url", "b64_json"] as const;
const INPUT_FIDELITIES = ["high", "low"] as const;

/** "This parameter is only supported for `dall-e-3`." — images/create. */
const STYLE_IS_DALL_E_3_ONLY: DenyRule = {
  reason: "`style` is only supported for dall-e-3",
  source: IMAGES_CREATE_DOCS,
};

/**
 * "This parameter is only supported for `dall-e-2` and `dall-e-3` ... GPT
 * image models always return base64-encoded images." — images/create.
 */
const RESPONSE_FORMAT_IS_DALL_E_ONLY: DenyRule = {
  reason:
    "`response_format` is only supported for the dall-e models — GPT image models always return base64-encoded images",
  source: IMAGES_CREATE_DOCS,
};

/** Params images/create documents as "only supported for the GPT image models". */
const gptImageOnly = (param: string, source: string): DenyRule => ({
  reason: `\`${param}\` is only supported for the GPT image models`,
  source,
});

const DALL_E_DENIES = (source: string): Record<string, DenyRule> => ({
  background: gptImageOnly("background", source),
  moderation: gptImageOnly("moderation", source),
  output_format: gptImageOnly("output_format", source),
  output_compression: gptImageOnly("output_compression", source),
  partial_images: gptImageOnly("partial_images", source),
  stream: gptImageOnly("stream", source),
});

const GPT_IMAGE_DENIES: Record<string, DenyRule> = {
  response_format: RESPONSE_FORMAT_IS_DALL_E_ONLY,
  style: STYLE_IS_DALL_E_3_ONLY,
};

const GPT_IMAGE_ENUMS: EndpointConstraints["enums"] = {
  size: GPT_IMAGE_SIZES,
  quality: GPT_IMAGE_QUALITIES,
  output_format: GPT_IMAGE_OUTPUT_FORMATS,
  moderation: GPT_IMAGE_MODERATIONS,
  background: ["transparent", "opaque", "auto"],
};

/**
 * gpt-image-2 accepts arbitrary "WIDTHxHEIGHT" sizes (divisible by 16, aspect
 * ratio at most 3:1, max edge 3840px, 655,360–8,294,400 total pixels), so
 * `size` carries no enum here — see checkGptImage2Size in images.ts.
 *
 * `background` takes all three values, including `transparent`:
 * "Transparent backgrounds are available for supported GPT Image models. For
 * `gpt-image-2` and `gpt-image-2-2026-04-21`, this support is in preview."
 * (images/create and images/createEdit references, checked 2026-08-31). The
 * `transparent`↔`output_format` coupling both references state is enforced by
 * checkTransparentOutputFormat in images-shared.ts.
 */
const GPT_IMAGE_2_ENUMS: EndpointConstraints["enums"] = {
  quality: GPT_IMAGE_QUALITIES,
  output_format: GPT_IMAGE_OUTPUT_FORMATS,
  moderation: GPT_IMAGE_MODERATIONS,
  background: ["transparent", "opaque", "auto"],
};

/**
 * GPT-Image-2.5: gpt-image-2's surface (free-form `size`, checked by
 * checkGptImage2Size — the create reference's free-form sentence names
 * "`gpt-image-2`, `gpt-image-2-2026-04-21`, `gpt-image-2.5-sunburst` and
 * `gpt-image-2.5-flare`, including their `2026-09-08` snapshots") with the
 * wider quality ladder.
 */
const GPT_IMAGE_25_ENUMS: EndpointConstraints["enums"] = {
  ...GPT_IMAGE_2_ENUMS,
  quality: GPT_IMAGE_25_QUALITIES,
};

/**
 * GPT-Image-2.6: the 2.5 surface plus `gif`/`svg` output and `complexity`.
 * `size` carries no enum AND is not checked by checkGptImage2Size: the
 * reference's free-form sentence stops at 2.5, and the guide's "Both models
 * also support custom dimensions" sits in a section that names the 2.5 ids —
 * an undocumented narrowing would false-positive, so 2.6 takes any string.
 */
const GPT_IMAGE_26_ENUMS: EndpointConstraints["enums"] = {
  ...GPT_IMAGE_25_ENUMS,
  output_format: GPT_IMAGE_26_OUTPUT_FORMATS,
  complexity: GPT_IMAGE_26_COMPLEXITIES,
};

/**
 * Per-model constraint table for openai.image (POST /v1/images/generations),
 * audited param-by-param against the create API reference and the
 * image-generation guide on 2026-08-13 (GPT-Image-2.5 / 2.6 rows added
 * 2026-11-12). Enum narrowing and deny rules both come from the documented
 * per-model applicability notes; the deny reasons quote them.
 */
export const imageConstraints = {
  "gpt-image-1-mini": { deny: GPT_IMAGE_DENIES, enums: GPT_IMAGE_ENUMS },
  "gpt-image-1.5": { deny: GPT_IMAGE_DENIES, enums: GPT_IMAGE_ENUMS },
  // The create reference's model list ends "…`gpt-image-2.6-flare`, and
  // `chatgpt-image-latest`." (2026-11-12): a generations model with the GPT
  // Image 1 surface, as on edits.
  "chatgpt-image-latest": { deny: GPT_IMAGE_DENIES, enums: GPT_IMAGE_ENUMS },
  "gpt-image-2": { deny: GPT_IMAGE_DENIES, enums: GPT_IMAGE_2_ENUMS },
  "gpt-image-2-2026-04-21": { deny: GPT_IMAGE_DENIES, enums: GPT_IMAGE_2_ENUMS },
  "gpt-image-2.5-sunburst": { deny: GPT_IMAGE_DENIES, enums: GPT_IMAGE_25_ENUMS },
  "gpt-image-2.5-sunburst-2026-09-08": { deny: GPT_IMAGE_DENIES, enums: GPT_IMAGE_25_ENUMS },
  "gpt-image-2.5-flare": { deny: GPT_IMAGE_DENIES, enums: GPT_IMAGE_25_ENUMS },
  "gpt-image-2.5-flare-2026-09-08": { deny: GPT_IMAGE_DENIES, enums: GPT_IMAGE_25_ENUMS },
  "gpt-image-2.6-sunburst": { deny: GPT_IMAGE_DENIES, enums: GPT_IMAGE_26_ENUMS },
  "gpt-image-2.6-flare": { deny: GPT_IMAGE_DENIES, enums: GPT_IMAGE_26_ENUMS },
  "dall-e-2": {
    deny: { ...DALL_E_DENIES(IMAGES_CREATE_DOCS), style: STYLE_IS_DALL_E_3_ONLY },
    enums: {
      size: ["256x256", "512x512", "1024x1024"],
      quality: ["auto", "standard"],
      response_format: DALL_E_RESPONSE_FORMATS,
    },
  },
  "dall-e-3": {
    deny: DALL_E_DENIES(IMAGES_CREATE_DOCS),
    enums: {
      size: ["1024x1024", "1792x1024", "1024x1792"],
      quality: ["auto", "standard", "hd"],
      style: ["vivid", "natural"],
      response_format: DALL_E_RESPONSE_FORMATS,
      n: [1],
    },
  },
} as const satisfies Partial<
  Record<
    OpenaiImageModelId | DallEModelId | GptImage2SnapshotId | GptImage25ModelId | GptImage26ModelId,
    EndpointConstraints
  >
>;

// ---------------------------------------------------------------------------
// Images edit (POST /v1/images/edits)
// ---------------------------------------------------------------------------

/**
 * `input_fidelity` is a GPT image param; dall-e-2 has none. The createEdit
 * reference (2026-11-12) scopes it as "Supports `high` and `low` on
 * `gpt-image-1.5`; `gpt-image-1-mini` supports only `low`." — so
 * gpt-image-1-mini is narrowed, not denied (see GPT_IMAGE_1_MINI_EDIT_ENUMS).
 */
const INPUT_FIDELITY_UNSUPPORTED: DenyRule = {
  reason: "`input_fidelity` is not supported by this model",
  source: IMAGES_EDIT_DOCS,
};

/**
 * "Supports `high` and `low` on `gpt-image-1.5`; `gpt-image-1-mini` supports
 * only `low`." / "Defaults to `low` on supported models." — createEdit
 * reference, read 2026-11-12.
 */
const GPT_IMAGE_1_MINI_EDIT_ENUMS: EndpointConstraints["enums"] = {
  ...GPT_IMAGE_ENUMS,
  input_fidelity: ["low"],
};

/**
 * "For `gpt-image-2`, omit this parameter; the API doesn't allow changing it
 * because the model processes every image input at high fidelity
 * automatically." — image-generation guide.
 */
const INPUT_FIDELITY_FIXED_HIGH: DenyRule = {
  reason:
    "gpt-image-2 processes every image input at high fidelity automatically and the API does not allow changing `input_fidelity`",
  source: IMAGE_GUIDE_DOCS,
};

/** Uploaded image limits for the GPT image models — createEdit reference. */
const GPT_IMAGE_EDIT_MEDIA: EndpointConstraints["media"] = {
  image: {
    // "each image should be a `png`, `webp`, or `jpg` file less than 50MB"
    maxBytes: 50 * 1024 * 1024,
    formats: ["png", "webp", "jpeg"],
  },
};

/** dall-e-2 edit input: "a square `png` file less than 4MB". */
const DALL_E_2_EDIT_MEDIA: EndpointConstraints["media"] = {
  image: { maxBytes: 4 * 1024 * 1024, formats: ["png"] },
};

const GPT_IMAGE_EDIT_ENUMS: EndpointConstraints["enums"] = {
  ...GPT_IMAGE_ENUMS,
  input_fidelity: INPUT_FIDELITIES,
};

const GPT_IMAGE_EDIT_DENIES: Record<string, DenyRule> = {
  response_format: {
    reason:
      "`response_format` is only supported for dall-e-2 — GPT image models always return base64-encoded images",
    source: IMAGES_EDIT_DOCS,
  },
};

/**
 * GPT-Image-2.5 / 2.6 on edits: the generations enums plus `input_fidelity`'s
 * documented value set. The createEdit reference narrows `input_fidelity` only
 * for the GPT Image 1 family ("Supports `high` and `low` on `gpt-image-1.5`;
 * `gpt-image-1-mini` supports only `low`.", 2026-11-12) and says nothing for
 * 2.5 / 2.6, so neither a deny nor a one-value enum would be documented here.
 * `output_format` `svg` stays accepted on 2.6 edits: the edit reference lists
 * it and documents the `svg` object, while the guide reads "The image edit
 * endpoint does not support SVG output" — two pages conflict and no 400 is on
 * record, so the request is sent as written.
 */
const GPT_IMAGE_25_EDIT_ENUMS: EndpointConstraints["enums"] = {
  ...GPT_IMAGE_25_ENUMS,
  input_fidelity: INPUT_FIDELITIES,
};

const GPT_IMAGE_26_EDIT_ENUMS: EndpointConstraints["enums"] = {
  ...GPT_IMAGE_26_ENUMS,
  input_fidelity: INPUT_FIDELITIES,
};

/**
 * Per-model constraint table for openai.imageEdit (POST /v1/images/edits),
 * audited against the createEdit API reference and the image-generation guide
 * on 2026-08-13 (GPT-Image-2.5 / 2.6 rows added 2026-11-12). `dall-e-3` is
 * deliberately absent: the endpoint documents "One of `dall-e-2` or a GPT
 * image model", so dall-e-3 is not an edit model.
 */
export const imagesEditConstraints = {
  "gpt-image-1-mini": {
    deny: GPT_IMAGE_EDIT_DENIES,
    enums: GPT_IMAGE_1_MINI_EDIT_ENUMS,
    media: GPT_IMAGE_EDIT_MEDIA,
  },
  "gpt-image-1.5": { deny: GPT_IMAGE_EDIT_DENIES, enums: GPT_IMAGE_EDIT_ENUMS, media: GPT_IMAGE_EDIT_MEDIA },
  "gpt-image-2": {
    deny: { ...GPT_IMAGE_EDIT_DENIES, input_fidelity: INPUT_FIDELITY_FIXED_HIGH },
    enums: GPT_IMAGE_2_ENUMS,
    media: GPT_IMAGE_EDIT_MEDIA,
  },
  "gpt-image-2-2026-04-21": {
    deny: { ...GPT_IMAGE_EDIT_DENIES, input_fidelity: INPUT_FIDELITY_FIXED_HIGH },
    enums: GPT_IMAGE_2_ENUMS,
    media: GPT_IMAGE_EDIT_MEDIA,
  },
  "gpt-image-2.5-sunburst": {
    deny: GPT_IMAGE_EDIT_DENIES,
    enums: GPT_IMAGE_25_EDIT_ENUMS,
    media: GPT_IMAGE_EDIT_MEDIA,
  },
  "gpt-image-2.5-sunburst-2026-09-08": {
    deny: GPT_IMAGE_EDIT_DENIES,
    enums: GPT_IMAGE_25_EDIT_ENUMS,
    media: GPT_IMAGE_EDIT_MEDIA,
  },
  "gpt-image-2.5-flare": {
    deny: GPT_IMAGE_EDIT_DENIES,
    enums: GPT_IMAGE_25_EDIT_ENUMS,
    media: GPT_IMAGE_EDIT_MEDIA,
  },
  "gpt-image-2.5-flare-2026-09-08": {
    deny: GPT_IMAGE_EDIT_DENIES,
    enums: GPT_IMAGE_25_EDIT_ENUMS,
    media: GPT_IMAGE_EDIT_MEDIA,
  },
  "gpt-image-2.6-sunburst": {
    deny: GPT_IMAGE_EDIT_DENIES,
    enums: GPT_IMAGE_26_EDIT_ENUMS,
    media: GPT_IMAGE_EDIT_MEDIA,
  },
  "gpt-image-2.6-flare": {
    deny: GPT_IMAGE_EDIT_DENIES,
    enums: GPT_IMAGE_26_EDIT_ENUMS,
    media: GPT_IMAGE_EDIT_MEDIA,
  },
  "chatgpt-image-latest": {
    deny: GPT_IMAGE_EDIT_DENIES,
    enums: GPT_IMAGE_EDIT_ENUMS,
    media: GPT_IMAGE_EDIT_MEDIA,
  },
  "dall-e-2": {
    deny: {
      ...DALL_E_DENIES(IMAGES_EDIT_DOCS),
      input_fidelity: INPUT_FIDELITY_UNSUPPORTED,
    },
    enums: {
      size: ["256x256", "512x512", "1024x1024"],
      // `quality` is documented as "Output quality for GPT image models",
      // but the OpenAPI type keeps `standard` — dall-e-2's only value — so
      // the param is narrowed, not denied.
      quality: ["auto", "standard"],
      response_format: DALL_E_RESPONSE_FORMATS,
    },
    media: DALL_E_2_EDIT_MEDIA,
  },
} as const satisfies Partial<
  Record<
    OpenaiImageModelId | "dall-e-2" | GptImage2SnapshotId | GptImage25ModelId | GptImage26ModelId,
    EndpointConstraints
  >
>;

// ---------------------------------------------------------------------------
// Audio — speech (POST /v1/audio/speech)
// ---------------------------------------------------------------------------

const SPEECH_DOCS = "https://developers.openai.com/api/docs/api-reference/audio/createSpeech";

/** Source for the per-model voice lists below. */
export const TTS_GUIDE_DOCS = "https://developers.openai.com/api/docs/guides/text-to-speech";

/** "Supported formats are `mp3`, `opus`, `aac`, `flac`, `wav`, and `pcm`." */
export const SPEECH_RESPONSE_FORMATS = ["mp3", "opus", "aac", "flac", "wav", "pcm"] as const;

/**
 * The 13 built-in voices gpt-4o-mini-tts supports — "`alloy`, `ash`,
 * `ballad`, `coral`, `echo`, `fable`, `onyx`, `nova`, `sage`, `shimmer`,
 * `verse`, `marin`, and `cedar`" (createTts reference). WIDENED from the
 * openai@7.4.0 `SpeechCreateParams["voice"]` union, which omits `fable`,
 * `onyx` and `nova` even though its own docstring lists them.
 */
export const SPEECH_VOICES = [
  "alloy",
  "ash",
  "ballad",
  "coral",
  "echo",
  "fable",
  "onyx",
  "nova",
  "sage",
  "shimmer",
  "verse",
  "marin",
  "cedar",
] as const;

/**
 * "tts-1 and tts-1-hd support a smaller set: alloy, ash, coral, echo, fable,
 * onyx, nova, sage, and shimmer." — text-to-speech guide. (`ballad`, `verse`,
 * `marin` and `cedar` are gpt-4o-mini-tts-only.)
 */
export const TTS_1_VOICES = [
  "alloy",
  "ash",
  "coral",
  "echo",
  "fable",
  "onyx",
  "nova",
  "sage",
  "shimmer",
] as const;

/** "Does not work with `tts-1` or `tts-1-hd`." — createTts reference. */
const INSTRUCTIONS_UNSUPPORTED: DenyRule = {
  reason: "`instructions` does not work with tts-1 or tts-1-hd",
  source: SPEECH_DOCS,
};

/** "`sse` is not supported for `tts-1` or `tts-1-hd`." — createTts reference. */
// NOTE: `voice` deliberately carries NO enum. Its value may be a custom voice
// OBJECT (`{ id: "voice_1234" }`), which the generic enum layer would reject
// out of hand; the string form is validated by checkVoice in speech.ts
// against the same per-model lists.
const TTS_1_ENUMS: EndpointConstraints["enums"] = {
  response_format: SPEECH_RESPONSE_FORMATS,
  stream_format: ["audio"],
};

const GPT_4O_MINI_TTS_ENUMS: EndpointConstraints["enums"] = {
  response_format: SPEECH_RESPONSE_FORMATS,
  stream_format: ["sse", "audio"],
};

/**
 * Per-model constraint table for openai.tts, audited against the
 * createTts API reference and the text-to-speech guide on 2026-08-13.
 * `voice` is enumerated here only for the string form — a custom voice object
 * (`{ id: "voice_1234" }`) bypasses the enum layer (it is not a string) and
 * is checked in speech.ts instead.
 */
export const ttsConstraints = {
  "tts-1": {
    deny: { instructions: INSTRUCTIONS_UNSUPPORTED },
    enums: TTS_1_ENUMS,
  },
  "tts-1-hd": {
    deny: { instructions: INSTRUCTIONS_UNSUPPORTED },
    enums: TTS_1_ENUMS,
  },
  "gpt-4o-mini-tts": { enums: GPT_4O_MINI_TTS_ENUMS },
  "gpt-4o-mini-tts-2025-12-15": { enums: GPT_4O_MINI_TTS_ENUMS },
} as const satisfies Partial<Record<OpenaiSpeechModelId, EndpointConstraints>>;

// ---------------------------------------------------------------------------
// Audio — transcription (POST /v1/audio/transcriptions)
// ---------------------------------------------------------------------------

const TRANSCRIPTION_DOCS =
  "https://developers.openai.com/api/docs/api-reference/audio/createTranscription";
const STT_GUIDE_DOCS = "https://developers.openai.com/api/docs/guides/speech-to-text";

/** "`json`, `text`, `srt`, `verbose_json`, `vtt`, or `diarized_json`". */
export const TRANSCRIPTION_RESPONSE_FORMATS = [
  "json",
  "text",
  "srt",
  "verbose_json",
  "vtt",
  "diarized_json",
] as const;

/**
 * Documented input formats. THE TWO PAGES CONFLICT (both re-read 2026-08-13):
 * - createTranscription (TRANSCRIPTION_DOCS): "The audio file object (not
 *   file name) to transcribe, in one of these formats: flac, mp3, mp4, mpeg,
 *   mpga, m4a, ogg, wav, or webm."
 * - the speech-to-text guide (STT_GUIDE_DOCS), the same page the 25 MB cap
 *   comes from: "Supported input formats are `mp3`, `mp4`, `mpeg`, `mpga`,
 *   `m4a`, `wav`, and `webm`." — no flac, no ogg.
 * The permissive superset (the reference's nine) is kept, matching the policy
 * used for the conflicting Google media pages: a false positive on a format
 * the API does accept is worse than passing one through. The API is the final
 * arbiter.
 *
 * NOTE: this list is currently advisory. It rides the family rule below, but
 * `checkUpload` (transcribe.ts) deliberately passes `formats: undefined`
 * because these are file EXTENSIONS and a Blob carries only a MIME type, so
 * nothing is enforced against it today. It is exported so callers can do
 * their own extension check before uploading.
 */
export const TRANSCRIPTION_FILE_FORMATS = [
  "flac",
  "mp3",
  "mp4",
  "mpeg",
  "mpga",
  "m4a",
  "ogg",
  "wav",
  "webm",
] as const;

export const TRANSCRIPTION_MAX_FILE_BYTES = 25 * 1024 * 1024;

/**
 * "The `timestamp_granularities[]` parameter is only supported for
 * `whisper-1`." — speech-to-text guide.
 */
const TIMESTAMPS_WHISPER_ONLY: DenyRule = {
  reason: "`timestamp_granularities` is only supported for whisper-1",
  source: STT_GUIDE_DOCS,
};

/**
 * "`logprobs` only works with response_format set to `json` and only with the
 * models `gpt-4o-transcribe`, `gpt-4o-mini-transcribe`, and
 * `gpt-4o-mini-transcribe-2025-12-15`." — createTranscription reference.
 */
const INCLUDE_UNSUPPORTED: DenyRule = {
  reason:
    "`include` is only supported for gpt-4o-transcribe, gpt-4o-mini-transcribe and gpt-4o-mini-transcribe-2025-12-15",
  source: TRANSCRIPTION_DOCS,
};

/** "Supported by `gpt-transcribe`." — createTranscription reference. */
const gptTranscribeOnly = (param: string): DenyRule => ({
  reason: `\`${param}\` is only supported by gpt-transcribe`,
  source: TRANSCRIPTION_DOCS,
});

/** Diarization fields only the diarize model accepts. */
const diarizeOnly = (param: string): DenyRule => ({
  reason: `\`${param}\` is only supported by gpt-4o-transcribe-diarize`,
  source: TRANSCRIPTION_DOCS,
});

const NON_GPT_TRANSCRIBE_DENIES: Record<string, DenyRule> = {
  keywords: gptTranscribeOnly("keywords"),
  languages: gptTranscribeOnly("languages"),
};

const NON_DIARIZE_DENIES: Record<string, DenyRule> = {
  known_speaker_names: diarizeOnly("known_speaker_names"),
  known_speaker_references: diarizeOnly("known_speaker_references"),
};

/**
 * Per-model constraint table for openai.stt, audited against the
 * createTranscription API reference (openai@7.4.0 OpenAPI-generated
 * docstrings) and the speech-to-text guide on 2026-08-13.
 *
 * `response_format` is narrowed only where the docs narrow it: "For
 * `gpt-4o-transcribe` and `gpt-4o-mini-transcribe`, the only supported format
 * is `json`. For `gpt-4o-transcribe-diarize`, the supported formats are
 * `json`, `text`, and `diarized_json`". whisper-1 and gpt-transcribe carry no
 * per-model narrowing because the docs state none.
 */
export const transcriptionConstraints = {
  "whisper-1": {
    deny: {
      ...NON_GPT_TRANSCRIBE_DENIES,
      ...NON_DIARIZE_DENIES,
      include: INCLUDE_UNSUPPORTED,
      // "Note: Streaming is not supported for the `whisper-1` model and will
      // be ignored." + guide: "`whisper-1` doesn't [support file streaming]".
      // The docs say ignored, not rejected → `ignored` (warning, not error).
      stream: {
        reason: "streaming is not supported for whisper-1, so the response is returned unstreamed",
        source: TRANSCRIPTION_DOCS,
        ignored: true,
      },
    },
  },
  "gpt-transcribe": {
    deny: { ...NON_DIARIZE_DENIES, include: INCLUDE_UNSUPPORTED, timestamp_granularities: TIMESTAMPS_WHISPER_ONLY },
  },
  "gpt-4o-transcribe": {
    deny: {
      ...NON_GPT_TRANSCRIBE_DENIES,
      ...NON_DIARIZE_DENIES,
      timestamp_granularities: TIMESTAMPS_WHISPER_ONLY,
    },
    enums: { response_format: ["json"] },
  },
  "gpt-4o-mini-transcribe": {
    deny: {
      ...NON_GPT_TRANSCRIBE_DENIES,
      ...NON_DIARIZE_DENIES,
      timestamp_granularities: TIMESTAMPS_WHISPER_ONLY,
    },
    enums: { response_format: ["json"] },
  },
  "gpt-4o-mini-transcribe-2025-12-15": {
    deny: {
      ...NON_GPT_TRANSCRIBE_DENIES,
      ...NON_DIARIZE_DENIES,
      timestamp_granularities: TIMESTAMPS_WHISPER_ONLY,
    },
    enums: { response_format: ["json"] },
  },
  "gpt-4o-transcribe-diarize": {
    deny: {
      ...NON_GPT_TRANSCRIBE_DENIES,
      // "This field is not supported when using `gpt-4o-transcribe-diarize`."
      prompt: {
        reason: "`prompt` is not supported when using gpt-4o-transcribe-diarize",
        source: TRANSCRIPTION_DOCS,
      },
      include: {
        reason: "`include` is not supported when using gpt-4o-transcribe-diarize",
        source: TRANSCRIPTION_DOCS,
      },
      // "This option is not available for `gpt-4o-transcribe-diarize`."
      timestamp_granularities: {
        reason: "`timestamp_granularities` is not available for gpt-4o-transcribe-diarize",
        source: TRANSCRIPTION_DOCS,
      },
    },
    enums: { response_format: ["json", "text", "diarized_json"] },
  },
} as const satisfies Partial<Record<OpenaiTranscriptionModelId, EndpointConstraints>>;

/**
 * Endpoint-wide upload limits for POST /v1/audio/transcriptions — documented
 * once for the endpoint, not per model, so they ride a family rule that
 * matches every id (including ids unmodel does not know yet). Only `maxBytes`
 * is enforced; see TRANSCRIPTION_FILE_FORMATS for why `formats` is advisory.
 */
export const transcriptionFamilyRules: readonly FamilyRule[] = [
  {
    family: "transcription upload",
    match: () => true,
    media: {
      audio: {
        maxBytes: TRANSCRIPTION_MAX_FILE_BYTES,
        formats: [...TRANSCRIPTION_FILE_FORMATS],
      },
    },
  },
];

/**
 * `seconds` values POST /v1/videos accepts, as strings on the wire. "4", "8"
 * and "12" come from the create API reference
 * (https://developers.openai.com/api/docs/api-reference/videos/create);
 * "16" and "20" from the video-generation guide ("Both `sora-2` and
 * `sora-2-pro` support `16`- and `20`-second generations", and the guide's
 * Batch examples send `"seconds": "16"` / `"seconds": "20"`) —
 * https://developers.openai.com/api/docs/guides/video-generation. Checked
 * 2026-08-13; the reference enum lags the guide.
 */
const SORA_SECONDS = ["4", "8", "12", "16", "20"] as const;

/**
 * sora-2 renders 720p only: the pricing page has no sora-2 rate above 720p
 * and the guide reads "Use `sora-2-pro` for higher-resolution exports"
 * (https://developers.openai.com/api/docs/guides/video-generation,
 * https://developers.openai.com/api/docs/pricing).
 */
const SORA_BASE_SIZES = ["720x1280", "1280x720"] as const;

/**
 * sora-2-pro adds 1024p (create API reference size enum) and 1080p ("Use
 * `sora-2-pro` when you need 1080p exports in `1920x1080` or `1080x1920`" —
 * video-generation guide; both values are priced on the pricing page).
 */
const SORA_PRO_SIZES = [
  ...SORA_BASE_SIZES,
  "1024x1792",
  "1792x1024",
  "1920x1080",
  "1080x1920",
] as const;

const SORA_BASE_ENUMS: EndpointConstraints["enums"] = {
  seconds: SORA_SECONDS,
  size: SORA_BASE_SIZES,
};

const SORA_PRO_ENUMS: EndpointConstraints["enums"] = {
  seconds: SORA_SECONDS,
  size: SORA_PRO_SIZES,
};

/**
 * Per-model constraint table for openai.video, verified 2026-08-13 against
 * the create API reference, the video-generation guide, and the pricing page
 * (URLs on the enum constants above). Dated snapshots follow their family.
 */
export const videoConstraints = {
  "sora-2": { enums: SORA_BASE_ENUMS },
  "sora-2-2025-10-06": { enums: SORA_BASE_ENUMS },
  "sora-2-2025-12-08": { enums: SORA_BASE_ENUMS },
  "sora-2-pro": { enums: SORA_PRO_ENUMS },
  "sora-2-pro-2025-10-06": { enums: SORA_PRO_ENUMS },
} as const satisfies Partial<Record<SoraModelId, EndpointConstraints>>;

// ---------------------------------------------------------------------------
// Chat (POST /v1/chat/completions)
// ---------------------------------------------------------------------------

/** The GPT-6 migration guide — the page the per-model tool/sampling rules quote. */
export const LATEST_MODEL_GUIDE_DOCS = "https://developers.openai.com/api/docs/guides/latest-model.md";
export const CHANGELOG_DOCS = "https://developers.openai.com/api/docs/changelog";

/**
 * GPT-6 Astra and GPT-6.1 Sol: "`reasoning.effort` supports `low`, `medium`,
 * `high`, `xhigh`, and `max`." (both model pages). `none` is a documented 400
 * — "Setting `reasoning.effort` (Responses) or `reasoning_effort` (Chat
 * Completions) to `none` returns HTTP 400." — and 6.1 Sol "does not support
 * `none` or `minimal` and defaults to `medium`." (reasoning guide). `minimal`
 * is absent from both pages' lists and the migration guide's advice is "If
 * your existing request uses `minimal`, start with `low`". Read 2026-11-12.
 */
const GPT6_REASONING_EFFORTS_WITHOUT_NONE = ["low", "medium", "high", "xhigh", "max"] as const;

/**
 * GPT-6 Sol, GPT-6 Luna and GPT-6.1 Terra: "`reasoning.effort` supports
 * `none`, `low`, `medium` (default), `high`, `xhigh`, and `max`." (each model
 * page, 2026-11-12). No `minimal` on any of them.
 */
const GPT6_REASONING_EFFORTS = ["none", ...GPT6_REASONING_EFFORTS_WITHOUT_NONE] as const;

/**
 * "For `gpt-5.5`, `gpt-5.5-pro`, and future models, only `24h` is supported."
 * — chat/create reference on `prompt_cache_retention` (itself "Deprecated. Use
 * `prompt_cache_options.ttl` instead."), read 2026-11-12. Applied to the two
 * ids the sentence names and to the models released after them.
 */
const PROMPT_CACHE_RETENTION_24H_ONLY = ["24h"] as const;

const GPT6_WITHOUT_NONE_ENUMS: EndpointConstraints["enums"] = {
  reasoning_effort: GPT6_REASONING_EFFORTS_WITHOUT_NONE,
  prompt_cache_retention: PROMPT_CACHE_RETENTION_24H_ONLY,
};

const GPT6_ENUMS: EndpointConstraints["enums"] = {
  reasoning_effort: GPT6_REASONING_EFFORTS,
  prompt_cache_retention: PROMPT_CACHE_RETENTION_24H_ONLY,
};

const RETENTION_24H_ENUMS: EndpointConstraints["enums"] = {
  prompt_cache_retention: PROMPT_CACHE_RETENTION_24H_ONLY,
};

/**
 * Per-model constraint table for openai.chat.
 *
 * `stop` is rejected on the o3 and o4-mini reasoning models — SDK docstring
 * and the live chat/create API reference both read: "Not supported with latest
 * reasoning models `o3` and `o4-mini`." (openai@7.4.0, checked 2026-08-12).
 *
 * The GPT-6 rows narrow `reasoning_effort` to each model page's own list (see
 * the constants above) and `prompt_cache_retention` to `24h`; their
 * tool-calling, logprobs and sampling rules are value-conditional and live in
 * {@link gpt6ChatRules}, enforced by checkGpt6ChatRules in ./chat.ts.
 */
export const chatConstraints = {
  o3: {
    deny: {
      stop: {
        reason:
          'the API rejects `stop` on this model ("Not supported with latest reasoning models `o3` and `o4-mini`")',
        source:
          "openai@7.4.0 SDK docstring; fixture: test/fixtures/provider-errors/openai/chat-o3-stop.json",
      },
    },
  },
  "o4-mini": {
    deny: {
      stop: {
        reason:
          'the API rejects `stop` on this model ("Not supported with latest reasoning models `o3` and `o4-mini`")',
        source:
          "openai@7.4.0 SDK docstring; fixture: test/fixtures/provider-errors/openai/chat-o4-mini-stop.json",
      },
    },
  },
  "gpt-5.5": { enums: RETENTION_24H_ENUMS },
  "gpt-5.6": { enums: RETENTION_24H_ENUMS },
  "gpt-5.6-sol": { enums: RETENTION_24H_ENUMS },
  "gpt-6-astra": { enums: GPT6_WITHOUT_NONE_ENUMS },
  "gpt-6.1-sol": { enums: GPT6_WITHOUT_NONE_ENUMS },
  "gpt-6-sol": { enums: GPT6_ENUMS },
  "gpt-6-luna": { enums: GPT6_ENUMS },
  "gpt-6.1-terra": { enums: GPT6_ENUMS },
} as const satisfies Partial<Record<string, EndpointConstraints>>;

/**
 * How a GPT-6 model's Chat Completions surface treats a param family.
 *
 * - `"responses-only"` — never on this endpoint, whatever the effort: "Tool
 *   calling requires the Responses API." (the GPT-6.1 Sol and Terra model
 *   pages) and "Chat Completions does not support function calling with GPT-6
 *   Astra or GPT-6.1 Sol." (reasoning guide).
 * - `"unsupported"` — the model has no such feature at all: "GPT-6 Astra does
 *   not support custom `temperature` or `top_p` values or log probabilities
 *   (`logprobs`)." (changelog, 2026-09-03 entry).
 * - `"effort-none-only"` — accepted exactly when `reasoning_effort` is `none`:
 *   "GPT-6 Sol and GPT-6 Luna support function calling in Chat Completions only
 *   with `reasoning_effort: \"none\"`." and, in the same paragraph, "When
 *   reasoning effort is not `none`, remove `temperature`, `top_p`, and
 *   `top_logprobs`." / "For Chat Completions, also remove `logprobs`."
 *   (migration guide). The chat/create reference's own logprobs example is
 *   `gpt-6-sol` at `reasoning_effort: "none"`.
 *
 * Absent or `null` effort is the server default `medium`, so it counts as
 * "not none". All read 2026-11-12.
 */
export type Gpt6ParamRule = "responses-only" | "unsupported" | "effort-none-only";

export interface Gpt6ChatRule {
  /** `tools` (and the legacy `functions`). */
  tools: Gpt6ParamRule;
  /**
   * `logprobs` / `top_logprobs`. Absent where no page names them for the model
   * (GPT-6.1 Sol and Terra): the migration guide's sentence is generic there,
   * and a rule inferred from a generic sentence would be an undocumented
   * narrowing.
   */
  logprobs?: Gpt6ParamRule;
}

/**
 * The value-conditional GPT-6 rules — a named table plus a dedicated check in
 * ./chat.ts rather than {@link EndpointConstraints.deny}, which can only
 * withdraw a param outright and would refuse `tools: []` or `logprobs: false`.
 *
 * `temperature` / `top_p` ride the catalog's `temperature: false` on every
 * GPT-6 row; the one thing the catalog cannot say is the `none` exemption
 * ("When reasoning effort is not `none`, remove `temperature`, `top_p`…"),
 * which ./chat.ts applies to every id in this table. For GPT-6 Astra and
 * GPT-6.1 Sol the exemption is moot — `none` is refused by their
 * `reasoning_effort` enum first.
 */
export const gpt6ChatRules = {
  "gpt-6-astra": { tools: "responses-only", logprobs: "unsupported" },
  "gpt-6.1-sol": { tools: "responses-only" },
  "gpt-6.1-terra": { tools: "responses-only" },
  "gpt-6-sol": { tools: "effort-none-only", logprobs: "effort-none-only" },
  "gpt-6-luna": { tools: "effort-none-only", logprobs: "effort-none-only" },
} as const satisfies Record<string, Gpt6ChatRule>;

export type Gpt6ChatModelId = keyof typeof gpt6ChatRules;

/**
 * Chat rules for facts the catalog cannot express. The catalog already
 * carries temperature/toolCall/structuredOutput/modalities per model, so
 * only the endpoint-wide vision input limits live here.
 */
export const chatFamilyRules: readonly FamilyRule[] = [
  {
    family: "chat vision input",
    match: () => true,
    media: {
      image: {
        maxBytes: 20 * 1024 * 1024,
        formats: ["png", "jpeg", "webp", "gif"],
      },
    },
    imageTokens: 1000,
    // No `imageTokensByDetail`, deliberately. `image_url.detail` reaches this
    // endpoint (it is `ChatFilePart.detail` on the unified surface) and the
    // estimator asks the table for a per-level number — but OpenAI's vision
    // guide states outright that `low` does not always use fewer tokens than
    // `high` on current models, and it publishes no per-level constant for the
    // ones it does. The historical 85-token low-detail figure is a GPT-4o-era
    // number that would be a guess wearing a catalog's clothes. Estimation is
    // the one place a plausible wrong number is worse than a coarse right one.
  },
];
