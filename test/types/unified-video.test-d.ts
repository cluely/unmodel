/**
 * Type-level tests for `unmodel/video`'s ready-made pack. NOT run by
 * `bun test` — this file is only type-checked (`bun run check` / tsc --noEmit).
 *
 * The runtime suites next door prove what a call *does*; these prove what an
 * editor knows before the call is made:
 *
 *  1. **The ref union comes from the ten adapters' `as const` model arrays.**
 *     `"kling/kling-v3"` and `"kling/kling-3.0"` are both in it — two route
 *     families, one provider, one union — while `"kling/kling-4.0"` is not,
 *     and is still *callable*, because a model released after this snapshot
 *     must not need a library upgrade.
 *  2. **The input types carry the route derivation.** `image` is one tagged
 *     object or an array of them, `role` is a closed three-value union, and a
 *     media reference is a URL or bytes and never both halves of neither —
 *     which is what makes "the inputs pick the endpoint" a decision the type
 *     system can describe.
 *  3. **The result is the ref'd provider's own `Validated`**, including for the
 *     providers whose `compile` dispatches between routes — a union of route
 *     bodies, not one of them widened.
 *  4. **`providerOptions` is keyed by the providers in the pack.** A typo is a
 *     compile error rather than an override that silently never happens.
 *  5. **There is no `.toApi`.** Retargeting is a chat-dialect feature; a media
 *     result must not advertise one.
 */
import { createVideo, video } from "../../src/unified/video";
import { video as googleVideo } from "../../src/providers/google/unified-video";
import type { GoogleVeoInstance } from "../../src/providers/google/video";
import { video as klingVideo } from "../../src/providers/kling/unified-video";
import { video as lumaVideo } from "../../src/providers/luma/unified-video";
import { video as openaiVideo } from "../../src/providers/openai/unified-video";
import type { UnifiedRef } from "../../src/core/unified/types";
import type { ValidateResult } from "../../src/core/result";
import type {
  VideoImageInput,
  VideoImageRole,
  VideoInput,
  VideoParams,
} from "../../src/core/unified/vocabulary/video";
import {
  expectAssignable,
  expectNotNever,
  expectTrue,
  type IsNever,
  type KeyIn,
} from "./helpers";

// ---------------------------------------------------------------------------
// 1 · The ref union
// ---------------------------------------------------------------------------

type PackRefs = UnifiedRef<
  typeof openaiVideo | typeof googleVideo | typeof klingVideo | typeof lumaVideo
>;

expectAssignable<PackRefs>("openai/sora-2");
expectAssignable<PackRefs>("openai/sora-2-pro");
expectAssignable<PackRefs>("google/veo-3.1-generate-preview");
expectAssignable<PackRefs>("luma/ray-2");
// Both Kling route families are one provider, so both are in one union — the
// id spelling is what selects the family at runtime.
expectAssignable<PackRefs>("kling/kling-v3");
expectAssignable<PackRefs>("kling/kling-3.0");
expectAssignable<PackRefs>("kling/kling-3.0-omni");
// @ts-expect-error — a model no adapter declares is not in the union…
expectAssignable<PackRefs>("kling/kling-4.0");
// @ts-expect-error — …and neither is a provider from another category.
expectAssignable<PackRefs>("elevenlabs/eleven_v3");

function refUnionTests(): void {
  // The union drives autocomplete…
  video({ model: "openai/sora-2", prompt: "a drone shot over a fjord" });
  video({ model: "minimax/MiniMax-Hailuo-2.3", prompt: "hi" });
  video({ model: "bytedance/dreamina-seedance-2-0-260128", prompt: "hi" });
  // …but does not gate the call: a model newer than this snapshot still works
  // and draws a runtime `unknown_model` warning.
  video({ model: "openai/sora-3", prompt: "hi" });
  // A provider with no adapter is a runtime structural error, not a type error:
  // the ref tail is `(string & {})`, deliberately.
  video({ model: "elevenlabs/eleven_v3", prompt: "hi" });

  // `prompt` IS optional here, unlike `unmodel/image`: an image-to-video
  // request with no prompt is a legitimate request at four of the ten
  // providers, and the ones that require it say so at runtime.
  video({ model: "luma/ray-2", image: { url: "https://example.com/a.png" } });

  // @ts-expect-error — a typo'd canonical field is caught by ExactKeys.
  video({ model: "openai/sora-2", prompt: "hi", aspecRatio: "16:9" });
  // @ts-expect-error — `duration` is seconds, always a number, never the wire spelling.
  video({ model: "openai/sora-2", prompt: "hi", duration: "8" });
  // @ts-expect-error — `"1920x1080"` is a provider spelling; the vocabulary has tiers.
  video({ model: "openai/sora-2", prompt: "hi", resolution: "1920x1080" });
  // @ts-expect-error — and `"8k"` is not one of the five tiers.
  video({ model: "openai/sora-2", prompt: "hi", resolution: "8k" });

  // A field the provider does not support is a RUNTIME error (declared on the
  // adapter), never a compile error: the vocabulary is one shape for everyone.
  video({ model: "luma/ray-2", prompt: "hi", seed: 7 });
}

// ---------------------------------------------------------------------------
// 2 · The input types the route derivation reads
// ---------------------------------------------------------------------------

function routeInputTests(): void {
  const url = "https://example.com/frame.png";

  // One image, or several with distinct roles — the two spellings the route
  // derivation reads.
  video({ model: "kling/kling-v3", prompt: "hi", image: { url } });
  video({ model: "kling/kling-v3", prompt: "hi", image: [{ url }, { url, role: "last" }] });
  video({ model: "vidu/viduq3-turbo", prompt: "hi", image: [{ url, role: "reference" }] });
  // Inline bytes carry a media type, because half these providers need one to
  // build a `data:` URI and the other half take the bytes directly.
  video({ model: "google/veo-3.1-generate-preview", prompt: "hi", image: { data: "AAAA", mimeType: "image/png" } });
  // A source clip is the fourth route, and its reference is URL or bytes.
  video({ model: "runway/aleph2", prompt: "hi", video: { url: "https://example.com/a.mp4" } });
  video({ model: "runway/aleph2", prompt: "hi", video: { data: "AAAA" } });

  // @ts-expect-error — `role` is a closed union: there is no fourth job an image does.
  video({ model: "kling/kling-v3", prompt: "hi", image: { url, role: "middle" } });
  // @ts-expect-error — a reference is a URL or bytes, not a bare string.
  video({ model: "kling/kling-v3", prompt: "hi", image: url });
  // @ts-expect-error — inline bytes need a media type; half these providers
  // cannot build a `data:` URI without one.
  video({ model: "kling/kling-v3", prompt: "hi", image: { data: "AAAA" } });
}

/** The vocabulary's own shapes, independent of any pack. */
expectAssignable<VideoImageRole>("first");
expectAssignable<VideoImageRole>("last");
expectAssignable<VideoImageRole>("reference");
expectAssignable<VideoImageInput>({ url: "https://example.com/a.png" });
expectAssignable<VideoImageInput>({ data: "AAAA", mimeType: "image/png", role: "reference" });
expectAssignable<VideoInput>({ url: "https://example.com/a.mp4" });
expectAssignable<VideoInput>({ data: "AAAA" });
// @ts-expect-error — a clip is the subject of the request, not a keyframe, so
// `video` has no `role` to disambiguate.
expectAssignable<VideoInput>({ url: "https://example.com/a.mp4", role: "first" });
expectAssignable<VideoParams>({ model: "luma/ray-2", prompt: "hi", duration: 5 });
expectAssignable<VideoParams["image"]>([{ url: "https://example.com/a.png", role: "first" }]);

// ---------------------------------------------------------------------------
// 3 · The result is the ref'd provider's own
// ---------------------------------------------------------------------------

function resultTypeTests(): void {
  const openai = video({ model: "openai/sora-2", prompt: "hi" });
  expectAssignable<string>(openai.prompt);
  expectAssignable<string>(openai.request.url);
  openai.toSdk("openai");
  // @ts-expect-error — "google" is not one of openai.video's SDK targets.
  openai.toSdk("google");

  const google = video({ model: "google/veo-3.1-generate-preview", prompt: "hi" });
  // Veo's body nests the prompt in an instance and strips the model into the URL.
  expectAssignable<GoogleVeoInstance[]>(google.instances);
  expectTrue<IsNever<KeyIn<typeof google, "prompt">>>();
  google.toSdk("google");

  // Warnings ride on every result, whichever provider — and whichever route —
  // answered.
  expectAssignable<readonly { code: string }[]>(openai.warnings);
  expectAssignable<readonly { code: string }[]>(google.warnings);
  const kling = video({ model: "kling/kling-3.0-omni", prompt: "hi" });
  expectAssignable<readonly { code: string }[]>(kling.warnings);
}

// ---------------------------------------------------------------------------
// 4 · providerOptions is keyed by the pack
// ---------------------------------------------------------------------------

function providerOptionsTests(): void {
  // One literal may carry blocks for every provider it might be pointed at.
  video({
    model: "openai/sora-2",
    prompt: "hi",
    providerOptions: {
      openai: { input_reference: { file_id: "file_123" } },
      luma: { loop: true },
    },
  });
  // @ts-expect-error — but not for a provider this pack does not have.
  video({ model: "openai/sora-2", prompt: "hi", providerOptions: { opneai: { seconds: "8" } } });
  // @ts-expect-error — nor for one that is simply not a video provider.
  video({ model: "openai/sora-2", prompt: "hi", providerOptions: { elevenlabs: { text: "x" } } });

  // A hand-built pack narrows the key set to exactly its own adapters.
  const pair = createVideo([openaiVideo, lumaVideo]);
  pair({ model: "openai/sora-2", prompt: "hi", providerOptions: { openai: {} } });
  // @ts-expect-error — google is not in THIS pack, even though it is in the full one.
  pair({ model: "openai/sora-2", prompt: "hi", providerOptions: { google: {} } });
  // @ts-expect-error — and its ref union is narrower too.
  expectAssignable<UnifiedRef<typeof openaiVideo | typeof lumaVideo>>("google/veo-3.1-generate-preview");
}

// ---------------------------------------------------------------------------
// 5 · Per-model narrowing: duration, resolution, aspectRatio and the extras
// ---------------------------------------------------------------------------

/**
 * The half `test/unified/completions.test.ts` cannot assert.
 *
 * The language service **does** offer number-literal completions at a
 * `duration:` position (measured; the entries come back as `"4"`, `"8"`, …
 * mixed into the global identifier list any expression position carries), so
 * that file checks the list is a superset of the model's lengths and excludes
 * their neighbours. What it cannot check is the *other* direction — a
 * completion list is a suggestion, and only a compile error is a limit. That is
 * this block.
 */
function durationNarrowingTests(): void {
  video({ model: "openai/sora-2", prompt: "hi", duration: 8 });
  // @ts-expect-error — Sora's five lengths are a closed enum; 7 is not one.
  video({ model: "openai/sora-2", prompt: "hi", duration: 7 });
  // @ts-expect-error — nor is a value that is legal one provider over.
  video({ model: "luma/ray-2", prompt: "hi", duration: 8 });
  video({ model: "luma/ray-2", prompt: "hi", duration: 9 });

  // A model whose lengths are a *range* keeps the wide `number` — a `>=` check
  // is not a union, and the endpoint's own bounds answer at run time.
  video({ model: "bytedance/seedance-1-0-pro-250528", prompt: "hi", duration: 7 });
  // Including the documented `-1` sentinel ("the model picks the length").
  video({ model: "bytedance/dreamina-seedance-2-5-260628", prompt: "hi", duration: -1 });

  // `runway/aleph2` has no duration parameter at all — the output follows the
  // input clip — so `durations: []` makes it `never`.
  // @ts-expect-error
  video({ model: "runway/aleph2", video: { url: "https://e.com/a.mp4" }, duration: 5 });
}

function sizeNarrowingTests(): void {
  video({ model: "openai/sora-2", prompt: "hi", resolution: "720p" });
  // @ts-expect-error — 1080p is `sora-2-pro`'s ("use sora-2-pro for higher-resolution exports").
  video({ model: "openai/sora-2", prompt: "hi", resolution: "1080p" });
  video({ model: "openai/sora-2-pro", prompt: "hi", resolution: "1080p" });
  // @ts-expect-error — 1440p is on no Sora model.
  video({ model: "openai/sora-2-pro", prompt: "hi", resolution: "1440p" });
  // @ts-expect-error — Veo 2 denies `parameters.resolution` outright.
  video({ model: "google/veo-2.0-generate-001", prompt: "hi", resolution: "720p" });

  video({ model: "kling/kling-v3", prompt: "hi", aspectRatio: "16:9" });
  // @ts-expect-error — Kling's three shapes do not include 4:3.
  video({ model: "kling/kling-v3", prompt: "hi", aspectRatio: "4:3" });
  // @ts-expect-error — and an image-only id has no aspect-ratio field at all.
  video({ model: "kling/kling-v2-1", prompt: "hi", aspectRatio: "16:9" });
  // @ts-expect-error — same for every Hailuo model on /v1/video_generation.
  video({ model: "minimax/MiniMax-Hailuo-02", prompt: "hi", aspectRatio: "16:9" });
  // `MiniMax-H3` is the v2 route, which does have `ratio`.
  video({ model: "minimax/MiniMax-H3", prompt: "hi", aspectRatio: "21:9", duration: 6, resolution: "720p" });

  // Runway's `ratio` members are pixel pairs, and the shapes they reduce to are
  // what a caller writes — including the ones no other provider has.
  video({ model: "runway/gen4.5", prompt: "hi", aspectRatio: "69:52" });
  // @ts-expect-error — but not a shape that pair list has no entry for.
  video({ model: "runway/gen4.5", prompt: "hi", aspectRatio: "21:9" });
}

function extrasNarrowingTests(): void {
  video({ model: "kling/kling-v1-6", prompt: "hi", cfg_scale: 0.5 });
  // @ts-expect-error — `cfg_scale` is kling-v1 / -v1-5 / -v1-6 only.
  video({ model: "kling/kling-v3", prompt: "hi", cfg_scale: 0.5 });
  // @ts-expect-error — and `camera_control` is `kling-v1` alone.
  video({ model: "kling/kling-v1-6", prompt: "hi", camera_control: { type: "simple" } });
  video({ model: "kling/kling-v1", prompt: "hi", camera_control: { type: "simple" } });

  video({ model: "kling/kling-v3", prompt: "hi", sound: "on" });
  // @ts-expect-error — an extra's own values are narrowed too.
  video({ model: "kling/kling-v3", prompt: "hi", sound: "loud" });
  // The path-addressed family spells it `settings.audio`, with a per-model set.
  video({ model: "kling/kling-3.0-omni", prompt: "hi", audio: "original" });
  // @ts-expect-error — `kling-3.0` has no "original".
  video({ model: "kling/kling-3.0", prompt: "hi", audio: "original" });
  // @ts-expect-error — and the turbo rows have no `audio` at all.
  video({ model: "kling/kling-3.0-turbo", prompt: "hi", audio: "native" });

  video({ model: "google/veo-3.1-generate-preview", prompt: "hi", personGeneration: "allow_adult" });
  // @ts-expect-error — `dont_allow` is Veo 2's, and only Veo 2's.
  video({ model: "google/veo-3.1-generate-preview", prompt: "hi", personGeneration: "dont_allow" });
  video({ model: "google/veo-2.0-generate-001", prompt: "hi", personGeneration: "dont_allow" });

  video({ model: "lightricks/ltx-2-5-fast", prompt: "hi", fps: 48 });
  // @ts-expect-error — ltx-2-5-pro's matrix has no 48.
  video({ model: "lightricks/ltx-2-5-pro", prompt: "hi", fps: 48 });
  video({ model: "lightricks/ltx-2-5-pro", prompt: "hi", fps: 50 });

  video({ model: "bytedance/seedance-1-0-pro-250528", prompt: "hi", frames: 49 });
  // @ts-expect-error — `frames` is the Seedance 1.0 pros'; the 2.x arms deny it.
  video({ model: "bytedance/dreamina-seedance-2-0-260128", prompt: "hi", frames: 49 });
  // @ts-expect-error — and `generate_audio` is the other way round.
  video({ model: "bytedance/seedance-1-0-pro-250528", prompt: "hi", generate_audio: true });
  video({ model: "bytedance/dreamina-seedance-2-0-260128", prompt: "hi", generate_audio: true });

  // @ts-expect-error — a key no model on the ref'd provider takes is a typo.
  video({ model: "luma/ray-2", prompt: "hi", lop: true });
  video({ model: "luma/ray-2", prompt: "hi", loop: true });
}

/**
 * A ref the type system cannot resolve — built at run time, or naming a model
 * newer than this snapshot — degrades to the wide vocabulary rather than to
 * `never`. Same trade every model list in this library makes.
 */
function degradedRefTests(): void {
  const dynamic: string = process.env["MODEL"] ?? "openai/sora-2";
  video({ model: dynamic, prompt: "hi", duration: 7, resolution: "1440p", aspectRatio: "5:4" });
  video({ model: "openai/sora-9", prompt: "hi", duration: 7, resolution: "1440p" });
  // The extras degrade to "every name in the build, typed `unknown`" — so a
  // real extra still compiles…
  video({ model: "openai/sora-9", prompt: "hi", loop: true });
  // @ts-expect-error — …and a typo is still caught by `ExactKeys`.
  video({ model: "openai/sora-9", prompt: "hi", lop: true });
}

/** `duration` on a dynamic ref is the wide `number`, not a literal union. */
function degradedDurationType(): void {
  const dynamic: string = process.env["MODEL"] ?? "openai/sora-2";
  const seconds: number = 7;
  video({ model: dynamic, prompt: "hi", duration: seconds });
}

// ---------------------------------------------------------------------------
// 6 · No retargeting on a media result
// ---------------------------------------------------------------------------

function noToApiTests(): void {
  const result = video({ model: "openai/sora-2", prompt: "hi" });
  expectTrue<IsNever<KeyIn<typeof result, "toApi">>>();
  expectTrue<IsNever<KeyIn<typeof result, "toApiSafe">>>();
  // The members that DO exist, for contrast.
  expectTrue<KeyIn<typeof result, "toSdk"> extends "toSdk" ? true : false>();
  expectTrue<KeyIn<typeof result, "request"> extends "request" ? true : false>();
}

// ---------------------------------------------------------------------------
// The adapters satisfy the category contract
// ---------------------------------------------------------------------------

expectAssignable<"video">(openaiVideo.category);
expectAssignable<"openai">(openaiVideo.provider);
expectAssignable<readonly string[]>(openaiVideo.models);
expectAssignable<"video">(klingVideo.category);
expectAssignable<readonly string[]>(googleVideo.models);

/**
 * Branching between two requests at the unified layer — the second half of the
 * recipe in `docs/validation.md`.
 *
 * `UnifiedResult` keys off the PROVIDER segment of the ref, so two arms on the
 * same provider already produce one result type and a ternary of two `safe()`
 * calls needs nothing. It is the CROSS-provider ternary that has two result
 * types, and there the hoist is the answer — the same one the substrate uses,
 * for the same reason: one call, one inference candidate.
 */
declare const wantsAtlas: boolean;

function crossProviderBranchTypeTests(): void {
  const atlas = {
    model: "atlascloud/bytedance/seedance-2.5/text-to-video",
    prompt: "a fox in the snow",
  } as const;
  const sora = { model: "openai/sora-2", prompt: "a fox in the snow" } as const;

  // Same provider, two arms: one result type already, so even a naked `<T>`
  // consumer infers. No hoist needed.
  const sameProvider = unwrap(
    wantsAtlas
      ? video.safe(atlas)
      : video.safe({
          model: "atlascloud/bytedance/seedance-2.5/image-to-video",
          prompt: "a fox in the snow",
          image: { url: "https://example.com/fox.png" },
        }),
  );
  expectNotNever<typeof sameProvider>();

  // Cross-provider, HOISTED: one call, and the generic consumer infers.
  const hoisted = unwrap(video.safe(wantsAtlas ? atlas : sora));
  expectNotNever<typeof hoisted>();

  // @ts-expect-error — cross-provider ternary of two CALLS: two result types,
  // and TypeScript never unions two covariant candidates for a naked `<T>`.
  // Not a variance defect — `Validated` is covariant; type the consumer
  // parameter concretely (`ValidateResult<{ request: RequestMeta }>`) or hoist.
  unwrap(wantsAtlas ? video.safe(atlas) : video.safe(sora));
}

/** The generic consumer shape from the adopter report, verbatim. */
function unwrap<T>(result: ValidateResult<T>): T | undefined {
  return result.ok ? result.params : undefined;
}

export {
  crossProviderBranchTypeTests,
  refUnionTests,
  routeInputTests,
  resultTypeTests,
  providerOptionsTests,
  durationNarrowingTests,
  sizeNarrowingTests,
  extrasNarrowingTests,
  degradedRefTests,
  degradedDurationType,
  noToApiTests,
};
