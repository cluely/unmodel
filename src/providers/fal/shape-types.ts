/**
 * The contract `scripts/codegen-fal.ts` targets: a compact description of what
 * ONE fal endpoint accepts, which the ONE hand-written check battery reads at
 * run time to narrow from a category to an endpoint.
 *
 * ## Why an IR exists at all
 *
 * unmodel curates 172 fal endpoints across ten verbs, and the obvious layouts
 * both fail:
 *
 * - **One zod schema per endpoint.** zod objects are built eagerly, so
 *   importing `unmodel/fal` would construct hundreds of them to use one.
 * - **One schema per category with every endpoint's bounds folded in.** There
 *   is no such thing: `num_inference_steps` tops out at 50 on `flux/dev` and at
 *   12 on `flux/schnell`, and a schema that accepts the union accepts a request
 *   `flux/schnell` refuses.
 *
 * So the split is: ONE `z.looseObject` per category answers "is this the right
 * shape?", and these rows answer "does this endpoint accept these values?".
 * The rows are plain data — no zod, no closures, no messages — which is what
 * lets 172 of them cost a few kilobytes and lets every message be
 * composed in one place, citing `FAL_DOC_URLS[id]`.
 *
 * ## Why the keys are the allow-list
 *
 * There is no per-endpoint deny table. `props` names everything an endpoint
 * takes, so everything else is unknown by definition; the alternative is an
 * O(endpoints × parameters) table that says the same thing at hundreds of
 * kilobytes. `checkKnownParams` reads these keys and composes the message.
 *
 * Hand-written, and the generator is checked against it: `<v>-narrow.gen.ts`
 * declares `satisfies Record<string, FalEndpointShape>`, so a field renamed
 * here fails `tsc` in the generated file instead of drifting into two
 * vocabularies.
 */

/** The media kind a string parameter carries, from fal's own `ui.field` hint. */
export type FalMediaKind = "image" | "video" | "audio" | "file" | (string & {});

/**
 * The coarse type tag. `"integer"` is kept distinct from `"number"` because
 * fal genuinely distinguishes them and "must be a whole number" is a message
 * worth being able to write; `"union"` means the parameter accepts more than
 * one shape (fal's `image_size` is the canonical case); `"unknown"` means fal
 * itself declared no type, never that the generator gave up — anything it
 * cannot model is a hard error at codegen time.
 */
export type FalPropType =
  | "string"
  | "number"
  | "integer"
  | "boolean"
  | "array"
  | "object"
  | "union"
  | "unknown";

/** One dimension of an `image_size` object, with the bounds fal publishes. */
export interface FalDimensionSpec {
  min?: number;
  /** `exclusiveMinimum`, as a NUMBER — 2020-12 semantics, which is what fal emits. */
  xmin?: number;
  max?: number;
  default?: number;
}

/**
 * The `image_size` union, flattened for `checkImageSize`.
 *
 * fal spells it `anyOf: [$ref ImageSize, string enum]` — either a named preset
 * (`"landscape_4_3"`) or an explicit `{ width, height }`. Both arms are here so
 * one check can answer both "is that a preset this endpoint knows?" and "is
 * 20000 px inside its ceiling?" without re-reading the schema.
 */
export interface FalSizeSpec {
  presets: readonly string[];
  width: FalDimensionSpec;
  height: FalDimensionSpec;
}

/**
 * One parameter, as one endpoint declares it.
 *
 * Field names are terse (`req`, `nul`, `xmin`) because these rows are the bulk
 * of what `unmodel/fal` ships: at 172 endpoints × ~10 parameters the
 * difference between `required` and `req` is measured in kilobytes of shipped
 * source. Every one of them is documented here, once.
 */
export interface FalPropSpec {
  /** The parameter's type. */
  t: FalPropType;
  /** In the endpoint's OpenAPI `required` list. */
  req?: true;
  /** `anyOf[T, null]` — an explicit `null` is accepted, and means "unset". */
  nul?: true;
  /** fal supplies a default, so omitting it is always safe. */
  def?: true;
  /** The vocabulary, when the parameter has one (`enum` or `const`). */
  enum?: readonly (string | number)[];
  /**
   * The vocabulary above is a SUGGESTION rather than a closed set.
   *
   * fal writes this as `anyOf: [{ type: "string", enum: [...] }, { type:
   * "string" }]` — "these values, or any other string". `flux-pro/v1.1-ultra`
   * lists nine aspect ratios and still accepts `"1234:567"`.
   *
   * The distinction is the difference between an error and a warning:
   * `checkEnums` refuses an unlisted value on a closed enum and merely reports
   * one here, because refusing it would reject a request fal accepts.
   */
  open?: true;
  /** `minimum` / `maximum` — inclusive. */
  min?: number;
  max?: number;
  /** `exclusiveMinimum` / `exclusiveMaximum`, as NUMBERS (2020-12 semantics). */
  xmin?: number;
  xmax?: number;
  /** `minLength` / `maxLength` on a string. */
  minLen?: number;
  maxLen?: number;
  /** `minItems` / `maxItems` on an array. */
  minItems?: number;
  maxItems?: number;
  /** The element spec, for arrays. */
  items?: FalPropSpec;
  /** fal's own hint that this string carries a media reference. */
  media?: FalMediaKind;
  /** The `image_size` union's presets and dimension bounds. */
  size?: FalSizeSpec;
}

/** One endpoint's whole input surface. */
export interface FalEndpointShape {
  /**
   * fal's own field order (`x-fal-order-properties`), asserted at codegen time
   * to be exactly the property key set. Bodies are emitted in this order so a
   * generated request reads like the endpoint's own documentation.
   */
  order: readonly string[];
  /** Every parameter the endpoint accepts. The keys ARE the allow-list. */
  props: Readonly<Record<string, FalPropSpec>>;
}

/**
 * How an endpoint lets a caller state output geometry and duration.
 *
 * The unified adapters branch on these and NEVER on the endpoint id: one
 * branch per class is a readable adapter that a new endpoint joins for free,
 * while one branch per endpoint is a hundred-arm switch and a declaration file
 * to match. An endpoint whose geometry parameters fit none of these fails
 * codegen rather than falling through to a default.
 */
export type FalShapeClass =
  /** `image_size`: `anyOf[{ width, height }, preset enum]` — flux and friends. */
  | "imageSizeUnion"
  /** `image_size` as a bare preset enum, with no explicit-dimensions arm. */
  | "imageSizePresets"
  /** Separate `width` and `height` numbers. */
  | "dimensionPair"
  /** `aspect_ratio`, usually a closed enum of `"16:9"`-style strings. */
  | "aspectRatioEnum"
  /** `resolution`, a closed enum (`"720p"`, `"1K"`, `"4k"`). */
  | "resolutionEnum"
  /** `upscale_factor` / `scale` — a multiplier rather than a target size. */
  | "scaleFactor"
  /** `duration` as a STRING enum (`"5"` at kling, `"8s"` at veo). */
  | "durationStringEnum"
  /** `duration` as a number. */
  | "durationNumber"
  /** No geometry or duration parameter at all — the endpoint decides. */
  | "fixedGeometry";

/**
 * What one endpoint offers the unified layer.
 *
 * This is both halves of the narrowing: `classes` is what the adapter branches
 * on, and the rest IS the row `modelParams` publishes — the same object, not a
 * copy of it. A row here that disagreed with the table a picker renders would
 * be exactly the drift `unmodel/fal/values` exists to make impossible, so
 * there is only ever one.
 */
export interface FalParamShape {
  /** Every geometry/duration class this endpoint exhibits, sorted. */
  classes: readonly FalShapeClass[];
  /** fal's own parameter list, in fal's own order. */
  keys: readonly string[];
  /**
   * The literal `size` values this endpoint takes — fal's own preset names
   * (`"landscape_4_3"`), which are what the wire accepts rather than a
   * translation of it. No free-form tail: explicit pixels reach the same
   * endpoint through `dimensions`, so for THIS spelling the list is the limit.
   */
  sizes?: readonly string[];
  /** The canonical `W:H` ratios this endpoint's `aspect_ratio` enum lists. */
  ratios?: readonly string[];
  /**
   * The ratio list is a set of presets rather than a limit — fal declared the
   * enum open (`anyOf[{enum}, {string}]`), so any `W:H` is accepted.
   */
  ratioFreeform?: true;
  /** The canonical tiers this endpoint's `resolution` enum can express. */
  tiers?: readonly string[];
  /**
   * Canonical tier → the spelling this endpoint's own `resolution` enum uses.
   *
   * fal writes `"1K"` and the canonical vocabulary writes `"1k"`, so an
   * adapter that has resolved a caller's tier still needs the way back to the
   * wire. Generated rather than lower-cased at run time because the two
   * vocabularies agree by coincidence rather than by rule — `"0.5K"` has no
   * canonical tier at all, and a future endpoint may spell one differently
   * again.
   */
  tierWire?: Readonly<Record<string, string>>;
  /**
   * The per-dimension bounds on an explicit `image_size: { width, height }`,
   * so a ratio can be solved into pixels this endpoint accepts.
   */
  pixels?: { min?: number; max?: number };
  /**
   * Numeric bounds on the CANONICAL params, keyed by wire name.
   *
   * So an adapter can respect a floor rather than send a value the endpoint
   * refuses. `fal-ai/flux/dev/image-to-image` floors `strength` at 0.01 while
   * the canonical scale starts at 0, and canonical 0 — "keep the source" — is
   * the commonest thing anyone asks an image-to-image route for.
   */
  bounds?: Readonly<Record<string, { min?: number; max?: number }>>;
  /**
   * `fal.video` only: the clip lengths this endpoint offers, in SECONDS.
   *
   * Absent means the endpoint's lengths are a range rather than a list —
   * `fal-ai/pixverse/v6/text-to-video` takes any integer 1..15 — and `duration`
   * then keeps the wide `number`, with the range enforced through
   * {@link bounds}. Present, the list is exhaustive and closed.
   *
   * The seconds are canonical, never the wire spelling: kling writes `"5"`,
   * veo3.1 writes `"8s"` and wan writes the integer `5`, and all three mean a
   * number of seconds. {@link durationWire} is the way back.
   */
  durations?: readonly number[];
  /** Canonical seconds → the literal this endpoint's `duration` actually takes. */
  durationWire?: Readonly<Record<string, string | number>>;
  /**
   * `fal.video` only: the canonical `VideoResolution` tiers this endpoint can
   * express, after mapping its own spelling.
   *
   * An EMPTY list is a fact rather than a gap, and it is emitted deliberately:
   * `minimax/h3` offers `"768P"` and `"2K"`, neither of which is a canonical
   * tier, so it has a resolution field and no canonical tier to put in it. The
   * adapter's refusal reads differently from the one it gives an endpoint with
   * no resolution field at all, which is why the two cases are distinguishable
   * here.
   */
  resolutions?: readonly string[];
  /** Canonical tier → the spelling this endpoint's own `resolution` enum uses. */
  resolutionWire?: Readonly<Record<string, string>>;
  /**
   * `fal.video` only: the `VideoImageRole` arms this endpoint serves.
   *
   * This is what lets thirty-five endpoints share ONE address. text-to-video,
   * image-to-video, first-and-last-frame and reference-to-video are four fal
   * ids and one route shape, so `fal.video`'s adapter reads the roles rather
   * than switching on the id — and an empty list types `image` as `never` at
   * the call site for the text-only routes.
   */
  roles?: readonly string[];
  /**
   * Role → the wire parameter that carries it. fal spells the opening frame
   * `image_url`, `start_image_url` and `first_frame_url` at three different
   * vendors; the role is what they have in common.
   */
  roleWire?: Readonly<Record<string, string>>;
  /** `fal.video` only: the wire parameter a source CLIP goes in, where there is one. */
  videoWire?: string;
  /**
   * `fal.lipsync` / `fal.avatar`: the shapes the performance may arrive in —
   * `["video"]` for a clip, `["image"]` for a still, `[]` for the two avatar
   * routes whose performer is a catalogued id and who take neither.
   *
   * The categories split on exactly this word, so it is stated per model rather
   * than assumed per category: `fal-ai/sync-lipsync/v3` and
   * `fal-ai/sync-lipsync/v3/image-to-video` are one product on two routes, and
   * the only thing that tells them apart is which shape they accept.
   */
  sources?: readonly string[];
  /** The wire parameter the source goes in — `video_url` or `image_url`. */
  sourceWire?: string;
  /** The wire parameter the audio goes in. `audio_url` everywhere so far, stated all the same. */
  audioWire?: string;
  /**
   * `fal.upscale`: the wire parameter the multiplier goes in — `upscale_factor`
   * at eight endpoints, `scale` at ESRGAN.
   */
  factorWire?: string;
  /**
   * `fal.upscale`: the multipliers this endpoint offers, as a CLOSED set.
   *
   * Three states, all load-bearing. Absent means the multiplier is a range and
   * `factor` keeps the wide `number` ({@link bounds} carries the ends). A list
   * means a closed enum — `fal-ai/aura-sr` publishes a `const 4`, so `factor: 2`
   * is a compile error naming 4. An EMPTY list means the endpoint has no
   * multiplier at all (`fal-ai/recraft/upscale/crisp`), which types `factor` as
   * `never` rather than letting a caller ask for something the route cannot do.
   */
  factors?: readonly number[];
  /**
   * `fal.threeD`: the input moods this endpoint reads.
   *
   * `["text"]` requires `prompt` and types `image` as `never`; `["image"]` does
   * the reverse; `["image", "text"]` leaves both optional, which is the honest
   * shape for `fal-ai/hyper3d/rodin/v2.5` — it publishes both fields, requires
   * neither, and uses a prompt to steer an image-driven generation. The only
   * row field in this provider that decides two canonical words at once, and it
   * moves them in opposite directions.
   *
   * There is no empty arm: an endpoint that declares neither a prompt nor an
   * image fails codegen rather than shipping a row nobody can call.
   */
  inputs?: readonly string[];
  /**
   * `fal.threeD`: the wire parameter the reference image goes in.
   *
   * Four spellings across seven vendors — `image_url` at Tripo and Trellis,
   * `input_image_url` at Hunyuan3D, `image_urls` at Rodin, `front_image_url` at
   * Tripo's multiview route, where the canonical `image` is that route's FRONT
   * view and the other three angles ride as extras.
   */
  imageWire?: string;
  /**
   * `fal.threeD`: {@link imageWire} takes an ARRAY of URLs rather than one.
   *
   * `fal-ai/hyper3d/rodin/v2.5` accepts up to five views in `image_urls`; the
   * canonical single `image` becomes a one-element list there. A flag rather
   * than a second wire field because the adapter's only decision is whether to
   * wrap.
   */
  imageWireList?: true;
  /**
   * `fal.threeD`: the wire parameter the GEOMETRY seed goes in.
   *
   * `seed` at most endpoints and `model_seed` at Tripo's four, which publish
   * three seeds apiece (`model_seed`, `image_seed`, `texture_seed`) pinning
   * three different stages. The canonical `seed` maps to the one that decides
   * whether you got the same object; the other two are extras.
   */
  seedWire?: string;
  /**
   * `fal.tts` / `fal.music` / `fal.sfx`: the wire parameter the words go in.
   *
   * Curated rather than derived, because the endpoints genuinely disagree:
   * speech is `text` at ElevenLabs and `prompt` at Kokoro, music is
   * `prompt` at Lyria, `tags` at ACE-Step and `lyrics` at DiffRhythm — where
   * the lyrics ARE the request and `style_prompt` is the decoration — and a
   * sound effect is `text` at ElevenLabs and `text_prompt` at Mirelo.
   */
  textWire?: string;
  /**
   * `fal.tts`: the wire parameter the voice goes in, where the endpoint has a
   * FLAT one. Absent at MiniMax, whose voice is `voice_setting.voice_id` — one
   * level down, and unmodel does not flatten objects into canonical words.
   */
  voiceWire?: string;
  /**
   * `fal.tts`: the voices this endpoint publishes, where it publishes a closed
   * list. Open by the time it reaches a caller (`VoiceOf` keeps the
   * `(string & {})` tail), because every provider here supports cloned voices
   * and a closed union would refuse a working request.
   */
  voices?: readonly string[];
  /** `fal.tts`: the wire parameter the speed multiplier goes in. */
  speedWire?: string;
  /**
   * `fal.tts` / `fal.stt`: the wire parameter the language goes in — four
   * spellings across the speech roster (`language`, `language_code`,
   * `language_boost`, `custom_audio_language`).
   */
  languageWire?: string;
  /** That field takes any string — ElevenLabs' free-form BCP-47 code, nothing to map. */
  languageOpen?: true;
  /** The languages this endpoint offers, as canonical BCP-47 primary subtags. */
  languages?: readonly string[];
  /**
   * Canonical primary subtag → this endpoint's own spelling of it.
   *
   * The way back, and it is not cosmetic: Gemini spells English `"English
   * (US)"` and MiniMax spells it `"English"`, so an adapter that had resolved a
   * caller's `"en"` would still have nothing to send without this.
   */
  languageValues?: Readonly<Record<string, string>>;
  /**
   * `fal.tts` / `fal.music` / `fal.sfx`: the wire parameter the output codec
   * goes in — `output_format` almost everywhere, `audio_format` at Sonilo and
   * `upload_audio_format` at Mirelo.
   */
  formatWire?: string;
  /**
   * The canonical codecs this endpoint can emit.
   *
   * An EMPTY list means there is no flat codec field, and three endpoints reach
   * it three different ways: `xai/tts/v1` spells its format as an OBJECT,
   * `fal-ai/minimax/speech-02-hd` spells `output_format` as `url | hex` — a
   * DELIVERY switch wearing a codec's name — and Kokoro has no format field at
   * all. All three type `outputFormat` as `never`; the adapter's message says
   * which of the three it is.
   */
  codecs?: readonly string[];
  /** Canonical codec → this endpoint's own spelling (`mp3` → `"mp3_44100_128"`). */
  codecValues?: Readonly<Record<string, string>>;
  /**
   * `fal.stt`: the timing granularities this route can be ASKED for.
   *
   * Empty at five of the six, and honestly so: ElevenLabs Scribe always returns
   * word timings and offers no switch to turn them off. An empty list types
   * `timestamps` as `never` — "this route does not take the question" — where a
   * list containing `"none"` would say "you may ask for plain text", which is
   * true nowhere here.
   */
  timestamps?: readonly string[];
  /** Canonical granularity → this endpoint's own spelling (wizper's `chunk_level`). */
  timestampValues?: Readonly<Record<string, string>>;
  /** `fal.stt`: the wire parameter the diarization switch goes in. */
  diarizeWire?: string;
  /**
   * `fal.music` / `fal.sfx`: the wire parameter the length goes in — four
   * spellings across the ten music endpoints (`duration`, `seconds_total`,
   * `music_duration`, `music_length_ms`) and two across the six sound-effect
   * ones (`duration_seconds` at ElevenLabs, `duration` at the rest).
   */
  lengthWire?: string;
  /**
   * `"ms"` where that parameter counts MILLISECONDS. ElevenLabs Music is the
   * one, and it is the reason the canonical word is `durationSeconds`: a bare
   * number means milliseconds there and seconds everywhere else.
   */
  lengthUnit?: "ms";
  /**
   * `fal.sfx`: `[min, max]` seconds, inclusive — the length's own bounds.
   *
   * The narrowing spelling of what {@link bounds} carries under the wire name,
   * and the reason for the second copy is that this is the half the unified
   * layer reads: `SfxModelParams` is one row type across fal and ElevenLabs,
   * and the native leaf has no `bounds` map to look in. Both are generated
   * from the same property, so there is nothing here to drift.
   *
   * It stays a RANGE and never becomes a union: the six endpoints span
   * 0.5–22, 1–180, 1–30, 0.1–60 and 1–120, which is the "a range genuinely
   * cannot be a union" case {@link durations} makes one category over.
   */
  durationRange?: readonly [number, number];
  /**
   * `fal.sfx`: that parameter is an INTEGER, so a fractional second is a 422.
   *
   * True at Sonilo and CassetteAI and false at the other four, which is why it
   * is a row field rather than a category rule: `durationSeconds: 2.5` is a
   * working request at ElevenLabs, Mirelo and Stable Audio and a refusal at the
   * other two.
   */
  durationInt?: true;
  /**
   * `fal.sfx`: the length this endpoint uses when the caller states none.
   *
   * The field that makes "absence means the PROVIDER's default" sayable instead
   * of the `"auto"` it looks like: Sonilo silently generates 8 seconds, Mirelo
   * 10, Stable Audio 30. Absent here means the endpoint documents no number —
   * ElevenLabs guesses a length from the prompt, which is a different fact and
   * carries no warning because nothing was invented on the caller's behalf.
   */
  durationDefault?: number;
  /**
   * `fal.sfx`: the length is in this endpoint's `required` list.
   *
   * `cassetteai/sound-effects-generator` is the one, and it is the reason this
   * category's `durationSeconds` has a required arm at all: a request without
   * one is a 422 there and a working request at the other five.
   */
  durationRequired?: true;
  /**
   * `fal.sfx`: the wire parameter a SEPARATE bitrate goes in.
   *
   * Stable Audio publishes `bitrate` beside its codec enum, as a kbps-suffixed
   * string (`"192k"`) rather than a number of bits. Every other endpoint in the
   * roster either folds the bitrate into a composite enum member
   * (`mp3_44100_128`) or has no bitrate field at all — and where there is none,
   * `outputFormat.bitrate` is refused by name rather than dropped.
   */
  bitrateWire?: string;
  /** `fal.music`: the lengths this endpoint offers as a closed set, in SECONDS. */
  lengths?: readonly number[];
  /** Canonical seconds → the literal the length parameter takes (`95` → `"95s"`). */
  lengthValues?: Readonly<Record<string, string | number>>;
  /** `fal.music`: the wire parameter the instrumental switch goes in. */
  instrumentalWire?: string;
  /**
   * Everything this endpoint takes that the canonical vocabulary has no word
   * for, as `{ wireName: EXTRA as T }` — keys for `applyExtras` to read at run
   * time, types for an editor to offer. See `core/unified/vocabulary/model-params.ts`.
   */
  extras?: Readonly<Record<string, unknown>>;
}

/**
 * Compile-time assignability gate for the generated `<verb>-check.gen.ts`
 * files (the idea is ArkType's `type.declare<T>()` — make renderer drift a
 * `tsc` error instead of a shipped bug; see docs/research/arktype-evaluation.md).
 *
 * `<verb>-wire.gen.ts` and `<verb>-schema.gen.ts` are rendered from the same
 * IR by two different emitters, so a bug in either one — or in the schema
 * file's field-merge rules — makes the loose gate reject a body the wire type
 * promises is legal. `AssertExtends<Wire[K], Gate[K]>` is that invariant, per
 * field: the check file instantiates one per primitive-shaped field, and the
 * constraint fails compilation when the two renderers disagree. Object-shaped
 * fields are skipped there, not here: an `interface` has no implicit index
 * signature, so it can never extend a `looseObject`'s input type, and the
 * per-endpoint truth for those lives in the SHAPES rows anyway.
 */
export type AssertExtends<Sub extends Super, Super> = Sub;
