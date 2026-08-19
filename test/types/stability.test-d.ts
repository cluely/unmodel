/**
 * Type-level tests for the stability provider. NOT run by `bun test` — this
 * file is only type-checked (`bun run check` / tsc --noEmit). Stability has
 * no official JS SDK, so these tests exercise the per-route field surfaces
 * and the ExactKeys typo guard.
 */
import {
  image,
  imageCore,
  imageSd3,
  toFormData,
} from "../../src/providers/stability";
import { expectAssignable } from "./helpers";

declare const imageBlob: Blob;

function ultraTypeTests(): void {
  const v = image({
    prompt: "a lighthouse at dawn",
    negative_prompt: "fog",
    aspect_ratio: "16:9",
    seed: 7,
    output_format: "webp",
    style_preset: "photographic",
    image: imageBlob,
    strength: 0.6,
  });
  expectAssignable<{ prompt: string }>(v);
  expectAssignable<FormData>(toFormData(v));

  // @ts-expect-error ExactKeys rejects typo'd keys
  image({ prompt: "hi", negativeprompt: "fog" });
  // @ts-expect-error style presets are a closed enum
  image({ prompt: "hi", style_preset: "pixelart" });
  // @ts-expect-error image must be a Blob (binary multipart part), not a URL string
  image({ prompt: "hi", image: "https://example.com/a.png", strength: 0.5 });
}

function coreTypeTests(): void {
  const v = imageCore({
    prompt: "hi",
    aspect_ratio: "21:9",
    style_preset: "pixel-art",
    seed: 1,
    output_format: "png",
  });
  expectAssignable<FormData>(toFormData(v));

  // @ts-expect-error core has no image field (text-to-image only)
  imageCore({ prompt: "hi", image: imageBlob });
  // @ts-expect-error core has no strength field
  imageCore({ prompt: "hi", strength: 0.5 });
}

function sd3TypeTests(): void {
  const v = imageSd3({
    prompt: "hi",
    mode: "image-to-image",
    image: imageBlob,
    strength: 0.7,
    model: "sd3.5-flash",
    seed: 42,
    output_format: "jpeg",
    style_preset: "anime",
    negative_prompt: "blurry",
    cfg_scale: 4,
  });
  expectAssignable<{ prompt: string }>(v);
  expectAssignable<FormData>(toFormData(v));

  // Unknown model ids stay assignable (string & {}) — validated at runtime.
  imageSd3({ prompt: "hi", model: "sd4-large" });

  // @ts-expect-error mode is a closed enum
  imageSd3({ prompt: "hi", mode: "img2img" });
  // @ts-expect-error ExactKeys rejects typo'd keys
  imageSd3({ prompt: "hi", modle: "sd3.5-flash" });
}

export { ultraTypeTests, coreTypeTests, sd3TypeTests };
