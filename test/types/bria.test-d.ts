/**
 * Type-level tests for the bria provider. NOT run by `bun test` — this file is
 * only type-checked (`bun run check` / tsc --noEmit). `aspect_ratio`,
 * `resolution` and `output_type` are CLOSED enums in the bundled OpenAPI the
 * docs site serves (https://docs.bria.ai/_bundle/image-generation.yaml), so
 * none of them carries a `(string & {})` tail: a non-member is a hard
 * `invalid_enum_value`, and these tests pin that it is a compile error first.
 */
import { image, imageLite, imageEdit } from "../../src/providers/bria";
import { expectAssignable } from "./helpers";

function generateEnumTypeTests(): void {
  const v = image({
    prompt: "a photorealistic rendering of balloon lettering on a white backdrop",
    aspect_ratio: "16:9",
    resolution: "4MP",
    output_type: "png",
  });
  expectAssignable<"16:9">(v.aspect_ratio);
  expectAssignable<"4MP">(v.resolution);
  expectAssignable<"png">(v.output_type);

  image({ prompt: "hi", aspect_ratio: "4:5", resolution: "1MP", output_type: "jpeg" });
  imageLite({ prompt: "hi", aspect_ratio: "9:16", output_type: "jpeg" });

  // The full route takes Fibo 2's 21 ratios; lite takes nine of them.
  image({ prompt: "hi", aspect_ratio: "21:9" });
  image({ prompt: "hi", aspect_ratio: "1:5" });
  // @ts-expect-error aspect_ratio is CLOSED — 7:3 is not one of the 21 values
  image({ prompt: "hi", aspect_ratio: "7:3" });
  // @ts-expect-error the lite route's enum is nine values — no 21:9
  imageLite({ prompt: "hi", aspect_ratio: "21:9" });
  // @ts-expect-error the empty string is not a ratio
  imageLite({ prompt: "hi", aspect_ratio: "" });
  // @ts-expect-error resolution is CLOSED — 1MP | 4MP
  image({ prompt: "hi", resolution: "2MP" });
  // @ts-expect-error the empty string is not a resolution
  image({ prompt: "hi", resolution: "" });
  // @ts-expect-error output_type is CLOSED — png | jpeg, no webp
  image({ prompt: "hi", output_type: "webp" });
  // @ts-expect-error the empty string is not an output type
  image({ prompt: "hi", output_type: "" });

  // style is CLOSED, and full-route only.
  image({ prompt: "hi", style: "kodak_film" });
  // @ts-expect-error style is CLOSED — kodak_film | hard_flash | hazy_dreamy | rough_realism
  image({ prompt: "hi", style: "vintage" });
  // @ts-expect-error the lite route has no style
  imageLite({ prompt: "hi", style: "kodak_film" });

  // model_version keeps its escape hatch — model ids stay open on purpose.
  image({ prompt: "hi", model_version: "FIBO-next" });
}

function editEnumTypeTests(): void {
  // output_type lives on BriaCommonParams, so the edit route shares the fix.
  imageEdit({ images: ["https://example.com/p.png"], instruction: "hi", output_type: "png" });
  imageEdit({ images: ["https://example.com/p.png"], instruction: "hi", output_type: "jpeg" });

  // @ts-expect-error output_type is CLOSED on every v2 image route
  imageEdit({ images: ["https://example.com/p.png"], instruction: "hi", output_type: "webp" });
  // @ts-expect-error the empty string is not an output type
  imageEdit({ images: ["https://example.com/p.png"], instruction: "hi", output_type: "" });

  // aspect_ratio on the edit route is the same 21-value enum as generate.
  imageEdit({
    images: ["https://example.com/a.png", "https://example.com/b.png"],
    instruction: "hi",
    aspect_ratio: "21:9",
  });
  // @ts-expect-error aspect_ratio is CLOSED on the edit route too
  imageEdit({ images: ["https://example.com/p.png"], instruction: "hi", aspect_ratio: "7:3" });
}

export { generateEnumTypeTests, editEnumTypeTests };
