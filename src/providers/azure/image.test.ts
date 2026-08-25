import { describe, expect, test } from "bun:test";
import { createAzure, azureMaiImagesGenerationsUrl, createMaiImage } from "./index";
import {
  MAI_IMAGE_MAX_TOTAL_PIXELS,
  MAI_IMAGE_MIN_DIMENSION,
  MAI_IMAGE_MODEL_IDS,
  maiImageModels,
} from "./mai-image-models";

const azure = createAzure({ endpoint: "https://my-resource.services.ai.azure.com" });

describe("azure MAI image URL construction", () => {
  test("endpoint + /mai/v1/images/generations", () => {
    expect(azure.imageUrl).toBe(
      "https://my-resource.services.ai.azure.com/mai/v1/images/generations",
    );
  });

  test("trailing slashes on the endpoint are stripped", () => {
    expect(azureMaiImagesGenerationsUrl("https://x.services.ai.azure.com/")).toBe(
      "https://x.services.ai.azure.com/mai/v1/images/generations",
    );
  });

  test("instances are independent: each carries its own URL", () => {
    const other = createAzure({ endpoint: "https://other.services.ai.azure.com" });
    const a = azure.image({ model: "MAI-Image-2.5", prompt: "a poster" });
    const b = other.image({ model: "MAI-Image-2.5", prompt: "a poster" });
    expect(a.request.url).toBe(azure.imageUrl);
    expect(b.request.url).toBe("https://other.services.ai.azure.com/mai/v1/images/generations");
  });

  test("createMaiImage stands alone without the chat surface", () => {
    const image = createMaiImage("https://solo.services.ai.azure.com");
    const v = image({ model: "MAI-Image-2e", prompt: "hi" });
    expect(v.request.url).toBe("https://solo.services.ai.azure.com/mai/v1/images/generations");
  });
});

describe("azure MAI image wire body", () => {
  test("enumerable props are the exact wire body; request carries url/method/headers", () => {
    const params = {
      model: "my-mai-deployment",
      prompt: "A photorealistic concept art poster",
      width: 1024,
      height: 1024,
    };
    const v = azure.image(params);
    expect(Object.keys(v)).toEqual(["model", "prompt", "width", "height"]);
    expect(JSON.parse(JSON.stringify(v))).toEqual(params);
    expect(v.toSdk("azure")).toEqual(params);
    expect(v.request.method).toBe("POST");
    expect(v.request.url).toBe(azure.imageUrl);
    expect(v.request.headers).toEqual({ "content-type": "application/json" });
  });

  test("width/height are optional — the docs mark no default and no required flag", () => {
    const r = azure.image.safe({ model: "MAI-Image-2.5", prompt: "hi" });
    expect(r.ok).toBe(true);
  });

  test("typo'd and OpenAI-dialect keys are compile errors (ExactKeys)", () => {
    // The /mai/ surface has no `size` — that is the /openai/ images dialect.
    // @ts-expect-error — `size` is not a MAI generations param
    const r = azure.image.safe({ model: "MAI-Image-2.5", prompt: "hi", size: "1024x1024" });
    expect(r.ok).toBe(true);
    // @ts-expect-error — `n` is not a MAI generations param ("Output: One image")
    const r2 = azure.image.safe({ model: "MAI-Image-2.5", prompt: "hi", n: 2 });
    expect(r2.ok).toBe(true);
  });
});

describe("azure MAI image dimension rules", () => {
  test("below the 768 minimum is an error, naming the dimension", () => {
    const r = azure.image.safe({ model: "MAI-Image-2.5", prompt: "hi", width: 512, height: 1024 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("invalid_shape");
      expect(r.errors[0]?.path).toEqual(["width"]);
      expect(r.errors[0]?.message).toContain(String(MAI_IMAGE_MIN_DIMENSION));
    }
  });

  test("total pixel count over 1,048,576 is an error", () => {
    // 1024 × 1365 = 1,397,760 > 1,048,576.
    const r = azure.image.safe({ model: "MAI-Image-2.5", prompt: "hi", width: 1024, height: 1365 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors).toHaveLength(1);
      expect(r.errors[0]?.code).toBe("invalid_shape");
      expect(r.errors[0]?.meta?.maxPixels).toBe(MAI_IMAGE_MAX_TOTAL_PIXELS);
    }
  });

  test("the documented example 768×1365 (1,048,320 px) passes", () => {
    const r = azure.image.safe({ model: "MAI-Image-2.5", prompt: "hi", width: 768, height: 1365 });
    expect(r.ok).toBe(true);
  });

  test("1024×1024 (exactly the cap) passes", () => {
    const r = azure.image.safe({ model: "MAI-Image-2.5", prompt: "hi", width: 1024, height: 1024 });
    expect(r.ok).toBe(true);
  });

  test("non-integer dimensions are rejected by the schema", () => {
    const r = azure.image.safe({ model: "MAI-Image-2.5", prompt: "hi", width: 1024.5, height: 768 });
    expect(r.ok).toBe(false);
  });
});

describe("azure MAI image deployment-name catalog matching", () => {
  test("every canonical MAI name resolves without an unknown_model warning", () => {
    for (const id of MAI_IMAGE_MODEL_IDS) {
      const r = azure.image.safe({ model: id, prompt: "hi" });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.warnings.map((w) => w.code)).not.toContain("unknown_model");
    }
  });

  test("prefixed deployment names resolve best-effort (MAI-Image-2.5-Pro-prod)", () => {
    const r = azure.image.safe({ model: "MAI-Image-2.5-Pro-prod", prompt: "hi" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).not.toContain("unknown_model");
  });

  test("custom deployment names get an unknown_model warning, checks still run", () => {
    const r = azure.image.safe({ model: "my-images", prompt: "hi", width: 512, height: 1024 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.warnings.map((w) => w.code)).toContain("unknown_model");
      // The endpoint-wide pixel rules are not model-dependent, so they fire anyway.
      expect(r.errors[0]?.code).toBe("invalid_shape");
    }
  });

  test("MAI-Image-2e is a documented generations model", () => {
    const r = azure.image.safe({ model: "MAI-Image-2e", prompt: "hi" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  test("no cost estimate — Microsoft publishes no per-image USD rate", () => {
    for (const info of Object.values(maiImageModels)) {
      expect("cost" in info).toBe(false);
    }
    const r = azure.image.safe({ model: "MAI-Image-2.5", prompt: "hi" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeUndefined();
  });
});
