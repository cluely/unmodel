/**
 * Per-**model** typing, for every category that needs it.
 *
 * ## The problem this solves
 *
 * `stt` narrows one field per *adapter* (`audioInputs`), and that is
 * enough there because a provider's routes agree about how audio arrives. The
 * image and video categories do not have that luxury: `gpt-image-2` takes a
 * free-form `size` up to 3840 px and a `background` that is `"opaque" | "auto"`,
 * while `gpt-image-1` — same provider, same endpoint — takes a three-value
 * `size` enum and a `background` that also accepts `"transparent"`. One
 * adapter, two different request surfaces, and the difference is the model id.
 * Video is the same story twice over: `sora-2` renders 720p and `sora-2-pro`
 * adds 1080p, `kling-v2-5-turbo` runs 5 or 10 seconds and `kling-v3` runs any
 * integer from 3 to 15.
 *
 * So the unit of declaration here is the **model**, not the adapter: each
 * adapter carries a `modelParams` table keyed by bare model id, and
 * {@link ModelParamsFor} resolves `model: "openai/gpt-image-2"` to that row.
 *
 * ## One mechanism, per-category rows
 *
 * The half that is category-agnostic — a row's {@link EXTRA} witnesses, the
 * ref → row lookup, the extras derivations — is declared once, over
 * {@link ModelParamsBase}. Each category then extends that base with the fields
 * its own vocabulary narrows ({@link ModelParams} for the two image surfaces,
 * {@link VideoModelParams}, {@link TtsModelParams},
 * {@link SttModelParams}, {@link MusicModelParams}) and gets its own
 * derivations. Adding a seventh category means adding a row interface and its
 * derivations, not a second copy of the lookup.
 *
 * ## One table, three consumers
 *
 * The table is a *value* (`as const`), and everything else is read off it with
 * `typeof`. That is the repo's established pattern for anything that has to be
 * true at both compile time and run time, and here it has three readers:
 *
 * | reader | what it takes |
 * |---|---|
 * | the caller's types | `sizes` → the `size` union, `ratios` → `aspectRatio`, `tiers` / `resolutions` → `resolution`, `durations` → `duration`, `codecs` → `outputFormat`, `languages` → `language`, `timestamps` → `timestamps`, `extras` → the per-model extra params |
 * | the adapter's `compile` | `extras`' **keys**, to identity-copy them onto the wire and to refuse one the model does not take |
 * | the preset sweep | every list, to prove each value an editor suggests is one the provider's own validator accepts |
 *
 * A second declaration could not be kept in step with the first, and the
 * autocomplete promise is only worth anything if the suggestions are provably
 * valid — which is what the third reader checks.
 *
 * ## Why `extras` is an object of type witnesses
 *
 * An extra needs two things: a name at run time, and an exact type at compile
 * time. A `readonly string[]` gives the first and not the second; a `type`
 * alias gives the second and not the first. So `extras` is an object whose
 * **keys** are the wire param names and whose **values** are
 * {@link EXTRA} — a `never` that is `undefined` at run time — cast to the type
 * that param takes:
 *
 * ```ts
 * const GPT_IMAGE_2_EXTRAS = {
 *   background: EXTRA as "opaque" | "auto" | null,
 *   quality: EXTRA as GptImageQuality,
 * } as const;
 * ```
 *
 * `Object.keys` sees two names; `typeof` sees two exact types; and the cast can
 * name a type the provider's own wire module already exports, so the unified
 * surface and the hand-written one cannot disagree about what `quality` is.
 * What it costs at run time is one object literal of `undefined`s per model —
 * which minifies to about as little as a name list would.
 */
import type {
  AdapterFor,
  RefModel,
} from "../types";
import type { AudioFormat, AudioFormatCodec, AudioFormatRequest } from "./audio";
import type { AspectRatio, Dimensions, ResolutionTier, VideoResolution } from "./common";
// Type-only, and the same erased-at-emit cycle `./stt` and `./tts` below
// document: the media shapes belong to their own category's vocabulary, and
// filing them under "shared" purely to dodge an edge the checker handles would
// misplace them.
import type { AvatarImageInput, AvatarSourceKind } from "./avatar";
import type { LipsyncSourceFor, LipsyncSourceKind } from "./lipsync";
import type { UpscaleSourceFor, UpscaleSourceKind } from "./upscale";
import type { ThreeDImageInput, ThreeDInputKind } from "./3d";
// Type-only, and therefore fine that `./stt` imports this file back: an
// `import type` is erased before emit, so the cycle exists only in the checker,
// which resolves it. The alternative — moving the granularity union into
// `./common` — would file a transcription word under "shared vocabulary" purely
// to dodge an edge the language handles.
import type { TimestampGranularity } from "./stt";
// Same type-only cycle as `./stt` above, and for the same reason: the
// word belongs to the speech vocabulary, and filing it under "shared" purely to
// dodge an edge the checker handles would misplace it.
import type { Voice } from "./tts";

/**
 * What every category's row carries: the params the canonical vocabulary has no
 * word for.
 *
 * The shared half of a row, and the reason the ref → row lookup and the extras
 * derivations below are written once rather than once per category.
 */
export interface ModelParamsBase {
  /**
   * The non-canonical params this model takes, as `{ wireName: EXTRA as T }`.
   * See the module header for why the values are witnesses.
   */
  readonly extras?: Readonly<Record<string, unknown>>;
}

/**
 * The loosest per-model table — the constraint on {@link WithModelParams}, so
 * that one ref → row lookup serves every category.
 *
 * `object` and **not** `ModelParamsBase`, which is the shape it means: a row is
 * a category's own row type, and every one of those is `ModelParamsBase` plus
 * that category's fields. Writing the constraint that way would be exactly
 * wrong, because `ModelParamsBase` is a *weak* type — every property optional —
 * and TypeScript refuses to assign an object with no properties in common to
 * one. A row that declares `{ durations, resolutions, ratios }` and no `extras`
 * is precisely that object, so `WithModelParams<infer T>` would fail to match
 * the adapter, `ModelParamsFor` would answer `never`, and every model would
 * silently degrade to the wide vocabulary with tsc perfectly happy. (Measured;
 * it is the same class of failure as the `& {}` one `SizingArms` documents —
 * green build, dead narrowing.)
 *
 * A category's own table type (`ModelParamTable`, `VideoModelParamTable`) is
 * what an adapter's `satisfies` clause names, and that is where a row is
 * actually checked field by field.
 */
export type AnyModelParamTable = Readonly<Record<string, object>>;

/**
 * One image model's request surface, beyond the canonical vocabulary every
 * model has.
 *
 * Every field is optional, and **absent means different things on purpose**:
 *
 * - no `sizes` → this model has no `size` spelling at all, so the caller's
 *   `size` types as `never` and an editor steers them to `aspectRatio`
 *   instead. (Run time stays permissive: `size` on a ratio-only model is
 *   converted by `pixelsToRatio`, with the warning that conversion always
 *   carries.)
 * - no `ratios` → the model's ratio vocabulary is *derived* rather than
 *   enumerated (OpenAI has no `aspect_ratio` field; the adapter turns a ratio
 *   into a `size`), so `aspectRatio` keeps the wide {@link AspectRatio}.
 * - no `tiers` → likewise for `resolution`.
 *
 * The asymmetry is the honest one: a missing size *list* means the field does
 * not exist, while a missing ratio list means the field is computed.
 */
export interface ModelParams extends ModelParamsBase {
  /**
   * The `WxH` values this model accepts, plus any literal it takes instead
   * (`"auto"`). Curated for the free-form models, exhaustive for the enums —
   * `test/unified/image-presets.test.ts` proves both by compiling every one.
   */
  readonly sizes?: readonly string[];
  /**
   * Whether a `WxH` outside {@link sizes} is legal — S4 free-form and S2
   * pixel-pair models. Adds the `` `${number}x${number}` `` tail to the `size`
   * union; a closed S3 enum deliberately gets no tail, because there the list
   * *is* the limit and a template tail would promise otherwise.
   */
  readonly sizeFreeform?: boolean;
  /** The ratio spellings this model accepts, in canonical `W:H` form. */
  readonly ratios?: readonly string[];
  /**
   * Whether a ratio outside {@link ratios} is legal — the S5 models, whose
   * wire field is any `W:H` inside a numeric range and whose list is a set of
   * presets rather than an enum.
   */
  readonly ratioFreeform?: boolean;
  /** The canonical tiers this model can express. */
  readonly tiers?: readonly ResolutionTier[];
}

/** An image adapter's per-model table, keyed by **bare** model id. */
export type ModelParamTable = Readonly<Record<string, ModelParams>>;

/**
 * One video model's request surface, beyond the canonical vocabulary.
 *
 * Absent means "the canonical field keeps its wide type", uniformly — the
 * asymmetry `ModelParams.sizes` carries has no analogue here, because every
 * field a video row narrows is a field the vocabulary already has. What says
 * "this model has no such field at all" is an **empty** list: `ratios: []`
 * types `aspectRatio` as `never`, which is the compile-time half of the
 * `unsupported_param` a Hailuo model raises for it at run time.
 */
export interface VideoModelParams extends ModelParamsBase {
  /**
   * The clip lengths this model offers, **in seconds**, as a closed enum.
   *
   * Absent means the model's lengths are a *range* rather than a list — every
   * integer from 4 to 30 on Seedance 2.5, 1 to 16 on Vidu q3 — and `duration`
   * then keeps the wide `number`. That is the one place this row is not simply
   * "list or wide vocabulary": a range genuinely cannot be a union, and
   * pretending otherwise would put 27 literals in a completion list to describe
   * a `>=` check.
   *
   * When it is present it is exhaustive, so the union carries **no** template
   * tail: the list *is* the limit, and `duration: 7` on `sora-2` is a compile
   * error naming 4, 8, 12, 16 and 20.
   */
  readonly durations?: readonly number[];
  /**
   * The canonical tiers this model can express — after the adapter's own
   * mapping, so `720p` is here for a model whose wire spells it `"768P"` or
   * `"std"`. Empty means the model has no size field at all.
   */
  readonly resolutions?: readonly VideoResolution[];
  /**
   * The shapes this model accepts, in canonical `W:H` form. Every video wire in
   * this build publishes a closed list (a pixel-pair enum still reduces to a
   * finite set of shapes), so — unlike the image row — there is no `freeform`
   * flag and the union carries no template tail. Empty means the model has no
   * aspect-ratio field.
   */
  readonly ratios?: readonly string[];
}

/** A video adapter's per-model table, keyed by **bare** model id. */
export type VideoModelParamTable = Readonly<Record<string, VideoModelParams>>;

/**
 * One speech model's request surface, beyond the canonical vocabulary.
 *
 * ## What is here, and what deliberately is not
 *
 * Two fields, because two are what a *type* can state honestly about a
 * text-to-speech request:
 *
 * - **`codecs`** is a closed set at every one of the fourteen providers. A
 *   codec the endpoint has no spelling for is an error, never an approximation,
 *   so the list is the limit in both directions and the union carries no tail.
 * - **`languages`** is a closed set on the wire and an *open* one in the
 *   vocabulary — see {@link LanguageOf}.
 *
 * **`sampleRate` and `bitrate` are not here, on purpose.** They are the
 * category's real complexity and the one shape a per-model row cannot carry: at
 * ElevenLabs they are a *composite enum* (`mp3_22050_32` exists, `mp3_22050_128`
 * does not — the legal pairs are not the cross product), at Cartesia and MiniMax
 * they are per-codec lists whose validity depends on the codec chosen in the
 * same object, and at Deepgram opus takes a bitrate anywhere in 4–650 kbps,
 * which is a range. Typing any of that would mean either a matrix type keyed on
 * a sibling property or a union of several hundred members — for a check
 * `AudioFormatSpec` already performs at run time, with a message that names the
 * rates the codec *does* take. So the row narrows the codec, and the sample
 * rate stays run time's job.
 *
 * **`voice` IS here now, and only where the provider publishes a list.** Voice
 * catalogs are the one part of a TTS API that is genuinely dynamic: they are
 * per-account (every provider here supports cloned voices, which no snapshot
 * can enumerate), they run to thousands of entries at ElevenLabs and Murf, and
 * they turn over between releases. That argument is about the providers whose
 * catalogs are unbounded, and it was never a claim that no provider publishes
 * a list — OpenAI publishes nine for `tts-1` and thirteen for
 * `gpt-4o-mini-tts`, hand-catalogued in this repo and already enforced at the
 * wire, where an off-list voice is a `checkVoice` error naming the list.
 *
 * So {@link voices} is the `languages` model applied to `voice`: a row states
 * a list only when the provider closes one, {@link VoiceOf} keeps the
 * `(string & {})` tail plus both object spellings so a cloned voice never
 * stops compiling, and a row that declares nothing keeps the wide `Voice`
 * unchanged. The thirteen adapters that publish no list are bit-for-bit
 * unaffected — and the one that does stops being *looser* at the unified
 * surface than at the wire surface it compiles down to, which is the invariant
 * `test/unified/completions.test.ts` already asserts for `size`.
 */
export interface TtsModelParams extends ModelParamsBase {
  /**
   * The canonical codecs this model can emit — after the adapter's own mapping,
   * so `pcm_s16le` is here for an endpoint whose wire spells it `"linear16"`,
   * `"pcm"` or `"wav"`. Exhaustive, and therefore closed: an off-list codec is
   * a compile error naming the ones that exist.
   */
  readonly codecs?: readonly AudioFormatCodec[];
  /**
   * The languages this model's language field enumerates, as primary subtags.
   * Absent means the model has no closed list to offer — either the field is
   * free-form or the adapter declares it unsupported.
   */
  readonly languages?: readonly string[];
  /**
   * The model's **built-in** voices, and ONLY where the provider publishes a
   * closed, hand-catalogued list of them.
   *
   * Absent is the normal case and means "this provider's voice space is not
   * enumerable" — a per-account catalog, cloned voices, or thousands of ids
   * that turn over between releases. Absent keeps the wide {@link Voice}
   * exactly as it was; there is no default list and no guessing.
   *
   * Present is a completion list, never a gate: {@link VoiceOf} keeps the
   * `(string & {})` tail and both object spellings, so the caller's own cloned
   * voice compiles beside the presets. That is deliberate — the wire-level
   * check is per model too, and a type stricter than the validator would be a
   * false compile error, the worst failure mode this library has.
   */
  readonly voices?: readonly string[];
}

/** A speech adapter's per-model table, keyed by **bare** model id. */
export type TtsModelParamTable = Readonly<Record<string, TtsModelParams>>;

/**
 * One transcription model's request surface, beyond the canonical vocabulary.
 *
 * The category already narrows one field per **adapter** — `audioInputs`, which
 * decides the shape of `audio` — and that stays exactly where it is. It
 * composes with this one rather than competing: the two narrow different keys
 * through different mechanisms (a route's input shapes are an adapter fact, a
 * granularity set is a model fact), and `SttValidator` intersects both.
 */
export interface SttModelParams extends ModelParamsBase {
  /**
   * The timing detail this route can return. Every entry is a granularity the
   * caller can *ask for* and get; `"none"` is on the list exactly when asking
   * for plain text is expressible, which is not everywhere — several routes
   * always return word timings and have no switch to turn them off.
   */
  readonly timestamps?: readonly TimestampGranularity[];
  /** The languages this model's language field enumerates. See {@link LanguageOf}. */
  readonly languages?: readonly string[];
}

/** A transcribe adapter's per-model table, keyed by **bare** model id. */
export type SttModelParamTable = Readonly<Record<string, SttModelParams>>;

/**
 * One music model's request surface, beyond the canonical vocabulary.
 *
 * The smallest row in the file, matching the smallest vocabulary: `prompt`,
 * `durationSeconds`, `instrumental` and `seed` are either free-form or booleans,
 * so `outputFormat` is the only canonical word with a per-model enum behind it.
 */
export interface MusicModelParams extends ModelParamsBase {
  /** The canonical codecs this model can emit — same contract as {@link TtsModelParams.codecs}. */
  readonly codecs?: readonly AudioFormatCodec[];
}

/** A music adapter's per-model table, keyed by **bare** model id. */
export type MusicModelParamTable = Readonly<Record<string, MusicModelParams>>;

/**
 * One sound-effect model's request surface, beyond the canonical vocabulary.
 *
 * Five fields, four of which describe ONE canonical word. `durationSeconds` is
 * the field this category is built around, and it is the first number in the
 * library where the interesting question is not "which values" but **"what
 * does absence mean"** — and the six routes in the first build answer it three
 * different ways:
 *
 * | endpoint | range | whole | absent means |
 * |---|---|---|---|
 * | `elevenlabs/eleven_text_to_sound_v2` | 0.5–30 | no | the model reads a length off the prompt |
 * | `fal/fal-ai/elevenlabs/sound-effects/v2` | 0.5–22 | no | the same, at a narrower cap |
 * | `fal/sonilo/v1.1/text-to-sound-effects` | 1–180 | **yes** | **8 seconds** |
 * | `fal/mirelo-ai/sfx1.6/text-to-audio` | 0.1–60 | no | **10 seconds** |
 * | `fal/fal-ai/stable-audio-3/small/sfx/*` | 1–120 | no | **30 seconds** |
 * | `fal/cassetteai/sound-effects-generator` | 1–30 | **yes** | **HTTP 422** — the field is required |
 *
 * So the row states all four facts and the adapters spend them separately:
 * {@link durationRequired} becomes a REQUIRED property at compile time (and a
 * `missing_param` at run time), {@link durationDefault} becomes an
 * `approximated_param` naming the number the provider will pick,
 * {@link durationRange} and {@link durationInt} become the bounds and
 * whole-number checks. Absence is never compiled to a literal `"auto"`: none of
 * these six wires has such a value, and inventing one would put a string in a
 * numeric field.
 *
 * {@link durationRange} stays a range and never becomes a union —
 * {@link VideoModelParams.durations}' argument, at six endpoints that span
 * 0.1 to 180 seconds.
 */
export interface SfxModelParams extends ModelParamsBase {
  /** The canonical codecs this model can emit — same contract as {@link TtsModelParams.codecs}. */
  readonly codecs?: readonly AudioFormatCodec[];
  /**
   * `[min, max]` seconds, inclusive. Absent means this build has no bounds for
   * the route, which degrades to the provider's own check rather than to a
   * guess.
   */
  readonly durationRange?: readonly [number, number];
  /** The wire field is an INTEGER, so a fractional second is a refusal. */
  readonly durationInt?: true;
  /**
   * The length the provider uses when the caller states none.
   *
   * Present is what makes the `approximated_param` honest — it names the
   * number. **Absent is not "no default"**: it is "the provider does not
   * publish one", which at both ElevenLabs routes means the model reads a
   * length off the prompt. Nothing is invented there, so nothing warns.
   */
  readonly durationDefault?: number;
  /**
   * Omitting the length is a wire error at this route.
   *
   * One witness (`cassetteai/sound-effects-generator`) and it is enough,
   * because the alternative is shipping a request the API answers 422 to. See
   * {@link SfxModelNarrowing} for the three arms this produces.
   */
  readonly durationRequired?: true;
}

/** A sound-effect adapter's per-model table, keyed by **bare** model id. */
export type SfxModelParamTable = Readonly<Record<string, SfxModelParams>>;

/**
 * One voice-conversion model's request surface, beyond the canonical
 * vocabulary.
 *
 * The same single-field row as {@link MusicModelParams}, and for a sharper
 * reason: this category's other three words are all un-narrowable. `audio` is
 * one shape at both witnesses, `voice` has no closed list at either (per-account
 * catalogs, thousands of entries, cloned voices), and `model` is the ref
 * itself. What is left is the encoding, which the two vendors spell in
 * genuinely different value spaces — a `codec_sampleRate_bitrate` composite at
 * ElevenLabs, a bare container name at Hume — so the row is what stops
 * `outputFormat: "opus"` compiling at the one that cannot emit it.
 */
export interface StsModelParams extends ModelParamsBase {
  /** The canonical codecs this model can emit — same contract as {@link TtsModelParams.codecs}. */
  readonly codecs?: readonly AudioFormatCodec[];
}

/** A voice-conversion adapter's per-model table, keyed by **bare** model id. */
export type StsModelParamTable = Readonly<Record<string, StsModelParams>>;

/**
 * One lipsync route's request surface, beyond the canonical vocabulary.
 *
 * A single field, and it is the one the category is built on. `stt` narrows
 * its input shape per **adapter** (`audioInputs`) because a provider's
 * transcribe routes agree about how audio arrives; that is not true here. fal
 * alone serves eight lipsync endpoints and eight avatar ones under one
 * provider id, and which shape a route takes is the difference between the two
 * categories — so the unit of declaration is the model, exactly as it is for
 * image sizes and video durations.
 */
export interface LipsyncModelParams extends ModelParamsBase {
  /**
   * The source shapes this route accepts, `as const`.
   *
   * Absent keeps the wide {@link LipsyncSource}. An **empty** list is the
   * compile-time `never`: it says this route takes no source at all, which is
   * a fact about `veed/avatars`-shaped routes in the sibling category and is
   * spelled the same way here so the two read alike.
   */
  readonly sources?: readonly LipsyncSourceKind[];
}

/** A lipsync adapter's per-model table, keyed by **bare** model id. */
export type LipsyncModelParamTable = Readonly<Record<string, LipsyncModelParams>>;

/**
 * One avatar route's request surface, beyond the canonical vocabulary.
 *
 * The same single field as its lipsync twin, and the same argument. What
 * differs is what an empty list means in practice: at avatar it is not
 * hypothetical, it is `veed/avatars/audio-to-video` and
 * `argil/avatars/audio-to-video`, whose performer is a catalogued id rather
 * than a picture.
 */
export interface AvatarModelParams extends ModelParamsBase {
  /**
   * The still shapes this route accepts, `as const`. Absent keeps the wide
   * optional `image`; `["image"]` makes it REQUIRED; `[]` types it `never`.
   */
  readonly sources?: readonly AvatarSourceKind[];
}

/** An avatar adapter's per-model table, keyed by **bare** model id. */
export type AvatarModelParamTable = Readonly<Record<string, AvatarModelParams>>;

/**
 * One upscale route's request surface, beyond the canonical vocabulary.
 *
 * Two fields, and this is where the `sources` mechanism stops being a
 * single-member union pretending to be data:
 * `fal-ai/seedvr/upscale/image` says `["image"]` and
 * `fal-ai/seedvr/upscale/video` says `["video"]` — one vendor, one product, one
 * release, two shapes. At lipsync and avatar the row separates two CATEGORIES;
 * here it separates two routes inside one.
 */
export interface UpscaleModelParams extends ModelParamsBase {
  /**
   * The source shapes this route accepts, `as const`. Absent keeps the wide
   * {@link UpscaleSource}; a single-member list narrows `source` to that shape.
   */
  readonly sources?: readonly UpscaleSourceKind[];
  /**
   * The multipliers this route offers, as a closed set.
   *
   * Absent means the multiplier is a RANGE — every number from 1 to 4 at
   * Clarity, 1 to 10 at SeedVR — and `factor` keeps the wide `number`, with the
   * ends enforced by the provider's own bounds check. That is the same "a range
   * genuinely cannot be a union" argument {@link VideoModelParams.durations}
   * makes, and it is why this list carries no template tail when it IS present.
   *
   * An **empty** list is the compile-time `never`: this route has no multiplier
   * at all. `fal-ai/recraft/upscale/crisp` is the witness — it upscales to a
   * size it chooses — and typing `factor` as `never` there says so at the
   * keystroke rather than at the 422.
   */
  readonly factors?: readonly number[];
}

/** An upscale adapter's per-model table, keyed by **bare** model id. */
export type UpscaleModelParamTable = Readonly<Record<string, UpscaleModelParams>>;

/**
 * One 3D route's request surface, beyond the canonical vocabulary.
 *
 * One field, and it decides BOTH canonical content words at once — the only
 * row in the library that does. `sources` at lipsync, avatar and upscale
 * answers "in what shape does the one input arrive"; `inputs` here answers "by
 * which of two routes is the object named at all", and the answer moves
 * `prompt` and `image` in opposite directions.
 */
export interface ThreeDModelParams extends ModelParamsBase {
  /**
   * The moods this route reads, `as const`.
   *
   * `["text"]` requires `prompt` and types `image` as `never`; `["image"]` does
   * the reverse; a list with both leaves each optional, which is the honest
   * shape for `fal-ai/hyper3d/rodin/v2.5` — it publishes both fields, requires
   * neither, and uses the prompt to steer the image when both arrive. Absent
   * keeps the wide optional pair, which is what an uncatalogued ref gets.
   *
   * There is no empty-list arm: a 3D route that is told nothing about what to
   * build is not a route.
   */
  readonly inputs?: readonly ThreeDInputKind[];
}

/** A 3D adapter's per-model table, keyed by **bare** model id. */
export type ThreeDModelParamTable = Readonly<Record<string, ThreeDModelParams>>;

/**
 * One voice-cloning route's request surface, beyond the canonical vocabulary.
 *
 * The category narrows two things per **adapter** already — `sampleInputs`
 * (the shape of each recording) and `sampleLimits` (how many) — and those
 * stay there: which transport a route takes is an adapter fact. What is a
 * *model* fact is the language space: Cartesia's clone route requires one of
 * 44 codes, so `languages` completes it, open, through {@link LanguageOf}.
 */
export interface VoiceCloneModelParams extends ModelParamsBase {
  /** The languages this route's language field enumerates. See {@link LanguageOf}. */
  readonly languages?: readonly string[];
}

/** A voice-clone adapter's per-model table, keyed by **bare** model id. */
export type VoiceCloneModelParamTable = Readonly<Record<string, VoiceCloneModelParams>>;

/**
 * One voice-design model's request surface, beyond the canonical vocabulary.
 * The same single-field row as its clone sibling, for the same reason.
 */
export interface VoiceDesignModelParams extends ModelParamsBase {
  /** The languages this route's language field enumerates. See {@link LanguageOf}. */
  readonly languages?: readonly string[];
}

/** A voice-design adapter's per-model table, keyed by **bare** model id. */
export type VoiceDesignModelParamTable = Readonly<Record<string, VoiceDesignModelParams>>;

/** An adapter that carries one. Every narrowing category's adapter type extends it. */
export interface WithModelParams<T extends AnyModelParamTable = AnyModelParamTable> {
  readonly modelParams: T;
}

// ---------------------------------------------------------------------------
// Ref → row
// ---------------------------------------------------------------------------

/**
 * The row a bare model id selects on one adapter, or `never`.
 *
 * `A` is naked so this distributes: a ref that is not a literal selects *every*
 * adapter (see `AdapterFor`), and every one of them answers `never` for a model
 * id it does not have — which collapses the whole thing to `never` and is
 * exactly the signal {@link ModelSizing} and {@link ModelExtras} degrade on.
 */
type RowOf<A, M extends string> = A extends WithModelParams<infer T>
  ? M extends keyof T
    ? T[M]
    : never
  : never;

/**
 * The row a `"provider/model"` ref selects — `never` when the ref is dynamic,
 * names a provider with no adapter, or names a model this build does not know.
 *
 * All three degrade to the wide vocabulary, which is the same trade every model
 * list in this library makes: the union drives autocomplete, it does not gate
 * the API, and a model released after this snapshot must stay callable.
 */
export type ModelParamsFor<A, R extends string> = RowOf<AdapterFor<A, R>, RefModel<R>>;

// ---------------------------------------------------------------------------
// Row → extras — the half every category shares
// ---------------------------------------------------------------------------

/** `extras` → the optional per-model params, with their exact types. */
type ExtrasOf<Row> = Row extends { readonly extras: infer X }
  ? { -readonly [K in keyof X]?: X[K] }
  : // `unknown`, not `{}`: this lands in an intersection on both of its call
    // sites, and an intersection with `unknown` is the no-op both want.
    unknown;

/** Every extra name any model on any adapter in this build declares. */
type ExtraKeysOf<Row> = Row extends { readonly extras: infer X } ? Extract<keyof X, string> : never;
type AnyExtraKey<A> = A extends WithModelParams<infer T> ? ExtraKeysOf<T[keyof T]> : never;

/**
 * The extras one ref admits.
 *
 * Degraded — dynamic ref, unknown provider, unknown model — it becomes *every*
 * extra name in the build, typed `unknown`. That is the honest widening: the
 * type cannot say which model this is, so it must not claim `background` is
 * illegal; but it can still say `bakcground` is, which is the half of
 * `ExactKeys` worth keeping.
 */
export type ModelExtras<A, R extends string> = [ModelParamsFor<A, R>] extends [never]
  ? { [K in AnyExtraKey<A>]?: unknown }
  : ExtrasOf<ModelParamsFor<A, R>>;

// ---------------------------------------------------------------------------
// Image / imageEdit: row → the caller's types
// ---------------------------------------------------------------------------

/** `sizes` → the `size` union, with the template tail only where the wire is open. */
export type SizeOf<Row> = Row extends { readonly sizes: readonly (infer S extends string)[] }
  ? Row extends { readonly sizeFreeform: true }
    ? S | (`${number}x${number}` & {})
    : S
  : never;

/** `ratios` → the `aspectRatio` union; absent keeps the wide one. */
export type RatioOf<Row> = Row extends { readonly ratios: readonly (infer R extends string)[] }
  ? Row extends { readonly ratioFreeform: true }
    ? R | (`${number}:${number}` & {})
    : R
  : AspectRatio;

/** `tiers` → the `resolution` union; absent keeps all three. */
export type TierOf<Row> = Row extends {
  readonly tiers: readonly (infer T extends ResolutionTier)[];
}
  ? T
  : ResolutionTier;

/**
 * The size/aspectRatio/dimensions XOR with per-model members. This is a
 * complete **replacement** for the vocabulary's own three arms, not a set of
 * per-field narrowings to intersect with them — and that is the load-bearing
 * decision of this module:
 *
 * `SizeOf` unions carry `` (`${number}x${number}` & {}) `` tails, and the
 * `& {}` is what stops TypeScript's union subtype reduction from absorbing
 * every `"WxH"` preset into the template. Intersecting that union with the
 * wide arm's `size?: string` **discharges the `& {}`** during intersection
 * normalization (`` `T` & {} & string `` reduces to `` `T` ``), a bare
 * template survives in the union, subtype reduction eats every preset, and
 * the editor completes nothing but `"auto"`. Measured with the real language
 * service; pinned by `test/unified/completions.test.ts`. Replacing the arms
 * outright means the narrowed union is the only source of `size`'s contextual
 * type, so the presets survive to the completion list — which is the entire
 * point of carrying them.
 */
type SizingArms<Size, Ratio> =
  | { size?: Size; aspectRatio?: never; dimensions?: never }
  | { size?: never; aspectRatio?: Ratio; dimensions?: never }
  | { size?: never; aspectRatio?: never; dimensions?: Dimensions };

/** The wide arms, restated for the degraded (dynamic/unknown-ref) case. */
type WideSizingArms = SizingArms<string, AspectRatio>;

/**
 * The sizing decision one ref admits, as complete XOR arms (see
 * {@link SizingArms} for why they replace the vocabulary's own arms instead
 * of intersecting them). Degraded — dynamic ref, unknown provider, unknown
 * model — it restates the wide arms, so the XOR invariant holds for every
 * caller and a model released after this snapshot stays callable.
 */
export type ModelSizing<A, R extends string> = [ModelParamsFor<A, R>] extends [never]
  ? WideSizingArms & { resolution?: ResolutionTier }
  : SizingArms<SizeOf<ModelParamsFor<A, R>>, RatioOf<ModelParamsFor<A, R>>> & {
      resolution?: TierOf<ModelParamsFor<A, R>>;
    };

/**
 * {@link ModelSizing} without the tier — for `imageEdit`, whose vocabulary has
 * no `resolution` because the overwhelmingly common answer to "how big" when
 * editing is "the size it already was".
 */
export type ModelShape<A, R extends string> = [ModelParamsFor<A, R>] extends [never]
  ? WideSizingArms
  : SizingArms<SizeOf<ModelParamsFor<A, R>>, RatioOf<ModelParamsFor<A, R>>>;

// ---------------------------------------------------------------------------
// Video: row → the caller's types
// ---------------------------------------------------------------------------

/**
 * `durations` → the `duration` union; absent keeps the wide `number`.
 *
 * **No template tail, ever.** `SizeOf`'s `` (`${number}x${number}` & {}) `` is
 * there because a free-form `size` genuinely accepts values outside its preset
 * list; a duration list is a *closed enum* — five values on Sora, two on Luma —
 * and a model whose lengths are open declares no `durations` at all and gets
 * the wide `number`. So the two cases are "these exactly" and "any number",
 * with nothing in between to spell.
 */
export type VideoDurationOf<Row> = Row extends {
  readonly durations: readonly (infer D extends number)[];
}
  ? D
  : number;

/** `resolutions` → the `resolution` union; absent keeps all five tiers. */
export type VideoResolutionOf<Row> = Row extends {
  readonly resolutions: readonly (infer R extends VideoResolution)[];
}
  ? R
  : VideoResolution;

/**
 * `ratios` → the `aspectRatio` union; absent keeps the wide {@link AspectRatio}.
 *
 * A plain literal union with no `` (`${number}:${number}` & {}) `` tail, which
 * is the difference from {@link RatioOf}: every video wire in this build
 * publishes a closed shape list — even Runway, whose `ratio` members are pixel
 * pairs, reduces to a finite set of shapes — so a tail would promise a
 * freedom none of them has. The *degraded* case keeps `AspectRatio` and
 * therefore keeps its tail, which is why this must never be intersected with
 * the wide vocabulary: see {@link SizingArms} for what that costs.
 */
export type VideoRatioOf<Row> = Row extends {
  readonly ratios: readonly (infer R extends string)[];
}
  ? R
  : AspectRatio;

/**
 * The three fields a video row narrows, as a complete **replacement** for the
 * vocabulary's own.
 *
 * Same rule as {@link SizingArms}, and for the same measured reason: the
 * degraded arm restates `AspectRatio`, whose `` (`${number}:${number}` & {}) ``
 * tail is discharged the moment it is intersected with a narrowed literal
 * union — after which subtype reduction eats every preset and `aspectRatio:`
 * completes nothing. `VideoParamsBase` therefore omits all three fields, so
 * this is the only source of their contextual type.
 */
type VideoArms<Duration, Resolution, Ratio> = {
  duration?: Duration;
  resolution?: Resolution;
  aspectRatio?: Ratio;
};

/**
 * The duration / resolution / shape one ref admits. Degraded — dynamic ref,
 * unknown provider, unknown model — it restates the wide vocabulary, so a model
 * released after this snapshot stays callable.
 */
export type VideoModelNarrowing<A, R extends string> = [ModelParamsFor<A, R>] extends [never]
  ? VideoArms<number, VideoResolution, AspectRatio>
  : VideoArms<
      VideoDurationOf<ModelParamsFor<A, R>>,
      VideoResolutionOf<ModelParamsFor<A, R>>,
      VideoRatioOf<ModelParamsFor<A, R>>
    >;

// ---------------------------------------------------------------------------
// The three audio categories: row → the caller's types
// ---------------------------------------------------------------------------

/** `codecs` → the codec union; absent keeps every codec the vocabulary has. */
export type CodecOf<Row> = Row extends {
  readonly codecs: readonly (infer C extends AudioFormatCodec)[];
}
  ? C
  : AudioFormatCodec;

/**
 * `codecs` → the whole `outputFormat` type, with **both** spellings narrowed.
 *
 * `AudioFormatRequest` is `AudioFormatCodec | AudioFormat`, and narrowing only
 * the shorthand would leave `{ format: "vorbis" }` compiling at a provider that
 * has never heard of Vorbis — the object form is the one a caller reaches for
 * precisely when they care about the encoding, so it is the half that must not
 * be left wide.
 *
 * Spelled `Omit<AudioFormat, "format"> & { format: C }` rather than
 * `AudioFormat & { format: C }`: the latter leaves two `format` declarations in
 * the intersection and the property's type becomes `AudioFormatCodec & C`,
 * which is a *deferred* intersection — assignability still works, but the
 * contextual type at a `format:` completion position is no longer a plain
 * literal union and the editor's list goes wide. Replacing the property
 * outright is the same rule {@link SizingArms} states, one level down.
 */
export type AudioFormatOf<Row> =
  | CodecOf<Row>
  | (Omit<AudioFormat, "format"> & { format: CodecOf<Row> });

/**
 * `languages` → the `language` union; absent keeps the wide `string`.
 *
 * **Open, unlike every other list in this file**, and the `(string & {})` tail
 * is the whole argument. The canonical `language` is a BCP-47 *tag*, while the
 * wire fields these lists come from are enums of bare primary subtags — so
 * `language: "pt-BR"` is a legal, working request that `toPrimaryLanguage`
 * sends as `"pt"` with an `approximated_param` naming the subtag it could not
 * express (and `"pt_BR"`, which half the world's locale plumbing emits, is
 * accepted too). A closed union would make both of those compile errors: a
 * false negative on a request the library deliberately supports, which is the
 * one failure mode worse than no narrowing at all. Widening the union to
 * `` `${L}-${string}` `` tails instead would triple its size and still lie
 * about the underscore spelling.
 *
 * So the list **completes** and does not gate — exactly what a model ref does,
 * for exactly the reason `UnifiedInput` gives — and the provider's own enum
 * check is what refuses `"xx"`, naming the languages it has.
 */
export type LanguageOf<Row> = Row extends {
  readonly languages: readonly (infer L extends string)[];
}
  ? L | (string & {})
  : string;

/**
 * `voices` → that model's presets, `| (string & {})`, plus both object
 * spellings. Absent restates the wide {@link Voice}.
 *
 * Open for {@link LanguageOf}'s reason and one of its own: every provider in
 * this category supports cloned voices, and the wire-level check that refuses
 * an off-list *string* is itself per model (`checkVoice` skips a model with no
 * table). A closed union here would refuse a working request — so the list
 * completes and does not gate.
 */
export type VoiceOf<Row> = Row extends { readonly voices: readonly (infer V extends string)[] }
  ? V | (string & {}) | { id: string } | { name: string }
  : Voice;

/** `timestamps` → the `timestamps` union; absent keeps all four granularities. */
export type TimestampsOf<Row> = Row extends {
  readonly timestamps: readonly (infer T extends TimestampGranularity)[];
}
  ? T
  : TimestampGranularity;

/**
 * The three fields a speech row narrows, as a complete **replacement** for the
 * vocabulary's own — {@link SizingArms}'s rule, and this category has its own
 * reason to obey it: {@link LanguageOf} and {@link VoiceOf} both carry a
 * `(string & {})` tail, and an intersection with the base's `language?: string`
 * / `voice?: Voice` would discharge the brace, leave a bare `string` in the
 * union, and let subtype reduction eat every code and every preset while tsc
 * stayed green. `TtsParamsBase` therefore omits all three, so this is the
 * only source of their contextual type.
 */
type TtsArms<Format, Language, VoiceArm> = {
  outputFormat?: Format;
  language?: Language;
  voice?: VoiceArm;
};

/**
 * The `outputFormat` / `language` / `voice` triple one ref admits. Degraded —
 * dynamic ref, unknown provider, unknown model — it restates the wide
 * vocabulary.
 */
export type TtsModelNarrowing<A, R extends string> = [ModelParamsFor<A, R>] extends [never]
  ? TtsArms<AudioFormatRequest, string, Voice>
  : TtsArms<
      AudioFormatOf<ModelParamsFor<A, R>>,
      LanguageOf<ModelParamsFor<A, R>>,
      VoiceOf<ModelParamsFor<A, R>>
    >;

/** {@link TtsArms} for transcription: the granularity set and the languages. */
type SttArms<Stamps, Language> = {
  timestamps?: Stamps;
  language?: Language;
};

/**
 * The `timestamps` / `language` pair one ref admits.
 *
 * Composes with — never replaces — this category's *other* narrowing:
 * `AudioNarrowing` types `audio` from the adapter's `audioInputs`, which is a
 * different key reached through a different mechanism, so the two intersect
 * cleanly in `SttValidator`.
 */
export type SttModelNarrowing<A, R extends string> = [ModelParamsFor<A, R>] extends [never]
  ? SttArms<TimestampGranularity, string>
  : SttArms<TimestampsOf<ModelParamsFor<A, R>>, LanguageOf<ModelParamsFor<A, R>>>;

/** The one field a music row narrows. */
type MusicArms<Format> = { outputFormat?: Format };

/** The `outputFormat` one ref admits, restated wide when the ref is degraded. */
export type MusicModelNarrowing<A, R extends string> = [ModelParamsFor<A, R>] extends [never]
  ? MusicArms<AudioFormatRequest>
  : MusicArms<AudioFormatOf<ModelParamsFor<A, R>>>;

/** The one field a voice-conversion row narrows. */
type StsArms<Format> = { outputFormat?: Format };

/**
 * The `outputFormat` one voice-conversion ref admits, restated wide when the
 * ref is degraded.
 *
 * `MusicModelNarrowing`'s shape, and it obeys the same replacement rule for the
 * same measured reason: {@link AudioFormatOf} replaces the `format` property
 * outright rather than intersecting with it, and `StsParamsBase` therefore
 * omits `outputFormat` so this is its only contextual type.
 */
export type StsModelNarrowing<A, R extends string> = [ModelParamsFor<A, R>] extends [never]
  ? StsArms<AudioFormatRequest>
  : StsArms<AudioFormatOf<ModelParamsFor<A, R>>>;

/**
 * The two fields a sound-effect row narrows, as a complete **replacement** for
 * the vocabulary's own.
 *
 * `SizingArms`'s rule, and this category needs the sharpest half of it —
 * {@link LipsyncArms}' argument, one word over: the arms differ in whether
 * `durationSeconds` is REQUIRED, and an intersection cannot make an optional
 * property required. `SfxParamsBase` therefore declares neither field, so this
 * is the only source of both contextual types.
 *
 * `Duration` is always `number` and never a union — the six routes' lengths are
 * ranges, not enums ({@link VideoDurationOf}'s rule). What varies is the
 * QUESTION MARK, which is the whole point.
 */
type SfxArms<Format> = { outputFormat?: Format; durationSeconds?: number };

/**
 * The `outputFormat` / `durationSeconds` pair one ref admits.
 *
 * Three arms, and the category needs every one. A route that requires a length
 * says so at the keystroke rather than at the 422
 * (`cassetteai/sound-effects-generator`); every other catalogued route leaves it
 * optional, where absence means that provider's own default; and a ref this
 * build cannot read restates the wide optional pair, so a model released after
 * this snapshot stays callable. That is the avatar three-arm requiredness
 * precedent, pointed at a number instead of a picture.
 */
export type SfxModelNarrowing<A, R extends string> = [ModelParamsFor<A, R>] extends [never]
  ? SfxArms<AudioFormatRequest>
  : ModelParamsFor<A, R> extends { readonly durationRequired: true }
    ? { outputFormat?: AudioFormatOf<ModelParamsFor<A, R>>; durationSeconds: number }
    : SfxArms<AudioFormatOf<ModelParamsFor<A, R>>>;

// ---------------------------------------------------------------------------
// The two performance categories: row → the caller's types
// ---------------------------------------------------------------------------

/**
 * `sources` → the `source` type; absent keeps the wide union, empty is `never`.
 *
 * The empty case is checked FIRST and separately, because `readonly []` does
 * match `readonly (infer S)[]` with `S = never`, and `LipsyncSourceFor<never>`
 * is `never` — a REQUIRED property of type `never`, which makes the whole call
 * uncallable with an error that names no fix. `source?: never` says the same
 * thing in a message a caller can act on: this route takes no source, omit it.
 */
export type LipsyncSourceOf<Row> = Row extends {
  readonly sources: readonly (infer S extends string)[];
}
  ? LipsyncSourceFor<Extract<S, LipsyncSourceKind>>
  : never;

/**
 * The one field a lipsync row narrows, as a complete **replacement** for the
 * vocabulary's own.
 *
 * `SizingArms`'s rule, and this category has the sharpest version of it: the
 * arms differ in whether the property is REQUIRED, and an intersection cannot
 * make an optional property required. `LipsyncParamsBase` therefore omits
 * `source` entirely, so this is the only source of its type — which is also
 * why a still handed to a clip-only model is one error on `source` rather than
 * a silently-widened union.
 */
type LipsyncArms<Source> = { source: Source };

/**
 * The `source` one ref admits. Degraded — dynamic ref, unknown provider,
 * unknown model — it restates the wide vocabulary, so a model released after
 * this snapshot stays callable.
 */
export type LipsyncModelNarrowing<A, R extends string> = [ModelParamsFor<A, R>] extends [never]
  ? LipsyncArms<LipsyncSourceFor<LipsyncSourceKind>>
  : ModelParamsFor<A, R> extends { readonly sources: readonly [] }
    ? { source?: never }
    : ModelParamsFor<A, R> extends { readonly sources: readonly string[] }
      ? LipsyncArms<LipsyncSourceOf<ModelParamsFor<A, R>>>
      : LipsyncArms<LipsyncSourceFor<LipsyncSourceKind>>;

/**
 * `sources` → the `image` type on an avatar row; the empty list is checked
 * first for {@link LipsyncSourceOf}'s reason.
 */
export type AvatarImageOf<Row> = Row extends {
  readonly sources: readonly (infer S extends string)[];
}
  ? [Extract<S, AvatarSourceKind>] extends [never]
    ? never
    : AvatarImageInput
  : never;

/**
 * The one field an avatar row narrows, as a complete **replacement**.
 *
 * Three arms rather than two, because "required", "forbidden" and "unknown"
 * are three different answers and a caller deserves the right message for
 * each: a still route requires `image`, a preset-performer route types it
 * `never` (and says so at the keystroke rather than at the 400), and a ref this
 * build cannot read keeps the wide optional arm so a model released after this
 * snapshot stays callable.
 */
export type AvatarModelNarrowing<A, R extends string> = [ModelParamsFor<A, R>] extends [never]
  ? { image?: AvatarImageInput }
  : ModelParamsFor<A, R> extends { readonly sources: readonly [] }
    ? { image?: never }
    : ModelParamsFor<A, R> extends { readonly sources: readonly string[] }
      ? { image: AvatarImageOf<ModelParamsFor<A, R>> }
      : { image?: AvatarImageInput };

/**
 * `sources` → the `source` type on an upscale row; absent keeps the wide union.
 *
 * No empty-list arm here, unlike its two cousins, and the asymmetry is a fact
 * about the category rather than an oversight: an upscaler with nothing to
 * upscale is not a route. Every row in this build names exactly one shape.
 */
export type UpscaleSourceOf<Row> = Row extends {
  readonly sources: readonly (infer S extends string)[];
}
  ? UpscaleSourceFor<Extract<S, UpscaleSourceKind>>
  : never;

/**
 * `factors` → the `factor` union; absent keeps the wide `number`.
 *
 * **No template tail, ever** — {@link VideoDurationOf}'s rule. A `factors` list
 * is a closed enum (`fal-ai/aura-sr` publishes exactly `4`) and a route whose
 * multipliers are open declares no list at all. The empty list falls out of the
 * same expression: `readonly []` matches with `F = never`, which types `factor`
 * as `never` — the answer for a route with no multiplier field.
 */
export type UpscaleFactorOf<Row> = Row extends {
  readonly factors: readonly (infer F extends number)[];
}
  ? F
  : number;

/**
 * The two fields an upscale row narrows, as a complete **replacement** for the
 * vocabulary's own.
 *
 * `SizingArms`'s rule, and this category needs both halves of it: `source` is
 * REQUIRED and an intersection cannot make an optional property required
 * (`LipsyncArms`'s sharpest-version argument), while `factor` has a `never` arm
 * that an intersection with `factor?: number` would quietly widen back to a
 * number. `UpscaleParamsBase` therefore omits both.
 */
type UpscaleArms<Source, Factor> = { source: Source; factor?: Factor };

/**
 * The `source` and `factor` one ref admits. Degraded — dynamic ref, unknown
 * provider, unknown model — it restates the wide vocabulary, so a model
 * released after this snapshot stays callable.
 */
export type UpscaleModelNarrowing<A, R extends string> = [ModelParamsFor<A, R>] extends [never]
  ? UpscaleArms<UpscaleSourceFor<UpscaleSourceKind>, number>
  : ModelParamsFor<A, R> extends { readonly sources: readonly string[] }
    ? UpscaleArms<UpscaleSourceOf<ModelParamsFor<A, R>>, UpscaleFactorOf<ModelParamsFor<A, R>>>
    : UpscaleArms<UpscaleSourceFor<UpscaleSourceKind>, UpscaleFactorOf<ModelParamsFor<A, R>>>;

/**
 * `inputs` → the `image` type on a 3D row.
 *
 * Its own alias rather than being inlined below because the adapter tests and
 * `unmodel/values` both name it, and because "what shape does this route's
 * image take" is a question worth being able to ask on its own.
 */
export type ThreeDImageOf<Row> = Row extends {
  readonly inputs: readonly (infer K extends string)[];
}
  ? "image" extends K
    ? ThreeDImageInput
    : never
  : ThreeDImageInput;

/**
 * The two fields a 3D row narrows, as a complete **replacement** for the
 * vocabulary's own.
 *
 * Four arms, and the category needs every one of them. A text route requires
 * `prompt` and refuses `image`; an image route does the reverse; a route that
 * publishes both requires neither, because at `fal-ai/hyper3d/rodin/v2.5` the
 * prompt is a steering hint and the image is optional too; and a ref this build
 * cannot read restates the wide optional pair, so a model released after this
 * snapshot stays callable.
 *
 * `SizingArms`'s rule applies twice over here, which is why
 * {@link ThreeDParamsBase} omits both fields: an intersection cannot make an
 * optional property required (so the text arm's `prompt: string` would decay),
 * and an intersection with an optional property cannot make it `never` (so the
 * refusals would decay too).
 */
export type ThreeDModelNarrowing<A, R extends string> = [ModelParamsFor<A, R>] extends [never]
  ? { prompt?: string; image?: ThreeDImageInput }
  : ModelParamsFor<A, R> extends { readonly inputs: readonly (infer K extends string)[] }
    ? "text" extends K
      ? "image" extends K
        ? { prompt?: string; image?: ThreeDImageInput }
        : { prompt: string; image?: never }
      : { prompt?: never; image: ThreeDImageInput }
    : { prompt?: string; image?: ThreeDImageInput };

/** The one field either voice-creation row narrows. */
type VoiceArms<Language> = { language?: Language };

/**
 * The `language` one voice-clone ref admits, restated wide when the ref is
 * degraded. Composes with — never replaces — the category's *other*
 * narrowing: `SampleNarrowing` types `samples` from the adapter's
 * `sampleInputs`, a different key reached through a different mechanism
 * (stt's `AudioNarrowing` sentence, one field over).
 */
export type VoiceCloneModelNarrowing<A, R extends string> = [ModelParamsFor<A, R>] extends [
  never,
]
  ? VoiceArms<string>
  : VoiceArms<LanguageOf<ModelParamsFor<A, R>>>;

/** The `language` one voice-design ref admits, restated wide when degraded. */
export type VoiceDesignModelNarrowing<A, R extends string> = [ModelParamsFor<A, R>] extends [
  never,
]
  ? VoiceArms<string>
  : VoiceArms<LanguageOf<ModelParamsFor<A, R>>>;
