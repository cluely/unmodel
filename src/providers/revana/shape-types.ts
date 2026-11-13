/**
 * The types of the tables `scripts/codegen-revana.ts` emits — and the place
 * where each key's meaning ON THE WIRE is written down.
 *
 * Type-only. The generated `gen/shapes-<address>.gen.ts` and `gen/prices-<address>.gen.ts` all
 * `satisfies` these, so a generator bug fails `tsc` instead of shipping.
 *
 * Every "an absent key means …" sentence below quotes what
 * `POST /v1/generations/quote` answered on 2026-11-12 when the field was sent
 * to a model whose catalog row lacks the option (docs/research/revana.md).
 */

/** `tasks`, in Revana's spelling. */
export type RevanaTask =
  | "text_to_video"
  | "image_to_video"
  | "first_last_frame"
  | "reference_to_video"
  | "video_to_video"
  | "text_to_image"
  | "image_to_image"
  | "upscale"
  | "text_to_speech"
  | "text_to_music";

/** The five media fields of `ModelInput`. */
export type RevanaMediaField =
  | "image_url"
  | "end_image_url"
  | "image_urls"
  | "video_url"
  | "audio_url";

/** The speech-only fields, which the OpenAPI document does not declare. */
export type RevanaSpeechField =
  | "text"
  | "voice"
  | "dialogue"
  | "stability"
  | "similarity_boost"
  | "speed"
  | "language_code";

/** `options.durations` when it is a range rather than a list. */
export interface RevanaDurationRange {
  readonly min: number;
  readonly max: number;
}

export interface RevanaModelShape {
  /** Catalog `kind`. Speech and music are both `"audio"`; `tasks` tells them apart. */
  readonly kind: "video" | "image" | "audio";
  readonly tasks: readonly RevanaTask[];
  /**
   * The media fields the model takes, derived from `tasks` and
   * `capabilities.audio_input`. Anything else answers "… cannot take this
   * combination of inputs" or "… does not take input.audio_url."
   */
  readonly media: readonly RevanaMediaField[];
  /** Absent: "<id> takes no input.resolution." Matched case-insensitively by the API. */
  readonly resolutions?: readonly string[];
  /**
   * Absent: the field is free-form — "input.aspect_ratio must look like 16:9"
   * is the only model-level rule, and whether a given shape is served is then
   * decided per route.
   */
  readonly aspectRatios?: readonly string[];
  /**
   * A list or an inclusive range, in whole seconds. Absent on a video model:
   * "<id> sets its own length; leave input.duration out."
   */
  readonly durations?: readonly number[] | RevanaDurationRange;
  /**
   * `true`: the model offers the `audio` toggle. Anything else: "<id> does not
   * make sound; leave input.audio out." (`audio: false` is accepted regardless.)
   */
  readonly audio?: boolean;
  /** The cap on `image_urls`: "<id> takes at most N pictures in input.image_urls." */
  readonly maxInputImages?: number;
  /** The cap on `num_images`: "input.num_images must be 1 to N for <id>." */
  readonly maxImages?: number;
  /** Present: `quality` is an enum. Absent: `quality` is accepted and has no listed values. */
  readonly qualities?: readonly string[];
  readonly defaultQuality?: string;
  /** Speech: the voice ids. Any other `voice` answers "… is not a voice of <id>." */
  readonly voices?: readonly string[];
  readonly defaultVoice?: string;
  /** Speech: the cap on `text`, in characters. */
  readonly maxCharacters?: number;
  /** Speech: `true` when the model takes `dialogue` (several voices in one take). */
  readonly dialogue?: boolean;
  /**
   * Speech, three states: a list is the `language_code` enum; `[]` means the
   * model "picks the language from the text; leave input.language_code out";
   * absent means any code is accepted.
   */
  readonly languages?: readonly string[];
  /** Speech: the fields the API itself says the model takes (`data/revana/overlays.json`). */
  readonly speechFields?: readonly RevanaSpeechField[];
  /** Music: the model offers `instrumental`. */
  readonly instrumental?: boolean;
  /** Music: how many files one job returns. */
  readonly outputsPerJob?: number;
  /** Nemesis: the `guide` enum. */
  readonly guides?: readonly string[];
  /** Nemesis: the `sound` enum. */
  readonly sounds?: readonly string[];
  /** Nemesis: the `roles` item enum. */
  readonly roles?: readonly string[];
  /**
   * `true` on the models whose routes take `negative_prompt`. Everywhere else
   * the API answered "No route for <id> can take this input (cannot take
   * negative_prompt)" — a fact about today's routes, so it is reported as a
   * warning and never as an error (`data/revana/overlays.json`).
   */
  readonly negativePrompt?: true;
}

/** A rate that is one number, or one number per setting key. */
export type RevanaRate = number | Readonly<Record<string, number>>;

/**
 * One model's listed price, as `GET /v1/models` publishes it.
 *
 * Setting keys are Revana's own and compose with `+` and `-`:
 * `"720p"`, `"720p+audio"`, `"1080p+video_input"`, `"1:1-high"`, `"balanced"`.
 */
export interface RevanaListedPrice {
  readonly unit: "per_image" | "per_second" | "per_1k_chars" | "per_job";
  readonly usd: RevanaRate;
  /** A flat fee added once per job, keyed like `usd`. */
  readonly feeUsd?: RevanaRate;
  /** Nemesis: "billed per second of clip in plus video out". */
  readonly billed?: "input_and_output_seconds";
}
