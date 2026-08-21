/**
 * Type-level tests for the kling provider. NOT run by `bun test` — this file
 * is only type-checked (`bun run check` / tsc --noEmit). Kling ships no
 * official JS SDK, so these tests exercise the curated preset unions on the
 * wire params: each one is autocomplete over the documented value space that
 * the per-model rule tables (`V1_MODEL_RULES`, the route `RouteRules`) narrow
 * further at runtime.
 */
import {
  video,
  videoFromImage,
  videoV3,
  videoV3FromImage,
  videoOmni,
  image,
  imageOmni,
} from "../../src/providers/kling";
import type {
  TextToVideoArm,
  TextToVideoModelId,
  TextToVideoParams,
} from "../../src/providers/kling/video";
import type {
  ImageToVideoArm,
  ImageToVideoParams,
} from "../../src/providers/kling/video-from-image";
import { video as klingVideoAdapter } from "../../src/providers/kling/unified-video";
import { V1_MODE_TIERS } from "../../src/providers/kling/v1-routes";
import type { KlingAspectRatio } from "../../src/providers/kling/shared";
import { expectAssignable, expectTrue, type IsNever } from "./helpers";

function v1DurationTypeTests(): void {
  // `duration` is seconds as a STRING on /v1/videos/*; the union is the widest
  // documented range (kling-v3's 3–15s).
  const v = video({ model_name: "kling-v3", prompt: "hi", duration: "5" });
  expectAssignable<{ prompt?: string }>(v);
  video({ model_name: "kling-v3", prompt: "hi", duration: "12" });
  // @ts-expect-error "" is not a documented duration (was a bare `string`)
  video({ model_name: "kling-v3", prompt: "hi", duration: "" });
  // @ts-expect-error 3–15 is the documented range; "16" is off the end
  video({ model_name: "kling-v3", prompt: "hi", duration: "16" });
  // @ts-expect-error this route takes seconds as a string, not a number
  video({ model_name: "kling-v3", prompt: "hi", duration: 5 });

  videoFromImage({ model_name: "kling-v3", image: "https://e.com/a.png", duration: "3" });
  videoFromImage({ model_name: "kling-v3", image: "https://e.com/a.png", duration: "15" });
  // @ts-expect-error banana is not a duration (was a bare `string`)
  videoFromImage({ model_name: "kling-v3", image: "https://e.com/a.png", duration: "banana" });

  // Model ids keep their escape hatch: unknown ids stay legal and warn at runtime.
  video({ model_name: "kling-v9", prompt: "hi", duration: "5" });
}

function pathRouteSettingsTypeTests(): void {
  // resolution / duration / audio are unions over the documented spaces; the
  // route rule tables reject what a given model does not offer at runtime.
  const v = videoV3({
    model: "kling-3.0",
    prompt: "hi",
    settings: { resolution: "1080p", duration: 10, audio: "native", aspect_ratio: "16:9" },
  });
  expectAssignable<{ prompt: string }>(v);
  videoV3({ model: "kling-3.0", prompt: "hi", settings: { resolution: "4k", duration: 15 } });
  // @ts-expect-error "" is not a resolution (was a bare `string`)
  videoV3({ model: "kling-3.0", prompt: "hi", settings: { resolution: "" } });
  // @ts-expect-error 2k is not a Kling video tier — the tiers are 720p/1080p/4k
  videoV3({ model: "kling-3.0", prompt: "hi", settings: { resolution: "2k" } });
  // @ts-expect-error banana is not an audio mode (was a bare `string`)
  videoV3({ model: "kling-3.0", prompt: "hi", settings: { audio: "banana" } });
  // @ts-expect-error 3–15 seconds is the documented range
  videoV3({ model: "kling-3.0", prompt: "hi", settings: { duration: 20 } });

  const frame = { type: "first_frame", url: "https://e.com/a.png" } as const;
  videoV3FromImage({ model: "kling-3.0", contents: [frame], settings: { resolution: "720p" } });
  videoV3FromImage({ model: "kling-2.6", contents: [frame], settings: { audio: "off", duration: 10 } });
  // @ts-expect-error "" is not a resolution (was a bare `string`)
  videoV3FromImage({ model: "kling-3.0", contents: [frame], settings: { resolution: "" } });
  // @ts-expect-error banana is not an audio mode (was a bare `string`)
  videoV3FromImage({ model: "kling-3.0", contents: [frame], settings: { audio: "banana" } });

  const prompt = { type: "prompt", text: "hi" } as const;
  // "original" — keep the input video's audio — exists only on this route.
  videoOmni({ model: "kling-3.0-omni", contents: [prompt], settings: { audio: "original" } });
  videoOmni({ model: "kling-o1", contents: [prompt], settings: { resolution: "1080p", duration: 8 } });
  // @ts-expect-error banana is not an audio mode (was a bare `string`)
  videoOmni({ model: "kling-3.0-omni", contents: [prompt], settings: { audio: "banana" } });
  // @ts-expect-error "" is not a resolution (was a bare `string`)
  videoOmni({ model: "kling-3.0-omni", contents: [prompt], settings: { resolution: "" } });
  // @ts-expect-error 3–15 seconds is the documented range
  videoOmni({ model: "kling-3.0-omni", contents: [prompt], settings: { duration: 0 } });
}

function imageRouteTypeTests(): void {
  const v = image({ model_name: "kling-v2-1", prompt: "hi", resolution: "1k" });
  expectAssignable<{ prompt: string }>(v);
  image({ model_name: "kling-v2-1", prompt: "hi", resolution: "2k" });
  // @ts-expect-error "" is not a resolution (was a bare `string`)
  image({ model_name: "kling-v2-1", prompt: "hi", resolution: "" });
  // @ts-expect-error the 4K tier belongs to the omni-image route
  image({ model_name: "kling-v2-1", prompt: "hi", resolution: "4k" });

  imageOmni({ prompt: "hi", resolution: "2k" });
  imageOmni({ model_name: "kling-v3-omni", prompt: "hi", resolution: "4k" });
  // @ts-expect-error banana is not a resolution (was a bare `string`)
  imageOmni({ prompt: "hi", resolution: "banana" });
}

// ---------------------------------------------------------------------------
// kling.video / kling.videoFromImage: the wire arm is per model, and it AGREES
// with the unified table
//
// This is the drift test in type space. `kling.video` accepted
// `duration: "8"` on `kling-v2-5-turbo` while `unmodel/video` — the surface
// that compiles down to it — refused the same fact, because two tables in the
// same package described the same nine models and nothing compared them. They
// are one table now (`V1_MODEL_RULES`, read by both `./video.ts` and
// `./unified-video.ts`), and the assertions below fail in BOTH directions if
// that ever stops being true.
// ---------------------------------------------------------------------------

/** Mutual assignability: a widening on either side fails, not just a narrowing. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

type UnifiedVideoRows = (typeof klingVideoAdapter)["modelParams"];

/** The seven text2video ids all have a unified row (the other six are elsewhere). */
expectTrue<IsNever<Exclude<TextToVideoModelId, keyof UnifiedVideoRows>>>();

/** `"5"` → `5`: the two surfaces spell the same seconds differently. */
type WireDuration<M extends TextToVideoModelId> = NonNullable<TextToVideoArm<M>["duration"]>;
type WireMode<M extends TextToVideoModelId> = NonNullable<TextToVideoArm<M>["mode"]>;

/** Per model, the wire field's value space vs the unified row's list. */
type Drifted<M extends TextToVideoModelId> =
  Same<WireDuration<M>, `${UnifiedVideoRows[M]["durations"][number]}`> extends true
    ? Same<
        (typeof V1_MODE_TIERS)[WireMode<M> & keyof typeof V1_MODE_TIERS],
        UnifiedVideoRows[M]["resolutions"][number]
      > extends true
      ? never
      : M
    : M;

expectTrue<IsNever<{ [M in TextToVideoModelId]: Drifted<M> }[TextToVideoModelId]>>();

/**
 * The three capability switches, the other way round: a key the unified row
 * declares as an extra is a key the wire arm types, and a key it does not
 * declare is one the wire arm types `never` (or, for `sound`, `"off"` — the
 * value that is still legal because the run-time check only refuses switching
 * it ON).
 */
type SwitchDrifted<M extends TextToVideoModelId> =
  Same<
    "cfg_scale" extends keyof UnifiedVideoRows[M]["extras"] ? true : false,
    IsNever<NonNullable<TextToVideoArm<M>["cfg_scale"]>> extends true ? false : true
  > extends true
    ? Same<
        "camera_control" extends keyof UnifiedVideoRows[M]["extras"] ? true : false,
        IsNever<NonNullable<TextToVideoArm<M>["camera_control"]>> extends true ? false : true
      > extends true
      ? Same<
          "sound" extends keyof UnifiedVideoRows[M]["extras"] ? true : false,
          Same<NonNullable<TextToVideoArm<M>["sound"]>, "on" | "off">
        > extends true
        ? never
        : M
      : M
    : M;

expectTrue<IsNever<{ [M in TextToVideoModelId]: SwitchDrifted<M> }[TextToVideoModelId]>>();

/**
 * `aspect_ratio` is NOT narrowed, and that is asserted rather than left to
 * chance: no source bounds it per `model_name`, so every model keeps the full
 * three-value enum. (The unified row's `ratios: []` on `kling-v2-1` /
 * `kling-v1-5` is route membership — neither id has a text2video arm at all.)
 */
expectTrue<Same<NonNullable<TextToVideoArm<"kling-v2-master">["aspect_ratio"]>, KlingAspectRatio>>();
expectTrue<Same<NonNullable<TextToVideoArm<"kling-v3">["aspect_ratio"]>, KlingAspectRatio>>();

/**
 * The degraded arms are the WIDE body itself — not a union of the seven arms,
 * which is what a distributive conditional would have produced for the omitted
 * `model_name` case, and which would have made `duration:` complete the
 * intersection of seven lists instead of the documented range.
 */
expectTrue<Same<TextToVideoArm<string>, TextToVideoParams>>();
expectTrue<Same<TextToVideoArm<"kling-v9">, TextToVideoParams>>();
expectTrue<Same<ImageToVideoArm<string>, ImageToVideoParams>>();
expectTrue<Same<NonNullable<TextToVideoArm<string>["mode"]>, "std" | "pro" | "4k">>();
expectTrue<Same<NonNullable<TextToVideoArm<string>["sound"]>, "on" | "off">>();
expectTrue<Same<NonNullable<ImageToVideoArm<string>["mode"]>, "std" | "pro" | "4k">>();

function v1PerModelArmTypeTests(): void {
  // --- The calls the wire used to accept while the unified layer refused them
  // @ts-expect-error kling-v2-5-turbo offers "5" and "10"
  video({ model_name: "kling-v2-5-turbo", prompt: "hi", duration: "8" });
  // @ts-expect-error kling-v2-6's range is 3–10s
  video({ model_name: "kling-v2-6", prompt: "hi", duration: "12" });
  // @ts-expect-error the master models are 1080P-only ("pro")
  video({ model_name: "kling-v2-master", prompt: "hi", mode: "std" });
  // @ts-expect-error 4K is kling-v3's alone on this family
  video({ model_name: "kling-v2-6", prompt: "hi", mode: "4k" });
  // @ts-expect-error native audio is kling-v3 / kling-v2-6 only
  video({ model_name: "kling-v2-5-turbo", prompt: "hi", sound: "on" });
  // @ts-expect-error cfg_scale is kling-v1 / -v1-5 / -v1-6 only
  video({ model_name: "kling-v2-6", prompt: "hi", cfg_scale: 0.5 });
  // @ts-expect-error camera control is kling-v1 alone — not kling-v1-6
  video({ model_name: "kling-v1-6", prompt: "hi", camera_control: { type: "down_back" } });
  // @ts-expect-error multi-shot is kling-v3's alone
  video({ model_name: "kling-v2-6", prompt: "hi", multi_shot: true });
  // @ts-expect-error the image route narrows the same six fields
  videoFromImage({ model_name: "kling-v2-1", image: "https://e.com/a.png", duration: "3" });
  // @ts-expect-error kling-v1-5 has no camera control either
  videoFromImage({ model_name: "kling-v1-5", image: "https://e.com/a.png", camera_control: {} });

  // --- …and the same facts, each on the model that DOES document them
  video({ model_name: "kling-v3", prompt: "hi", duration: "8", mode: "4k", sound: "on" });
  video({ model_name: "kling-v3", prompt: "hi", multi_shot: true, shot_type: "intelligence" });
  video({ model_name: "kling-v2-6", prompt: "hi", duration: "3", mode: "pro", sound: "on" });
  video({ model_name: "kling-v2-master", prompt: "hi", mode: "pro", duration: "10" });
  video({ model_name: "kling-v1", prompt: "hi", cfg_scale: 0.5, camera_control: { type: "down_back" } });
  video({ model_name: "kling-v1-6", prompt: "hi", cfg_scale: 0.5 });
  videoFromImage({ model_name: "kling-v2-1", image: "https://e.com/a.png", duration: "5", mode: "pro" });
  videoFromImage({ model_name: "kling-v1-5", image: "https://e.com/a.png", cfg_scale: 0.2 });

  // Switching a capability OFF stays legal everywhere: the run-time check only
  // refuses turning it on, and the type may not be stricter than the check.
  video({ model_name: "kling-v2-5-turbo", prompt: "hi", sound: "off", multi_shot: false });

  // --- The degraded arms: every documented value still compiles ------------
  // An omitted `model_name` (the server default is kling-v1, but nothing in the
  // request says so, so nothing is narrowed).
  video({ prompt: "hi", duration: "12", mode: "4k", sound: "on", cfg_scale: 0.5 });
  // A run-time id.
  const runtime: string = "kling-v3";
  video({ model_name: runtime, prompt: "hi", duration: "12", mode: "4k", cfg_scale: 0.5 });
  // A post-snapshot id.
  video({ model_name: "kling-v9", prompt: "hi", duration: "12", mode: "4k", sound: "on" });
  videoFromImage({ model_name: "kling-v9", image: "https://e.com/a.png", duration: "15", mode: "4k" });

  // --- `Validated<T, …>` inference is undamaged ---------------------------
  const v = video({ model_name: "kling-v3", prompt: "hi", duration: "8", mode: "pro" });
  // `model_name` is a BODY field on this route: nothing is stripped, and every
  // key survives at its literal type.
  expectAssignable<"kling-v3">(v.model_name);
  expectAssignable<"8">(v.duration);
  expectAssignable<"pro">(v.mode);
  expectAssignable<string>(v.request.url);
  expectAssignable<"POST">(v.request.method);
  expectAssignable<{ model_name: "kling-v3"; duration: "8" }>(v.toSdk("kling"));
  // @ts-expect-error "kling" is this endpoint's only SDK target
  v.toSdk("ai-sdk");

  const safe = video.safe({ model_name: "kling-v1", prompt: "hi", cfg_scale: 0.25 });
  if (safe.ok) {
    expectAssignable<"kling-v1">(safe.params.model_name);
    expectAssignable<number>(safe.params.cfg_scale);
  }

  // ExactKeys still guards the per-model arm: a typo'd key is a compile error,
  // not a silent unknown_param warning.
  video({
    model_name: "kling-v3",
    prompt: "hi",
    // @ts-expect-error excess (typo'd) top-level key — the ExactKeys guard
    negativePrompt: "rain",
  });
}

export {
  v1DurationTypeTests,
  pathRouteSettingsTypeTests,
  imageRouteTypeTests,
  v1PerModelArmTypeTests,
};
