/**
 * Type-level tests for the bria provider. NOT run by `bun test` — this file is
 * only type-checked (`bun run check` / tsc --noEmit). `aspect_ratio`,
 * `resolution` and `output_type` are CLOSED enums in the bundled OpenAPI the
 * docs site serves (https://docs.bria.ai/_bundle/image-generation.yaml), so
 * none of them carries a `(string & {})` tail: a non-member is a hard
 * `invalid_enum_value`, and these tests pin that it is a compile error first.
 */
import { imageGenerate, imageGenerateLite, imageEdit } from "../../src/providers/bria";
import { expectAssignable } from "./helpers";

function generateEnumTypeTests(): void {
  const v = imageGenerate({
    prompt: "a photorealistic rendering of balloon lettering on a white backdrop",
    aspect_ratio: "16:9",
    resolution: "4MP",
    output_type: "png",
  });
  expectAssignable<"16:9">(v.aspect_ratio);
  expectAssignable<"4MP">(v.resolution);
  expectAssignable<"png">(v.output_type);

  imageGenerate({ prompt: "hi", aspect_ratio: "4:5", resolution: "1MP", output_type: "jpeg" });
  imageGenerateLite({ prompt: "hi", aspect_ratio: "9:16", output_type: "jpeg" });

  // @ts-expect-error aspect_ratio is CLOSED — 21:9 is not one of the 9 values
  imageGenerate({ prompt: "hi", aspect_ratio: "21:9" });
  // @ts-expect-error the empty string is not a ratio
  imageGenerateLite({ prompt: "hi", aspect_ratio: "" });
  // @ts-expect-error resolution is CLOSED — 1MP | 4MP
  imageGenerate({ prompt: "hi", resolution: "2MP" });
  // @ts-expect-error the empty string is not a resolution
  imageGenerate({ prompt: "hi", resolution: "" });
  // @ts-expect-error output_type is CLOSED — png | jpeg, no webp
  imageGenerate({ prompt: "hi", output_type: "webp" });
  // @ts-expect-error the empty string is not an output type
  imageGenerate({ prompt: "hi", output_type: "" });

  // model_version keeps its escape hatch — model ids stay open on purpose.
  imageGenerate({ prompt: "hi", model_version: "FIBO-next" });
}

function editEnumTypeTests(): void {
  // output_type lives on BriaCommonParams, so the edit route shares the fix.
  imageEdit({ images: ["https://example.com/p.png"], instruction: "hi", output_type: "png" });
  imageEdit({ images: ["https://example.com/p.png"], instruction: "hi", output_type: "jpeg" });

  // @ts-expect-error output_type is CLOSED on every v2 image route
  imageEdit({ images: ["https://example.com/p.png"], instruction: "hi", output_type: "webp" });
  // @ts-expect-error the empty string is not an output type
  imageEdit({ images: ["https://example.com/p.png"], instruction: "hi", output_type: "" });
}

export { generateEnumTypeTests, editEnumTypeTests };
