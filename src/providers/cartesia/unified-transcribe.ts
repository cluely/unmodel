/**
 * `unmodel/transcribe` → `cartesia.transcribe` (POST /stt).
 *
 * The smallest surface in the category — six wire fields — and the second
 * blob-only route, so `audioInputs` is `["file"]`. There is no URL field and
 * no upload endpoint: `file` is required and a string in it is appended to the
 * form verbatim rather than fetched, which is why a canonical `{ url }` has
 * nothing to compile to here.
 *
 * `timestamp_granularities` is an array whose only member is `"word"`, so the
 * canonical `"segment"` and `"character"` are `invalid_enum_value` naming what
 * this route reports — the narrowest timestamp cell in the category, and the
 * one that shows why the granularity is refused rather than approximated: a
 * segment is not a coarse word.
 */
import {
  resolveAudioInput,
  toPrimaryLanguage,
  toTimestampGranularity,
} from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type {
  TranscribeAdapterFor,
  TranscribeParamsFor,
} from "../../core/unified/vocabulary/transcribe";
import { transcribe as validator, type SttTranscribeParams } from "./transcribe";

/** The one batch STT model — the ref union for `cartesia/…`. */
const MODELS = ["ink-whisper"] as const;

const STT_DOCS = "https://docs.cartesia.ai/api-reference/stt/transcribe";

/** The wire params this adapter compiles to (form fields + query params). */
export type CartesiaTranscribeWire = SttTranscribeParams;

/** What a unified call to `cartesia/…` returns. */
export type CartesiaTranscribeResult = ReturnType<typeof validator>;

export const transcribe = {
  category: "transcribe",
  provider: "cartesia",
  models: MODELS,
  audioInputs: ["file"],
  unsupported: {
    languages:
      "POST /stt takes one `language` from a closed list and has no candidate-set field; omit " +
      "`language` to let Whisper detect.",
    diarization:
      "POST /stt has no diarization of any kind — Cartesia's speaker features live on the " +
      "realtime `/stt/websocket` surface, which is a different endpoint.",
    prompt: "POST /stt takes no prompt, keyterms or vocabulary field of any kind.",
  },
  compile(
    input: TranscribeParamsFor<"file">,
    ctx: CompileContext<TranscribeParamsFor<"file">>,
  ): CompiledCall<CartesiaTranscribeWire, CartesiaTranscribeResult> {
    const body: CartesiaTranscribeWire = { file: new Blob([]), model: ctx.model };
    ctx.from(["file"], "audio");
    ctx.from(["timestamp_granularities"], "timestamps");

    const audio = ctx.take(
      resolveAudioInput(input.audio, ["file"], { path: ["audio"], warn: ctx.warn }, {
        source: STT_DOCS,
        hint: "POST /stt reads the bytes from a multipart `file` part; it fetches no URLs.",
      }),
    );
    if (audio?.kind === "file") body.file = audio.file;

    if (input.language !== undefined) {
      const language = ctx.take(
        toPrimaryLanguage(input.language, { path: ["language"], warn: ctx.warn }, {
          source: STT_DOCS,
        }),
      );
      // The closed 100-code list lives in `cartesia.transcribe`'s own
      // `checkLanguage`; duplicating it here would be a second copy to drift.
      if (language !== undefined) body.language = language;
    }

    if (input.timestamps !== undefined) {
      const granularity = ctx.take(
        toTimestampGranularity(input.timestamps, ["word"], {
          path: ["timestamps"],
          warn: ctx.warn,
        }, { source: STT_DOCS }),
      );
      if (granularity !== undefined) body.timestamp_granularities = [granularity];
    }

    return { params: body, validate: validator.safe };
  },
} as const satisfies TranscribeAdapterFor<
  "file",
  CartesiaTranscribeWire,
  CartesiaTranscribeResult
>;
