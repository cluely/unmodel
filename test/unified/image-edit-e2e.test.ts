/**
 * `unmodel/image-edit`, end to end through the ready-made pack.
 *
 * The golden matrix next door pins *what* each provider compiles to and the
 * capability table pins *which* fields it can express; this pins what a caller
 * gets back — the provider's own `Validated`, its `.request`, its `.toSdk(…)`
 * and its estimate — plus the three things this category has that the others do
 * not:
 *
 * 1. a **required** wire field the canonical vocabulary makes optional
 *    (Recraft's `strength`);
 * 2. a family of sibling routes deliberately left out of the vocabulary (every
 *    masked operation at all eight providers that ship one);
 * 3. an input shape that is legal at one model of a provider and not at another
 *    (dall-e-2's PNG-only, square, 4 MB rule against the GPT image models' 50 MB
 *    png/webp/jpeg one) — which is the provider's own media check, reached
 *    through the canonical `image`.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { UnmodelValidationError } from "../../src/core/issues";
import { TranslationUnavailableError } from "../../src/core/translate/errors";
import { imageEdit as openaiImageEdit } from "../../src/providers/openai";
import {
  imageEditDeblur,
  imageEditErase,
  imageEditExpand,
  imageEditFill,
  imageEditOutpainting,
  imageEditVto,
} from "../../src/providers/black-forest-labs";
import {
  imageEditReframe as ideogramReframe,
  imageEditRemix as ideogramRemix,
  imageEdit as ideogramInpaint,
  imageEditReplaceBackground as ideogramReplaceBackground,
} from "../../src/providers/ideogram";
import {
  EDIT_URL,
  imageEdit as photoroomImageEdit,
  imageEditRemoveBackground as photoroomRemoveBackground,
  SEGMENT_URL,
  toFormData as photoroomFormData,
} from "../../src/providers/photoroom";
import {
  imageEditRemoveBackground as stabilityRemoveBackground,
  STABLE_IMAGE_REMOVE_BACKGROUND_URL,
  toFormData as stabilityFormData,
} from "../../src/providers/stability";
import {
  imageEditGenerateBackground,
  imageEditInpaint,
  imageEditOutpaint,
  imageEditReplaceBackground,
} from "../../src/providers/recraft";
import { imageEdit } from "../../src/unified/image-edit";

const PROMPT = "make the sky a thunderstorm";
const png = (bytes = 64): Blob => new Blob([new Uint8Array(bytes)], { type: "image/png" });
const URL_IMAGE = "https://example.com/street.png";

describe("the pack", () => {
  test("registers exactly the eight image-edit providers, sorted", () => {
    expect([...imageEdit.providers]).toEqual([
      "black-forest-labs",
      // fal contributes 17 editing endpoints — more than the other four
      // providers together — because it is a queue in front of many vendors.
      // Its mask-driven routes are still excluded, on the same rule that keeps
      // Stability's out: `mask_url` is not a word this vocabulary has.
      "fal",
      "ideogram",
      "openai",
      // Two refs, one per operation: `photoroom/edit-with-ai`, the single mode
      // of a forty-feature route that is a picture and a sentence, and
      // `photoroom/remove-background`.
      "photoroom",
      "recraft",
      "revana",
      // One ref and one operation: `removeBackground`. Its five other edit
      // routes are mask- or search-driven.
      "stability",
    ]);
  });

  test("a provider outside the pack is structural, not a validation error", () => {
    const request = {
      operation: "edit",
      model: "luma/photon-1",
      prompt: PROMPT,
      image: { file: png() },
    } as const;
    expect(() => imageEdit(request as never)).toThrow(TranslationUnavailableError);
    const result = imageEdit.safe(request as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]!.meta).toMatchObject({ structural: true, provider: "luma" });
  });

  test("a model the adapter does not list warns but still compiles", () => {
    const result = imageEdit.safe({
      operation: "edit",
      model: "openai/gpt-image-9",
      prompt: PROMPT,
      image: { file: png() },
    } as never);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.map((issue) => issue.code)).toContain("unknown_model");
  });

  test("an operation this vocabulary has not added yet is refused at every provider", () => {
    // The type forbids it; this is the half that answers for JavaScript callers
    // and for requests that arrived over the wire. A discriminant that is only
    // a type is a silent drop: the field would compile to nothing and the
    // request would quietly be an edit.
    for (const [ref, image] of [
      ["openai/gpt-image-1.5", { file: png() }],
      ["black-forest-labs/flux-kontext-pro", { url: URL_IMAGE }],
      ["ideogram/ideogram-3.0-default", { file: png() }],
      ["recraft/recraftv4_1", { file: png() }],
    ] as const) {
      const result = imageEdit.safe({
        operation: "inpaint",
        model: ref,
        prompt: PROMPT,
        image,
        strength: 0.5,
      } as never);
      expect(result.ok, ref).toBe(false);
      if (result.ok) continue;
      const issue = result.errors.find((e) => e.path[0] === "operation");
      expect(issue?.code, ref).toBe("invalid_enum_value");
      expect(issue?.meta).toMatchObject({ allowed: ["edit"], value: "inpaint" });
      // …and the message points somewhere actionable: the wire-only sibling
      // that does the job today, or the escape hatch that reaches the mask.
      expect(String(issue?.message), ref).toMatch(/unmodel\/|providerOptions/);
    }
  });

  test("`operation` is a discriminant and never reaches any provider's wire", () => {
    for (const [ref, image] of [
      ["openai/gpt-image-1.5", { file: png() }],
      ["black-forest-labs/flux-kontext-pro", { url: URL_IMAGE }],
      ["ideogram/ideogram-3.0-default", { file: png() }],
    ] as const) {
      const result = imageEdit.safe({ operation: "edit", model: ref, prompt: PROMPT, image } as never);
      expect(result.ok, ref).toBe(true);
      if (!result.ok) continue;
      expect(Object.keys(result.params), ref).not.toContain("operation");
    }
  });
});

describe("the result is the provider's own Validated", () => {
  test("openai: a multipart body whose `image` is the caller's Blob", () => {
    const file = png();
    const params = imageEdit({
      operation: "edit",
      model: "openai/gpt-image-1.5",
      prompt: PROMPT,
      image: { file },
      n: 2,
      outputFormat: "webp",
    });
    const body = params as unknown as Record<string, unknown>;
    // Identity, not a copy: the multipart part is the Blob the caller handed in.
    expect(body["image"]).toBe(file);
    expect(body["model"]).toBe("gpt-image-1.5");
    expect(body["prompt"]).toBe(PROMPT);
    expect(body["n"]).toBe(2);
    expect(body["output_format"]).toBe("webp");
    expect(params.request).toMatchObject({
      url: "https://api.openai.com/v1/images/edits",
      method: "POST",
      // Deliberately empty: the boundary belongs to the FormData.
      headers: {},
    });
    expect(params.toSdk("openai")).toMatchObject({ model: "gpt-image-1.5", prompt: PROMPT });
  });

  test("black-forest-labs: the ref is the route, and the body is JSON", () => {
    const params = imageEdit({
      operation: "edit",
      model: "black-forest-labs/flux-kontext-max",
      prompt: PROMPT,
      image: { data: "aVZCT1J3MEtHZ28=" },
      seed: 7,
      outputFormat: "png",
    });
    expect(JSON.parse(JSON.stringify(params))).toEqual({
      prompt: PROMPT,
      input_image: "aVZCT1J3MEtHZ28=",
      seed: 7,
      output_format: "png",
    });
    // `model` is stripped from the body and interpolated into the URL.
    expect(params.request.url).toBe("https://api.bfl.ai/v1/flux-kontext-max");
    expect(params.request.headers).toEqual({ "content-type": "application/json" });
  });

  test("recraft: multipart with a Blob, JSON with a URL — same request otherwise", () => {
    const blob = imageEdit({
      operation: "edit",
      model: "recraft/recraftv4_1",
      prompt: PROMPT,
      image: { file: png() },
      strength: 0.2,
    });
    const url = imageEdit({
      operation: "edit",
      model: "recraft/recraftv4_1",
      prompt: PROMPT,
      image: { url: URL_IMAGE },
      strength: 0.2,
    });
    expect(blob.request.headers).toEqual({});
    expect(url.request.headers).toEqual({ "content-type": "application/json" });
    expect(blob.request.url).toBe(url.request.url);
    expect(JSON.parse(JSON.stringify(url))).toEqual({
      model: "recraftv4_1",
      prompt: PROMPT,
      strength: 0.2,
      image_url: URL_IMAGE,
    });
  });

  test("recraft: `outputFormat` compiles to `image_format`, and jpeg is refused naming webp / png", () => {
    const png = imageEdit({
      operation: "edit",
      model: "recraft/recraftv4_1",
      prompt: PROMPT,
      image: { url: URL_IMAGE },
      strength: 0.2,
      outputFormat: "png",
    });
    expect(JSON.parse(JSON.stringify(png))).toEqual({
      model: "recraftv4_1",
      prompt: PROMPT,
      strength: 0.2,
      image_url: URL_IMAGE,
      image_format: "png",
    });

    const jpeg = imageEdit.safe({
      operation: "edit",
      model: "recraft/recraftv4_1",
      prompt: PROMPT,
      image: { url: URL_IMAGE },
      strength: 0.2,
      outputFormat: "jpeg",
    });
    expect(jpeg.ok).toBe(false);
    if (jpeg.ok) return;
    expect(jpeg.errors.map((e) => `${e.code}@${e.path?.join(".")}`)).toEqual([
      "invalid_enum_value@outputFormat",
    ]);
    expect(jpeg.errors[0]!.meta?.allowed).toEqual(["webp", "png"]);
  });

  test("recraft: the V4.1 row refuses `style_id`, which imageToImage takes on V3 only", () => {
    const v4 = imageEdit.safe({
      operation: "edit",
      model: "recraft/recraftv4_1",
      prompt: PROMPT,
      image: { url: URL_IMAGE },
      strength: 0.2,
      style_id: "abc",
    } as never);
    expect(v4.ok).toBe(false);
    if (!v4.ok) expect(v4.errors[0]!.path).toEqual(["style_id"]);

    const v3 = imageEdit.safe({
      operation: "edit",
      model: "recraft/recraftv3",
      prompt: PROMPT,
      image: { url: URL_IMAGE },
      strength: 0.2,
      style_id: "abc",
      style_match: "regular",
    });
    expect(v3.ok).toBe(true);
  });

  test("an estimate rides through, from the provider's own cost model", () => {
    // Ideogram prices per image and per rendering speed, and the ref picked
    // both — so `n: 2` at the quality tier is two quality images.
    const ideogram = imageEdit.safe({
      operation: "edit",
      model: "ideogram/ideogram-3.0-quality",
      prompt: PROMPT,
      image: { file: png() },
      n: 2,
    });
    expect(ideogram.ok).toBe(true);
    if (!ideogram.ok) return;
    expect(ideogram.estimate?.costUSD).toBeCloseTo(0.09 * 2, 6);

    const bfl = imageEdit.safe({
      operation: "edit",
      model: "black-forest-labs/flux-kontext-pro",
      prompt: PROMPT,
      image: { url: URL_IMAGE },
    });
    expect(bfl.ok && bfl.estimate?.costUSD).toBeCloseTo(0.04, 6);
  });
});

describe("the provider's own checks reach the canonical path", () => {
  test("dall-e-2's PNG-only 4 MB rule, reported at `image`", () => {
    const tooBig = imageEdit.safe({
      operation: "edit",
      model: "openai/dall-e-2",
      prompt: PROMPT,
      image: { file: png(5 * 1024 * 1024) },
    } as never);
    expect(tooBig.ok).toBe(false);
    if (tooBig.ok) return;
    expect(tooBig.errors[0]!.code).toBe("media_too_large");
    expect(tooBig.errors[0]!.path).toEqual(["image"]);
    // No "(compiled from …)" suffix: the wire key is `image` and so is the
    // canonical one, and a message that explains a rename that did not happen
    // reads like a bug. The suffix appears when the two differ — see the
    // `size` cases above, and `kernel.ts`'s `remap`.
    expect(tooBig.errors[0]!.message).not.toContain("compiled from");

    const wrongFormat = imageEdit.safe({
      operation: "edit",
      model: "openai/dall-e-2",
      prompt: PROMPT,
      image: { file: new Blob([new Uint8Array(64)], { type: "image/jpeg" }) },
    } as never);
    expect(wrongFormat.ok).toBe(false);
    if (wrongFormat.ok) return;
    expect(wrongFormat.errors[0]!.code).toBe("media_unsupported_format");
    expect(wrongFormat.errors[0]!.path).toEqual(["image"]);
  });

  test("the same 5 MB Blob is fine on a GPT image model — the limit is per model", () => {
    const result = imageEdit.safe({
      operation: "edit",
      model: "openai/gpt-image-1.5",
      prompt: PROMPT,
      image: { file: png(5 * 1024 * 1024) },
    } as never);
    expect(result.ok).toBe(true);
  });

  test("Ideogram's 25 MB cap and Recraft's 20 MB one, both at `image`", () => {
    const ideogram = imageEdit.safe({
      operation: "edit",
      model: "ideogram/ideogram-3.0-default",
      prompt: PROMPT,
      image: { file: png(26 * 1024 * 1024) },
    } as never);
    expect(ideogram.ok).toBe(false);
    if (!ideogram.ok) expect(ideogram.errors[0]!.path).toEqual(["image"]);

    const recraft = imageEdit.safe({
      operation: "edit",
      model: "recraft/recraftv4_1",
      prompt: PROMPT,
      image: { file: png(21 * 1024 * 1024) },
      strength: 0.5,
    } as never);
    expect(recraft.ok).toBe(false);
    if (!recraft.ok) expect(recraft.errors[0]!.path).toEqual(["image"]);
  });

  test("the prompt cap is the provider's, reported at `prompt`", () => {
    const result = imageEdit.safe({
      operation: "edit",
      model: "openai/dall-e-2",
      prompt: "x".repeat(1200),
      image: { file: png() },
    } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]!.code).toBe("over_output_limit");
    expect(result.errors[0]!.path).toEqual(["prompt"]);
    expect(result.errors[0]!.message).not.toContain("compiled from");
  });

  test("a Recraft model the editing route does not serve is that route's own error", () => {
    // `recraftv2` is a generation model: `unmodel/image` serves it, this route
    // does not, and the list in the message is Recraft's own.
    const result = imageEdit.safe({
      operation: "edit",
      model: "recraft/recraftv2",
      prompt: PROMPT,
      image: { file: png() },
      strength: 0.5,
    } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]!.code).toBe("invalid_enum_value");
    expect(result.errors[0]!.path).toEqual(["model"]);
  });
});

describe("the fields whose answer depends on the model", () => {
  test("a shape the gpt-image enum has no entry for is an error, not a rounding", () => {
    const result = imageEdit.safe({
      operation: "edit",
      model: "openai/gpt-image-1.5",
      prompt: PROMPT,
      image: { file: png() },
      aspectRatio: "16:9",
    } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]!.code).toBe("invalid_enum_value");
    expect(result.errors[0]!.path).toEqual(["aspectRatio"]);
    // …while the free-form family answers the same question with pixels.
    const freeform = imageEdit.safe({
      operation: "edit",
      model: "openai/gpt-image-2",
      prompt: PROMPT,
      image: { file: png() },
      aspectRatio: "16:9",
    } as never);
    expect(freeform.ok && (freeform.params as unknown as { size: string }).size).toBe("1360x768");
  });

  test("`outputFormat` is a GPT-image field, refused by name on dall-e-2", () => {
    const result = imageEdit.safe({
      operation: "edit",
      model: "openai/dall-e-2",
      prompt: PROMPT,
      image: { file: png() },
      outputFormat: "webp",
    } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]!.code).toBe("unsupported_param");
    expect(result.errors[0]!.path).toEqual(["outputFormat"]);
    // Model-dependent, so it is NOT on the adapter's `unsupported` record —
    // the same field is native two rows up.
    expect(result.errors[0]!.message).toContain("GPT image models");
  });
});

describe("Recraft's required strength", () => {
  test("omitting it is an error naming the field and what its ends mean", () => {
    const result = imageEdit.safe({
      operation: "edit",
      model: "recraft/recraftv4_1",
      prompt: PROMPT,
      image: { file: png() },
    } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]!.code).toBe("invalid_shape");
    expect(result.errors[0]!.path).toEqual(["strength"]);
    expect(result.errors[0]!.message).toContain("required");
    // No invented default: the message says so, because a silently-chosen
    // number here is a different picture on a per-image bill.
    expect(result.errors[0]!.message).toContain("no default");
  });

  test("and it is the only provider in the pack that insists", () => {
    for (const [ref, image] of [
      ["openai/gpt-image-1.5", { file: png() }],
      ["black-forest-labs/flux-kontext-pro", { url: URL_IMAGE }],
      ["ideogram/ideogram-3.0-default", { file: png() }],
    ] as const) {
      const result = imageEdit.safe({ operation: "edit", model: ref, prompt: PROMPT, image } as never);
      expect(result.ok, ref).toBe(true);
    }
  });
});

describe("providerOptions", () => {
  test("reaches the params the vocabulary deliberately has no word for", () => {
    const params = imageEdit({
      operation: "edit",
      model: "black-forest-labs/flux-kontext-pro",
      prompt: PROMPT,
      image: { url: URL_IMAGE },
      providerOptions: { "black-forest-labs": { safety_tolerance: 4, prompt_upsampling: true } },
    });
    expect(JSON.parse(JSON.stringify(params))).toMatchObject({
      safety_tolerance: 4,
      prompt_upsampling: true,
    });
  });

  test("an override the provider rejects says where it came from", () => {
    const result = imageEdit.safe({
      operation: "edit",
      model: "black-forest-labs/flux-kontext-pro",
      prompt: PROMPT,
      image: { url: URL_IMAGE },
      providerOptions: { "black-forest-labs": { safety_tolerance: 9 } },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]!.path).toEqual(["safety_tolerance"]);
    expect(result.errors[0]!.message).toEndWith("(supplied via `providerOptions`)");
  });

  test("a mask rides through the escape hatch — which is how v1 does inpainting", () => {
    // `mask` has no canonical field, on purpose. It is still one deep-merged
    // key away, and it is still checked by OpenAI's own four layers.
    const mask = new Blob([new Uint8Array(32)], { type: "image/png" });
    const params = imageEdit({
      operation: "edit",
      model: "openai/gpt-image-1.5",
      prompt: PROMPT,
      image: { file: png() },
      providerOptions: { openai: { mask } },
    });
    expect((params as unknown as Record<string, unknown>)["mask"]).toBe(mask);
  });
});

describe("the routes this category deliberately does not unify", () => {
  /**
   * Every masked or geometry-driven editing route in the library. All of them
   * validate, none of them is reachable through `imageEdit()`, and that is a
   * decision rather than an oversight: each needs a second image or a set of
   * pixels the v1 vocabulary has no word for. `operation` is the discriminant
   * that lets them join later.
   */
  test("they are wire-only, and they still work", () => {
    for (const validator of [
      imageEditFill,
      imageEditExpand,
      imageEditOutpainting,
      imageEditErase,
      imageEditDeblur,
      imageEditVto,
      imageEditInpaint,
      imageEditOutpaint,
      imageEditGenerateBackground,
      imageEditReplaceBackground,
      ideogramInpaint,
      ideogramReframe,
      ideogramReplaceBackground,
    ]) {
      expect(typeof validator).toBe("function");
    }
  });

  test("the unified route at ideogram is remix, not the mask-driven `edit`", () => {
    const params = imageEdit({
      operation: "edit",
      model: "ideogram/ideogram-3.0-default",
      prompt: PROMPT,
      image: { file: png() },
    });
    expect(params.request.url).toEndWith("/remix");
    // …and remix's own validator is the one the pack ends in.
    const direct = ideogramRemix({
      image: png(),
      prompt: PROMPT,
      rendering_speed: "DEFAULT",
    });
    expect(Object.keys(JSON.parse(JSON.stringify(params)))).toEqual(
      Object.keys(JSON.parse(JSON.stringify(direct))),
    );
  });

  test("openai's own imageEdit validator is the one the pack ends in", () => {
    const file = png();
    const direct = openaiImageEdit({ model: "gpt-image-1.5", image: file, prompt: PROMPT });
    const unified = imageEdit({
      operation: "edit",
      model: "openai/gpt-image-1.5",
      prompt: PROMPT,
      image: { file },
    });
    expect(JSON.parse(JSON.stringify(unified))).toEqual(JSON.parse(JSON.stringify(direct)));
    expect(unified.request.url).toBe(direct.request.url);
  });
});

describe("the image narrowing, at run time", () => {
  test("a Blob at Black Forest Labs is refused with the reason and the alternatives", () => {
    const result = imageEdit.safe({
      operation: "edit",
      model: "black-forest-labs/flux-kontext-pro",
      prompt: PROMPT,
      image: { file: png() },
    } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]!.code).toBe("unsupported_param");
    expect(result.errors[0]!.path).toEqual(["image"]);
    expect(String(result.errors[0]!.message)).toContain("{ data }");
    expect(String(result.errors[0]!.message)).toContain("{ url }");
    // The reason, not just the refusal: a Blob cannot be base64-encoded
    // synchronously, which is the honest answer rather than a packaging one.
    expect(String(result.errors[0]!.message)).toContain("await");
  });

  test("a URL at OpenAI is refused naming the multipart part it does take", () => {
    const result = imageEdit.safe({
      operation: "edit",
      model: "openai/gpt-image-1.5",
      prompt: PROMPT,
      image: { url: URL_IMAGE },
    } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]!.path).toEqual(["image"]);
    expect(String(result.errors[0]!.message)).toContain("multipart");
  });

  test("two shapes at once is a caller who has not decided", () => {
    const result = imageEdit.safe({
      operation: "edit",
      model: "recraft/recraftv4_1",
      prompt: PROMPT,
      image: { file: png(), url: URL_IMAGE },
      strength: 0.5,
    } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]!.code).toBe("invalid_shape");
    expect(result.errors[0]!.path).toEqual(["image"]);
  });

  test("a `data:` URI passed as bytes is unwrapped to its payload", () => {
    const params = imageEdit({
      operation: "edit",
      model: "black-forest-labs/flux-kontext-pro",
      prompt: PROMPT,
      image: { data: "data:image/png;base64,aVZCT1J3MEtHZ28=" },
    });
    expect((params as unknown as { input_image: string }).input_image).toBe("aVZCT1J3MEtHZ28=");
  });
});

describe("`size`, on the editing routes", () => {
  test("a preset compiles verbatim, and the XOR still holds", () => {
    const ok = imageEdit.safe({
      operation: "edit",
      model: "openai/gpt-image-2",
      prompt: PROMPT,
      image: { file: png() },
      size: "2560x1440",
    } as never);
    expect(ok.ok, ok.ok ? "" : JSON.stringify(ok.errors)).toBe(true);
    if (!ok.ok) return;
    expect(ok.params).toMatchObject({ size: "2560x1440" });

    const both = imageEdit.safe({
      operation: "edit",
      model: "openai/gpt-image-2",
      prompt: PROMPT,
      image: { file: png() },
      size: "2560x1440",
      aspectRatio: "16:9",
    } as never);
    expect(both.ok).toBe(false);
    if (both.ok) return;
    expect(both.errors[0]!.code).toBe("invalid_shape");
  });

  test("the free-form tail's promise is kept by the endpoint, not by the type", () => {
    // Same story as on generations: `"1920x1080"` is inside the template tail
    // and outside gpt-image-2's 16-px rule, so the type admits it and
    // `checkGptImage2Size` refuses it.
    const result = imageEdit.safe({
      operation: "edit",
      model: "openai/gpt-image-2",
      prompt: PROMPT,
      image: { file: png() },
      size: "1920x1080",
    } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatchObject({ code: "invalid_enum_value", path: ["size"] });
  });

  test("at a route with no size field the string becomes the shape, and warns", () => {
    const result = imageEdit.safe({
      operation: "edit",
      model: "black-forest-labs/flux-kontext-pro",
      prompt: PROMPT,
      image: { url: "https://example.com/street.png" },
      size: "1920x1080",
    } as never);
    expect(result.ok, result.ok ? "" : JSON.stringify(result.errors)).toBe(true);
    if (!result.ok) return;
    expect(result.params).toMatchObject({ aspect_ratio: "16:9" });
    const warnings = (result.params as unknown as { warnings: readonly { path: unknown[] }[] })
      .warnings;
    expect(warnings.some((warning) => warning.path[0] === "size")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// revana — an edit is a picture request that carries a picture, by URL
// ---------------------------------------------------------------------------

describe("revana: the source is a public URL and nothing else", () => {
  const base = { operation: "edit", prompt: PROMPT } as const;

  test("the picture lands on `input.image_url`, the shape and count beside it", () => {
    const params = imageEdit({
      ...base,
      model: "revana/nano-banana-pro",
      image: { url: URL_IMAGE },
      aspectRatio: "4:5",
      n: 2,
      seed: 3,
    });
    expect(JSON.parse(JSON.stringify(params))).toEqual({
      model: "nano-banana-pro",
      input: { prompt: PROMPT, image_url: URL_IMAGE, aspect_ratio: "4:5", num_images: 2, seed: 3 },
    });
    expect(params.request.url).toBe("https://api.revana.si/v1/generations");
    expect(params.toSdk("revana")).toEqual(JSON.parse(JSON.stringify(params)));
  });

  test.each([
    ["{ file }", { file: png() }],
    ["{ data }", { data: "aVZCT1J3MEtHZ28=" }],
  ])("%s is refused with the upload route that makes a URL", (_label, image) => {
    const result = imageEdit.safe({ ...base, model: "revana/flux-kontext-pro", image } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((issue) => [issue.code, issue.path])).toEqual([
      ["unsupported_param", ["image"]],
    ]);
    expect(result.errors[0]!.message).toContain("it takes { url }");
    expect(result.errors[0]!.message).toContain("POST https://api.revana.si/v1/uploads");
  });

  test("a `data:` URL is `revana.imageEdit`'s own https rule, at `image`", () => {
    const result = imageEdit.safe({
      ...base,
      model: "revana/flux-kontext-pro",
      image: { url: "data:image/png;base64,aVZCT1J3MEtHZ28=" },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatchObject({ code: "invalid_shape", path: ["image"] });
    expect(result.errors[0]!.message).toContain("must be a public https URL");
  });

  test("`strength` and `outputFormat` are declared gaps naming what an edit does take", () => {
    const result = imageEdit.safe({
      ...base,
      model: "revana/flux-kontext-pro",
      image: { url: URL_IMAGE },
      strength: 0.5,
      outputFormat: "png",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((issue) => [issue.code, issue.path])).toEqual([
      ["unsupported_param", ["strength"]],
      ["unsupported_param", ["outputFormat"]],
    ]);
    expect(result.errors[0]!.message).toContain("steered by `prompt` alone");
  });

  test("a model that cannot edit is refused by the view, which names the wide address", () => {
    // `imagen-4` is text-to-image only: not in this roster, and `revana.imageEdit`
    // is the narrower view that says so.
    const result = imageEdit.safe({
      ...base,
      model: "revana/imagen-4",
      image: { url: URL_IMAGE },
    } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.warnings.map((issue) => issue.code)).toEqual(["unknown_model"]);
    expect(result.errors[0]).toMatchObject({ code: "unsupported_capability", path: ["model"] });
    expect(result.errors[0]!.message).toContain("`revana.image` validates it");
  });

  test("further reference pictures ride on `providerOptions.revana.input.image_urls`", () => {
    const params = imageEdit({
      ...base,
      model: "revana/nano-banana-pro",
      image: { url: URL_IMAGE },
      providerOptions: { revana: { input: { image_urls: ["https://example.com/style.png"] } } },
    });
    expect((params as unknown as { input: Record<string, unknown> }).input).toEqual({
      prompt: PROMPT,
      image_url: URL_IMAGE,
      image_urls: ["https://example.com/style.png"],
    });
  });
});

// ---------------------------------------------------------------------------
// photoroom — one mode of one route, on a flat multipart form
// ---------------------------------------------------------------------------

interface DocsExample {
  page: string;
  url: string;
  fields: Record<string, string>;
}

/** Photoroom's own Edit With AI curl examples, as published (see the fixture's `$comment`). */
const EDIT_WITH_AI_EXAMPLES = (
  JSON.parse(
    readFileSync(
      new URL("../fixtures/photoroom/docs-examples.json", import.meta.url),
      "utf8",
    ),
  ) as { examples: DocsExample[] }
).examples.filter((example) => example.page.endsWith("/edit-with-ai.md"));

/** A multipart body as `name → text`, with every file part rendered the way the fixture writes one. */
function formFields(form: FormData): Record<string, string> {
  const fields: Record<string, string> = {};
  form.forEach((value, key) => {
    fields[key] = typeof value === "string" ? value : "@file";
  });
  return fields;
}

describe("photoroom: Edit With AI, and nothing else on the route", () => {
  const base = { operation: "edit", model: "photoroom/edit-with-ai", prompt: PROMPT } as const;

  test("the body is the flat form, ending in `photoroom.imageEdit`'s own ValidatedForm", () => {
    const file = png();
    const params = imageEdit({ ...base, image: { file }, seed: 7, outputFormat: "webp" });
    const body: Record<string, unknown> = { ...params };
    expect(body).toEqual({
      "editWithAI.mode": "ai.auto",
      "editWithAI.prompt": PROMPT,
      removeBackground: false,
      imageFile: file,
      "editWithAI.seed": 7,
      "export.format": "webp",
    });
    expect("imageFile" in params && params.imageFile).toBe(file);
    expect(params.request.url).toBe(EDIT_URL);
    expect(params.request.body).toBe("form");
    // No content-type: `fetch` derives the multipart boundary. And no `pr-*`
    // header either — the adapter writes none.
    expect(params.request.headers).toEqual({});
    const sdk: unknown = params.toSdk("photoroom");
    expect(sdk).toEqual(body);
    // The same request, written by hand, is the same validated value.
    const direct = photoroomImageEdit({
      "editWithAI.mode": "ai.auto",
      "editWithAI.prompt": PROMPT,
      removeBackground: false,
      imageFile: file,
      "editWithAI.seed": 7,
      "export.format": "webp",
    });
    expect(body).toEqual({ ...direct });
  });

  test("the fixture carries all five Edit With AI examples", () => {
    expect(EDIT_WITH_AI_EXAMPLES.length).toBe(5);
    // The premise `removeBackground: false` rests on, read off the docs.
    expect(EDIT_WITH_AI_EXAMPLES.map((example) => example.fields["removeBackground"])).toEqual([
      "false",
      "false",
      "false",
      "false",
      "false",
    ]);
    expect(
      EDIT_WITH_AI_EXAMPLES.filter((example) => example.fields["referenceBox"] !== undefined).length,
    ).toBe(1);
  });

  test("a prompt and a seed send exactly the form Photoroom's own example sends", () => {
    // The second and third examples on the page: a picture, a prompt, a seed.
    const examples = EDIT_WITH_AI_EXAMPLES.filter(
      (example) => Object.keys(example.fields).length === 5 && example.fields["editWithAI.seed"],
    );
    expect(examples.length).toBe(2);
    for (const example of examples) {
      const params = imageEdit({
        ...base,
        prompt: example.fields["editWithAI.prompt"] as string,
        image: { file: png() },
        seed: Number(example.fields["editWithAI.seed"]),
      });
      expect(formFields(photoroomFormData(params))).toEqual(example.fields);
    }
  });

  test("`referenceBox` is not written, and the escape hatch reproduces the example that sends it", () => {
    const example = EDIT_WITH_AI_EXAMPLES.find(
      (candidate) => candidate.fields["referenceBox"] !== undefined,
    ) as DocsExample;
    const bare = imageEdit({
      ...base,
      prompt: example.fields["editWithAI.prompt"] as string,
      image: { file: png() },
    });
    expect(Object.keys(bare)).not.toContain("referenceBox");

    const result = imageEdit.safe({
      ...base,
      prompt: example.fields["editWithAI.prompt"] as string,
      image: { file: png() },
      providerOptions: { photoroom: { referenceBox: "originalImage" } },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The OpenAPI document says the pair "Can't be provided" together and the
    // docs send it on nine pages; `photoroom.imageEdit` sides with the docs.
    expect(result.warnings).toEqual([]);
    expect(formFields(photoroomFormData(result.params))).toEqual(example.fields);
  });

  test("further reference pictures ride on `providerOptions.photoroom`, under names the caller picks", () => {
    const example = EDIT_WITH_AI_EXAMPLES.find(
      (candidate) => candidate.fields["editWithAI.additionalImages.Scene.imageFile"] !== undefined,
    ) as DocsExample;
    const result = imageEdit.safe({
      ...base,
      prompt: example.fields["editWithAI.prompt"] as string,
      image: { file: png() },
      seed: Number(example.fields["editWithAI.seed"]),
      providerOptions: {
        photoroom: { "editWithAI.additionalImages.Scene.imageFile": png() },
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // A documented family key is not an unknown field.
    expect(result.warnings).toEqual([]);
    expect(formFields(photoroomFormData(result.params))).toEqual(example.fields);
  });

  test("reference pictures by URL: the nested `*.imageUrl` family is typed on POST, as the docs send it", () => {
    // The fifth example on the page, and the only one that names a reference
    // by URL. The OpenAPI document lists no `*.imageUrl` on POST; the docs
    // page posts two, and the field table's overlay sides with the page.
    const example = EDIT_WITH_AI_EXAMPLES.find(
      (candidate) =>
        candidate.fields["editWithAI.additionalImages.styleRef.imageUrl"] !== undefined,
    ) as DocsExample;
    const result = imageEdit.safe({
      ...base,
      prompt: example.fields["editWithAI.prompt"] as string,
      image: { file: png() },
      providerOptions: {
        photoroom: {
          "editWithAI.additionalImages.styleRef.imageUrl": example.fields[
            "editWithAI.additionalImages.styleRef.imageUrl"
          ] as string,
          "editWithAI.additionalImages.moodRef.imageUrl": example.fields[
            "editWithAI.additionalImages.moodRef.imageUrl"
          ] as string,
        },
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toEqual([]);
    expect(formFields(photoroomFormData(result.params))).toEqual(example.fields);
  });

  test("a `pr-*` header param supplied through the escape hatch comes back as a header", () => {
    const params = imageEdit({
      ...base,
      image: { file: png() },
      providerOptions: { photoroom: { "pr-hd-background-removal": "auto" } },
    });
    expect(params.request.headers).toEqual({ "pr-hd-background-removal": "auto" });
    expect(Object.keys(params)).not.toContain("pr-hd-background-removal");
  });

  test("the forced `removeBackground: false` yields to the caller's own value", () => {
    const params = imageEdit({
      ...base,
      image: { file: png() },
      providerOptions: { photoroom: { removeBackground: true } },
    });
    expect((params as unknown as { removeBackground: unknown }).removeBackground).toBe(true);
  });

  test.each([
    ["{ url }", { url: URL_IMAGE }],
    ["{ data }", { data: "aVZCT1J3MEtHZ28=" }],
  ])("%s is refused naming the multipart part and the route that does fetch a URL", (_label, image) => {
    const result = imageEdit.safe({ ...base, image } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((issue) => [issue.code, issue.path])).toEqual([
      ["unsupported_param", ["image"]],
    ]);
    const message = result.errors[0]!.message;
    expect(message).toContain("it takes { file }");
    expect(message).toContain("multipart `imageFile` part");
    expect(message).toContain("`GET /v2/edit`");
  });

  test("every declared gap is refused at its canonical name, with the reason", () => {
    const refused = (extra: Record<string, unknown>): string => {
      const result = imageEdit.safe({ ...base, image: { file: png() }, ...extra } as never);
      expect(result.ok).toBe(false);
      if (result.ok) return "";
      expect(result.errors.map((issue) => [issue.code, issue.path])).toEqual([
        ["unsupported_param", Object.keys(extra)],
      ]);
      return result.errors[0]!.message;
    };
    expect(refused({ strength: 0.5 })).toContain("steered by `editWithAI.prompt` alone");
    expect(refused({ strength: 0.5 })).toContain("neither Photoroom route");
    expect(refused({ n: 2 })).toContain("issue N requests");
    // The three shape words share one reason, and it names the field that
    // LOOKS like the answer and is not.
    for (const shape of [
      { size: "1024x1024" },
      { aspectRatio: "16:9" },
      { dimensions: { width: 1024, height: 768 } },
    ]) {
      const message = refused(shape);
      expect(message).toContain("1K (`1024x1024`)");
      expect(message).toContain("is the CANVAS");
      // …and the one on the sibling route, because the same sentence is quoted
      // to a caller of `photoroom/remove-background`.
      expect(message).toContain("named downscale");
    }
  });

  test("the provider's own findings arrive at the canonical name", () => {
    // `editWithAI.prompt` is `minLength: 1` on the wire.
    const empty = imageEdit.safe({ ...base, prompt: "", image: { file: png() } });
    expect(empty.ok).toBe(false);
    if (empty.ok) return;
    expect(empty.errors.map((issue) => [issue.code, issue.path])).toEqual([
      ["invalid_shape", ["prompt"]],
    ]);

    // "Maximum File Size: 30MB", reported where the caller put the picture.
    const tooBig = imageEdit.safe({ ...base, image: { file: png(30 * 1024 * 1024 + 1) } });
    expect(tooBig.ok).toBe(false);
    if (tooBig.ok) return;
    expect(tooBig.errors.map((issue) => [issue.code, issue.path])).toEqual([
      ["media_too_large", ["image"]],
    ]);
  });

  test("the estimate is the flat per-call rate, read off the `edit-with-ai` row", () => {
    const result = imageEdit.safe({ ...base, image: { file: png() }, seed: 1 });
    expect(result.ok && result.estimate?.costUSD).toBeCloseTo(0.1, 6);
  });

  test("a typo in the escape hatch is the route's own billed-and-ignored warning", () => {
    const result = imageEdit.safe({
      ...base,
      image: { file: png() },
      providerOptions: { photoroom: { "editWithAI.sead": 7 } },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.map((issue) => [issue.code, issue.path])).toEqual([
      ["unknown_param", ["editWithAI.sead"]],
    ]);
    expect(result.warnings[0]!.message).toContain("`pr-unsupported-attributes`");
  });
});

// ---------------------------------------------------------------------------
// operation: "removeBackground" — two providers, two forms
// ---------------------------------------------------------------------------

describe("removeBackground: stability", () => {
  const base = {
    operation: "removeBackground",
    model: "stability/stable-image-remove-background",
  } as const;

  test("the body is the two-field form, ending in the route's own ValidatedForm", () => {
    const file = png();
    const params = imageEdit({ ...base, image: { file }, outputFormat: "webp" });
    const body: Record<string, unknown> = { ...params };
    expect(body).toEqual({ image: file, output_format: "webp" });
    expect(params.request.url).toBe(STABLE_IMAGE_REMOVE_BACKGROUND_URL);
    expect(params.request.body).toBe("form");
    expect(params.request.headers).toEqual({});
    expect(params.warnings).toEqual([]);

    // Byte for byte what the wire-exact validator returns for the same form.
    const direct = stabilityRemoveBackground({ image: file, output_format: "webp" });
    expect(body).toEqual({ ...direct });
    expect(params.request).toEqual(direct.request);
    expect(formFields(stabilityFormData(params))).toEqual({ image: "@file", output_format: "webp" });
  });

  test("the estimate is the route's 5 credits", () => {
    const result = imageEdit.safe({ ...base, image: { file: png() } });
    expect(result.ok && result.estimate?.costUSD).toBeCloseTo(0.05, 6);
  });

  test("`jpeg` is refused by name: the route returns an alpha channel", () => {
    const result = imageEdit.safe({ ...base, image: { file: png() }, outputFormat: "jpeg" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((issue) => [issue.code, issue.path])).toEqual([
      ["invalid_enum_value", ["outputFormat"]],
    ]);
    const issue = result.errors[0]!;
    expect(issue.message).toContain("returns an alpha channel");
    expect(issue.message).toContain("JPEG cannot carry one");
    expect(issue.meta).toMatchObject({ allowed: ["png", "webp"], value: "jpeg" });
  });

  test("`operation: \"edit\"` is refused naming the wire-only routes that take a prompt", () => {
    const result = imageEdit.safe({
      operation: "edit",
      model: base.model,
      prompt: PROMPT,
      image: { file: png() },
    } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const operation = result.errors.find((issue) => issue.path[0] === "operation");
    expect(operation?.code).toBe("invalid_enum_value");
    expect(operation?.meta).toMatchObject({ allowed: ["removeBackground"], value: "edit" });
    expect(operation?.message).toContain("`stability.imageEditInpaint`");
    expect(operation?.message).toContain("`stability.imageEditSearchAndReplace`");
    // The sentence has nowhere to go either, and is reported at its own name.
    const prompt = result.errors.find((issue) => issue.path[0] === "prompt");
    expect(prompt?.code).toBe("unsupported_param");
    expect(prompt?.message).toContain("takes `image` and `output_format` and nothing else");
  });

  test.each([
    ["{ url }", { url: URL_IMAGE }],
    ["{ data }", { data: "aVZCT1J3MEtHZ28=" }],
  ])("%s is refused naming the multipart part", (_label, image) => {
    const result = imageEdit.safe({ ...base, image } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((issue) => [issue.code, issue.path])).toEqual([
      ["unsupported_param", ["image"]],
    ]);
    expect(result.errors[0]!.message).toContain("it takes { file }");
    expect(result.errors[0]!.message).toContain("its `image` part");
  });

  test("the escape hatch reaches the wire, and the route's own schema still checks it", () => {
    const result = imageEdit.safe({
      ...base,
      image: { file: png() },
      providerOptions: { stability: { output_format: "jpeg" } },
    } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((issue) => issue.path)).toEqual([["output_format"]]);
  });
});

describe("removeBackground: photoroom", () => {
  test("an id outside a synthetic-id adapter's list is refused, not sent and priced as whichever route the operation picks", () => {
    const edit = imageEdit.safe({ operation: "edit", model: "photoroom/remove-backgroud", prompt: PROMPT, image: { file: png() } } as never);
    if (edit.ok) throw new Error("expected a refusal");
    expect(edit.errors.map((issue) => [issue.code, issue.path])).toEqual([["invalid_enum_value", ["model"]]]);
    expect(edit.errors[0]?.message).toBe(
      "`photoroom/remove-backgroud` is not a Photoroom ref. Photoroom's routes take no model field, so the refs are " +
        "unmodel's names for them: `photoroom/edit-with-ai` and `photoroom/remove-background`.",
    );
    const removal = imageEdit.safe({ operation: "removeBackground", model: "stability/some-new-thing", image: { file: png() } } as never);
    if (removal.ok) throw new Error("expected a refusal");
    expect(removal.errors.map((issue) => [issue.code, issue.path])).toEqual([["invalid_enum_value", ["model"]]]);
  });

  const base = { operation: "removeBackground", model: "photoroom/remove-background" } as const;

  test("the body is the `/v1/segment` form, ending in that route's own ValidatedForm", () => {
    const file = png();
    const params = imageEdit({
      ...base,
      image: { file },
      outputFormat: "webp",
      bg_color: "#FF00FF",
      crop: "true",
    });
    const body: Record<string, unknown> = { ...params };
    expect(body).toEqual({ image_file: file, format: "webp", bg_color: "#FF00FF", crop: "true" });
    expect(params.request.url).toBe(SEGMENT_URL);
    expect(params.request.body).toBe("form");
    expect(params.request.headers).toEqual({});
    expect(params.warnings).toEqual([]);

    const direct = photoroomRemoveBackground({
      image_file: file,
      format: "webp",
      bg_color: "#FF00FF",
      crop: "true",
    });
    expect(body).toEqual({ ...direct });
    expect(params.request).toEqual(direct.request);
    expect(formFields(photoroomFormData(params))).toEqual({
      image_file: "@file",
      format: "webp",
      bg_color: "#FF00FF",
      crop: "true",
    });
  });

  test("`jpeg` is written `jpg`, the route's own spelling, with nothing warned", () => {
    const result = imageEdit.safe({ ...base, image: { file: png() }, outputFormat: "jpeg" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.params as unknown as { format: string }).format).toBe("jpg");
    expect(result.warnings).toEqual([]);
  });

  test("the estimate is `/v1/segment`'s $0.02, a fifth of the edit route's", () => {
    const removal = imageEdit.safe({ ...base, image: { file: png() } });
    expect(removal.ok && removal.estimate?.costUSD).toBeCloseTo(0.02, 6);
    const edit = imageEdit.safe({
      operation: "edit",
      model: "photoroom/edit-with-ai",
      prompt: PROMPT,
      image: { file: png() },
    });
    expect(edit.ok && edit.estimate?.costUSD).toBeCloseTo(0.1, 6);
  });

  test("the route's `size` rides in the bucket, because the canonical word is a shape", () => {
    const params = imageEdit({
      ...base,
      image: { file: png() },
      providerOptions: { photoroom: { size: "hd" } },
    });
    expect((params as unknown as { size: string }).size).toBe("hd");

    const canonical = imageEdit.safe({ ...base, image: { file: png() }, size: "hd" } as never);
    expect(canonical.ok).toBe(false);
    if (canonical.ok) return;
    expect(canonical.errors.map((issue) => [issue.code, issue.path])).toEqual([
      ["unsupported_param", ["size"]],
    ]);
    expect(canonical.errors[0]!.message).toContain("`providerOptions.photoroom`");
  });

  test("`prompt` and `seed` are refused naming the ref that does read them", () => {
    for (const word of ["prompt", "seed"] as const) {
      const result = imageEdit.safe({
        ...base,
        image: { file: png() },
        [word]: word === "prompt" ? PROMPT : 7,
      } as never);
      expect(result.ok, word).toBe(false);
      if (result.ok) continue;
      expect(result.errors.map((issue) => [issue.code, issue.path])).toEqual([
        ["unsupported_param", [word]],
      ]);
      expect(result.errors[0]!.message).toContain("`photoroom/edit-with-ai`");
    }
  });

  test("each ref refuses the other's operation, naming both", () => {
    for (const [model, operation, allowed] of [
      ["photoroom/remove-background", "edit", "removeBackground"],
      ["photoroom/edit-with-ai", "removeBackground", "edit"],
    ] as const) {
      const result = imageEdit.safe({
        operation,
        model,
        ...(operation === "edit" && { prompt: PROMPT }),
        image: { file: png() },
      } as never);
      expect(result.ok, model).toBe(false);
      if (result.ok) continue;
      const issue = result.errors.find((each) => each.path[0] === "operation");
      expect(issue?.code, model).toBe("invalid_enum_value");
      expect(issue?.meta).toMatchObject({ allowed: [allowed], value: operation });
      expect(issue?.message).toContain("`photoroom/edit-with-ai` serves");
      expect(issue?.message).toContain("`photoroom/remove-background` serves");
    }
  });

  test.each([
    ["{ url }", { url: URL_IMAGE }],
    ["{ data }", { data: "aVZCT1J3MEtHZ28=" }],
  ])("%s is refused naming the multipart part and the base64 body that is not addressed", (_label, image) => {
    const result = imageEdit.safe({ ...base, image } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((issue) => [issue.code, issue.path])).toEqual([
      ["unsupported_param", ["image"]],
    ]);
    const message = result.errors[0]!.message;
    expect(message).toContain("it takes { file }");
    expect(message).toContain("multipart `image_file` part");
    expect(message).toContain("`image_file_b64`");
  });

  test("the provider's own findings arrive at the canonical name", () => {
    // "Maximum File Size: 50MB", reported where the caller put the picture.
    const tooBig = imageEdit.safe({ ...base, image: { file: png(50 * 1024 * 1024 + 1) } });
    expect(tooBig.ok).toBe(false);
    if (tooBig.ok) return;
    expect(tooBig.errors.map((issue) => [issue.code, issue.path])).toEqual([
      ["media_too_large", ["image"]],
    ]);
  });

  test("an `/v2/edit` field in the bucket of a removal is the route's own unknown-field warning", () => {
    // The bucket is typed from both forms; which half a request may carry is
    // the ref's, and `/v1/segment`'s validator is what says so.
    const result = imageEdit.safe({
      ...base,
      image: { file: png() },
      providerOptions: { photoroom: { padding: 0.1 } },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.map((issue) => [issue.code, issue.path])).toEqual([
      ["unknown_param", ["padding"]],
    ]);
  });
});

describe("the throwing form", () => {
  test("throws UnmodelValidationError labelled with the category", () => {
    const request = {
      operation: "edit",
      model: "openai/gpt-image-1.5",
      prompt: PROMPT,
      image: { file: png() },
      strength: 0.5,
    } as const;
    expect(() => imageEdit(request as never)).toThrow(UnmodelValidationError);
    try {
      imageEdit(request as never);
    } catch (error) {
      expect((error as Error).message).toContain("unmodel/image-edit");
      expect((error as UnmodelValidationError).issues[0]!.path).toEqual(["strength"]);
    }
  });
});
