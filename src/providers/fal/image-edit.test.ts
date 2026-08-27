/**
 * `fal.imageEdit` — the wire contract.
 *
 * The routing, stripping and degradation rules are the provider's, not this
 * category's, and `./image.test.ts` asserts them in full. What is tested here
 * is what editing adds: three different spellings of "the picture to edit",
 * a mask that only one endpoint has, and a `strength` dial that only one
 * endpoint has — three per-endpoint facts that the ONE category schema cannot
 * see and the generated IR can.
 */

import { describe, expect, test } from "bun:test";
import { imageEdit } from "./image-edit";
import { FAL_IMAGE_EDIT_ENDPOINTS, FAL_REQUIRED_PROBES } from "./gen/endpoints.gen";
import { FAL_IMAGE_EDIT_SHAPES } from "./gen/image-edit-narrow.gen";
import { FAL_IMAGE_EDIT_MODELS } from "./gen/image-edit-params.gen";

const PROMPT = "put the cabin in a snowstorm";
const IMAGE = "https://example.com/cabin.jpg";

/**
 * The smallest body an endpoint accepts, built from its OWN required list.
 *
 * `FAL_REQUIRED_PROBES` is each endpoint's OpenAPI `required` minus everything
 * fal defaults — "what a caller must actually send" — and it is generated
 * precisely so a sweep like this does not have to guess. Guessing is what the
 * first draft of this test did, and it was wrong seven ways: six endpoints take
 * `image_urls` rather than `image_url`, and the fill route needs a `mask_url`
 * on top.
 */
function minimalBody(endpoint: string): Record<string, unknown> {
  const shape = FAL_IMAGE_EDIT_SHAPES[endpoint as keyof typeof FAL_IMAGE_EDIT_SHAPES];
  const required = FAL_REQUIRED_PROBES[endpoint as keyof typeof FAL_REQUIRED_PROBES] ?? [];
  const body: Record<string, unknown> = { endpoint };
  for (const name of required as readonly string[]) {
    const spec = (
      shape.props as Record<
        string,
        { t: string; media?: string; enum?: readonly (string | number)[] }
      >
    )[name];
    if (spec === undefined) continue;
    if (spec.t === "array") body[name] = [IMAGE];
    else if (spec.media !== undefined) body[name] = IMAGE;
    else if (spec.enum !== undefined) body[name] = spec.enum[0];
    else body[name] = PROMPT;
  }
  return body;
}

describe("routing", () => {
  test("every curated editing endpoint routes to its own queue URL, and validates clean", () => {
    // A floor, so a roster that lost its rows could not make this vacuous.
    expect(FAL_IMAGE_EDIT_ENDPOINTS.length).toBeGreaterThanOrEqual(17);
    for (const endpoint of FAL_IMAGE_EDIT_ENDPOINTS) {
      const result = imageEdit.safe(minimalBody(endpoint) as never);
      expect(result.ok, `${endpoint}: ${result.ok ? "" : JSON.stringify(result.errors)}`).toBe(true);
      if (!result.ok) continue;
      expect(result.warnings, endpoint).toEqual([]);
      expect(result.params.request.url).toBe(`https://queue.fal.run/${endpoint}`);
    }
  });

  test("a four-segment id keeps all four segments", () => {
    const params = imageEdit({
      endpoint: "fal-ai/flux-pro/kontext/max/multi",
      prompt: PROMPT,
      image_urls: [IMAGE],
    });
    expect(params.request.url).toBe("https://queue.fal.run/fal-ai/flux-pro/kontext/max/multi");
  });

  test("`endpoint` is stripped, and `.toSdk(\"fal\")` nests under `input`", () => {
    const params = imageEdit({
      endpoint: "fal-ai/flux-pro/kontext",
      prompt: PROMPT,
      image_url: IMAGE,
    });
    expect(Object.keys(params).sort()).toEqual(["image_url", "prompt"]);
    expect(params.toSdk("fal")).toEqual({ input: { prompt: PROMPT, image_url: IMAGE } });
  });

  test("Bria Relight is a known direct request but not a prompt-based unified model", () => {
    expect(FAL_IMAGE_EDIT_ENDPOINTS).toContain("bria/fibo-edit/relight");
    expect(FAL_IMAGE_EDIT_MODELS).not.toContain("bria/fibo-edit/relight" as never);

    const result = imageEdit.safe({
      endpoint: "bria/fibo-edit/relight",
      image_url: IMAGE,
      light_direction: "top-down",
      light_type: "soft overcast daylight lighting",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toEqual([]);
    const params = result.params;
    expect(params.request.url).toBe("https://queue.fal.run/bria/fibo-edit/relight");
    expect(Object.keys(params)).toEqual(["image_url", "light_direction", "light_type"]);
    expect(params.toSdk("fal")).toEqual({
      input: {
        image_url: IMAGE,
        light_direction: "top-down",
        light_type: "soft overcast daylight lighting",
      },
    });
    expect(result.estimate.costUSD).toBe(0.04);
  });
});

describe("the source picture, three spellings", () => {
  test("`image_url` on the single-image routes", () => {
    const result = imageEdit.safe({
      endpoint: "fal-ai/flux-pro/kontext",
      prompt: PROMPT,
      image_url: IMAGE,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toEqual([]);
  });

  test("`image_urls` on the multi-image routes, and NOT `image_url`", () => {
    const list = imageEdit.safe({
      endpoint: "fal-ai/nano-banana-2/edit",
      prompt: PROMPT,
      image_urls: [IMAGE],
    });
    expect(list.ok).toBe(true);
    if (!list.ok) return;
    expect(list.warnings).toEqual([]);

    // The singular is a sibling's parameter, so it draws the endpoint-citing
    // warning rather than the pipeline's generic one — the whole reason the
    // per-endpoint IR exists.
    const singular = imageEdit.safe({
      endpoint: "fal-ai/nano-banana-2/edit",
      prompt: PROMPT,
      image_url: IMAGE,
    } as never);
    expect(singular.ok).toBe(true);
    if (!singular.ok) return;
    expect(singular.warnings.map((issue) => issue.code)).toEqual(["unknown_param"]);
    expect(singular.warnings[0]?.message).toContain("image_urls");
  });

  test("`mask_url` exists on the fill route and nowhere else", () => {
    const fill = imageEdit.safe({
      endpoint: "fal-ai/flux-pro/v1/fill",
      prompt: PROMPT,
      image_url: IMAGE,
      mask_url: "https://example.com/mask.png",
    });
    expect(fill.ok).toBe(true);
    if (!fill.ok) return;
    expect(fill.warnings).toEqual([]);

    const elsewhere = imageEdit.safe({
      endpoint: "fal-ai/flux-pro/kontext",
      prompt: PROMPT,
      image_url: IMAGE,
      mask_url: "https://example.com/mask.png",
    } as never);
    expect(elsewhere.ok).toBe(true);
    if (!elsewhere.ok) return;
    expect(elsewhere.warnings.map((issue) => issue.code)).toEqual(["unknown_param"]);
    expect(elsewhere.warnings[0]?.message).toContain("mask_url");
  });

  test("a media parameter must be a reference, and says what a reference is", () => {
    const local = imageEdit.safe({
      endpoint: "fal-ai/flux-pro/kontext",
      prompt: PROMPT,
      image_url: "/Users/me/cabin.jpg",
    });
    expect(local.ok).toBe(false);
    if (local.ok) return;
    const [issue] = local.errors;
    expect(issue?.path).toEqual(["image_url"]);
    expect(issue?.message).toContain("looks like a local path");
    expect(issue?.meta).toMatchObject({ media: "image" });

    // A `data:` URI is a reference, and is accepted.
    const inline = imageEdit.safe({
      endpoint: "fal-ai/flux-pro/kontext",
      prompt: PROMPT,
      image_url: "data:image/png;base64,aVZCT1J3MEtHZ28=",
    });
    expect(inline.ok).toBe(true);

    // …and inside an ARRAY too, with the index in the path.
    const badItem = imageEdit.safe({
      endpoint: "fal-ai/nano-banana-2/edit",
      prompt: PROMPT,
      image_urls: [IMAGE, "cabin.jpg"],
    });
    expect(badItem.ok).toBe(false);
    if (badItem.ok) return;
    expect(badItem.errors[0]?.path).toEqual(["image_urls", 1]);
  });
});

describe("per-endpoint narrowing", () => {
  test("`strength` is a real field on the image-to-image route only", () => {
    const i2i = imageEdit.safe({
      endpoint: "fal-ai/flux/dev/image-to-image",
      prompt: PROMPT,
      image_url: IMAGE,
      strength: 0.6,
    });
    expect(i2i.ok).toBe(true);
    if (!i2i.ok) return;
    expect(i2i.warnings).toEqual([]);

    // …and its floor is 0.01, not 0 — the number the unified adapter clamps to.
    const belowFloor = imageEdit.safe({
      endpoint: "fal-ai/flux/dev/image-to-image",
      prompt: PROMPT,
      image_url: IMAGE,
      strength: 0,
    });
    expect(belowFloor.ok).toBe(false);
    if (belowFloor.ok) return;
    expect(belowFloor.errors[0]?.message).toContain("at least 0.01");
  });

  test("a required source is an error when it is missing", () => {
    const result = imageEdit.safe({
      endpoint: "fal-ai/flux-pro/kontext",
      prompt: PROMPT,
    } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((issue) => issue.path[0])).toContain("image_url");
  });

  test("an unknown editing endpoint degrades to a warning and still routes", () => {
    const result = imageEdit.safe({
      endpoint: "fal-ai/some-new-editor",
      prompt: PROMPT,
      image_url: IMAGE,
    } as never);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.map((issue) => issue.code)).toEqual(["unknown_model"]);
    expect(result.params.request.url).toBe("https://queue.fal.run/fal-ai/some-new-editor");
  });
});

describe("estimates", () => {
  test("a flat per-image editing rate is a number", () => {
    const result = imageEdit.safe({
      endpoint: "fal-ai/flux-pro/kontext",
      prompt: PROMPT,
      image_url: IMAGE,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.estimate.costUSD).toBe(0.04);
  });

  test("a rate billed across INPUT megapixels cannot be estimated", () => {
    // `fal-ai/flux-2/edit` bills per megapixel of input AND output, and the
    // input's pixel count is a property of a file at the far end of a URL.
    const result = imageEdit.safe({
      endpoint: "fal-ai/flux-2/edit",
      prompt: PROMPT,
      image_urls: [IMAGE],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.estimate.costUSD).toBeUndefined();
  });
});
