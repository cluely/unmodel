/**
 * `unmodel/stt` → `elevenlabs.stt` (POST /v1/speech-to-text).
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
  resolveAudioInput,
  resolveDiarization,
  toPrimaryLanguage,
  toTimestampGranularity,
} from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type { SttAdapterFor, SttParamsFor } from "../../core/unified/vocabulary/stt";
import { stt as validator, type SpeechToTextParams } from "./stt";
import { ELEVENLABS_STT_MODEL_PARAMS, MODELS } from "./stt-params";

const STT_DOCS = "https://elevenlabs.io/docs/api-reference/speech-to-text/convert";

/** The wire params this adapter compiles to. */
export type ElevenlabsSttWire = SpeechToTextParams;

/** What a unified call to `elevenlabs/…` returns. */
export type ElevenlabsSttResult = ReturnType<typeof validator<ElevenlabsSttWire>>;

export const stt = {
  category: "stt",
  provider: "elevenlabs",
  models: MODELS,
  modelParams: ELEVENLABS_STT_MODEL_PARAMS,
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
    input: SttParamsFor<"file" | "url">,
    ctx: CompileContext<SttParamsFor<"file" | "url">>,
  ): CompiledCall<ElevenlabsSttWire, ElevenlabsSttResult> {
    const body: ElevenlabsSttWire = { model_id: ctx.model };
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

    applyExtras(input, ELEVENLABS_STT_MODEL_PARAMS, body, ctx);

    return { params: body, validate: validator.safe };
  },
} as const satisfies SttAdapterFor<
  "file" | "url",
  typeof ELEVENLABS_STT_MODEL_PARAMS,
  ElevenlabsSttWire,
  ElevenlabsSttResult
>;
