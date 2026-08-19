/**
 * Type-level tests for the bytedance (BytePlus ModelArk) provider. NOT run by
 * `bun test` — this file is only type-checked (`bun run check` / tsc
 * --noEmit). BytePlus ships no official JS SDK, so these tests exercise the
 * Tier-A per-model arms and the `size` rule space.
 */
import { imageGenerations } from "../../src/providers/bytedance";
import { expectAssignable } from "./helpers";

function imageGenerationsSizeTypeTests(): void {
  // Resolution keywords autocomplete, and they are per model at runtime.
  const v = imageGenerations({ model: "seedream-4-0-250828", prompt: "hi", size: "2K" });
  expectAssignable<string>(JSON.stringify(v));
  imageGenerations({ model: "seedream-5-0-260128", prompt: "hi", size: "3K" });
  imageGenerations({ model: "dola-seedream-5-0-pro-260628", prompt: "hi", size: "1.5K" });
  // "auto" is layer decomposition only — legal in the union, narrowed at runtime.
  imageGenerations({
    model: "dola-seedream-5-0-pro-260628",
    image: "https://example.com/a.png",
    layer_decomposition: true,
    size: "auto",
  });

  // Explicit "<width>x<height>" stays free-form: checkSize bounds it by the
  // model's total-pixel range and the [1/16, 16] aspect range, not by a list.
  imageGenerations({ model: "seedream-4-0-250828", prompt: "hi", size: "2048x2048" });
  imageGenerations({ model: "seedream-4-0-250828", prompt: "hi", size: "1920x1080" });

  // @ts-expect-error — "*" is not the wire separator; sizes are "<w>x<h>"
  imageGenerations({ model: "seedream-4-0-250828", prompt: "hi", size: "2048*2048" });
  // @ts-expect-error — non-size strings are compile errors (was a bare `string`)
  imageGenerations({ model: "seedream-4-0-250828", prompt: "hi", size: "" });
  // @ts-expect-error — no model documents an "8K" keyword
  imageGenerations({ model: "seedream-4-0-250828", prompt: "hi", size: "banana" });
  // @ts-expect-error — aspect-ratio strings are not the size wire format
  imageGenerations({ model: "seedream-5-0-lite-260128", prompt: "hi", size: "16:9" });
}

function imageGenerationsArmTypeTests(): void {
  // Seedream 5.0 pro: layer decomposition + transparent backgrounds, no batch.
  imageGenerations({
    model: "dola-seedream-5-0-pro-260628",
    image: "https://example.com/a.png",
    layer_decomposition: true,
    output_format: "png",
    background: "transparent",
  });
  // @ts-expect-error — batch generation is Seedream 5.0 lite / 4.5 / 4.0 only
  imageGenerations({ model: "dola-seedream-5-0-pro-260628", prompt: "hi", stream: true });
  // @ts-expect-error — layer decomposition is a Seedream 5.0 pro capability
  imageGenerations({ model: "seedream-4-0-250828", prompt: "hi", layer_decomposition: true });

  // Unknown ids (new releases, `ep-…` endpoint ids) fall into the loose arm,
  // where `size` is unconstrained because the model's table is unknown.
  imageGenerations({ model: "ep-20260101-abcdef", prompt: "hi", size: "whatever" });
}

export { imageGenerationsSizeTypeTests, imageGenerationsArmTypeTests };
