/**
 * `unmodel/sts` → `hume.sts` (POST /v0/tts/voice_conversion/file).
 *
 * The simplest compile in the pack: three of the four canonical words land on a
 * field of the same name, and the fourth — `model` — lands nowhere, because
 * this route has no model field and no `version` either. `ctx.model` is
 * unmodel's synthetic `voice-conversion` id and is deliberately not written
 * into the body; a catalog id in a request is the mistake `hume.tts`'s header
 * warns about, one route over.
 *
 * `voice` is the one place this adapter is RICHER than its ElevenLabs sibling.
 * Hume takes both spellings — `{ id }` from the Voice Library or your own
 * catalog, `{ name }` from either — and cannot tell which a bare string means,
 * so both arms of the canonical {@link Voice} reach the wire unchanged and a
 * bare string is read as an id. `voice.provider` (`HUME_AI` /
 * `CUSTOM_VOICE`, defaulting to the latter) stays on `providerOptions.hume`
 * for the reason `./tts-params.ts` records: a key spelled `provider` that means
 * something other than the model ref's provider is worth more confusion than it
 * saves.
 *
 * `outputFormat` carries a container name and nothing else, so a sample rate or
 * bitrate is an `unsupported_param` rather than a value dropped on the floor —
 * `hume.tts`'s arrangement, and the same `FORMAT` shape.
 */
import { applyExtras, resolveAudioFormat, resolveVoice } from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type { StsAdapterFor, StsParams } from "../../core/unified/vocabulary/sts";
import { sts as validator, type VoiceConversionBody } from "./sts";
import {
  FORMAT,
  HUME_STS_MODEL_PARAMS,
  MODELS,
  VOICE_CONVERSION_DOCS,
} from "./sts-params";
import type { HumeAudioFormatType } from "./tts";

/** The wire body this adapter compiles to (the multipart form fields). */
export type HumeStsWire = VoiceConversionBody;

/** What a unified call to `hume/voice-conversion` returns. */
export type HumeStsResult = ReturnType<typeof validator<HumeStsWire>>;

export const sts = {
  category: "sts",
  provider: "hume",
  models: MODELS,
  modelParams: HUME_STS_MODEL_PARAMS,
  compile(
    input: StsParams,
    ctx: CompileContext<StsParams>,
  ): CompiledCall<HumeStsWire, HumeStsResult> {
    const body: HumeStsWire = { audio: input.audio.file };
    ctx.from(["audio"], "audio");
    ctx.from(["voice"], "voice");
    ctx.from(["format"], "outputFormat");

    const voice = ctx.take(
      resolveVoice(
        input.voice,
        { accepts: ["id", "name"], source: VOICE_CONVERSION_DOCS },
        { path: ["voice"], warn: ctx.warn },
      ),
    );
    if (voice !== undefined) {
      body.voice = voice.kind === "id" ? { id: voice.value } : { name: voice.value };
    }

    if (input.outputFormat !== undefined) {
      const format = ctx.take(
        resolveAudioFormat(input.outputFormat, FORMAT, { path: ["outputFormat"], warn: ctx.warn }),
      );
      if (format !== undefined) {
        const type: HumeAudioFormatType =
          format.codec === "mp3" ? "mp3" : format.container === "wav" ? "wav" : "pcm";
        body.format = { type };
      }
    }

    applyExtras(input, HUME_STS_MODEL_PARAMS, body, ctx);

    return { params: body, validate: validator.safe };
  },
} as const satisfies StsAdapterFor<typeof HUME_STS_MODEL_PARAMS, HumeStsWire, HumeStsResult>;
