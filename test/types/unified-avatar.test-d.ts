/**
 * Type-level tests for `unmodel/avatar`'s ready-made pack. NOT run by
 * `bun test` — this file is only type-checked (`bun run check` / tsc --noEmit).
 *
 * The lipsync file's twin, and the assertion that earns its keep is the one
 * lipsync cannot make: `image` is REQUIRED at six of the eight endpoints,
 * `never` at the two whose performer is a catalogued id, and wide-and-optional
 * for a ref this build cannot read. Three arms, three messages, one row field.
 */
import { avatar, createAvatar } from "../../src/unified/avatar";
import { avatar as falAvatar } from "../../src/providers/fal/unified-avatar";
import { avatar as heygenAvatar } from "../../src/providers/heygen/unified-avatar";
import { avatar as syncAvatar } from "../../src/providers/sync/unified-avatar";
import { avatar as veedAvatar } from "../../src/providers/veed/unified-avatar";
import type { UnifiedRef } from "../../src/core/unified/types";
import type { AvatarParams } from "../../src/core/unified/vocabulary/avatar";
import { expectAssignable, expectTrue, type IsNever, type KeyIn } from "./helpers";

type PackRefs = UnifiedRef<
  typeof falAvatar | typeof heygenAvatar | typeof syncAvatar | typeof veedAvatar
>;

expectAssignable<PackRefs>("fal/fal-ai/sync-lipsync/v3/image-to-video");
expectAssignable<PackRefs>("fal/fal-ai/bytedance/omnihuman/v1.5");
expectAssignable<PackRefs>("fal/fal-ai/kling-video/ai-avatar/v2/standard");
expectAssignable<PackRefs>("fal/fal-ai/kling-video/ai-avatar/v2/pro");
expectAssignable<PackRefs>("fal/veed/avatars/audio-to-video");
expectAssignable<PackRefs>("fal/argil/avatars/audio-to-video");
expectAssignable<PackRefs>("fal/fal-ai/longcat-single-avatar/image-audio-to-video");
expectAssignable<PackRefs>("fal/fal-ai/echomimic-v3");
// @ts-expect-error — the clip-driven arm of the same product is `unmodel/lipsync`.
expectAssignable<PackRefs>("fal/fal-ai/sync-lipsync/v3");

// The native half — one model, and it is the SAME id `unmodel/lipsync` serves.
// Only the category and the input tell the two calls apart.
expectAssignable<PackRefs>("sync/sync-3");
// @ts-expect-error — the other four sync. models take a clip and refuse a still.
expectAssignable<PackRefs>("sync/lipsync-2");
// @ts-expect-error — react-1 is the expressive model and still reads no image.
expectAssignable<PackRefs>("sync/react-1");

// VEED's still-driven model. Its clip-driven one is `unmodel/lipsync`, and its
// PRESENTER library has no native endpoint at all — that product is reachable
// only through fal, which is why `fal/veed/avatars/audio-to-video` is above and
// `veed/avatars` is not a ref anywhere.
expectAssignable<PackRefs>("veed/fabric-1.0");
// @ts-expect-error — the clip route is the other category.
expectAssignable<PackRefs>("veed/lipsync-2.0");
// @ts-expect-error — VEED's presenter library is a fal-only product.
expectAssignable<PackRefs>("veed/avatars");

// HeyGen's two image-capable engines. Avatar III is in the catalog and at the
// wire address and NOT here: its own engine config says it does not render raw
// image input, and this adapter compiles the raw-image arm.
expectAssignable<PackRefs>("heygen/avatar_iv");
expectAssignable<PackRefs>("heygen/avatar_v");
// @ts-expect-error — "Not supported for raw image input (type: \"image\")".
expectAssignable<PackRefs>("heygen/avatar_iii");
// @ts-expect-error — the lipsync modes are the other category.
expectAssignable<PackRefs>("heygen/lipsync-speed");

const URL_IMAGE = { url: "https://example.com/headshot.png" } as const;
const URL_AUDIO = { url: "https://example.com/vo.wav" } as const;

function refUnionTests(): void {
  avatar({ model: "fal/fal-ai/sync-lipsync/v3/image-to-video", image: URL_IMAGE, audio: URL_AUDIO });
  avatar({ model: "fal/fal-ai/bytedance/omnihuman/v1.5", image: URL_IMAGE, audio: URL_AUDIO });
  // A model newer than this snapshot still works, with a runtime warning.
  avatar({ model: "fal/fal-ai/omnihuman/v2", image: URL_IMAGE, audio: URL_AUDIO });
  // A provider with no adapter is a runtime structural error, not a type error.
  avatar({ model: "topaz/Standard V2", image: URL_IMAGE, audio: URL_AUDIO });

  // @ts-expect-error — `audio` is not optional; there is nothing to speak.
  avatar({ model: "fal/fal-ai/sync-lipsync/v3/image-to-video", image: URL_IMAGE });
  // @ts-expect-error — a typo'd canonical field is caught by ExactKeys.
  avatar({ model: "fal/fal-ai/sync-lipsync/v3/image-to-video", imgae: URL_IMAGE, audio: URL_AUDIO });
  // @ts-expect-error — `source` is the lipsync word; this category spells it `image`.
  avatar({ model: "fal/fal-ai/sync-lipsync/v3/image-to-video", source: URL_IMAGE, audio: URL_AUDIO });
}

/**
 * The three arms of `AvatarModelNarrowing`, which is the whole reason this
 * category narrows a field the vocabulary declares OPTIONAL.
 *
 * Required, forbidden and wide are three different answers, and the middle one
 * is not hypothetical: `veed/avatars/audio-to-video` and
 * `argil/avatars/audio-to-video` animate a catalogued presenter out of a closed
 * enum and have no image field at all.
 */
function imageArmTests(): void {
  // Required — six of the eight.
  avatar({ model: "fal/fal-ai/kling-video/ai-avatar/v2/pro", image: URL_IMAGE, audio: URL_AUDIO });
  // @ts-expect-error — …and omitting it is a compile error, not a 422.
  avatar({ model: "fal/fal-ai/kling-video/ai-avatar/v2/pro", audio: URL_AUDIO });

  // Forbidden — the two preset-performer routes.
  avatar({ model: "fal/veed/avatars/audio-to-video", audio: URL_AUDIO });
  avatar({ model: "fal/argil/avatars/audio-to-video", audio: URL_AUDIO });
  // @ts-expect-error — there is nowhere on VEED's wire to put a face.
  avatar({ model: "fal/veed/avatars/audio-to-video", image: URL_IMAGE, audio: URL_AUDIO });

  // Required at VEED too — and VEED is the one route in the category that also
  // demands a word the vocabulary has not got. `resolution` is in
  // `FabricInput.required` with no default, so it rides as a per-model extra.
  avatar({ model: "veed/fabric-1.0", image: URL_IMAGE, audio: URL_AUDIO, resolution: "720p" });
  avatar({
    model: "veed/fabric-1.0",
    image: URL_IMAGE,
    audio: URL_AUDIO,
    // @ts-expect-error — VEED's two resolutions are a closed enum, and a 2× price fork.
    resolution: "1080p",
  });

  // HeyGen's per-engine extras are disjoint, in both directions.
  avatar({ model: "heygen/avatar_iv", image: URL_IMAGE, audio: URL_AUDIO, expressiveness: "high" });
  avatar({
    model: "heygen/avatar_v",
    image: URL_IMAGE,
    audio: URL_AUDIO,
    reference_look_id: "look_abc",
  });
  // @ts-expect-error — `expressiveness` is REJECTED on Avatar V, not ignored.
  avatar({ model: "heygen/avatar_v", image: URL_IMAGE, audio: URL_AUDIO, expressiveness: "high" });
  // @ts-expect-error — `reference_look_id` lives inside Avatar V's own engine config.
  avatar({ model: "heygen/avatar_iv", image: URL_IMAGE, audio: URL_AUDIO, reference_look_id: "x" });

  // The inline arm carries its media type, for `LipsyncVideoSource`'s reason.
  avatar({
    model: "fal/fal-ai/echomimic-v3",
    image: { data: "AAAA", mimeType: "image/png" },
    audio: URL_AUDIO,
    prompt: "a woman speaking to camera",
  });
  avatar({
    model: "fal/fal-ai/echomimic-v3",
    // @ts-expect-error — a clip is not a still, and this category takes stills.
    image: { data: "AAAA", mimeType: "video/mp4" },
    audio: URL_AUDIO,
    prompt: "a woman speaking to camera",
  });
}

function resultTypeTests(): void {
  const result = avatar({
    model: "fal/fal-ai/sync-lipsync/v3/image-to-video",
    image: URL_IMAGE,
    audio: URL_AUDIO,
  });
  expectAssignable<string | undefined>(result.image_url);
  expectAssignable<string | undefined>(result.audio_url);
  expectAssignable<string>(result.request.url);
  result.toSdk("fal");
  expectTrue<IsNever<KeyIn<typeof result, "endpoint">>>();
  expectAssignable<readonly { code: string }[]>(result.warnings);
}

function providerOptionsTests(): void {
  // The presenter enum, reached the way a per-model extra with a 28-value
  // vocabulary should be: through the escape hatch, still validated by fal's
  // own IR on the way out.
  avatar({
    model: "fal/veed/avatars/audio-to-video",
    audio: URL_AUDIO,
    providerOptions: { fal: { avatar_id: "emily_primary" } },
  });
  avatar({
    model: "fal/argil/avatars/audio-to-video",
    audio: URL_AUDIO,
    // @ts-expect-error — not for a provider this pack does not have.
    providerOptions: { topaz: {} },
  });

  const one = createAvatar([falAvatar]);
  one({ model: "fal/fal-ai/echomimic-v3", image: URL_IMAGE, audio: URL_AUDIO, providerOptions: { fal: {} } });
}

function noToApiTests(): void {
  const result = avatar({
    model: "fal/fal-ai/sync-lipsync/v3/image-to-video",
    image: URL_IMAGE,
    audio: URL_AUDIO,
  });
  expectTrue<IsNever<KeyIn<typeof result, "toApi">>>();
  expectTrue<IsNever<KeyIn<typeof result, "toApiSafe">>>();
  expectTrue<KeyIn<typeof result, "toSdk"> extends "toSdk" ? true : false>();
  expectTrue<KeyIn<typeof result, "request"> extends "request" ? true : false>();
}

/**
 * Per-model extras, and `prompt` among them — the finding this category records
 * rather than papering over.
 *
 * Three of the eight rows have no prompt field, `fal-ai/echomimic-v3` REQUIRES
 * one, and the two Kling rows default theirs to `"."`. A word whose meaning
 * ranges from mandatory to meaningless across a single provider's own roster is
 * not canonical yet, so it arrives here typed from each endpoint's own wire
 * interface.
 */
function extrasNarrowingTests(): void {
  avatar({
    model: "fal/fal-ai/bytedance/omnihuman/v1.5",
    image: URL_IMAGE,
    audio: URL_AUDIO,
    prompt: "she turns to the window",
    resolution: "1080p",
    turbo_mode: true,
  });
  avatar({
    model: "fal/fal-ai/sync-lipsync/v3/image-to-video",
    image: URL_IMAGE,
    audio: URL_AUDIO,
    // @ts-expect-error — sync.'s image route declares nothing but the two media fields.
    prompt: "she turns to the window",
  });
  avatar({
    model: "fal/fal-ai/bytedance/omnihuman/v1.5",
    image: URL_IMAGE,
    audio: URL_AUDIO,
    // @ts-expect-error — 720p and 1080p are the two OmniHuman offers.
    resolution: "4k",
  });
  avatar({
    model: "fal/fal-ai/longcat-single-avatar/image-audio-to-video",
    image: URL_IMAGE,
    audio: URL_AUDIO,
    num_inference_steps: 40,
    audio_guidance_scale: 5,
  });
  avatar({
    model: "fal/fal-ai/echomimic-v3",
    image: URL_IMAGE,
    audio: URL_AUDIO,
    // @ts-expect-error — LongCat's knob, on LongCat's row.
    num_inference_steps: 40,
    prompt: "hi",
  });
}

/** A dynamic or unknown ref degrades to the wide vocabulary, never to `never`. */
function degradedRefTests(): void {
  const dynamic: string = process.env["MODEL"] ?? "fal/fal-ai/echomimic-v3";
  // Degraded, `image` is OPTIONAL — the type cannot say whether this route
  // takes a still, so it must neither require nor refuse one.
  avatar({ model: dynamic, audio: URL_AUDIO });
  avatar({ model: dynamic, image: URL_IMAGE, audio: URL_AUDIO });
  avatar({ model: "fal/fal-ai/omnihuman/v9", image: URL_IMAGE, audio: URL_AUDIO, turbo_mode: true });
  // @ts-expect-error — …and a typo is still caught by `ExactKeys`.
  avatar({ model: "fal/fal-ai/omnihuman/v9", image: URL_IMAGE, audio: URL_AUDIO, turbo_moad: true });
}

expectAssignable<"avatar">(falAvatar.category);
expectAssignable<"fal">(falAvatar.provider);
expectAssignable<readonly string[]>(falAvatar.models);
expectAssignable<AvatarParams["model"]>("fal/fal-ai/echomimic-v3");

export {
  refUnionTests,
  imageArmTests,
  resultTypeTests,
  providerOptionsTests,
  noToApiTests,
  extrasNarrowingTests,
  degradedRefTests,
};
