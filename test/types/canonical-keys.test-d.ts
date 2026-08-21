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
import type { TtsParams } from "../../src/core/unified/vocabulary/tts";
import type { SttParams } from "../../src/core/unified/vocabulary/stt";
import type { MusicParams } from "../../src/core/unified/vocabulary/music";
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

/** Vocabulary keys the kernel's list does not accept: a valid request refused. */
type Unlisted<C extends "image" | "imageEdit" | "video" | "tts" | "stt" | "music", P> =
  Exclude<AllKeys<P>, CanonicalKeyOf<C>>;

/** List keys no vocabulary declares: a param accepted that nothing compiles. */
type Unclaimed<C extends "image" | "imageEdit" | "video" | "tts" | "stt" | "music", P> =
  Exclude<CanonicalKeyOf<C>, AllKeys<P>>;

expectTrue<IsNever<Unlisted<"image", ImageParams>>>();
expectTrue<IsNever<Unclaimed<"image", ImageParams>>>();

expectTrue<IsNever<Unlisted<"imageEdit", ImageEditParams>>>();
expectTrue<IsNever<Unclaimed<"imageEdit", ImageEditParams>>>();

expectTrue<IsNever<Unlisted<"video", VideoParams>>>();
expectTrue<IsNever<Unclaimed<"video", VideoParams>>>();

expectTrue<IsNever<Unlisted<"tts", TtsParams>>>();
expectTrue<IsNever<Unclaimed<"tts", TtsParams>>>();

expectTrue<IsNever<Unlisted<"stt", SttParams>>>();
expectTrue<IsNever<Unclaimed<"stt", SttParams>>>();

expectTrue<IsNever<Unlisted<"music", MusicParams>>>();
expectTrue<IsNever<Unclaimed<"music", MusicParams>>>();
