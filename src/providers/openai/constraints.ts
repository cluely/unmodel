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

// ---------------------------------------------------------------------------
// Images — doc URLs. Every rule below cites one of these.
// ---------------------------------------------------------------------------

const IMAGES_CREATE_DOCS = "https://developers.openai.com/api/docs/api-reference/images/create";
const IMAGES_EDIT_DOCS = "https://developers.openai.com/api/docs/api-reference/images/createEdit";
const IMAGE_GUIDE_DOCS = "https://developers.openai.com/api/docs/guides/image-generation";

const GPT_IMAGE_SIZES = ["auto", "1024x1024", "1536x1024", "1024x1536"] as const;
const GPT_IMAGE_QUALITIES = ["auto", "low", "medium", "high"] as const;
const GPT_IMAGE_OUTPUT_FORMATS = ["png", "jpeg", "webp"] as const;
const GPT_IMAGE_MODERATIONS = ["low", "auto"] as const;
const DALL_E_RESPONSE_FORMATS = ["url", "b64_json"] as const;
const INPUT_FIDELITIES = ["high", "low"] as const;

/**
 * `background` values gpt-image-2 accepts. WIDENED from a blanket deny on
 * 2026-08-13: the current docs reject only `transparent`, not the parameter —
 * "`gpt-image-2` and `gpt-image-2-2026-04-21` do not support transparent
 * backgrounds. Requests with `background` set to `transparent` will return an
 * error for these models; use `opaque` or `auto` instead." (openai@7.4.0
 * OpenAPI-generated docstring) and "`gpt-image-2` doesn't currently support
 * transparent backgrounds." (image-generation guide). The recorded 400
 * (test/fixtures/provider-errors/openai/images-gpt-image-2-background.json)
 * was captured with `background: "transparent"`, so it is still explained by
 * this narrower rule — and `opaque`/`auto` are no longer false-positived.
 */
const GPT_IMAGE_2_BACKGROUNDS = ["opaque", "auto"] as const;

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
 */
const GPT_IMAGE_2_ENUMS: EndpointConstraints["enums"] = {
  quality: GPT_IMAGE_QUALITIES,
  output_format: GPT_IMAGE_OUTPUT_FORMATS,
  moderation: GPT_IMAGE_MODERATIONS,
  background: GPT_IMAGE_2_BACKGROUNDS,
};

/**
 * Per-model constraint table for openai.image (POST /v1/images/generations),
 * audited param-by-param against the create API reference and the
 * image-generation guide on 2026-08-13. Enum narrowing and deny rules both
 * come from the documented per-model applicability notes; the deny reasons
 * quote them.
 */
export const imageConstraints = {
  "gpt-image-1": { deny: GPT_IMAGE_DENIES, enums: GPT_IMAGE_ENUMS },
  "gpt-image-1-mini": { deny: GPT_IMAGE_DENIES, enums: GPT_IMAGE_ENUMS },
  "gpt-image-1.5": { deny: GPT_IMAGE_DENIES, enums: GPT_IMAGE_ENUMS },
  "gpt-image-2": { deny: GPT_IMAGE_DENIES, enums: GPT_IMAGE_2_ENUMS },
  "gpt-image-2-2026-04-21": { deny: GPT_IMAGE_DENIES, enums: GPT_IMAGE_2_ENUMS },
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
  Record<OpenaiImageModelId | DallEModelId | GptImage2SnapshotId, EndpointConstraints>
>;

// ---------------------------------------------------------------------------
// Images edit (POST /v1/images/edits)
// ---------------------------------------------------------------------------

/**
 * "This parameter is only supported for `gpt-image-1` and `gpt-image-1.5` and
 * later models, unsupported for `gpt-image-1-mini`." — createEdit reference.
 */
const INPUT_FIDELITY_UNSUPPORTED: DenyRule = {
  reason: "`input_fidelity` is not supported by this model",
  source: IMAGES_EDIT_DOCS,
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
 * Per-model constraint table for openai.imageEdit (POST /v1/images/edits),
 * audited against the createEdit API reference and the image-generation guide
 * on 2026-08-13. `dall-e-3` is deliberately absent: the endpoint documents
 * "One of `dall-e-2` or a GPT image model", so dall-e-3 is not an edit model.
 */
export const imagesEditConstraints = {
  "gpt-image-1": { deny: GPT_IMAGE_EDIT_DENIES, enums: GPT_IMAGE_EDIT_ENUMS, media: GPT_IMAGE_EDIT_MEDIA },
  "gpt-image-1-mini": {
    deny: { ...GPT_IMAGE_EDIT_DENIES, input_fidelity: INPUT_FIDELITY_UNSUPPORTED },
    enums: GPT_IMAGE_ENUMS,
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
  Record<OpenaiImageModelId | "dall-e-2" | GptImage2SnapshotId, EndpointConstraints>
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
 * `verse`, `marin`, and `cedar`" (createSpeech reference). WIDENED from the
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

/** "Does not work with `tts-1` or `tts-1-hd`." — createSpeech reference. */
const INSTRUCTIONS_UNSUPPORTED: DenyRule = {
  reason: "`instructions` does not work with tts-1 or tts-1-hd",
  source: SPEECH_DOCS,
};

/** "`sse` is not supported for `tts-1` or `tts-1-hd`." — createSpeech reference. */
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
 * Per-model constraint table for openai.speech, audited against the
 * createSpeech API reference and the text-to-speech guide on 2026-08-13.
 * `voice` is enumerated here only for the string form — a custom voice object
 * (`{ id: "voice_1234" }`) bypasses the enum layer (it is not a string) and
 * is checked in speech.ts instead.
 */
export const speechConstraints = {
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
 * `checkUpload` (transcription.ts) deliberately passes `formats: undefined`
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
 * Per-model constraint table for openai.transcription, audited against the
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
 * Per-model constraint table for openai.videos, verified 2026-08-13 against
 * the create API reference, the video-generation guide, and the pricing page
 * (URLs on the enum constants above). Dated snapshots follow their family.
 */
export const videosConstraints = {
  "sora-2": { enums: SORA_BASE_ENUMS },
  "sora-2-2025-10-06": { enums: SORA_BASE_ENUMS },
  "sora-2-2025-12-08": { enums: SORA_BASE_ENUMS },
  "sora-2-pro": { enums: SORA_PRO_ENUMS },
  "sora-2-pro-2025-10-06": { enums: SORA_PRO_ENUMS },
} as const satisfies Partial<Record<SoraModelId, EndpointConstraints>>;

/**
 * Per-model constraint table for openai.chat. `stop` is rejected on the o3
 * and o4-mini reasoning models — SDK docstring and the live chat/create API
 * reference both read: "Not supported with latest reasoning models `o3` and
 * `o4-mini`." (openai@7.4.0, checked 2026-08-12).
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
} as const satisfies Partial<Record<string, EndpointConstraints>>;

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
  },
];
