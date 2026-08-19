/**
 * Type-level tests for the ideogram provider (IMAGE GENERATION modality).
 * NOT run by `bun test` — this file is only type-checked (`bun run check` /
 * tsc --noEmit). Ideogram has no official JS SDK, so these tests pin the
 * `ExactKeys` public-cast contract of `ideogram.generate`: the excess-key
 * compile error, the `safe<T>` overload carrying the same guard, and the fact
 * that this multipart endpoint strips NOTHING from the params object (the
 * validated value feeds `toFormData()` verbatim).
 */
import { generate, toFormData } from "../../src/providers/ideogram";
import type { EndpointConstraints } from "../../src/core/constraint-types";
import { expectAssignable, expectTrue, type IsNever, type KeyIn } from "./helpers";

declare const referenceImage: Blob;

function generateTypeTests(): void {
  const v = generate({
    prompt: "an isometric cutaway of a lighthouse",
    aspect_ratio: "16x9",
    rendering_speed: "QUALITY",
    magic_prompt: "OFF",
    negative_prompt: "text, watermark",
    num_images: 2,
    seed: 7,
    style_type: "REALISTIC",
    style_preset: "80S_ILLUSTRATION",
    color_palette: { name: "EMBER" },
    style_reference_images: [referenceImage],
    enable_copyright_detection: null,
  });

  // Nothing is stripped: every form field survives on the validated value
  // with its literal type intact, and the value is the multipart source.
  expectAssignable<string>(v.prompt);
  expectAssignable<"16x9">(v.aspect_ratio);
  expectAssignable<"QUALITY">(v.rendering_speed);
  expectAssignable<Blob[]>(v.style_reference_images);
  expectAssignable<FormData>(toFormData(v));

  // POST /v1/ideogram-v3/generate has no `model` wire param at all — the
  // billable tier is `rendering_speed`. Assert the key is genuinely absent
  // from the body type rather than merely optional.
  expectTrue<IsNever<KeyIn<typeof v, "model">>>();

  // `.request` and `.toSdk("ideogram")` stay typed (headers are deliberately
  // empty so fetch derives the multipart boundary from the FormData body).
  expectAssignable<string>(v.request.url);
  expectAssignable<"POST">(v.request.method);
  expectAssignable<Record<string, string>>(v.request.headers);
  expectAssignable<{ prompt: string }>(v.toSdk("ideogram"));

  // @ts-expect-error — "ideogram" is this endpoint's only SDK target
  v.toSdk("openai");
  // @ts-expect-error — `.toSdk()` now requires a target
  v.toSdk();

  // Explicit members are the other half of the color_palette union.
  generate({
    prompt: "hi",
    color_palette: { members: [{ color_hex: "#FF0000", color_weight: 0.5 }] },
  });

  // safe() narrows to the same Validated shape and carries the same guard.
  const result = generate.safe({ prompt: "hi", rendering_speed: "TURBO" });
  if (result.ok) {
    expectAssignable<"TURBO">(result.params.rendering_speed);
    expectAssignable<FormData>(toFormData(result.params));
  }

  expectAssignable<EndpointConstraints[]>(generate.constraintsFor("ideogram-v3-quality"));

  // @ts-expect-error rendering_speed is a closed enum
  generate({ prompt: "hi", rendering_speed: "FASTEST" });
  // @ts-expect-error color_palette is name XOR members, never both
  generate({ prompt: "hi", color_palette: { name: "EMBER", members: [] } });

  // ExactKeys: a typo'd/excess top-level key is a COMPILE error, not a
  // silent unknown_param warning.
  generate({
    prompt: "hi",
    // @ts-expect-error excess (typo'd) top-level key — the ExactKeys guard
    aspect_ration: "16x9",
  });

  // The same guard is wired into the safe() overload.
  generate.safe({
    prompt: "hi",
    // @ts-expect-error excess (typo'd) top-level key — ExactKeys on safe()
    style_typ: "REALISTIC",
  });
}

export { generateTypeTests };
