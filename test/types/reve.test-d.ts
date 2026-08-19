/**
 * Type-level tests for the reve provider. NOT run by `bun test` — this file is
 * only type-checked (`bun run check` / tsc --noEmit). Reve documents two
 * CLOSED aspect-ratio spaces (the v1 legacy subset and the full v2 set
 * including `auto`) plus a closed `async.image_format` list, so none of those
 * params carries a `(string & {})` tail: a non-member is a hard
 * `invalid_enum_value` at runtime, and these tests pin that it is a compile
 * error first.
 */
import { create, edit, remix, createV2 } from "../../src/providers/reve";
import { expectAssignable } from "./helpers";

declare const base64Png: string;

function v1AspectRatioTypeTests(): void {
  const v = create({ prompt: "a serene mountain landscape", aspect_ratio: "16:9" });
  expectAssignable<"16:9">(v.aspect_ratio);
  create({ prompt: "hi", aspect_ratio: "9:16" });

  edit({ edit_instruction: "make the sky stormy", reference_image: base64Png, aspect_ratio: "3:2" });
  edit({ edit_instruction: "hi", reference_image: base64Png, aspect_ratio: "1:1" });

  remix({ prompt: "hi", reference_images: [base64Png], aspect_ratio: "4:3" });
  remix({ prompt: "hi", reference_images: [base64Png], aspect_ratio: "2:3" });

  // @ts-expect-error the v1 routes accept only the legacy subset — 21:9 is v2-only
  create({ prompt: "hi", aspect_ratio: "21:9" });
  // @ts-expect-error `auto` is v2-only too
  create({ prompt: "hi", aspect_ratio: "auto" });
  // @ts-expect-error the empty string is not a ratio
  edit({ edit_instruction: "hi", reference_image: base64Png, aspect_ratio: "" });
  // @ts-expect-error junk no longer compiles on remix either
  remix({ prompt: "hi", reference_images: [base64Png], aspect_ratio: "banana" });
}

function v2TypeTests(): void {
  const v = createV2({ prompt: "hi", aspect_ratio: "21:9" });
  expectAssignable<"21:9">(v.aspect_ratio);
  // `auto` is the v2 default and a real member of the union.
  createV2({ prompt: "hi", aspect_ratio: "auto" });

  createV2({ prompt: "hi", async: { image_format: "image/png" } });
  createV2({ prompt: "hi", async: { image_format: "application/json" } });

  // @ts-expect-error the v2 set is CLOSED — 5:1 is not one of the 18 values
  createV2({ prompt: "hi", aspect_ratio: "5:1" });
  // @ts-expect-error the empty string is not a ratio
  createV2({ prompt: "hi", aspect_ratio: "" });
  // @ts-expect-error async.image_format is CLOSED — there is no image/gif arm
  createV2({ prompt: "hi", async: { image_format: "image/gif" } });
  // @ts-expect-error the empty string is not a media type
  createV2({ prompt: "hi", async: { image_format: "" } });
}

export { v1AspectRatioTypeTests, v2TypeTests };
