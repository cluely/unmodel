/**
 * `minimax.tts` → fal: the overlap table and the mapping.
 *
 * **Reached only from `./index.ts`** — see `core/translate/media-retarget.ts`
 * for why the seam is placed there and not in `./tts.ts`.
 *
 * ## What fal serves
 *
 * Three of MiniMax's eight speech models, verified against fal's curated
 * roster on 2026-08-25 (`data/fal/curation.json`; the drift guard in
 * `fal-target.test.ts` re-asserts every id here against `FAL_TTS_ENDPOINTS`).
 * Source pages under https://fal.ai/models/fal-ai/minimax/…/api
 *
 * | native `model` | fal endpoint |
 * |---|---|
 * | `speech-2.8-hd` | `fal-ai/minimax/speech-2.8-hd` |
 * | `speech-2.8-turbo` | `fal-ai/minimax/speech-2.8-turbo` |
 * | `speech-02-hd` | `fal-ai/minimax/speech-02-hd` |
 *
 * This is the closest overlap in the whole set on the numbers: fal's
 * `sample_rate`, `bitrate` and `channel` unions are literally MiniMax's own
 * constant arrays, and `speed`, `vol`, `pitch` and `output_format` agree
 * value-for-value and default-for-default.
 *
 * ## Two renames that fail silently if you miss them
 *
 * Both targets are `z.looseObject`s on fal's side, so a body carrying the
 * source spelling passes fal's own validation and is then ignored by the
 * model. That is the worst failure mode available — a green request that does
 * nothing — so both are stated here rather than left to a reader:
 *
 * - **`text` → `prompt`** on the two 2.8 rows. `speech-02-hd` keeps `text`.
 * - **`pronunciation_dict.tone` → `pronunciation_dict.tone_list`** everywhere.
 *   Same element format (`"燕少飞/(yan4)(shao3)(fei1)"`), different key.
 *
 * ## The one thing no param can express
 *
 * fal's 2.8 rows apply **loudness normalization by default**
 * (`normalization_setting.enabled` defaults to `true`); MiniMax's own
 * `t2a_v2` does not. Retargeted audio will therefore not match native output
 * even when every param maps exactly, so the mapping records it once per
 * retarget as an `approximated_param` on the route itself.
 */
import type { ApiRetargeter } from "../../core/request";
import {
  approximateParam,
  createMediaToApi,
  refuseParam,
  type MediaMapContext,
} from "../../core/translate/media-retarget";
import { FAL_MEDIA_TARGET } from "../../core/translate/media-endpoints";
import type { FalTtsBodyById } from "../fal/interop";
import type { T2aParams } from "./tts";

// The per-endpoint aliases below are `export`ed rather than private, and it is
// not decoration: they are the exact symbols `<Provider>…FalOverlap`'s
// `ReturnType` resolves to, so a consumer that emits declarations around a
// result carrying `.toApi("fal")` cannot name it without them (TS4023, "has or
// is using name 'FalAiFlux2ProInput' … but cannot be named"). Type-only, and
// re-exported one line from ./index.ts. See src/core/carriers.ts.
export type ById = FalTtsBodyById;
export type FalSpeech28Hd = ById["fal-ai/minimax/speech-2.8-hd"];
export type FalSpeech28Turbo = ById["fal-ai/minimax/speech-2.8-turbo"];
export type FalSpeech02Hd = ById["fal-ai/minimax/speech-02-hd"];

/** fal's `voice_setting.emotion` enum — MiniMax's, minus three, plus `neutral`. */
const FAL_EMOTIONS = new Set(["happy", "sad", "angry", "fearful", "disgusted", "surprised"]);

/** fal's `audio_setting.format` enum. MiniMax also serves four more. */
const FAL_FORMATS = new Set(["mp3", "pcm", "flac"]);

/**
 * The three language boosts MiniMax added after fal's snapshot.
 *
 * Exactly the set `minimax.tts`'s own `LATE_LANGUAGE_BOOSTS` names, which is
 * not a coincidence: both are "documented on MiniMax, absent from the enum
 * this side was generated from".
 */
const LATE_LANGUAGE_BOOSTS = new Set(["Persian", "Filipino", "Tamil"]);

/**
 * The params no fal MiniMax row publishes.
 *
 * `timbre_weights` is the one that takes a whole *request shape* with it:
 * MiniMax's documented voice-mixing mode leaves `voice_setting.voice_id` empty
 * and supplies weights instead, and fal has no field for either half — so such
 * a request has no fal representation at all, not merely a lossier one.
 */
function refuseUniversal(params: T2aParams, ctx: MediaMapContext, endpoint: string): void {
  if (params.stream === true) {
    refuseParam(
      ctx,
      ["stream"],
      endpoint,
      "is a queue submit, not a stream — `output_format` is a delivery switch there, not chunked transfer",
    );
  }
  if (params.stream_options !== undefined) {
    refuseParam(ctx, ["stream_options"], endpoint, "has no streaming arm for these options to configure");
  }
  if (params.subtitle_enable === true) {
    refuseParam(
      ctx,
      ["subtitle_enable"],
      endpoint,
      "returns `{ audio, duration_ms }` and no subtitle document — this changes the response contract, not just the request",
    );
  }
  if (params.subtitle_type !== undefined) {
    refuseParam(ctx, ["subtitle_type"], endpoint, "returns no subtitle document to granulate");
  }
  if (params.timbre_weights !== undefined) {
    refuseParam(
      ctx,
      ["timbre_weights"],
      endpoint,
      "publishes no voice-mixing fields — MiniMax's mixing mode leaves `voice_setting.voice_id` empty and supplies weights instead, and fal has neither half",
    );
  }
  const voice = params.voice_setting;
  if (voice?.latex_read !== undefined) {
    refuseParam(
      ctx,
      ["voice_setting", "latex_read"],
      endpoint,
      "publishes no LaTeX-reading switch, and fal's `voice_setting` is a loose object — an unmapped key would pass validation and be ignored",
    );
  }
  if (params.audio_setting?.force_cbr !== undefined) {
    refuseParam(
      ctx,
      ["audio_setting", "force_cbr"],
      endpoint,
      "has no constant-bitrate switch (MiniMax documents it as streamed-mp3 only, and there is no stream here)",
    );
  }
  if (params.voice_modify?.sound_effects !== undefined) {
    refuseParam(
      ctx,
      ["voice_modify", "sound_effects"],
      endpoint,
      "publishes `pitch`, `intensity` and `timbre` on `voice_modify` and no sound-effect field",
    );
  }
}

/** fal's rows require a non-empty `text`/`prompt`; MiniMax accepts `""`. */
function requireText(
  params: T2aParams,
  maxChars: number,
  ctx: MediaMapContext,
  endpoint: string,
): string {
  if (params.text === "") {
    ctx.unsupported({
      path: ["text"],
      message: `\`text\` must be non-empty at ${endpoint}; MiniMax accepts an empty string and fal does not.`,
    });
  } else if (params.text.length > maxChars) {
    ctx.unsupported({
      path: ["text"],
      message:
        `\`text\` is ${params.text.length} characters, over the ${maxChars}-character cap ${endpoint} publishes. ` +
        `MiniMax's own cap on this route is 10000, so this is a limit the retarget introduces.`,
    });
  }
  return params.text;
}

/** MiniMax's `voice_setting` → fal's, with the two divergent fields checked. */
function voiceSetting(
  params: T2aParams,
  ctx: MediaMapContext,
  endpoint: string,
): FalSpeech28Hd["voice_setting"] {
  const voice = params.voice_setting;
  if (voice === undefined) return undefined;
  const emotion = voice.emotion;
  if (emotion !== undefined && !FAL_EMOTIONS.has(emotion)) {
    ctx.unsupported({
      path: ["voice_setting", "emotion"],
      message:
        `\`voice_setting.emotion: "${emotion}"\` has no equivalent at ${endpoint}, whose enum is happy, sad, angry, ` +
        'fearful, disgusted, surprised and neutral. MiniMax\'s "calm", "fluent" and "whisper" have no counterpart, ' +
        'and "neutral" is not a rename of any of them.',
    });
  }
  if (voice.text_normalization !== undefined) {
    approximateParam(ctx, ["voice_setting", "text_normalization"], {
      requested: voice.text_normalization,
      achieved: "english_normalization",
      message:
        `\`voice_setting.text_normalization\` is digit-reading normalization for Chinese and English at MiniMax; ` +
        `${endpoint} spells the nearest thing \`english_normalization\` and documents it as English only. The value ` +
        "was carried, the scope narrowed.",
      source: `https://fal.ai/models/${endpoint}/api`,
    });
  }
  return {
    ...(voice.voice_id !== undefined && { voice_id: voice.voice_id }),
    ...(voice.speed !== undefined && { speed: voice.speed }),
    ...(voice.vol !== undefined && { vol: voice.vol }),
    ...(voice.pitch !== undefined && { pitch: voice.pitch }),
    ...(emotion !== undefined &&
      FAL_EMOTIONS.has(emotion) && { emotion: emotion as "happy" }),
    ...(voice.text_normalization !== undefined && {
      english_normalization: voice.text_normalization,
    }),
  };
}

/** MiniMax's `audio_setting` → fal's. Every numeric union matches exactly. */
function audioSetting(
  params: T2aParams,
  ctx: MediaMapContext,
  endpoint: string,
): FalSpeech28Hd["audio_setting"] {
  const audio = params.audio_setting;
  if (audio === undefined) return undefined;
  const format = audio.format;
  if (format !== undefined && !FAL_FORMATS.has(format)) {
    ctx.unsupported({
      path: ["audio_setting", "format"],
      message:
        `\`audio_setting.format: "${format}"\` has no equivalent at ${endpoint}, which serves mp3, pcm and flac. ` +
        'Snapping "wav" onto "pcm" would change the container, not just the codec.',
    });
  }
  return {
    ...(audio.sample_rate !== undefined && {
      sample_rate: audio.sample_rate as NonNullable<FalSpeech28Hd["audio_setting"]>["sample_rate"],
    }),
    ...(audio.bitrate !== undefined && {
      bitrate: audio.bitrate as NonNullable<FalSpeech28Hd["audio_setting"]>["bitrate"],
    }),
    ...(format !== undefined && FAL_FORMATS.has(format) && { format: format as "mp3" }),
    ...(audio.channel !== undefined && {
      channel: audio.channel as NonNullable<FalSpeech28Hd["audio_setting"]>["channel"],
    }),
  };
}

/** `language_boost`, refusing the three MiniMax added after fal's snapshot. */
function languageBoost(
  params: T2aParams,
  ctx: MediaMapContext,
  endpoint: string,
): string | null | undefined {
  const boost = params.language_boost;
  if (boost == null) return boost === null ? null : undefined;
  if (LATE_LANGUAGE_BOOSTS.has(boost)) {
    ctx.unsupported({
      path: ["language_boost"],
      message:
        `\`language_boost: "${boost}"\` is not in ${endpoint}'s enum: MiniMax added Persian, Filipino and Tamil ` +
        "after the schema fal publishes was generated. The other 38 values carry unchanged.",
    });
    return undefined;
  }
  return boost;
}

/** `pronunciation_dict.tone` → fal's `tone_list`. Same elements, different key. */
function pronunciationDict(params: T2aParams): { tone_list: string[] } | undefined {
  const tone = params.pronunciation_dict?.tone;
  if (tone === undefined) return undefined;
  return { tone_list: [...tone] };
}

/** The loudness-normalization note, recorded once per retarget on the 2.8 rows. */
function noteLoudnessNormalization(ctx: MediaMapContext, endpoint: string): void {
  ctx.warn({
    code: "approximated_param",
    path: [],
    message:
      `${endpoint} applies loudness normalization by default (\`normalization_setting.enabled\` defaults to true); ` +
      "MiniMax's own `/v1/t2a_v2` does not. The retargeted audio will not match native output even though every " +
      "param mapped. Set `normalization_setting: { enabled: false }` on the fal body to match.",
    meta: { requested: "no loudness normalization", achieved: "fal's default normalization" },
  });
}

function mapSpeech28(
  params: T2aParams,
  ctx: MediaMapContext,
  endpoint: string,
): FalSpeech28Hd {
  refuseUniversal(params, ctx, endpoint);
  noteLoudnessNormalization(ctx, endpoint);
  const voice = voiceSetting(params, ctx, endpoint);
  const audio = audioSetting(params, ctx, endpoint);
  const boost = languageBoost(params, ctx, endpoint);
  const dict = pronunciationDict(params);
  return {
    // The rename: the 2.8 rows call it `prompt`.
    prompt: requireText(params, 10000, ctx, endpoint),
    ...(voice !== undefined && { voice_setting: voice }),
    ...(audio !== undefined && { audio_setting: audio }),
    ...(boost !== undefined && { language_boost: boost as FalSpeech28Hd["language_boost"] }),
    ...(dict !== undefined && { pronunciation_dict: dict }),
    ...(params.voice_modify !== undefined && {
      voice_modify: {
        ...(params.voice_modify.pitch !== undefined && { pitch: params.voice_modify.pitch }),
        ...(params.voice_modify.intensity !== undefined && {
          intensity: params.voice_modify.intensity,
        }),
        ...(params.voice_modify.timbre !== undefined && { timbre: params.voice_modify.timbre }),
      },
    }),
    ...(params.output_format !== undefined && { output_format: params.output_format }),
  };
}

function mapSpeech28Hd(params: T2aParams, ctx: MediaMapContext): FalSpeech28Hd {
  return mapSpeech28(params, ctx, "fal-ai/minimax/speech-2.8-hd");
}

function mapSpeech28Turbo(params: T2aParams, ctx: MediaMapContext): FalSpeech28Turbo {
  return mapSpeech28(params, ctx, "fal-ai/minimax/speech-2.8-turbo") as FalSpeech28Turbo;
}

/**
 * `speech-02-hd` → `fal-ai/minimax/speech-02-hd`.
 *
 * Two deltas from the 2.8 rows, both narrowing: the field is `text` (no
 * rename), the cap is **5000** characters rather than MiniMax's own 10000, and
 * there is no `voice_modify` at all.
 */
function mapSpeech02Hd(params: T2aParams, ctx: MediaMapContext): FalSpeech02Hd {
  const endpoint = "fal-ai/minimax/speech-02-hd";
  refuseUniversal(params, ctx, endpoint);
  if (params.voice_modify !== undefined) {
    refuseParam(
      ctx,
      ["voice_modify"],
      endpoint,
      "publishes no `voice_modify` — fal exposes it on the Speech 2.8 rows only",
    );
  }
  const voice = voiceSetting(params, ctx, endpoint);
  const audio = audioSetting(params, ctx, endpoint);
  const boost = languageBoost(params, ctx, endpoint);
  const dict = pronunciationDict(params);
  return {
    text: requireText(params, 5000, ctx, endpoint),
    ...(voice !== undefined && { voice_setting: voice }),
    ...(audio !== undefined && { audio_setting: audio }),
    ...(boost !== undefined && { language_boost: boost as FalSpeech02Hd["language_boost"] }),
    ...(dict !== undefined && { pronunciation_dict: dict }),
    ...(params.output_format !== undefined && { output_format: params.output_format }),
  };
}

/** MiniMax speech model id → the fal endpoint that serves it. */
export const MINIMAX_TTS_FAL_OVERLAP = {
  "speech-2.8-hd": { endpoints: ["fal-ai/minimax/speech-2.8-hd"], map: mapSpeech28Hd },
  "speech-2.8-turbo": { endpoints: ["fal-ai/minimax/speech-2.8-turbo"], map: mapSpeech28Turbo },
  "speech-02-hd": { endpoints: ["fal-ai/minimax/speech-02-hd"], map: mapSpeech02Hd },
} as const;

/** The five MiniMax speech ids fal does not serve, with the reason. */
export const MINIMAX_TTS_FAL_REFUSALS: Readonly<Record<string, string>> = Object.freeze({
  "speech-2.6-hd":
    'fal serves no Speech 2.6 row, and 2.6 is the only generation that offers `emotion: "whisper"` — snapping it to a 2.8 row would drop a capability, not a transport.',
  "speech-2.6-turbo":
    'fal serves no Speech 2.6 row, and 2.6 is the only generation that offers `emotion: "whisper"`.',
  "speech-02-turbo":
    "fal serves speech-02-hd but no speech-02-turbo; routing to a 2.8 row would cross a generation.",
  "speech-01-hd": "fal's curated MiniMax speech roster is 02-hd and the 2.8 pair.",
  "speech-01-turbo": "fal's curated MiniMax speech roster is 02-hd and the 2.8 pair.",
});

/** The type half of {@link MINIMAX_TTS_FAL_OVERLAP}, derived from it. */
export type MinimaxTtsFalOverlap = {
  [K in keyof typeof MINIMAX_TTS_FAL_OVERLAP]: ReturnType<
    (typeof MINIMAX_TTS_FAL_OVERLAP)[K]["map"]
  >;
};

/** `.toApi("fal")` for `minimax.tts`. */
export const minimaxTtsToFal: (params: T2aParams) => ApiRetargeter = createMediaToApi({
  endpoint: "minimax.tts",
  target: FAL_MEDIA_TARGET,
  modelId: (params: T2aParams) => params.model,
  overlap: MINIMAX_TTS_FAL_OVERLAP,
  refusals: MINIMAX_TTS_FAL_REFUSALS,
});
