/**
 * `unmodel/stt` → `deepgram.stt` (POST /v1/listen).
 *
 * The query-string end of the category: only `url` is a body field, and every
 * option rides in `.request.url`. The provider validator does that split, so
 * this adapter writes ordinary params and declares provenance.
 *
 * `audioInputs` is `["url"]`, which is the wire and not a simplification: the
 * local-file form of this endpoint is *raw audio bytes as the HTTP body* with
 * an audio content-type — not a multipart part and not a JSON field — so there
 * is nothing for a `Blob` to compile *to*. `deepgram.stt` documents that
 * path (post your bytes to `.request.url` yourself), and the canonical
 * `{ file }` deliberately does not pretend to be it.
 *
 * The timestamp mapping is the one line worth defending. /v1/listen returns
 * word timings unconditionally and offers exactly one timing switch,
 * `utterances`, which groups those words into segments. So `"segment"` is
 * `utterances: true` and `"word"` is `utterances: false` — the request states
 * the granularity it wants rather than leaning on a default the caller cannot
 * see, and the two are distinguishable on the wire, which is what keeps the
 * no-silent-drop guarantee true for this cell.
 */
import {
  applyExtras,
  resolveAudioInput,
  resolveDiarization,
  toTimestampGranularity,
} from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type { SttAdapterFor, SttParamsFor } from "../../core/unified/vocabulary/stt";
import { stt as validator, type ListenParams } from "./stt";
import { DEEPGRAM_STT_MODEL_PARAMS, MODELS } from "./stt-params";

const LISTEN_DOCS = "https://developers.deepgram.com/reference/speech-to-text/listen-pre-recorded";

/** The wire params this adapter compiles to (body `{url}` + query params). */
export type DeepgramSttWire = ListenParams;

/** What a unified call to `deepgram/…` returns. */
export type DeepgramSttResult = ReturnType<typeof validator>;

export const stt = {
  category: "stt",
  provider: "deepgram",
  models: MODELS,
  modelParams: DEEPGRAM_STT_MODEL_PARAMS,
  audioInputs: ["url"],
  unsupported: {
    prompt:
      "/v1/listen takes no prose prompt — its nearest feature is `keyterm` (Nova-3) or " +
      "`keywords`, both of which are lists of terms rather than a sentence, so send them " +
      "through `providerOptions.deepgram` where they keep their own meaning.",
  },
  compile(
    input: SttParamsFor<"url">,
    ctx: CompileContext<SttParamsFor<"url">>,
  ): CompiledCall<DeepgramSttWire, DeepgramSttResult> {
    const body: DeepgramSttWire = { model: ctx.model };
    ctx.from(["url"], "audio");
    ctx.from(["detect_language"], "languages");
    ctx.from(["diarize"], "diarization");
    ctx.from(["utterances"], "timestamps");

    const audio = ctx.take(
      resolveAudioInput(input.audio, ["url"], { path: ["audio"], warn: ctx.warn }, {
        source: LISTEN_DOCS,
        hint:
          "For local audio, POST the raw bytes to `.request.url` yourself with the file's " +
          "media type — /v1/listen has no multipart or file-id form.",
      }),
    );
    if (audio?.kind === "url") body.url = audio.url;

    // BCP-47 verbatim: Deepgram documents "language=pt-BR" and the `multi`
    // sentinel, so there is no subtag to drop and nothing to warn about.
    if (input.language !== undefined) body.language = input.language;

    if (input.languages !== undefined) body.detect_language = [...input.languages];

    if (input.diarization !== undefined) {
      const diarization = ctx.take(
        resolveDiarization(
          input.diarization,
          { source: LISTEN_DOCS },
          { path: ["diarization"], warn: ctx.warn },
        ),
      );
      if (diarization !== undefined) body.diarize = diarization.enabled;
    }

    if (input.timestamps !== undefined) {
      const granularity = ctx.take(
        toTimestampGranularity(input.timestamps, ["word", "segment"], {
          path: ["timestamps"],
          warn: ctx.warn,
        }, { source: LISTEN_DOCS }),
      );
      if (granularity !== undefined) body.utterances = granularity === "segment";
    }

    applyExtras(input, DEEPGRAM_STT_MODEL_PARAMS, body, ctx);

    return { params: body, validate: validator.safe };
  },
} as const satisfies SttAdapterFor<
  "url",
  typeof DEEPGRAM_STT_MODEL_PARAMS,
  DeepgramSttWire,
  DeepgramSttResult
>;
