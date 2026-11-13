/**
 * Inworld Text-to-Speech — POST https://api.inworld.ai/tts/v1/voice
 *
 * Wire reference:
 * https://docs.inworld.ai/api-reference/ttsAPI/texttospeech/synthesize-speech
 * (verified 2026-11-12). Params mirror the wire body exactly. The streaming
 * variant (POST /tts/v1/voice:stream) takes the same body (plus an optional
 * `timestampTransportStrategy`) but returns NDJSON; unmodel finalizes to the
 * non-streaming URL only. The realtime WebSocket API is not validated.
 *
 * THREE WAYS TO NAME THE SPEECH: `text` + a stored `voiceId`, `text` + an
 * ad-hoc `voiceDesign`, or a `script` of utterances that each carry their own
 * voice — "Set either `voiceId` or `voiceDesign`, not both", and `script`
 * "Replaces top-level `text`, `voiceId`, and `voiceDesign`". `TtsVoiceBody`
 * is the union of those three shapes; `checkSpeechSource` re-states it for
 * callers a type cannot reach.
 *
 * CHARACTER CAP: "`text` accepts up to **2,000 UTF-16 code units**
 * (JavaScript `text.length`)", and "For scripts, the limit applies to the sum
 * of the utterance texts." An over-long request is reported with issue code
 * `over_output_limit` — there is no character-specific issue code, so the
 * message and meta ({ limitCharacters, actualCharacters }) spell out that
 * the limit is in characters, not tokens.
 *
 * `.toSdk("inworld")` is the identity: Inworld's TTS API has no official JS SDK (the
 * docs drive it with raw fetch; the legacy @inworld/nodejs-sdk targets the
 * Character Engine, not /tts/v1). The response is JSON but carries no
 * quality/usage signals beyond `usage.processedCharactersCount`, so there is
 * no response checker.
 */

import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import { JSON_HEADERS, toValidated, type ExactKeys, type Validated } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateEstimate, ValidateResult } from "../../core/result";
import type { ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import { computeCharacterCostUSD } from "../../core/cost";
import { models, type InworldTtsModelId } from "./models";

export const TTS_VOICE_URL = "https://api.inworld.ai/tts/v1/voice";
/** Streaming variant — same body; NDJSON response. Not what finalize targets. */
export const TTS_VOICE_STREAM_URL = "https://api.inworld.ai/tts/v1/voice:stream";

/**
 * "`text` accepts up to **2,000 UTF-16 code units** (JavaScript
 * `text.length`)" — synthesize-speech API reference.
 */
export const INWORLD_TTS_MAX_CHARACTERS = 2000;

// ---------------------------------------------------------------------------
// Wire types — mirror ttsv1SynthesizeSpeechRequest exactly.
// ---------------------------------------------------------------------------

export type InworldAudioEncoding =
  | "LINEAR16"
  | "MP3"
  | "OGG_OPUS"
  | "ALAW"
  | "MULAW"
  | "FLAC"
  | "PCM"
  | "WAV";

/**
 * The rates the reference calls common: "Accepts values within the range
 * [8000, 48000]. Common sample rates include: 8000, 16000, 22050, 24000,
 * 32000, 44100, 48000." (SYNTHESIZE_DOCS, 2026-11-12.) A list for pickers and
 * autocomplete, not a bound — the bound is the range.
 */
export const INWORLD_SAMPLE_RATES_HERTZ = [
  8000, 16000, 22050, 24000, 32000, 44100, 48000,
] as const;

export type InworldSampleRateHertz = (typeof INWORLD_SAMPLE_RATES_HERTZ)[number];

/** "Accepts values within the range [8000, 48000]." */
const SAMPLE_RATE_MIN_HERTZ = 8000;
const SAMPLE_RATE_MAX_HERTZ = 48000;

export interface InworldAudioConfig {
  /** Default: "MP3". */
  audioEncoding?: InworldAudioEncoding;
  /**
   * An integer in [8000, 48000]; {@link INWORLD_SAMPLE_RATES_HERTZ} are the
   * common ones. "The request fails if the chosen encoding does not support
   * the rate, or if the rate exceeds a known native output rate." "When
   * omitted, the default is 8,000 Hz for `MULAW` and `ALAW`. For other
   * encodings, it is 48,000 Hz, capped at the model's native output rate when
   * known."
   */
  sampleRateHertz?: InworldSampleRateHertz | (number & {});
  /** Bits per second; compressed formats only; default 128000. */
  bitRate?: number;
  /** Range [0.5, 1.5]; default 1.0. */
  speakingRate?: number;
}

export type InworldDeliveryMode =
  | "DELIVERY_MODE_UNSPECIFIED"
  | "STABLE"
  | "BALANCED"
  | "CREATIVE";

export type InworldTimestampType = "TIMESTAMP_TYPE_UNSPECIFIED" | "WORD" | "CHARACTER";

export type InworldApplyTextNormalization =
  | "APPLY_TEXT_NORMALIZATION_UNSPECIFIED"
  | "ON"
  | "OFF";

/**
 * Prior turns supplied as generation context — the reference documents a
 * single field, `previousRequests`, holding earlier synthesis requests.
 */
export interface InworldSynthesisContext {
  previousRequests?: Array<{ text?: string; [key: string]: unknown }>;
  [key: string]: unknown;
}

/** `voiceDesign` — an ad-hoc voice described in words instead of a stored `voiceId`. */
export interface InworldTtsVoiceDesign {
  /**
   * "Use 7–1,024 characters; leading and trailing whitespace does not count
   * toward the minimum. This describes the voice; put the words to speak in
   * `text`."
   */
  designPrompt: string;
}

/** A `script.voices[]` default, and the shape of each utterance's `voiceConfig`. */
export interface InworldScriptVoiceConfig {
  /** "Stored voice identifier, resolved in your workspace." */
  voiceId: string;
  /**
   * Range [0.5, 1.5]. "An utterance's value overrides its matching
   * `script.voices` entry, which overrides `audioConfig.speakingRate`."
   */
  speakingRate?: number;
  /** "Only supported by `inworld-tts-2`. The field is ignored on other models." */
  deliveryMode?: InworldDeliveryMode;
}

export interface InworldScriptUtterance {
  /** Text to synthesize for this utterance. */
  text: string;
  voiceConfig: InworldScriptVoiceConfig;
}

/** `script` — "Ordered utterances for TTS-2", 1–100 of them. */
export interface InworldTtsScript {
  /** Playback order; the text cap applies to the sum of their texts. */
  utterances: InworldScriptUtterance[];
  /** "Optional defaults keyed by unique voiceId." */
  voices?: InworldScriptVoiceConfig[];
}

/**
 * "Select one combined recording or separate utterance recordings. Omitted or
 * `OUTPUT_MODE_UNSPECIFIED` means `COMBINED`. `PER_UTTERANCE` requires
 * `script`."
 */
export type InworldOutputMode = "OUTPUT_MODE_UNSPECIFIED" | "COMBINED" | "PER_UTTERANCE";

/** The fields every request shape shares. */
interface TtsVoiceCommon {
  modelId: InworldTtsModelId | (string & {});
  audioConfig?: InworldAudioConfig;
  /** BCP-47 tag (e.g. "en-US"); auto-detected when omitted. */
  language?: string;
  /** "Only supported by `inworld-tts-2`. The field is ignored on other models." */
  deliveryMode?: InworldDeliveryMode;
  /** Range (0, 2]; default 1.0. Ignored by inworld-tts-2. */
  temperature?: number;
  timestampType?: InworldTimestampType;
  applyTextNormalization?: InworldApplyTextNormalization;
  /** Audio denoising toggle; default false. */
  enhanceGeneration?: boolean;
  /** Previous requests supplied as generation context. */
  synthesisContext?: InworldSynthesisContext;
}

/** `text` spoken by a stored voice — the classic request. */
export interface TtsVoiceTextBody extends TtsVoiceCommon {
  /** At most 2,000 UTF-16 code units. */
  text: string;
  /** Voice identifier, e.g. "Dennis". */
  voiceId: string;
  voiceDesign?: never;
  script?: never;
  /** `PER_UTTERANCE` requires `script`. */
  outputMode?: Exclude<InworldOutputMode, "PER_UTTERANCE">;
}

/** `text` spoken by a voice described inline — "Set either `voiceId` or `voiceDesign`, not both." */
export interface TtsVoiceDesignBody extends TtsVoiceCommon {
  /** At most 2,000 UTF-16 code units. */
  text: string;
  voiceDesign: InworldTtsVoiceDesign;
  voiceId?: never;
  script?: never;
  /** `PER_UTTERANCE` requires `script`. */
  outputMode?: Exclude<InworldOutputMode, "PER_UTTERANCE">;
}

/** A script — "Replaces top-level `text`, `voiceId`, and `voiceDesign`." */
export interface TtsVoiceScriptBody extends TtsVoiceCommon {
  script: InworldTtsScript;
  text?: never;
  voiceId?: never;
  voiceDesign?: never;
  outputMode?: InworldOutputMode;
}

export type TtsVoiceBody = TtsVoiceTextBody | TtsVoiceDesignBody | TtsVoiceScriptBody;

// ---------------------------------------------------------------------------
// Schema (loose: unknown keys pass through with a warning).
// ---------------------------------------------------------------------------

/**
 * Exported so the WebSocket context config in ./realtime validates
 * `audioConfig` against the same bounds — it is the same object on both
 * surfaces, and a second copy would be a second thing to keep in sync.
 */
export const audioConfigSchema = z.looseObject({
  audioEncoding: z
    .enum(["LINEAR16", "MP3", "OGG_OPUS", "ALAW", "MULAW", "FLAC", "PCM", "WAV"])
    .optional(),
  sampleRateHertz: z
    .number()
    .int()
    .min(SAMPLE_RATE_MIN_HERTZ)
    .max(SAMPLE_RATE_MAX_HERTZ)
    .optional(),
  bitRate: z.number().int().positive().optional(),
  speakingRate: z.number().min(0.5).max(1.5).optional(),
});

/** "Use 7–1,024 characters; leading and trailing whitespace does not count toward the minimum." */
const DESIGN_PROMPT_MIN_CHARACTERS = 7;
const DESIGN_PROMPT_MAX_CHARACTERS = 1024;
/** "Scripts accept **1–100 utterances**" (SCRIPT_DOCS). */
const SCRIPT_MAX_UTTERANCES = 100;

const deliveryModeSchema = z.enum(["DELIVERY_MODE_UNSPECIFIED", "STABLE", "BALANCED", "CREATIVE"]);

const scriptVoiceConfigSchema = z.looseObject({
  voiceId: z.string().min(1, "voiceId must not be empty."),
  // "Per-utterance controls are `voiceId`, `speakingRate` (0.5–1.5), and `deliveryMode`."
  speakingRate: z.number().min(0.5).max(1.5).optional(),
  deliveryMode: deliveryModeSchema.optional(),
});

const schema = z.looseObject({
  text: z.string().min(1, "text must not be empty.").optional(),
  voiceId: z.string().min(1, "voiceId must not be empty.").optional(),
  voiceDesign: z
    .looseObject({
      designPrompt: z
        .string()
        .max(DESIGN_PROMPT_MAX_CHARACTERS, `designPrompt must be at most ${DESIGN_PROMPT_MAX_CHARACTERS} characters.`)
        .refine(
          (prompt) => prompt.trim().length >= DESIGN_PROMPT_MIN_CHARACTERS,
          `designPrompt must be at least ${DESIGN_PROMPT_MIN_CHARACTERS} characters, not counting leading and trailing whitespace.`,
        ),
    })
    .optional(),
  script: z
    .looseObject({
      utterances: z
        .array(
          z.looseObject({
            text: z.string().min(1, "utterance text must not be empty."),
            voiceConfig: scriptVoiceConfigSchema,
          }),
        )
        .min(1, "script.utterances must hold at least one utterance.")
        .max(SCRIPT_MAX_UTTERANCES, `script.utterances holds at most ${SCRIPT_MAX_UTTERANCES} utterances.`),
      voices: z.array(scriptVoiceConfigSchema).optional(),
    })
    .optional(),
  outputMode: z.enum(["OUTPUT_MODE_UNSPECIFIED", "COMBINED", "PER_UTTERANCE"]).optional(),
  modelId: z.string(),
  audioConfig: audioConfigSchema.optional(),
  language: z.string().optional(),
  deliveryMode: deliveryModeSchema.optional(),
  temperature: z.number().gt(0).max(2).optional(),
  timestampType: z.enum(["TIMESTAMP_TYPE_UNSPECIFIED", "WORD", "CHARACTER"]).optional(),
  applyTextNormalization: z
    .enum(["APPLY_TEXT_NORMALIZATION_UNSPECIFIED", "ON", "OFF"])
    .optional(),
  enhanceGeneration: z.boolean().optional(),
  synthesisContext: z
    .looseObject({ previousRequests: z.array(z.looseObject({})).optional() })
    .optional(),
});

// ---------------------------------------------------------------------------
// Constraints — per-model gates the synthesize-speech reference documents.
// ---------------------------------------------------------------------------

const SYNTHESIZE_DOCS =
  "https://docs.inworld.ai/api-reference/ttsAPI/texttospeech/synthesize-speech";
const SCRIPT_DOCS = "https://docs.inworld.ai/tts/capabilities/script-synthesis";

const deliveryModeDeny = {
  deliveryMode: {
    reason:
      '`deliveryMode` is documented as "Only supported by `inworld-tts-2`. The field is ignored on other models.", so the requested stability/creativity trade-off is not applied',
    source: SYNTHESIZE_DOCS,
    ignored: true,
  },
} as const;

/**
 * Two `ignored` rules — params the API accepts and drops, so each is a
 * warning about a silent no-op rather than an error:
 * - `deliveryMode` on the 1.x generations: "Only supported by
 *   `inworld-tts-2`. The field is ignored on other models."
 *   `inworld-tts-2-flash` is left without the warning: the docs name the
 *   generation, and flash is the same generation.
 * - `temperature` on `inworld-tts-2`: "Ignored on `inworld-tts-2`. Use
 *   `deliveryMode` instead." Only the exact id the docs name is covered.
 */
export const ttsConstraints: Readonly<Partial<Record<string, EndpointConstraints>>> = {
  "inworld-tts-1.5-max": { deny: deliveryModeDeny },
  "inworld-tts-1.5-mini": { deny: deliveryModeDeny },
  "inworld-tts-1": { deny: deliveryModeDeny },
  "inworld-tts-1-max": { deny: deliveryModeDeny },
  "inworld-tts-2": {
    deny: {
      temperature: {
        reason:
          "the request is accepted but sampling is unaffected; use `deliveryMode` to steer stability instead",
        source: SYNTHESIZE_DOCS,
        ignored: true,
      },
    },
  },
};

// ---------------------------------------------------------------------------
// Checks + estimation
// ---------------------------------------------------------------------------

/**
 * Which of the three request shapes the body is, re-stated at runtime:
 * `script` stands alone ("Replaces top-level `text`, `voiceId`, and
 * `voiceDesign`"); without it, `text` is required ("Required without
 * `script`") and exactly one of `voiceId` / `voiceDesign` names the voice
 * ("Set either `voiceId` or `voiceDesign`, not both"). `outputMode:
 * "PER_UTTERANCE"` "requires `script`".
 */
function checkSpeechSource(
  params: TtsVoiceBody,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  function report(path: string, message: string, source: string = SYNTHESIZE_DOCS): void {
    ctx.report({ code: "invalid_shape", path: [path], model: params.modelId, message, meta: { source } });
  }

  if (params.outputMode === "PER_UTTERANCE" && params.script === undefined) {
    report("outputMode", '`outputMode: "PER_UTTERANCE"` requires `script`; without one, the response is a single COMBINED recording.');
  }
  if (params.script !== undefined) {
    for (const key of ["text", "voiceId", "voiceDesign"] as const) {
      if (params[key] !== undefined) {
        report(
          key,
          `\`${key}\` is replaced by \`script\`; omit it and give each utterance its own \`text\` and \`voiceConfig.voiceId\`.`,
          SCRIPT_DOCS,
        );
      }
    }
    return;
  }
  if (params.text === undefined) {
    report("text", "`text` is required without `script`; send the words to speak, or a `script` of utterances.");
  }
  if (params.voiceId !== undefined && params.voiceDesign !== undefined) {
    report("voiceDesign", "set either `voiceId` or `voiceDesign`, not both.");
  } else if (params.voiceId === undefined && params.voiceDesign === undefined) {
    report("voiceId", "name the voice: a stored `voiceId`, an inline `voiceDesign`, or a `script` whose utterances carry their own voices.");
  }
}

/** The characters the text cap counts: `text`, or the sum of the script's utterance texts. */
function spokenCharacters(params: TtsVoiceBody): number {
  if (params.script === undefined) return params.text?.length ?? 0;
  return params.script.utterances.reduce((sum, utterance) => sum + (utterance?.text?.length ?? 0), 0);
}

/**
 * Enforces the documented 2,000-character cap on `text` — or, for a script,
 * on "the sum of the utterance texts". The cap is documented at the endpoint
 * level, so it applies even when the model id is unknown to the catalog (see
 * module JSDoc for the issue-code decision).
 */
function checkTextLength(
  params: TtsVoiceBody,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const limit = info?.limit.characters ?? INWORLD_TTS_MAX_CHARACTERS;
  if (limit <= 0) return;
  const actual = spokenCharacters(params);
  if (actual > limit) {
    const what = params.script === undefined ? "text is" : "the script's utterance texts total";
    ctx.report({
      code: "over_output_limit",
      path: [params.script === undefined ? "text" : "script"],
      model: params.modelId,
      message: `${what} ${actual} characters, over the ${limit}-character per-request limit of the Inworld TTS API (this limit is in characters, not tokens); split the input into multiple requests.`,
      meta: { limitCharacters: limit, actualCharacters: actual },
    });
  }
}

/**
 * TTS is billed per input character (On-Demand list rates — see models.ts):
 * a script's "Usage counts the text across the script once" (SCRIPT_DOCS),
 * and "A voice design prompt sent with a synthesis request counts once per
 * request" (https://docs.inworld.ai/portal/billing, 2026-11-12).
 */
function estimateTts(
  params: TtsVoiceBody,
  info: ModelInfo | undefined,
  _ctx: PipelineContext,
): ValidateEstimate {
  const characters = spokenCharacters(params) + (params.voiceDesign?.designPrompt.length ?? 0);
  const costUSD = computeCharacterCostUSD(info?.cost, characters);
  return costUSD === undefined ? {} : { costUSD };
}

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

/**
 * SDK targets for `inworld.tts`. Inworld publishes no official JS SDK for
 * /tts/v1 (see the module JSDoc), so the single self-named `"inworld"` target
 * returns the wire body unchanged — the id is still spelled out so the call
 * site reads the same as every other endpoint's, and so a real SDK shape can
 * be added later without a breaking change. Type alias, not interface: an
 * interface has no implicit index signature and cannot satisfy
 * `SdkFormatters`.
 */
type TtsSdkTargets<B> = { inworld: () => B };

function finalize(params: TtsVoiceBody): Validated<TtsVoiceBody, TtsSdkTargets<TtsVoiceBody>> {
  const body = { ...params };
  return toValidated(
    body,
    {
      url: TTS_VOICE_URL,
      method: "POST",
      headers: JSON_HEADERS,
    },
    { sdk: { inworld: () => body } },
  );
}

const validator = createValidator<TtsVoiceBody, Validated<TtsVoiceBody, TtsSdkTargets<TtsVoiceBody>>>({
  endpoint: "inworld.tts",
  schema,
  modelId: (params) => params.modelId,
  catalog: models,
  constraints: ttsConstraints,
  checks: [checkSpeechSource, checkTextLength],
  estimate: estimateTts,
  finalize,
});

/**
 * Validates params for POST /tts/v1/voice. The result's enumerable
 * properties are the exact fetch JSON body; `.toSdk("inworld")` returns the
 * body unchanged (no official JS SDK — see module JSDoc) and `.request` carries
 * url/method/static headers. Auth is your job: add a Basic `authorization`
 * header.
 *
 * ```ts
 * const params = inworld.tts({ text: "…", voiceId: "Dennis", modelId: "inworld-tts-2" });
 * await fetch(params.request.url, {
 *   method: params.request.method,
 *   headers: { ...params.request.headers, authorization: `Basic ${process.env.INWORLD_API_KEY!}` },
 *   body: JSON.stringify(params),
 * });
 * ```
 */
export const tts = validator as unknown as {
  <T extends TtsVoiceBody>(
    params: T & ExactKeys<T, TtsVoiceBody>,
    options?: ValidateOptions<T>,
  ): Validated<T, TtsSdkTargets<T>>;
  safe<T extends TtsVoiceBody>(
    params: T & ExactKeys<T, TtsVoiceBody>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<T, TtsSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
