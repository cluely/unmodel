/**
 * `CANONICAL_KEYS` ↔ the vocabulary types. Not executed by `bun test`;
 * type-checked by `bun run check`.
 *
 * `createUnified`'s envelope check refuses any top-level key it does not
 * recognise, and the list it recognises is hand-written in
 * `src/core/unified/kernel.ts`. That is a second declaration of the same
 * vocabulary the `*Params` types state — and the repo's own rule about second
 * declarations (`vocabulary/model-params.ts`) is that they cannot be kept in
 * step by intention.
 *
 * The failure mode is nasty in the right direction to catch here: add a field
 * to `VideoParams` and forget the key list, and a call that type-checks is
 * rejected at runtime with `unsupported_param`. No existing test iterates a
 * fully-populated params literal, no bundle budget can see a type-only field,
 * and the type is not wrong — only the list is. So the two are compared
 * directly, in both directions:
 *
 * - a vocabulary key missing from the list would reject a valid request;
 * - a list key missing from the vocabulary would accept a param nothing reads.
 */
import type { CanonicalKeyOf } from "../../src/core/unified/kernel";
import type { ImageParams } from "../../src/core/unified/vocabulary/image";
import type { ImageEditParams } from "../../src/core/unified/vocabulary/image-edit";
import type { VideoParams } from "../../src/core/unified/vocabulary/video";
import type { LipsyncParams } from "../../src/core/unified/vocabulary/lipsync";
import type { AvatarParams } from "../../src/core/unified/vocabulary/avatar";
import type { UpscaleParams } from "../../src/core/unified/vocabulary/upscale";
import type { ThreeDParams } from "../../src/core/unified/vocabulary/3d";
import type { TtsParams } from "../../src/core/unified/vocabulary/tts";
import type { SttParams } from "../../src/core/unified/vocabulary/stt";
import type { MusicParams } from "../../src/core/unified/vocabulary/music";
import type { SfxParams } from "../../src/core/unified/vocabulary/sfx";
import type { StsParams } from "../../src/core/unified/vocabulary/sts";
import type { VoiceCloneParams } from "../../src/core/unified/vocabulary/voice-clone";
import type { VoiceDesignParams } from "../../src/core/unified/vocabulary/voice-design";
import { expectTrue, type IsNever } from "./helpers";

/**
 * Every key any arm declares.
 *
 * Plain `keyof` on a union yields only the *shared* keys, which would quietly
 * excuse exactly the fields these vocabularies express as XOR arms
 * (`size` / `aspectRatio` / `dimensions`). Distributing first is what makes
 * the comparison total.
 */
type AllKeys<T> = T extends unknown ? Extract<keyof T, string> : never;

/**
 * The categories, written once rather than twice.
 *
 * `UnifiedCategory` itself would be the obvious constraint and is deliberately
 * not used: this file exists to catch a list and a type drifting apart, and
 * constraining it by the very union the list is keyed on would let a category
 * added to one and forgotten in the other pass silently. Spelled out here, a
 * new category is a compile error in this file until someone writes its two
 * assertions below.
 */
type Category =
  | "image"
  | "imageEdit"
  | "video"
  | "lipsync"
  | "avatar"
  | "upscale"
  | "3d"
  | "tts"
  | "stt"
  | "music"
  | "sfx"
  | "sts"
  | "voiceClone"
  | "voiceDesign";

/** Vocabulary keys the kernel's list does not accept: a valid request refused. */
type Unlisted<
  C extends Category,
  P,
> =
  Exclude<AllKeys<P>, CanonicalKeyOf<C>>;

/** List keys no vocabulary declares: a param accepted that nothing compiles. */
type Unclaimed<
  C extends Category,
  P,
> =
  Exclude<CanonicalKeyOf<C>, AllKeys<P>>;

expectTrue<IsNever<Unlisted<"image", ImageParams>>>();
expectTrue<IsNever<Unclaimed<"image", ImageParams>>>();

expectTrue<IsNever<Unlisted<"imageEdit", ImageEditParams>>>();
expectTrue<IsNever<Unclaimed<"imageEdit", ImageEditParams>>>();

expectTrue<IsNever<Unlisted<"video", VideoParams>>>();
expectTrue<IsNever<Unclaimed<"video", VideoParams>>>();

/**
 * The two performance categories, and the one asymmetry worth reading.
 *
 * `LipsyncParams.source` is REQUIRED and `AvatarParams.image` is OPTIONAL, and
 * both are in their category's key list all the same — the list answers "may a
 * caller write this key", not "must they". Which of the two an avatar model
 * requires is a per-model fact `AvatarModelNarrowing` states, and a key list
 * cannot express a per-model requirement without becoming a second copy of the
 * rows.
 */
expectTrue<IsNever<Unlisted<"lipsync", LipsyncParams>>>();
expectTrue<IsNever<Unclaimed<"lipsync", LipsyncParams>>>();

expectTrue<IsNever<Unlisted<"avatar", AvatarParams>>>();
expectTrue<IsNever<Unclaimed<"avatar", AvatarParams>>>();

/**
 * `upscale` shares `source` with lipsync and nothing else — no `audio`, no
 * `seed` — and adds `factor`, which appears in no other category's list. That
 * is what a category being genuinely its own looks like from here.
 */
expectTrue<IsNever<Unlisted<"upscale", UpscaleParams>>>();
expectTrue<IsNever<Unclaimed<"upscale", UpscaleParams>>>();

/**
 * `3d` is the first category whose two content words are ALTERNATIVES, and this
 * pair is where that shows up as a type fact rather than a claim: `prompt` and
 * `image` are BOTH optional on `ThreeDParams` and both in the key list, because
 * the list answers "may a caller write this key" and which one a given model
 * REQUIRES is what `ThreeDModelNarrowing` states per row. A key list that tried
 * to express the requirement would be a second copy of the rows.
 *
 * Note what is absent from both sides: every sizing word, `n`, and `format`.
 */
expectTrue<IsNever<Unlisted<"3d", ThreeDParams>>>();
expectTrue<IsNever<Unclaimed<"3d", ThreeDParams>>>();

expectTrue<IsNever<Unlisted<"tts", TtsParams>>>();
expectTrue<IsNever<Unclaimed<"tts", TtsParams>>>();

expectTrue<IsNever<Unlisted<"stt", SttParams>>>();
expectTrue<IsNever<Unclaimed<"stt", SttParams>>>();

expectTrue<IsNever<Unlisted<"music", MusicParams>>>();
expectTrue<IsNever<Unclaimed<"music", MusicParams>>>();

/**
 * `sfx`'s list is a strict SUBSET of `music`'s, and that is the shape of two
 * categories that split on the wire rather than on taste: the words music has
 * and sound effects do not (`instrumental`, `seed`) are meaningless for a door
 * creak, and the one they share by name — `durationSeconds` — means seconds
 * here and compiles to milliseconds there.
 *
 * `durationSeconds` and `outputFormat` are both OPTIONAL on `SfxParams` and
 * both in the key list, for the reason the `3d` note above gives: the list
 * answers "may a caller write this key", and which model REQUIRES a length is
 * what `SfxModelNarrowing` states per row. `loop` is in neither, because it has
 * one vendor witness of five.
 */
expectTrue<IsNever<Unlisted<"sfx", SfxParams>>>();
expectTrue<IsNever<Unclaimed<"sfx", SfxParams>>>();

/**
 * `sts` is the only category where MOST of the list is required — `model`,
 * `audio` and `voice` all are — and the list says nothing about that, for the
 * reason the `3d` and `sfx` notes above give: it answers "may a caller write
 * this key". What it does say is that `voice` is a word here and `text` is not,
 * which is the whole difference between this category and `tts`.
 */
expectTrue<IsNever<Unlisted<"sts", StsParams>>>();
expectTrue<IsNever<Unclaimed<"sts", StsParams>>>();

expectTrue<IsNever<Unlisted<"voiceClone", VoiceCloneParams>>>();
expectTrue<IsNever<Unclaimed<"voiceClone", VoiceCloneParams>>>();

expectTrue<IsNever<Unlisted<"voiceDesign", VoiceDesignParams>>>();
expectTrue<IsNever<Unclaimed<"voiceDesign", VoiceDesignParams>>>();
