/**
 * Type-level tests for the atlascloud (Atlas Cloud) provider. NOT run by
 * `bun test` — this file is only type-checked (`bun run check` / tsc
 * --noEmit). Atlas ships no typed client SDK, so these tests exercise the
 * per-model arms, which is where this provider's whole compile-time story is:
 * `model` names the ROUTE as well as the model, so the twenty-three ids are
 * twenty-three param surfaces rather than one narrowed twenty-three ways.
 */
import {
  video,
  type AtlasMediaRef,
  type GenerateVideoBody,
  type Seedance25ReferenceToVideoBody,
} from "../../src/providers/atlascloud";
import { expectAssignable } from "./helpers";

function routeIsTheModelTypeTests(): void {
  // The three Seedance 2.5 routes, each with the fields its own schema declares.
  const v = video({
    model: "bytedance/seedance-2.5/text-to-video",
    prompt: "a fox in the snow",
    duration: 12,
    resolution: "1080p-esr & 60fps",
    ratio: "21:9",
    output_format: "mov",
  });
  expectAssignable<string>(JSON.stringify(v));

  video({
    model: "bytedance/seedance-2.5/image-to-video",
    image: "https://example.com/a.png",
    last_image: "asset://01HZX9QK3M",
    ratio: "adaptive",
  });

  video({
    model: "bytedance/seedance-2.5/reference-to-video",
    reference_images: ["https://example.com/a.png"],
    reference_videos: ["https://example.com/c.mp4"],
    reference_audios: ["data:audio/mp3;base64,SUQz"],
    omni_reference_task_type: "edit",
    duration: -1,
    ratio: "adaptive",
  });

  // @ts-expect-error — `image` is a field of the /image-to-video route only
  video({ model: "bytedance/seedance-2.5/text-to-video", prompt: "hi", image: "https://x/a.png" });
  // @ts-expect-error — and the reference arrays belong to /reference-to-video
  video({ model: "bytedance/seedance-2.5/text-to-video", prompt: "hi", reference_images: [] });
  // @ts-expect-error — `image` is REQUIRED on the image route, not optional
  video({ model: "bytedance/seedance-2.5/image-to-video", prompt: "hi" });
  // @ts-expect-error — the 2.5 image route pins the shape to "adaptive"
  video({ model: "bytedance/seedance-2.5/image-to-video", image: "https://x/a.png", ratio: "16:9" });
}

function crossFamilyFieldTypeTests(): void {
  // Four families, four vocabularies, and the compiler keeps them apart.
  video({
    model: "bytedance/seedance-2.0/text-to-video",
    prompt: "hi",
    bitrate_mode: "high",
    seed: 7,
    resolution: "4k",
  });
  video({
    model: "bytedance/seedance-v1.5-pro/text-to-video",
    prompt: "hi",
    aspect_ratio: "21:9",
    camera_fixed: true,
  });
  video({ model: "alibaba/wan-3.0/text-to-video", prompt: "hi", audio: false, ratio: "16:9" });
  video({
    model: "google/veo3.1/text-to-video",
    prompt: "hi",
    negative_prompt: "blurry",
    aspect_ratio: "9:16",
    duration: 6,
  });

  // @ts-expect-error — Seedance 2.5 declares no `seed`
  video({ model: "bytedance/seedance-2.5/text-to-video", prompt: "hi", seed: 1 });
  // @ts-expect-error — `bitrate_mode` is the 2.0 series' alone
  video({ model: "bytedance/seedance-2.5/text-to-video", prompt: "hi", bitrate_mode: "high" });
  // @ts-expect-error — `output_format` is 2.5's alone
  video({ model: "bytedance/seedance-2.0/text-to-video", prompt: "hi", output_format: "mov" });
  // @ts-expect-error — Seedance 2.x spells the shape field `ratio`
  video({ model: "bytedance/seedance-2.0/text-to-video", prompt: "hi", aspect_ratio: "16:9" });
  // @ts-expect-error — …and v1.5 pro spells it `aspect_ratio`
  video({ model: "bytedance/seedance-v1.5-pro/text-to-video", prompt: "hi", ratio: "16:9" });
  // @ts-expect-error — Wan spells its audio toggle `audio`, not `generate_audio`
  video({ model: "alibaba/wan-3.0/text-to-video", prompt: "hi", generate_audio: false });
  // @ts-expect-error — …and the Seedance families spell it `generate_audio`
  video({ model: "bytedance/seedance-2.0/text-to-video", prompt: "hi", audio: false });
  // @ts-expect-error — `negative_prompt` is Veo 3.1's alone
  video({ model: "bytedance/seedance-2.5/text-to-video", prompt: "hi", negative_prompt: "x" });
  // @ts-expect-error — `camera_fixed` is Seedance v1.5 pro's alone
  video({ model: "google/veo3.1/text-to-video", prompt: "hi", camera_fixed: true });
  // @ts-expect-error — Wan's image route has no `ratio`: the first frame decides it
  video({ model: "alibaba/wan-3.0/image-to-video", prompt: "hi", image: "https://x/a.png", ratio: "16:9" });
  // @ts-expect-error — Veo's reference route declares no `aspect_ratio` property
  video({ model: "google/veo3.1/reference-to-video", prompt: "hi", images: ["u"], aspect_ratio: "16:9" });
}

function resolutionEnumTypeTests(): void {
  // The eleven-value ladder is per model, and the casings differ by family.
  video({ model: "bytedance/seedance-2.5/text-to-video", prompt: "hi", resolution: "4k-esr" });
  video({ model: "bytedance/seedance-2.0/text-to-video", prompt: "hi", resolution: "1440p-SR" });
  video({ model: "alibaba/wan-3.0-prime/text-to-video", prompt: "hi", resolution: "1080P" });
  video({ model: "alibaba/wan-3.0/text-to-video", prompt: "hi", resolution: "1080p" });

  // @ts-expect-error — 2.5 spells the upscaler suffix lower-case
  video({ model: "bytedance/seedance-2.5/text-to-video", prompt: "hi", resolution: "1440p-SR" });
  // @ts-expect-error — native 4k is the full 2.0 model's alone
  video({ model: "bytedance/seedance-2.0-mini/text-to-video", prompt: "hi", resolution: "4k" });
  // @ts-expect-error — Wan 3.0-prime is UPPER-case; plain Wan 3.0 is not
  video({ model: "alibaba/wan-3.0-prime/text-to-video", prompt: "hi", resolution: "1080p" });
  // @ts-expect-error — the v1.5-pro fast pair renders 720p only
  video({ model: "bytedance/seedance-v1.5-pro/text-to-video-fast", prompt: "hi", resolution: "480p" });
}

function mediaRefTypeTests(): void {
  // The three documented forms, and the open tail that keeps bare Base64 legal.
  expectAssignable<AtlasMediaRef>("https://example.com/a.png");
  expectAssignable<AtlasMediaRef>("data:image/png;base64,iVBORw0KGgo=");
  expectAssignable<AtlasMediaRef>("asset://01HZX9QK3M");
  expectAssignable<AtlasMediaRef>("iVBORw0KGgo=");
}

function videoBodyAliasTypeTests(): void {
  const reference: Seedance25ReferenceToVideoBody = {
    model: "bytedance/seedance-2.5/reference-to-video",
    reference_images: ["https://example.com/a.png"],
    duration: -1,
  };
  expectAssignable<GenerateVideoBody>(reference);

  // @ts-expect-error — a known discriminant cannot escape its arm after aliasing
  const aliasedInvalid: GenerateVideoBody = {
    model: "bytedance/seedance-2.5/text-to-video",
    prompt: "hi",
    seed: 1,
  };
  void aliasedInvalid;

  // An id Atlas adds after this snapshot opts into the loose arm by name.
  const future: GenerateVideoBody<"kwaivgi/kling-v3.0-pro/text-to-video"> = {
    model: "kwaivgi/kling-v3.0-pro/text-to-video",
    prompt: "hi",
    future_atlas_control: true,
  };
  video(future);
}

export {
  routeIsTheModelTypeTests,
  crossFamilyFieldTypeTests,
  resolutionEnumTypeTests,
  mediaRefTypeTests,
  videoBodyAliasTypeTests,
};
