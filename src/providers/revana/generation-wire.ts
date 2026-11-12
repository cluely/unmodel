/**
 * Revana's generation wire — `POST https://api.revana.si/v1/generations` —
 * and the documents it answers with.
 *
 * Type-only. Transcribed 2026-11-12 from https://revana.si/openapi.json
 * (`info.version` `2026-10-31`; committed at `data/revana/openapi.json`) and
 * https://revana.si/llms-full.txt. The interface names are the OpenAPI schema
 * names — `GenerationRequest`, `ModelInput`, `SeedanceInput`, `NemesisInput`,
 * `Generation`, `Quote` — and every field keeps its wire spelling
 * (`docs/decisions.md` §2).
 *
 * # One body for every image, video, speech and music model
 *
 * `{ model, input }`, where `input` is one of three schemas chosen BY `model`:
 *
 * > "SeedanceInput for seedance-2.5. NemesisInput for nemesis … and
 * > nemesis-lite … ModelInput for every other model."
 *
 * The OpenAPI document spells that as a bare `oneOf`, which a JSON Schema
 * validator cannot honour — `{ "prompt": "…" }` matches both `SeedanceInput`
 * and `ModelInput`, so a strict reading refuses the most ordinary request
 * there is. The server does not read it that way and neither does unmodel:
 * the arm is selected by the model id ({@link InputFor}).
 *
 * # `ModelInput` is wider than the document says
 *
 * The published `ModelInput` declares seventeen properties with
 * `additionalProperties: false` and no speech field at all, while the speech
 * models' own pages send `{ "text": …, "voice": … }`. The API's validator
 * recognises seven more keys, and names them itself when one is sent to a
 * model that lacks it ("elevenlabs-v3 reads text aloud … It takes text, voice,
 * dialogue, stability and language_code"). Those seven are typed here, marked
 * as such, with the bounds its 422s state.
 *
 * # Per-model narrowing is data
 *
 * "Which fields and values a model takes … are in /data/models.json." So
 * `resolution`, `aspect_ratio`, `duration`, `quality`, `voice` and
 * `language_code` are narrowed per model from the generated `REVANA_<ADDRESS>_SHAPES`
 * table rather than written out 127 times.
 *
 * One thing the types deliberately do not follow the server on: it matches
 * `ModelInput`'s `resolution`, `aspect_ratio`, `quality` and `language_code`
 * case-insensitively (`"4k"` is accepted where the catalog lists `"4K"`). The
 * types offer the catalog's spelling only; the runtime checks accept what the
 * API accepts.
 */

import type { FutureModelId } from "../../core/catalog-types";
import type { REVANA_MUSIC_SHAPES } from "./gen/shapes-music.gen";
import type { REVANA_TTS_SHAPES } from "./gen/shapes-tts.gen";
import type { REVANA_IMAGE_SHAPES } from "./gen/shapes-image.gen";
import type { REVANA_VIDEO_SHAPES } from "./gen/shapes-video.gen";
import type { RevanaDurationRange } from "./shape-types";

// ---------------------------------------------------------------------------
// Shared leaves
// ---------------------------------------------------------------------------

/**
 * A media reference. "Media must be public https URLs that download directly"
 * — `http:` and `data:` both answer "input.image_url must be a public https
 * URL." For a local file, `POST /v1/uploads` returns one.
 */
export type RevanaMediaUrl = `https://${string}`;

/**
 * `task` — "What to do with input.video_url, on video models. video_edit
 * changes the clip and keeps its length …; video_extend continues it."
 */
export type GenerationTask = "video_edit" | "video_extend";

type Shapes = typeof REVANA_VIDEO_SHAPES &
  typeof REVANA_IMAGE_SHAPES &
  typeof REVANA_TTS_SHAPES &
  typeof REVANA_MUSIC_SHAPES;

/** Every image, video, speech and music model id in the committed catalog. */
export type RevanaMediaModelId = keyof Shapes;

/** One member of a shape's `as const` list, or `Fallback` when the row has no such list. */
type Listed<S, K extends string, Fallback> = S extends Record<K, readonly (infer V)[]> ? V : Fallback;

/** `duration`'s type: the listed seconds, any number inside a range, or absent. */
type DurationOf<S> = S extends { durations: RevanaDurationRange }
  ? number
  : S extends { durations: readonly (infer D)[] }
    ? D
    : never;

/** `audio`'s type: a toggle where the model offers one, else only the accepted `false`. */
type AudioOf<S> = S extends { audio: true } ? boolean : false;

/**
 * `T` when the model's `media` list has ANY of the fields `F`, else `never`.
 *
 * "Any of" because the API reads a request as one input combination, decided
 * by its highest-ranking media field — a clip, then a first frame, then
 * references. A lower-ranking field beside it rides along: `image_urls` next
 * to an `image_url`, or an `image_url` next to a `video_url` (the character
 * picture of a motion-control model). So a picture field is typed wherever the
 * model has a combination it could ride along with; whether the combination
 * the request ends up in is one the model offers is the runtime check's.
 */
type MediaOf<S, F extends string, T> = S extends { media: readonly (infer M)[] }
  ? [Extract<M, F>] extends [never]
    ? never
    : T
  : never;

// ---------------------------------------------------------------------------
// ModelInput — "the input of every model other than seedance-2.5"
// ---------------------------------------------------------------------------

/** The speech and music fields, absent from a picture or video request. */
interface NoAudioModelFields {
  /** Speech models only. */
  text?: never;
  /** Speech models only. */
  voice?: never;
  /** Speech models only. */
  dialogue?: never;
  /** Speech models only. */
  stability?: never;
  /** Speech models only. */
  similarity_boost?: never;
  /** Speech models only. */
  speed?: never;
  /** Speech models only. */
  language_code?: never;
  /** Music models only. */
  lyrics?: never;
  /** Music models only. */
  style?: never;
  /** Music models only. */
  instrumental?: never;
}

/** The fields a speech or music request never carries. */
interface NoVisualFields {
  /** "… reads text aloud and does not take input.negative_prompt." */
  negative_prompt?: never;
  image_url?: never;
  end_image_url?: never;
  image_urls?: never;
  video_url?: never;
  audio_url?: never;
  resolution?: never;
  aspect_ratio?: never;
  duration?: never;
  audio?: never;
  quality?: never;
  seed?: never;
  /** "input.num_images is for picture models". */
  num_images?: never;
  n?: never;
  /** "task … is for video models". */
  task?: never;
}

/** What a picture and a video request share. */
interface VisualInput<S> {
  /**
   * "What to generate. Required unless the model only transforms media (an
   * upscaler)." 1–30000 characters. A picture model requires it on every
   * request; a video model only when the request has no media to work from.
   */
  prompt?: string;
  /**
   * "What to avoid, on models that take it." At most 5000 characters. All but
   * two models' routes refused it on 2026-11-12 — `revana.*` warns.
   */
  negative_prompt?: string;
  /** "The start frame (image to video) or the picture to edit (image to image)." */
  image_url?: MediaOf<S, "image_url" | "video_url", RevanaMediaUrl>;
  /** "Reference pictures, up to the model's max_input_images." */
  image_urls?: MediaOf<S, "image_url" | "image_urls" | "video_url", RevanaMediaUrl[]>;
  /** "A clip to transform or extend … Its length is measured and may be billed." */
  video_url?: MediaOf<S, "video_url", RevanaMediaUrl>;
  /** "One of the model's resolutions, e.g. 720p, 1080p, 1K, 2K, 4K." */
  resolution?: Listed<S, "resolutions", never>;
  /**
   * "One of the model's aspect ratios, e.g. 16:9, 9:16, 1:1." Free-form on a
   * model that lists none ("must look like 16:9").
   */
  aspect_ratio?: Listed<S, "aspectRatios", string>;
  /** "A quality tier, on models that price by one (e.g. low, medium, high)." */
  quality?: Listed<S, "qualities", string>;
  /** "A seed, on models that take one." 0–4294967295. */
  seed?: number;
}

/** `ModelInput` on a `kind: "video"` model. */
export interface VideoModelInput<S> extends VisualInput<S>, NoAudioModelFields {
  /** "The last frame, on models with first and last frame. Needs image_url." */
  end_image_url?: MediaOf<S, "end_image_url", RevanaMediaUrl>;
  /** "A sound to drive the video (talking avatars, lip sync)." */
  audio_url?: MediaOf<S, "audio_url", RevanaMediaUrl>;
  /**
   * "Video length in seconds: one of the model's durations. Per-second models
   * are billed for it."
   */
  duration?: DurationOf<S>;
  /** "Generate sound, on models that offer it. Changes the price on some models." */
  audio?: AudioOf<S>;
  /** "Also accepted as input.task." Send it once: "task and input.task disagree" is a 422. */
  task?: GenerationTask;
  /** "input.num_images is for picture models; <id> makes videos." */
  num_images?: never;
  n?: never;
}

/** `ModelInput` on a `kind: "image"` model. */
export interface ImageModelInput<S> extends VisualInput<S>, NoAudioModelFields {
  /**
   * "Picture models only: how many pictures to make, up to the model's
   * options.max_images … The price and the hold are per picture." Default 1.
   */
  num_images?: number;
  /** "Also accepted as n." Send one of the two: both is a 422. */
  n?: number;
  /** Video models only. */
  end_image_url?: never;
  /** Video models only. */
  audio_url?: never;
  /** "<id> makes pictures; input.duration does not apply." */
  duration?: never;
  /** "<id> does not make sound; leave input.audio out." `false` is accepted. */
  audio?: false;
  /** "task … is for video models; <id> makes pictures." */
  task?: never;
}

/** One line of a `dialogue`. Strict on the wire: an unknown key is a 422. */
export interface SpeechDialogueLine<Voice extends string = string> {
  text: string;
  /** A voice id of the model; the model's default voice when left out. */
  voice?: Voice;
}

/** A speech field the model takes, or `never` when its `speechFields` list lacks it. */
type SpeechOf<S, F extends string, T> = S extends { speechFields: readonly (infer M)[] }
  ? F extends M
    ? T
    : never
  : never;

/** `language_code`'s type: the listed codes, `never` on an empty list, any string when unlisted. */
type LanguageOf<S> = S extends { languages: readonly [] }
  ? never
  : S extends { languages: readonly (infer L)[] }
    ? L
    : string;

/**
 * `ModelInput` on a speech model.
 *
 * None of these seven fields is in the OpenAPI document. `text` and `voice`
 * are documented on each speech model's page; the rest are named by the API's
 * own refusals, and the bounds are the ones its validator states
 * (`stability`/`similarity_boost` "expected number to be >=0 … <=1", `speed`
 * ">=0.7 … <=1.2").
 */
export interface SpeechModelInput<S> extends NoVisualFields {
  /** The words to read. Required unless `dialogue` is sent. */
  text?: string;
  /**
   * "input.prompt is read as the text only when input.text is left out" —
   * sending both is a 422.
   */
  prompt?: string;
  /** One of the model's `options.voices` ids; its default voice when left out. */
  voice?: Listed<S, "voices", string>;
  /**
   * "lines, each with its own voice" — on the models whose row has
   * `dialogue: true`. "Send input.dialogue … or input.text with input.voice,
   * not both."
   */
  dialogue?: SpeechOf<
    S,
    "dialogue",
    SpeechDialogueLine<Extract<Listed<S, "voices", string>, string>>[]
  >;
  /** 0–1. */
  stability?: SpeechOf<S, "stability", number>;
  /** 0–1. */
  similarity_boost?: SpeechOf<S, "similarity_boost", number>;
  /** 0.7–1.2. */
  speed?: SpeechOf<S, "speed", number>;
  /** One of the model's `options.languages`, where it lists any. */
  language_code?: SpeechOf<S, "language_code", LanguageOf<S>>;
  lyrics?: never;
  style?: never;
  instrumental?: never;
}

/**
 * `ModelInput` on a music model. "A music request needs style or lyrics;
 * prompt (at most 3000 characters there) is the idea."
 */
export interface MusicModelInput extends NoVisualFields {
  /** The idea. At most 3000 characters on a music model. */
  prompt?: string;
  /** "the genre and sound, such as "indie folk, warm vocals"." 1–1000 characters. */
  style?: string;
  /** "the words to sing. Not with instrumental." 1–5000 characters. */
  lyrics?: string;
  /** "true for no vocals. Not with lyrics." Default false. */
  instrumental?: boolean;
  text?: never;
  voice?: never;
  dialogue?: never;
  stability?: never;
  similarity_boost?: never;
  speed?: never;
  language_code?: never;
}

/**
 * `ModelInput`, unnarrowed — the union of every field the API's validator
 * recognises on it. This is the shape of a request to a model id unmodel has
 * no row for.
 */
export interface ModelInput {
  prompt?: string;
  negative_prompt?: string;
  image_url?: RevanaMediaUrl;
  end_image_url?: RevanaMediaUrl;
  image_urls?: RevanaMediaUrl[];
  video_url?: RevanaMediaUrl;
  audio_url?: RevanaMediaUrl;
  resolution?: string;
  aspect_ratio?: string;
  duration?: number;
  audio?: boolean;
  quality?: string;
  seed?: number;
  num_images?: number;
  n?: number;
  lyrics?: string;
  style?: string;
  instrumental?: boolean;
  text?: string;
  voice?: string;
  dialogue?: SpeechDialogueLine[];
  stability?: number;
  similarity_boost?: number;
  speed?: number;
  language_code?: string;
  task?: GenerationTask;
}

// ---------------------------------------------------------------------------
// SeedanceInput — `model: "seedance-2.5"`
// ---------------------------------------------------------------------------

/**
 * Seedance 2.5's own input schema. Unlike `ModelInput` it is matched
 * case-SENSITIVELY (`"1080P"` answers "expected one of "480p"|"720p"|"1080p"")
 * and it has no `seed`, `negative_prompt` or `quality`.
 */
export interface SeedanceInput {
  /** Required. 1–30000 characters. */
  prompt: string;
  /** Default `"720p"`. */
  resolution?: "480p" | "720p" | "1080p";
  /**
   * 4–30 whole seconds, default 5. Not with `video_url`: "the edited clip
   * keeps the length of the source."
   */
  duration?: number;
  /** Default `"16:9"`. */
  aspect_ratio?: "16:9" | "9:16" | "1:1" | "4:3" | "3:4" | "21:9" | "adaptive";
  /** Default false. */
  audio?: boolean;
  /**
   * "exact first frame". "image_url cannot be combined with reference media;
   * use input.image_urls for a looser visual reference."
   */
  image_url?: RevanaMediaUrl;
  /** "last frame (needs image_url)". */
  end_image_url?: RevanaMediaUrl;
  /** "up to 30 reference images". */
  image_urls?: RevanaMediaUrl[];
  /** "a 4-30 s clip to edit; leave out duration, the result keeps the clip's length". */
  video_url?: RevanaMediaUrl;
  /** "up to 10 reference clips, 30 s in all (billed at the video-input rate)". */
  video_urls?: RevanaMediaUrl[];
  /** "up to 10 reference sounds, 30 s in all". */
  audio_urls?: RevanaMediaUrl[];
  /** "Also accepted as input.task." */
  task?: GenerationTask;
  /** Seedance 2.5's schema has no `seed`: "Unrecognized key: "seed"". */
  seed?: never;
  /** "Unrecognized key: "negative_prompt"". */
  negative_prompt?: never;
  /** "Unrecognized key: "quality"". */
  quality?: never;
  /** `ModelInput`'s single sound; Seedance 2.5 takes `audio_urls`. */
  audio_url?: never;
}

// ---------------------------------------------------------------------------
// NemesisInput — `model: "nemesis" | "nemesis-lite"`
// ---------------------------------------------------------------------------

/** `roles` — "one per picture … (default: every picture is a person)". */
export type NemesisRole = "person" | "product" | "location" | "look";

/**
 * "Restages a clip with your people, products and places: the clip's movement,
 * timing and camera, played by the references." The result keeps the clip's
 * length and shape, so there is no `duration` and no `aspect_ratio`.
 */
export interface NemesisInput {
  /** Required. A 4–30 s clip on `nemesis`, 2–15 s on `nemesis-lite`. */
  video_url: RevanaMediaUrl;
  /** Required. 1–8 reference pictures. */
  image_urls: RevanaMediaUrl[];
  /** One per picture: "input.roles has 2 entries; give one for each of the 1 input.image_urls". */
  roles?: NemesisRole[];
  /**
   * "Before the render, the clip's first frame is redrawn with the change
   * already made … and sent as the first reference." Default true on
   * `nemesis`, false on `nemesis-lite`.
   */
  target_frame?: boolean;
  /** "nemesis-lite only; nemesis always edits the clip itself". */
  guide?: "people" | "scene" | "clip";
  /** `"original"` puts the clip's own sound back on the result; the default on `nemesis`. */
  sound?: "none" | "original";
  /** "nemesis-lite only": traces each face so the new one keeps its expressions. */
  face_mesh?: boolean;
  /** Default `"720p"`. */
  resolution?: "480p" | "720p" | "1080p";
  /** Optional. At most 5000 characters. */
  prompt?: string;
  /** "Unrecognized key: "duration"" — the result keeps the clip's length. */
  duration?: never;
  aspect_ratio?: never;
  image_url?: never;
  end_image_url?: never;
  audio_url?: never;
}

// ---------------------------------------------------------------------------
// The request
// ---------------------------------------------------------------------------

type ShapeInput<S> = S extends { kind: "video" }
  ? VideoModelInput<S>
  : S extends { kind: "image" }
    ? ImageModelInput<S>
    : S extends { tasks: readonly ["text_to_speech"] }
      ? SpeechModelInput<S>
      : MusicModelInput;

/**
 * The `input` a model id takes: the `oneOf` in the OpenAPI document, resolved
 * the way the server resolves it — by `model`.
 */
export type InputFor<M extends string> = M extends "seedance-2.5"
  ? SeedanceInput
  : M extends "nemesis" | "nemesis-lite"
    ? NemesisInput
    : M extends RevanaMediaModelId
      ? ShapeInput<Shapes[M]>
      : ModelInput & Record<string, unknown>;

/**
 * `GenerationRequest` — the body of `POST /v1/generations` and of
 * `POST /v1/generations/quote`.
 */
export interface GenerationRequest<M extends string = string> {
  /** "A model id from /data/models.json." */
  model: M;
  input: InputFor<M>;
  /**
   * Video models only, and only with `input.video_url`. "Only the routes that
   * do that task are used; a model without one answers 422 invalid_input
   * naming the models that do. Leave it out to keep each model's own
   * behaviour."
   */
  task?: GenerationTask;
  /**
   * "The most this generation may cost. Routes above it are skipped." Greater
   * than 0; default 100. The document also states a maximum of 100, which the
   * API does not enforce (101 priced normally on 2026-11-12).
   */
  max_cost_usd?: number;
  /**
   * "Routes expected to take longer than this many seconds are skipped, and
   * once it has passed no new route is tried." A whole number, 1–86400.
   */
  max_wait_s?: number;
}

/** A request for a model id the committed catalog has no row for. */
export type UnknownModelRequest<M extends string> = GenerationRequest<
  FutureModelId<M, RevanaMediaModelId>
>;

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

/** A failed generation's `error.code`. The first six are not retryable. */
export type GenerationErrorCode =
  | "content_policy"
  | "invalid_input"
  | "model_declined"
  | "reference_changed"
  | "max_cost_exceeded"
  // In the OpenAPI enum and absent from the docs' table.
  | "review_required"
  | "model_busy"
  | "model_unavailable"
  | "timeout"
  | "all_routes_failed"
  | "processing_failed";

export interface GenerationError {
  code: GenerationErrorCode | (string & {});
  message: string;
  /** "true means the same request can work later; false means the request has to change." */
  retryable?: boolean;
  /** On `content_policy`: `sexual | minors | copyright | real_person | other`. */
  reason?: string;
}

/** `output` once `status` is `succeeded`; `null` before. */
export interface GenerationOutput {
  /** One per file. Each is `GET /v1/generations/{id}/content[/n]` and redirects. */
  urls: string[];
  /** Pictures and videos. */
  width?: number;
  height?: number;
  /** Videos and sounds: the first file's length in seconds. */
  duration_s?: number;
  /** Videos. */
  has_audio?: boolean;
  /** "Audio only: the length of each file in urls, in order." */
  durations_s?: (number | null)[];
}

/**
 * How far along a generation is. Present on every `Generation` the API
 * returns and absent from the OpenAPI document; recorded from a live create
 * and poll on 2026-11-12 (`test/fixtures/revana/`).
 */
export interface GenerationProgress {
  stage: string;
  typical_seconds: number | null;
  slower_than_usual: boolean;
  estimated_seconds_left: number | null;
  estimated_finish_at: string | null;
}

/** What a create (`202`), a poll and each row of a list answer. */
export interface Generation {
  /** `gen_` + 20 hex digits. */
  id: string;
  object: "generation";
  model: string;
  status: "queued" | "running" | "succeeded" | "failed";
  /** "A generation still being confirmed shows running with a message." */
  message?: string;
  output: GenerationOutput | null;
  /** "the first route's price". */
  quoted_usd: number;
  /** "held while it runs: the most it can cost, if a dearer backup route makes it". */
  reserved_usd?: number | null;
  /** "the charge once succeeded, 0 once failed"; `null` while it runs. */
  cost_usd: number | null;
  attempts: number;
  progress?: GenerationProgress;
  error: GenerationError | null;
  created_at: string;
  completed_at: string | null;
}

/** What `POST /v1/generations/quote` answers. "Nothing is created, held or charged." */
export interface Quote {
  object: "quote";
  model: string;
  currency: "usd";
  /** "the usual price" — the first route's. */
  quoted_usd: number;
  /** "the most it can cost". */
  reserved_usd: number | null;
  estimated_seconds: number | null;
  /** With a customer key. */
  available_usd?: number;
  enough_credit?: boolean;
}

/**
 * The error body of every non-2xx on the generation routes. Every response
 * also carries `X-Request-Id`.
 */
export interface RevanaErrorBody {
  error: {
    /** e.g. `invalid_input`, `max_cost_exceeded`, `model_not_available`, `insufficient_credits`. */
    code: string;
    message: string;
    /** `req_` + 20 hex digits. */
    request_id: string;
  };
}
