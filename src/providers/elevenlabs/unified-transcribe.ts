/**
 * `unmodel/transcribe` → `elevenlabs.transcribe` (POST /v1/speech-to-text).
 *
 * The only route in the category that takes **both** bytes and a URL, so
 * `audioInputs` is `["file", "url"]` — and the two land in different places on
 * the wire even though ElevenLabs' own `file` field is typed `Blob | string`:
 * a `Blob` becomes the multipart `file` part, a URL becomes `source_url`.
 * Writing the URL to `source_url` rather than to `file` is deliberate: it is
 * the field the API documents, and `toFormData` re-keys a string `file` to it
 * anyway — doing it here keeps the compiled params readable.
 *
 * `timestamps` is the one cell in the category where `"none"` is a *value*
 * rather than an omission: `timestamps_granularity` is a scalar enum
 * `none | word | character`, and its default is `"word"`, so asking for no
 * timing has to be said out loud or the API keeps producing it. `"segment"`
 * is the granularity this route does not have, and it is refused by name.
 */
import {
  applyExtras,
  EXTRA,
  resolveAudioInput,
  resolveDiarization,
  toPrimaryLanguage,
  toTimestampGranularity,
} from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type {
  TranscribeAdapterFor,
  TranscribeModelParamTable,
  TranscribeParamsFor,
} from "../../core/unified/vocabulary/transcribe";
import { transcribe as validator, type SpeechToTextParams } from "./transcribe";

/** The two batch Scribe models — the ref union for `elevenlabs/…`. */
const MODELS = ["scribe_v2", "scribe_v1"] as const;

const STT_DOCS = "https://elevenlabs.io/docs/api-reference/speech-to-text/convert";

/** The wire params this adapter compiles to. */
export type ElevenlabsTranscribeWire = SpeechToTextParams;

/** What a unified call to `elevenlabs/…` returns. */
export type ElevenlabsTranscribeResult = ReturnType<typeof validator<ElevenlabsTranscribeWire>>;

/**
 * Scribe's per-model surface: the category's only three-value `timestamps`
 * row, and one key `scribe_v1` does not have.
 *
 * `timestamps_granularity` is a scalar enum `none | word | character` whose
 * default is `"word"`, so `"none"` is a **value** here rather than an omission
 * — the one cell in the category where asking for no timing is expressible and
 * therefore belongs on the row. `"segment"` is the granularity this route does
 * not have, and it is a compile error naming the three it does.
 *
 * `no_verbatim` ("Only supported with scribe_v2 model", which
 * `speechToTextConstraints` denies on `scribe_v1`) is the one row difference.
 * Everything else is shared: audio-event tagging, keyterm biasing, sampling,
 * multichannel handling, speaker-library lookups and the entity
 * detection/redaction trio.
 *
 * Excluded: `model_id`, `file`, `source_url`, `language_code`, `diarize` and
 * `num_speakers` are canonical words' wire spellings, and `timestamps_
 * granularity` is the canonical `timestamps`' own — an extra of that name could
 * overwrite what the adapter compiled.
 */
const SCRIBE_EXTRAS = {
  tag_audio_events: EXTRA as boolean,
  keyterms: EXTRA as string[],
  temperature: EXTRA as number,
  seed: EXTRA as number,
  file_format: EXTRA as "pcm_s16le_16" | "other",
  additional_formats: EXTRA as Array<Record<string, unknown>>,
  diarization_threshold: EXTRA as number | null,
  use_multi_channel: EXTRA as boolean,
  multichannel_output_style: EXTRA as "separate" | "combined",
  use_speaker_library: EXTRA as boolean,
  detect_speaker_roles: EXTRA as boolean,
  entity_detection: EXTRA as string | string[],
  entity_redaction: EXTRA as string | string[],
  entity_redaction_mode: EXTRA as "redacted" | "entity_type" | "enumerated_entity_type",
} as const;

const TIMESTAMPS = ["none", "word", "character"] as const;

const ELEVENLABS_TRANSCRIBE_MODEL_PARAMS = {
  scribe_v2: {
    timestamps: TIMESTAMPS,
    extras: { ...SCRIBE_EXTRAS, no_verbatim: EXTRA as boolean },
  },
  scribe_v1: { timestamps: TIMESTAMPS, extras: SCRIBE_EXTRAS },
} as const satisfies TranscribeModelParamTable;

export const transcribe = {
  category: "transcribe",
  provider: "elevenlabs",
  models: MODELS,
  modelParams: ELEVENLABS_TRANSCRIBE_MODEL_PARAMS,
  audioInputs: ["file", "url"],
  unsupported: {
    languages:
      "POST /v1/speech-to-text has no candidate-language list — `language_code` pins one language " +
      "and omitting it detects, with nothing in between.",
    prompt:
      "Scribe takes no prose prompt — `keyterms` is a list of terms capped at five words each, " +
      "which is a different thing; send it through `providerOptions.elevenlabs`.",
  },
  compile(
    input: TranscribeParamsFor<"file" | "url">,
    ctx: CompileContext<TranscribeParamsFor<"file" | "url">>,
  ): CompiledCall<ElevenlabsTranscribeWire, ElevenlabsTranscribeResult> {
    const body: ElevenlabsTranscribeWire = { model_id: ctx.model };
    ctx.from(["model_id"], "model");
    ctx.from(["file"], "audio");
    ctx.from(["source_url"], "audio");
    ctx.from(["language_code"], "language");
    ctx.from(["diarize"], "diarization");
    ctx.from(["num_speakers"], "diarization.speakers");
    ctx.from(["timestamps_granularity"], "timestamps");

    const audio = ctx.take(
      resolveAudioInput(input.audio, ["file", "url"], { path: ["audio"], warn: ctx.warn }, {
        source: STT_DOCS,
      }),
    );
    if (audio?.kind === "file") body.file = audio.file;
    if (audio?.kind === "url") body.source_url = audio.url;

    if (input.language !== undefined) {
      const language = ctx.take(
        toPrimaryLanguage(input.language, { path: ["language"], warn: ctx.warn }, {
          source: STT_DOCS,
        }),
      );
      if (language !== undefined) body.language_code = language;
    }

    if (input.diarization !== undefined) {
      const diarization = ctx.take(
        resolveDiarization(
          input.diarization,
          { speakers: true, source: STT_DOCS },
          { path: ["diarization"], warn: ctx.warn },
        ),
      );
      if (diarization !== undefined) {
        body.diarize = diarization.enabled;
        if (diarization.speakers !== undefined) body.num_speakers = diarization.speakers;
      }
    }

    if (input.timestamps === "none") {
      // Said out loud, because the field's default is `"word"`.
      body.timestamps_granularity = "none";
    } else if (input.timestamps !== undefined) {
      const granularity = ctx.take(
        toTimestampGranularity(input.timestamps, ["word", "character"], {
          path: ["timestamps"],
          warn: ctx.warn,
        }, { source: STT_DOCS }),
      );
      if (granularity !== undefined) body.timestamps_granularity = granularity;
    }

    applyExtras(input, ELEVENLABS_TRANSCRIBE_MODEL_PARAMS, body, ctx);

    return { params: body, validate: validator.safe };
  },
} as const satisfies TranscribeAdapterFor<
  "file" | "url",
  typeof ELEVENLABS_TRANSCRIBE_MODEL_PARAMS,
  ElevenlabsTranscribeWire,
  ElevenlabsTranscribeResult
>;
