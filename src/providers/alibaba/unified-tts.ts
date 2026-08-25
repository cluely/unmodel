/**
 * `unmodel/tts` → `alibaba.tts` (DashScope POST …/multimodal-generation/generation).
 *
 * A three-field `input` object, so the adapter is mostly nesting — with one
 * genuine translation and two declared gaps:
 *
 * - **`language_type` is spelled in English words**, not language codes:
 *   `"Portuguese"`, `"Chinese"`, `"Auto"`. The canonical `language` is
 *   BCP-47, so `LANGUAGE_TYPE_BY_SUBTAG` is the mapping, and a tag Alibaba
 *   has no word for is an `invalid_enum_value` naming the ten it does —
 *   never a dropped hint. An omitted `language` is the wire's own `"Auto"`
 *   default, left unsent.
 * - **`speed`** has no field anywhere on this route, and **`outputFormat`**
 *   has none either — the response encoding is fixed (a 24 kHz mono WAV URL,
 *   or Base64 PCM chunks under `stream: true`). Both are declared
 *   `unsupported` so the error is uniform and arrives before compile.
 *
 * Voices are a closed per-model list on this API (48 / 24 / 17 names), so the
 * rows narrow `voice` at compile time and the provider validator's checkVoice
 * enforces the same lists at run time.
 */
import { applyExtras, resolveVoice, toPrimaryLanguage } from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type { TtsAdapterFor, TtsParams } from "../../core/unified/vocabulary/tts";
import { tts as validator, type TtsGenerationParams } from "./tts";
import {
  ALIBABA_TTS_DELIVERY,
  ALIBABA_TTS_MODEL_PARAMS,
  LANGUAGE_TYPE_BY_SUBTAG,
  MODELS,
  TTS_DOCS,
  type AlibabaLanguageType,
} from "./tts-params";

/** The wire body this adapter compiles to. */
export type AlibabaTtsWire = TtsGenerationParams;

/** What a unified tts call to `alibaba/…` returns. */
export type AlibabaTtsResult = ReturnType<typeof validator>;

type AlibabaTtsValidate = CompiledCall<AlibabaTtsWire, AlibabaTtsResult>["validate"];

export const tts = {
  category: "tts",
  provider: "alibaba",
  models: MODELS,
  modelParams: ALIBABA_TTS_MODEL_PARAMS,
  delivery: ALIBABA_TTS_DELIVERY,
  unsupported: {
    speed:
      "the Qwen TTS request has no speaking-rate field (the realtime WebSocket API is where " +
      "prosody controls live); adjust pacing through the text, or an Instruct-Flash " +
      "`instructions` extra.",
    outputFormat:
      "the response encoding is fixed — a 24 kHz 16-bit mono WAV URL, or Base64 PCM chunks " +
      "when `stream: true` — there is no request field to pick a codec, container, sample " +
      "rate or bitrate.",
  },
  compile(
    input: TtsParams,
    ctx: CompileContext<TtsParams>,
  ): CompiledCall<AlibabaTtsWire, AlibabaTtsResult> {
    ctx.from(["input", "text"], "text");
    ctx.from(["input", "voice"], "voice");
    ctx.from(["input", "language_type"], "language");

    const body: AlibabaTtsWire = {
      model: ctx.model,
      input: { text: input.text, voice: "" },
    };

    if (input.voice !== undefined) {
      const voice = ctx.take(
        resolveVoice(
          input.voice,
          { accepts: ["name"], source: TTS_DOCS },
          { path: ["voice"], warn: ctx.warn },
        ),
      );
      if (voice !== undefined) body.input.voice = voice.value;
    }

    if (input.language !== undefined) {
      const primary = ctx.take(
        toPrimaryLanguage(input.language, { path: ["language"], warn: ctx.warn }, { source: TTS_DOCS }),
      );
      if (primary !== undefined) {
        const word = (
          LANGUAGE_TYPE_BY_SUBTAG as Readonly<Record<string, AlibabaLanguageType | undefined>>
        )[primary];
        if (word === undefined) {
          ctx.fail({
            code: "invalid_enum_value",
            path: ["language"],
            message:
              `\`language\` ${JSON.stringify(input.language)} has no \`language_type\` on this ` +
              "model — Alibaba names languages in English words, and covers " +
              `${Object.keys(LANGUAGE_TYPE_BY_SUBTAG).join(", ")}. Omit \`language\` for the ` +
              'wire\'s own "Auto" detection.',
            meta: {
              allowed: Object.keys(LANGUAGE_TYPE_BY_SUBTAG),
              value: input.language,
              source: TTS_DOCS,
            },
          });
        } else {
          body.input.language_type = word;
        }
      }
    }

    applyExtras(input, ALIBABA_TTS_MODEL_PARAMS, body, ctx, {
      nest: { instructions: ["input"], optimize_instructions: ["input"] },
    });

    return { params: body, validate: validator.safe as AlibabaTtsValidate };
  },
} as const satisfies TtsAdapterFor<
  typeof ALIBABA_TTS_MODEL_PARAMS,
  AlibabaTtsWire,
  AlibabaTtsResult
>;
