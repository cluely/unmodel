/**
 * Type-level tests for the bytedance (BytePlus ModelArk) provider. NOT run by
 * `bun test` — this file is only type-checked (`bun run check` / tsc
 * --noEmit). BytePlus ships no official JS SDK, so these tests exercise the
 * Tier-A per-model arms and the `size` rule space.
 */
import {
  image,
  video,
  type ContentGenerationTasksBody,
  type ImageGenerationsBody,
} from "../../src/providers/bytedance";
import { expectAssignable } from "./helpers";

function imageGenerationsSizeTypeTests(): void {
  // Resolution keywords autocomplete, and they are per model at runtime.
  const v = image({ model: "seedream-4-0-250828", prompt: "hi", size: "2K" });
  expectAssignable<string>(JSON.stringify(v));
  image({ model: "seedream-5-0-260128", prompt: "hi", size: "3K" });
  image({ model: "dola-seedream-5-0-pro-260628", prompt: "hi", size: "1.5K" });
  // "auto" is layer decomposition only — legal in the union, narrowed at runtime.
  image({
    model: "dola-seedream-5-0-pro-260628",
    image: "https://example.com/a.png",
    layer_decomposition: true,
    size: "auto",
  });

  // Explicit "<width>x<height>" stays free-form: checkSize bounds it by the
  // model's total-pixel range and the [1/16, 16] aspect range, not by a list.
  image({ model: "seedream-4-0-250828", prompt: "hi", size: "2048x2048" });
  image({ model: "seedream-4-0-250828", prompt: "hi", size: "1920x1080" });

  // @ts-expect-error — "*" is not the wire separator; sizes are "<w>x<h>"
  image({ model: "seedream-4-0-250828", prompt: "hi", size: "2048*2048" });
  // @ts-expect-error — non-size strings are compile errors (was a bare `string`)
  image({ model: "seedream-4-0-250828", prompt: "hi", size: "" });
  // @ts-expect-error — no model documents an "8K" keyword
  image({ model: "seedream-4-0-250828", prompt: "hi", size: "banana" });
  // @ts-expect-error — aspect-ratio strings are not the size wire format
  image({ model: "seedream-5-0-lite-260128", prompt: "hi", size: "16:9" });
}

function imageGenerationsArmTypeTests(): void {
  // Seedream 5.0 pro: layer decomposition + transparent backgrounds, no batch.
  image({
    model: "dola-seedream-5-0-pro-260628",
    image: "https://example.com/a.png",
    layer_decomposition: true,
    output_format: "png",
    background: "transparent",
  });
  // @ts-expect-error — batch generation is Seedream 5.0 lite / 4.5 / 4.0 only
  image({ model: "dola-seedream-5-0-pro-260628", prompt: "hi", stream: true });
  // @ts-expect-error — layer decomposition is a Seedream 5.0 pro capability
  image({ model: "seedream-4-0-250828", prompt: "hi", layer_decomposition: true });

  // Unknown ids (new releases, `ep-…` endpoint ids) fall into the loose arm,
  // where `size` is unconstrained because the model's table is unknown.
  image({ model: "ep-20260101-abcdef", prompt: "hi", size: "whatever" });

  // @ts-expect-error — a known discriminant cannot escape its exact arm after aliasing
  const aliasedInvalid: ImageGenerationsBody = {
    model: "dola-seedream-5-0-pro-260628",
    prompt: "hi",
    stream: true,
  };
  void aliasedInvalid;
  const future: ImageGenerationsBody<"ep-20260101-abcdef"> = {
    model: "ep-20260101-abcdef",
    prompt: "hi",
    future_image_control: true,
  };
  image(future);
}

function videoBodyAliasTypeTests(): void {
  // @ts-expect-error — Seedance 2.5 does not accept the 1.x-only seed field
  const aliasedInvalid: ContentGenerationTasksBody = {
    model: "dreamina-seedance-2-5-260628",
    content: [{ type: "text", text: "hi" }],
    seed: 1,
  };
  void aliasedInvalid;
  const future: ContentGenerationTasksBody<"ep-20260101-video"> = {
    model: "ep-20260101-video",
    content: [{ type: "text", text: "hi" }],
    future_video_control: true,
  };
  video(future);
}

export { imageGenerationsSizeTypeTests, imageGenerationsArmTypeTests, videoBodyAliasTypeTests };
