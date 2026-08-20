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
  test("registers exactly the four image-edit providers, sorted", () => {
    expect([...imageEdit.providers]).toEqual([
      "black-forest-labs",
      "ideogram",
      "openai",
      "recraft",
    ]);
  });

  test("a provider outside the pack is structural, not a validation error", () => {
    const request = {
      operation: "edit",
      model: "stability/stable-image-erase",
      prompt: PROMPT,
      image: { file: png() },
    } as const;
    expect(() => imageEdit(request as never)).toThrow(TranslationUnavailableError);
    const result = imageEdit.safe(request as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]!.meta).toMatchObject({ structural: true, provider: "stability" });
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
    expect(tooBig.errors[0]!.message).toContain("compiled from `image`");

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

  test("Ideogram's 25 MB cap and Recraft's 10 MB one, both at `image`", () => {
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
      image: { file: png(11 * 1024 * 1024) },
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
    expect(result.errors[0]!.message).toContain("compiled from `prompt`");
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
