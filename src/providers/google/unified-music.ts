/**
 * `unmodel/music` → `google.music` (POST /v1beta/interactions).
 *
 * The provider with no knobs. Lyria 3's request surface is a prompt (plus,
 * wire-only, images) and one output-format switch — every musical control the
 * category's other providers put in fields (length, vocals, bpm) is steered
 * "using prompt" here, so this adapter is mostly declared gaps:
 *
 * - **`durationSeconds` has no field.** Clip is fixed at 30 seconds; Pro runs
 *   "a couple of minutes (controllable using prompt)". Compiling `120` into an
 *   English sentence would be inventing a request (the same finding as
 *   `google.tts`'s `speed`), so the gap is declared and the message says where
 *   the control actually is.
 * - **`instrumental` has no switch** — same story: ask for "instrumental" in
 *   the prompt.
 * - **`seed`** compiles to `generation_config.seed`, which the Interactions
 *   reference documents surface-wide ("Seed used in decoding for
 *   reproducibility"); the music guide itself is silent about it, so it goes
 *   out as written and any refusal is the API's to make.
 * - **`outputFormat`** compiles to `response_format` — `{ type: "audio" }`
 *   with `mime_type` `audio/mp3` or `audio/wav` (canonical `pcm_s16le` in its
 *   default WAV container). On Clip there is nothing to compile INTO: MP3 is
 *   the only output and the WAV option is "available for Lyria 3 Pro only", so
 *   a canonical `mp3` is a no-op and anything beyond it warns rather than
 *   sending a field the model refuses.
 *
 * Image-conditioned generation ("up to 10 images alongside your text prompt")
 * stays wire-only on `google.music`, exactly as Stability's audio-conditioned
 * routes stay wire-only: no other music provider takes images, so a canonical
 * vocabulary for them would be a vocabulary of one.
 */
import { applyExtras, resolveAudioFormat } from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type { MusicAdapterFor, MusicParams } from "../../core/unified/vocabulary/music";
import {
  music as validator,
  type GoogleInteractionServiceTier,
  type GoogleLyriaAudioMimeType,
  type GoogleLyriaAudioResponseFormat,
} from "./music";
import { FORMAT, GOOGLE_MUSIC_MODEL_PARAMS, MODELS } from "./music-params";

/**
 * The wire body this adapter compiles to — the loose arm of
 * `CreateMusicInteractionBody`. `input` is always the bare prompt string:
 * block-form input exists for images, which are wire-only (see the header).
 */
export interface GoogleMusicWire {
  model: string;
  input: string;
  response_format?: GoogleLyriaAudioResponseFormat;
  generation_config?: { seed?: number };
  store?: boolean;
  background?: boolean;
  service_tier?: GoogleInteractionServiceTier;
  labels?: Record<string, string>;
}

/** What a unified music call to `google/…` returns: `google.music`'s `Validated`. */
export type GoogleMusicResult = ReturnType<
  typeof validator<GoogleMusicWire["model"], GoogleMusicWire>
>;

export const music = {
  category: "music",
  provider: "google",
  models: MODELS,
  modelParams: GOOGLE_MUSIC_MODEL_PARAMS,
  unsupported: {
    durationSeconds:
      "Lyria 3 has no duration field — lyria-3-clip-preview always renders 30 seconds, and " +
      "lyria-3-pro-preview's full-song length is \"controllable using prompt\". Write the " +
      "target length into `prompt` rather than have unmodel invent a sentence for you.",
    instrumental:
      "Lyria 3 has no vocals switch — the guide steers everything musical through the prompt, " +
      "so ask for an instrumental piece in `prompt` itself.",
  },
  compile(
    input: MusicParams,
    ctx: CompileContext<MusicParams>,
  ): CompiledCall<GoogleMusicWire, GoogleMusicResult> {
    const body: GoogleMusicWire = { model: ctx.model, input: input.prompt };
    ctx.from(["model"], "model");
    ctx.from(["input"], "prompt");
    ctx.from(["generation_config", "seed"], "seed");
    // Leaf paths spelled out, same reason as `google.tts`'s responseFormat
    // rules: a finding at `response_format.mime_type` must reach the caller as
    // `outputFormat`.
    for (const leaf of [[], ["type"], ["mime_type"], ["sample_rate"], ["bit_rate"], ["delivery"]]) {
      ctx.from(["response_format", ...leaf], "outputFormat");
    }

    if (input.outputFormat !== undefined) {
      const format = ctx.take(
        resolveAudioFormat(input.outputFormat, FORMAT, { path: ["outputFormat"], warn: ctx.warn }),
      );
      if (format !== undefined) {
        if (ctx.model === "lyria-3-clip-preview") {
          // Nothing to emit: MP3 is Clip's only output and `response_format`
          // is Pro-only, so a canonical `mp3` is the model's default restated.
          // A rate or bitrate names a control Clip does not have.
          if (format.codec !== "mp3" || format.sampleRate !== undefined || format.bitrate !== undefined) {
            ctx.warn({
              code: "dropped_param",
              path: ["outputFormat"],
              message:
                "`outputFormat` is fixed on lyria-3-clip-preview: Clip always emits 30-second " +
                'MP3s and takes no `response_format` — "This WAV format option is available ' +
                'for Lyria 3 Pro only." The request goes out with the MP3 default.',
              meta: { param: "outputFormat" },
            });
          }
        } else {
          body.response_format = {
            type: "audio",
            mime_type: format.wire as GoogleLyriaAudioMimeType,
            ...(format.sampleRate !== undefined && { sample_rate: format.sampleRate }),
            // `FORMAT.unavailable` already refused a bitrate on the WAV arm,
            // so reaching here with one means MP3.
            ...(format.bitrate !== undefined && { bit_rate: format.bitrate }),
          };
        }
      }
    }

    if (input.seed !== undefined) body.generation_config = { seed: input.seed };

    applyExtras(input, GOOGLE_MUSIC_MODEL_PARAMS, body, ctx);

    return { params: body, validate: validator.safe };
  },
} as const satisfies MusicAdapterFor<
  typeof GOOGLE_MUSIC_MODEL_PARAMS,
  GoogleMusicWire,
  GoogleMusicResult
>;
