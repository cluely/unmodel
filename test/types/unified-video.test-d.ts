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
import { video as klingVideo } from "../../src/providers/kling/unified-video";
import { video as lumaVideo } from "../../src/providers/luma/unified-video";
import { video as openaiVideo } from "../../src/providers/openai/unified-video";
import type { UnifiedRef } from "../../src/core/unified/types";
import type {
  VideoImageInput,
  VideoImageRole,
  VideoInput,
  VideoParams,
} from "../../src/core/unified/vocabulary/video";
import { expectAssignable, expectTrue, type IsNever, type KeyIn } from "./helpers";

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
  expectAssignable<Record<string, unknown>[]>(google.instances);
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
// 5 · No retargeting on a media result
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

export { refUnionTests, routeInputTests, resultTypeTests, providerOptionsTests, noToApiTests };
