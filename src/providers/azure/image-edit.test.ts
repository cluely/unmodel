import { describe, expect, test } from "bun:test";
import {
  createAzure,
  azureMaiImagesEditsUrl,
  createMaiImageEdit,
  toMaiEditFormData,
} from "./index";
import { MAI_IMAGE_EDIT_MODEL_IDS } from "./mai-image-models";

const azure = createAzure({ endpoint: "https://my-resource.services.ai.azure.com" });

const png = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" });
const jpeg = new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: "image/jpeg" });

describe("azure MAI image-edit URL construction", () => {
  test("endpoint + /mai/v1/images/edits", () => {
    expect(azure.imageEditUrl).toBe("https://my-resource.services.ai.azure.com/mai/v1/images/edits");
  });

  test("trailing slashes on the endpoint are stripped", () => {
    expect(azureMaiImagesEditsUrl("https://x.services.ai.azure.com/")).toBe(
      "https://x.services.ai.azure.com/mai/v1/images/edits",
    );
  });

  test("createMaiImageEdit stands alone without the chat surface", () => {
    const imageEdit = createMaiImageEdit("https://solo.services.ai.azure.com");
    const v = imageEdit({ model: "MAI-Image-2.5", prompt: "edit", image: png });
    expect(v.request.url).toBe("https://solo.services.ai.azure.com/mai/v1/images/edits");
  });
});

describe("azure MAI image-edit multipart body", () => {
  test("request is a form request: empty headers, body 'form', props are the params", () => {
    const v = azure.imageEdit({ model: "my-mai-deployment", prompt: "make it studio-lit", image: png });
    expect(v.request.method).toBe("POST");
    expect(v.request.url).toBe(azure.imageEditUrl);
    // fetch must derive the multipart boundary from the FormData body.
    expect(v.request.headers).toEqual({});
    expect(v.request.body).toBe("form");
    expect(Object.keys(v)).toEqual(["model", "prompt", "image"]);
    expect(v.image).toBe(png);
    expect(v.toSdk("azure").image).toBe(png);
  });

  test("toMaiEditFormData builds the documented parts: model, prompt, one `image`", () => {
    const v = azure.imageEdit({ model: "my-mai-deployment", prompt: "edit", image: jpeg });
    const form = toMaiEditFormData(v);
    expect(form.get("model")).toBe("my-mai-deployment");
    expect(form.get("prompt")).toBe("edit");
    const part = form.get("image");
    expect(part).toBeInstanceOf(Blob);
    expect((part as Blob).type).toBe("image/jpeg");
    expect(form.getAll("image")).toHaveLength(1);
  });

  test("OpenAI-dialect edit params are compile errors (ExactKeys)", () => {
    // The MAI edits API documents no mask and no image[] array.
    // @ts-expect-error — `mask` is not a MAI edits param
    const r = azure.imageEdit.safe({ model: "MAI-Image-2.5", prompt: "edit", image: png, mask: png });
    expect(r.ok).toBe(true);
    // @ts-expect-error — width/height are generations-only params
    const r2 = azure.imageEdit.safe({ model: "MAI-Image-2.5", prompt: "edit", image: png, width: 1024 });
    expect(r2.ok).toBe(true);
  });

  test("a missing image is a schema error", () => {
    const safe = azure.imageEdit.safe as unknown as (p: unknown) => { ok: boolean };
    expect(safe({ model: "MAI-Image-2.5", prompt: "edit" }).ok).toBe(false);
  });
});

describe("azure MAI image-edit format rules", () => {
  test("a Blob labeled JPEG or PNG passes", () => {
    for (const blob of [png, jpeg]) {
      const r = azure.imageEdit.safe({ model: "MAI-Image-2.5", prompt: "edit", image: blob });
      expect(r.ok).toBe(true);
    }
  });

  test("a Blob labeled webp is refused — the API takes JPEG or PNG", () => {
    const webp = new Blob([new Uint8Array([0x52])], { type: "image/webp" });
    const r = azure.imageEdit.safe({ model: "MAI-Image-2.5", prompt: "edit", image: webp });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("media_unsupported_format");
      expect(r.errors[0]?.path).toEqual(["image"]);
    }
  });

  test("an unlabeled Blob makes no format claim and passes", () => {
    const bare = new Blob([new Uint8Array([1, 2, 3])]);
    const r = azure.imageEdit.safe({ model: "MAI-Image-2.5", prompt: "edit", image: bare });
    expect(r.ok).toBe(true);
  });
});

describe("azure MAI image-edit model gating", () => {
  test("every 2.5-family canonical name is accepted", () => {
    for (const id of MAI_IMAGE_EDIT_MODEL_IDS) {
      const r = azure.imageEdit.safe({ model: id, prompt: "edit", image: png });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.warnings).toEqual([]);
    }
  });

  test("MAI-Image-2e is refused — text-to-image only", () => {
    const r = azure.imageEdit.safe({ model: "MAI-Image-2e", prompt: "edit", image: png });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("unsupported_capability");
      expect(r.errors[0]?.path).toEqual(["model"]);
      expect(r.errors[0]?.message).toContain("MAI-Image-2e");
    }
  });

  test("a deployment RESOLVING to MAI-Image-2e is refused too (MAI-Image-2e-prod)", () => {
    const r = azure.imageEdit.safe({ model: "MAI-Image-2e-prod", prompt: "edit", image: png });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("unsupported_capability");
  });

  test("custom deployment names get an unknown_model warning, no capability error", () => {
    const r = azure.imageEdit.safe({ model: "my-editor", prompt: "edit", image: png });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
  });
});
