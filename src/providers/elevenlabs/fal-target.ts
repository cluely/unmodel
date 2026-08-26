/**
 * `elevenlabs.tts` → fal: the overlap table and the mapping.
 *
 * **Reached only from `./index.ts`** — see `core/translate/media-retarget.ts`
 * for why the seam is placed there and not in `./tts.ts`.
 *
 * ## What fal serves
 *
 * Three of ElevenLabs' seven TTS models, verified against fal's curated roster
 * on 2026-08-25 (`data/fal/curation.json`; the drift guard in
 * `fal-target.test.ts` re-asserts every id here against `FAL_TTS_ENDPOINTS`).
 * Source pages under https://fal.ai/models/fal-ai/elevenlabs/tts/…/api
 *
 * | native `model_id` | fal endpoint |
 * |---|---|
 * | `eleven_v3` | `fal-ai/elevenlabs/tts/eleven-v3` |
 * | `eleven_multilingual_v2` | `fal-ai/elevenlabs/tts/multilingual-v2` |
 * | `eleven_turbo_v2_5` | `fal-ai/elevenlabs/tts/turbo-v2.5` |
 *
 * `eleven_flash_v2_5` is the one to argue about, and it is refused: the
 * catalog records turbo v2.5 as "deprecated in favour of eleven_flash_v2_5, to
 * which the docs state it is functionally equivalent", and the two carry the
 * same rate — but they are still two model ids producing different audio, and
 * a retarget that silently swaps the model is not a retarget.
 *
 * ## The two things that change even when every param maps
 *
 * Both are recorded once per retarget as `approximated_param`, because neither
 * is expressible as a param and both change what the caller gets back:
 *
 * - **`voice_id` changes namespace.** ElevenLabs voice ids and cloned voices
 *   belong to *your* account; fal calls ElevenLabs under fal's. fal's row
 *   publishes an open `voice` string whose default is the *name* `"Rachel"`,
 *   so a system voice resolves and a clone does not.
 * - **The response changes shape.** `elevenlabs.tts` answers with raw audio
 *   bytes; fal answers with a queue envelope you poll, whose result document
 *   carries `{ audio: { url }, timestamps? }`.
 *
 * ## The refusal that matters most
 *
 * `enable_logging: false` is ElevenLabs' zero-retention mode. fal publishes no
 * equivalent, and dropping a privacy request silently is the worst failure
 * available here — so it is a hard error, unconditionally.
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
import type { TextToSpeechParams } from "./tts";

// The per-endpoint aliases below are `export`ed rather than private, and it is
// not decoration: they are the exact symbols `<Provider>…FalOverlap`'s
// `ReturnType` resolves to, so a consumer that emits declarations around a
// result carrying `.toApi("fal")` cannot name it without them (TS4023, "has or
// is using name 'FalAiFlux2ProInput' … but cannot be named"). Type-only, and
// re-exported one line from ./index.ts. See src/core/carriers.ts.
export type ById = FalTtsBodyById;
export type FalElevenV3 = ById["fal-ai/elevenlabs/tts/eleven-v3"];
export type FalElevenMultilingualV2 = ById["fal-ai/elevenlabs/tts/multilingual-v2"];
export type FalElevenTurboV25 = ById["fal-ai/elevenlabs/tts/turbo-v2.5"];

/**
 * The params no fal ElevenLabs row publishes, refused on every arm.
 *
 * Every one of them is account-scoped, privacy-relevant or determinism-
 * relevant, which is why none is droppable:
 *
 * - `enable_logging: false` — zero retention. See the module header.
 * - `output_format` — fal's rows expose no codec, sample rate or bitrate; the
 *   result is a file on fal's CDN. A caller who asked for `pcm_44100` and got
 *   an MP3 URL has a broken pipeline, not a lossier one.
 * - `optimize_streaming_latency` — fal is a queue; there is no stream to tune.
 * - `seed` — no field, and dropping it destroys the determinism it exists for.
 * - `pronunciation_dictionary_locators` — the ids address dictionaries in
 *   *your* ElevenLabs account. Structurally unresolvable from fal's.
 * - `previous_request_ids` / `next_request_ids` — request stitching, scoped to
 *   whoever called ElevenLabs. That is fal, not you.
 * - `apply_language_text_normalization` — changes Japanese output.
 * - `use_pvc_as_ivc` — selects a voice *version* in your account.
 * - `voice_settings.use_speaker_boost` — no fal field. `false` is an explicit
 *   change from ElevenLabs' default, so it is refused; `true` restates the
 *   default and is dropped with a `dropped_param` note.
 */
function refuseUniversal(
  params: TextToSpeechParams,
  ctx: MediaMapContext,
  endpoint: string,
): void {
  if (params.enable_logging === false) {
    refuseParam(
      ctx,
      ["enable_logging"],
      endpoint,
      "publishes no retention control — `enable_logging: false` is ElevenLabs' zero-retention mode, and silently losing a privacy request is the one failure this seam will never make",
    );
  }
  if (params.output_format !== undefined) {
    refuseParam(
      ctx,
      ["output_format"],
      endpoint,
      "exposes no codec, sample-rate or bitrate control: it returns a file on fal's CDN in fal's own format",
    );
  }
  if (params.optimize_streaming_latency != null) {
    refuseParam(
      ctx,
      ["optimize_streaming_latency"],
      endpoint,
      "is a queue submit, not a stream — there is no first-chunk latency to tune",
    );
  }
  if (params.seed != null) {
    refuseParam(ctx, ["seed"], endpoint, "publishes no seed, so the determinism `seed` exists for cannot be carried");
  }
  if (params.pronunciation_dictionary_locators != null) {
    refuseParam(
      ctx,
      ["pronunciation_dictionary_locators"],
      endpoint,
      "cannot resolve a `pronunciation_dictionary_id`: those address dictionaries in your own ElevenLabs account, not fal's",
    );
  }
  if (params.previous_request_ids != null || params.next_request_ids != null) {
    refuseParam(
      ctx,
      [params.previous_request_ids != null ? "previous_request_ids" : "next_request_ids"],
      endpoint,
      "cannot stitch requests: the ids are scoped to whoever called ElevenLabs, and on a retarget that is fal",
    );
  }
  if (params.apply_language_text_normalization !== undefined) {
    refuseParam(
      ctx,
      ["apply_language_text_normalization"],
      endpoint,
      "publishes no language-specific normalization switch, and it changes how Japanese is read",
    );
  }
  if (params.use_pvc_as_ivc !== undefined) {
    refuseParam(
      ctx,
      ["use_pvc_as_ivc"],
      endpoint,
      "selects no voice version — PVC/IVC versions belong to your own ElevenLabs account",
    );
  }
  const settings = params.voice_settings;
  if (settings?.use_speaker_boost === false) {
    refuseParam(
      ctx,
      ["voice_settings", "use_speaker_boost"],
      endpoint,
      "publishes no speaker-boost switch, and `false` is an explicit departure from ElevenLabs' default",
    );
  } else if (settings?.use_speaker_boost === true) {
    ctx.warn({
      code: "dropped_param",
      path: ["voice_settings", "use_speaker_boost"],
      message: `${endpoint} publishes no speaker-boost switch; \`true\` restates ElevenLabs' own default, so it was dropped rather than refused.`,
      meta: { param: "voice_settings.use_speaker_boost" },
    });
  }
}

/** fal's rows require a non-empty `text`; ElevenLabs accepts `""`. */
function requireText(params: TextToSpeechParams, ctx: MediaMapContext, endpoint: string): string {
  if (params.text !== "") return params.text;
  ctx.unsupported({
    path: ["text"],
    message: `\`text\` must be non-empty at ${endpoint}; ElevenLabs accepts an empty string and fal does not.`,
  });
  return params.text;
}

/** The voice-namespace and response-shape notes, recorded once per retarget. */
function noteNamespaceChange(
  params: TextToSpeechParams,
  ctx: MediaMapContext,
  endpoint: string,
): void {
  approximateParam(ctx, ["voice_id"], {
    requested: params.voice_id,
    achieved: `${endpoint} \`voice\``,
    message:
      `\`voice_id\` was carried to ${endpoint}'s open \`voice\` field, but the namespace changes: fal calls ` +
      "ElevenLabs under fal's account, so a stock voice resolves and a voice you cloned does not. fal's own " +
      'default for the field is the NAME "Rachel", not an id.',
    source: `https://fal.ai/models/${endpoint}/api`,
  });
  ctx.warn({
    code: "approximated_param",
    path: [],
    message:
      `\`elevenlabs.tts\` answers with raw audio bytes; ${endpoint} answers with fal's queue envelope, whose ` +
      "result document carries `{ audio: { url }, timestamps? }`. Follow the `response_url` the submit hands back.",
    meta: { requested: "audio/mpeg body", achieved: "fal queue result document" },
  });
}

/** Refuses a 0–1 setting fal bounds but ElevenLabs does not. */
function unitRange(
  value: number | null | undefined,
  key: "stability" | "similarity_boost" | "style",
  ctx: MediaMapContext,
  endpoint: string,
): number | undefined {
  if (value == null) return undefined;
  if (value >= 0 && value <= 1) return value;
  ctx.unsupported({
    path: ["voice_settings", key],
    message:
      `\`voice_settings.${key}\` is ${value}; ${endpoint} bounds it to 0–1. ElevenLabs publishes no numeric ` +
      "bounds for it, so unmodel enforces none on the source — but fal does, and the request would 422.",
  });
  return undefined;
}

/**
 * `eleven_v3` → `fal-ai/elevenlabs/tts/eleven-v3`.
 *
 * The thin arm: fal's v3 row publishes `text`, `voice`, `stability`,
 * `language_code` and `apply_text_normalization`, and nothing else. So
 * `similarity_boost`, `style`, `speed`, `previous_text` and `next_text` — all
 * of which the other two arms carry — are refused here rather than silently
 * thinned. A request that is quietly stripped of its style exaggeration is a
 * different request.
 */
function mapElevenV3(params: TextToSpeechParams, ctx: MediaMapContext): FalElevenV3 {
  const endpoint = "fal-ai/elevenlabs/tts/eleven-v3";
  refuseUniversal(params, ctx, endpoint);
  noteNamespaceChange(params, ctx, endpoint);
  const settings = params.voice_settings;
  for (const key of ["similarity_boost", "style", "speed"] as const) {
    if (settings?.[key] != null) {
      refuseParam(
        ctx,
        ["voice_settings", key],
        endpoint,
        "publishes only `stability` of the voice settings — fal's Eleven v3 row has no `similarity_boost`, `style` or `speed`",
      );
    }
  }
  if (params.previous_text != null || params.next_text != null) {
    refuseParam(
      ctx,
      [params.previous_text != null ? "previous_text" : "next_text"],
      endpoint,
      "publishes no continuity fields on the Eleven v3 row",
    );
  }
  const stability = unitRange(settings?.stability, "stability", ctx, endpoint);
  return {
    text: requireText(params, ctx, endpoint),
    voice: params.voice_id,
    ...(stability !== undefined && { stability }),
    ...(params.language_code != null && { language_code: params.language_code }),
    ...(params.apply_text_normalization !== undefined && {
      apply_text_normalization: params.apply_text_normalization,
    }),
  };
}

/**
 * `eleven_multilingual_v2` / `eleven_turbo_v2_5` → their fal rows.
 *
 * One mapping for two endpoints: fal publishes byte-identical property sets
 * for both (they share a generated row). Ten fields land, and `speed`'s bounds
 * match to the decimal on both sides (0.7–1.2), which is the sort of agreement
 * that makes an overlap worth shipping.
 */
function mapElevenFull(
  params: TextToSpeechParams,
  ctx: MediaMapContext,
  endpoint: string,
): FalElevenMultilingualV2 {
  refuseUniversal(params, ctx, endpoint);
  noteNamespaceChange(params, ctx, endpoint);
  const settings = params.voice_settings;
  const stability = unitRange(settings?.stability, "stability", ctx, endpoint);
  const similarity = unitRange(settings?.similarity_boost, "similarity_boost", ctx, endpoint);
  const style = unitRange(settings?.style, "style", ctx, endpoint);
  const speed = settings?.speed;
  if (speed != null && (speed < 0.7 || speed > 1.2)) {
    ctx.unsupported({
      path: ["voice_settings", "speed"],
      message: `\`voice_settings.speed\` is ${speed}; ${endpoint} bounds it to 0.7–1.2, the same window ElevenLabs documents.`,
    });
  }
  return {
    text: requireText(params, ctx, endpoint),
    voice: params.voice_id,
    ...(stability !== undefined && { stability }),
    ...(similarity !== undefined && { similarity_boost: similarity }),
    ...(style !== undefined && { style }),
    ...(speed != null && speed >= 0.7 && speed <= 1.2 && { speed }),
    ...(params.previous_text != null && { previous_text: params.previous_text }),
    ...(params.next_text != null && { next_text: params.next_text }),
    ...(params.language_code != null && { language_code: params.language_code }),
    ...(params.apply_text_normalization !== undefined && {
      apply_text_normalization: params.apply_text_normalization,
    }),
  };
}

function mapMultilingualV2(
  params: TextToSpeechParams,
  ctx: MediaMapContext,
): FalElevenMultilingualV2 {
  return mapElevenFull(params, ctx, "fal-ai/elevenlabs/tts/multilingual-v2");
}

function mapTurboV25(params: TextToSpeechParams, ctx: MediaMapContext): FalElevenTurboV25 {
  return mapElevenFull(params, ctx, "fal-ai/elevenlabs/tts/turbo-v2.5") as FalElevenTurboV25;
}

/** ElevenLabs TTS model id → the fal endpoint that serves it. */
export const ELEVENLABS_TTS_FAL_OVERLAP = {
  eleven_v3: { endpoints: ["fal-ai/elevenlabs/tts/eleven-v3"], map: mapElevenV3 },
  eleven_multilingual_v2: {
    endpoints: ["fal-ai/elevenlabs/tts/multilingual-v2"],
    map: mapMultilingualV2,
  },
  eleven_turbo_v2_5: { endpoints: ["fal-ai/elevenlabs/tts/turbo-v2.5"], map: mapTurboV25 },
} as const;

/** The four ElevenLabs TTS ids fal does not serve, with the reason. */
export const ELEVENLABS_TTS_FAL_REFUSALS: Readonly<Record<string, string>> = Object.freeze({
  eleven_flash_v2_5:
    'fal serves no Flash v2.5 row. Turbo v2.5 is documented as "functionally equivalent" and carries the same rate, but it is a different model id producing different audio, and a retarget that swaps the model is not a retarget.',
  eleven_flash_v2: "fal's curated ElevenLabs TTS roster is Eleven v3, Multilingual v2 and Turbo v2.5.",
  eleven_turbo_v2: "fal's curated ElevenLabs TTS roster is Eleven v3, Multilingual v2 and Turbo v2.5.",
  eleven_multilingual_v1:
    "fal's curated ElevenLabs TTS roster is Eleven v3, Multilingual v2 and Turbo v2.5.",
});

/** The type half of {@link ELEVENLABS_TTS_FAL_OVERLAP}, derived from it. */
export type ElevenlabsTtsFalOverlap = {
  [K in keyof typeof ELEVENLABS_TTS_FAL_OVERLAP]: ReturnType<
    (typeof ELEVENLABS_TTS_FAL_OVERLAP)[K]["map"]
  >;
};

/**
 * `.toApi("fal")` for `elevenlabs.tts`.
 *
 * `model_id` is optional on the wire and defaults to `eleven_multilingual_v2`
 * server-side, so the retargeter resolves the same default the validator does
 * — an omitted model is a mapped model here, not an unknown one.
 */
export const elevenlabsTtsToFal: (params: TextToSpeechParams) => ApiRetargeter = createMediaToApi({
  endpoint: "elevenlabs.tts",
  target: FAL_MEDIA_TARGET,
  modelId: (params: TextToSpeechParams) => params.model_id ?? "eleven_multilingual_v2",
  overlap: ELEVENLABS_TTS_FAL_OVERLAP,
  refusals: ELEVENLABS_TTS_FAL_REFUSALS,
});
