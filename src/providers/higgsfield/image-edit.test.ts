import { describe, expect, test } from "bun:test";
import { HIGGSFIELD_IMAGE_EDIT_ENDPOINTS } from "./gen/endpoints.gen";
import { HIGGSFIELD_IMAGE_SHAPES } from "./gen/image-narrow.gen";
import { imageEditModels, imageModels } from "./gen/models-image.gen";
import { image } from "./image";
import { imageEdit } from "./image-edit";

/** The JSON a validated result serialises to: its enumerable properties, which are the wire body. */
function bodyOf(validated: object): unknown {
  return JSON.parse(JSON.stringify(validated));
}

/** `higgsfield.imageEdit` — the view — against the REAL generated rows. */

const QWEN = "alibaba/qwen-image-3/edit" as const;
const PICTURE = "https://example.com/portrait.png";

describe("higgsfield.imageEdit", () => {
  test("the same path and the same body as `higgsfield.image`", () => {
    const edited = imageEdit({ endpoint: QWEN, prompt: "Make the jacket red", image_urls: [PICTURE] });
    const wide = image({ endpoint: QWEN, prompt: "Make the jacket red", image_urls: [PICTURE] });
    expect(bodyOf(edited)).toEqual(bodyOf(wide));
    expect(edited.request).toEqual(wide.request);
    expect(edited.request.url).toBe("https://api.higgsfield.ai/alibaba/qwen-image-3/edit");
    expect(edited.toSdk("higgsfield")).toEqual({ input: { prompt: "Make the jacket red", image_urls: [PICTURE] } });
  });

  test("`endpoint` and `hf_webhook` are stripped, and nothing else changes", () => {
    const result = imageEdit.safe({ endpoint: "higgsfield-ai/soul/v2/image-to-image", prompt: "x", image_url: PICTURE, seed: null, batch_size: 1, hf_webhook: "https://hooks.example.com/hf" });
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(bodyOf(result.params)).toEqual({ prompt: "x", image_url: PICTURE, seed: null, batch_size: 1 });
    expect(result.params.request.url).toEndWith("/higgsfield-ai/soul/v2/image-to-image?hf_webhook=https%3A%2F%2Fhooks.example.com%2Fhf");
  });

  test("the view is ten of the image routes, and every one declares a picture parameter", () => {
    expect([...HIGGSFIELD_IMAGE_EDIT_ENDPOINTS]).toEqual([
      "alibaba/qwen-image-3/edit",
      "bytedance/seedream/v5.0/pro/edit",
      "higgsfield-ai/soul/v2/image-to-image",
      "ideogram/v4.0",
      "kling-image/v4.0/edit",
      "kling-image/v4.0/edit/series",
      "marketing-studio/image",
      "marketing-studio/image/flare",
      "marketing-studio/image/sunburst",
      "xai/grok-imagine-image-2.0",
    ]);
    for (const id of HIGGSFIELD_IMAGE_EDIT_ENDPOINTS) {
      const props: Record<string, unknown> = HIGGSFIELD_IMAGE_SHAPES[id].props;
      expect("image_url" in props || "image_urls" in props, id).toBe(true);
    }
  });

  test("its catalog rows are `higgsfield.image`'s rows, not copies", () => {
    expect(Object.keys(imageEditModels)).toEqual([...HIGGSFIELD_IMAGE_EDIT_ENDPOINTS]);
    for (const id of HIGGSFIELD_IMAGE_EDIT_ENDPOINTS) expect(imageEditModels[id]).toBe(imageModels[id]);
  });

  test("an image route that does not edit is REFUSED here, and validated one address over", () => {
    const params = { endpoint: "z-image/turbo", prompt: "a fox" } as const;
    const result = imageEdit.safe(params as never);
    expect(!result.ok && result.errors).toMatchObject([
      {
        severity: "error",
        code: "unsupported_capability",
        path: ["endpoint"],
        message: "higgsfield.imageEdit serves the Higgsfield routes that edit a picture, and `z-image/turbo` is not one of them. `higgsfield.image` validates it.",
      },
    ]);
    expect(image.safe(params).ok).toBe(true);
  });

  test("AI Influencer is filed under `image_edit` by the vendor and is not in the view", () => {
    const result = imageEdit.safe({ endpoint: "higgsfield/ai-influencer", image_url: PICTURE } as never);
    expect(!result.ok && result.errors.map((issue) => issue.code)).toEqual(["unsupported_capability"]);
    expect(image.safe({ endpoint: "higgsfield/ai-influencer", image_url: PICTURE }).ok).toBe(true);
  });

  test("a route that also generates from text needs the picture to be an edit", () => {
    const result = imageEdit.safe({ endpoint: "ideogram/v4.0", prompt: "a fox" });
    expect(!result.ok && result.errors.map((issue) => issue.message)).toEqual([
      "higgsfield.imageEdit is for requests that edit a picture: send `image_url` or `image_urls`. Without one this is a plain generation on ideogram/v4.0, which `higgsfield.image` validates.",
    ]);
    expect(imageEdit.safe({ endpoint: "ideogram/v4.0", prompt: "a fox", image_url: PICTURE }).ok).toBe(true);
    // An empty list names no picture: Marketing Studio then generates from text.
    const empty = imageEdit.safe({ endpoint: "marketing-studio/image", prompt: "x", image_urls: [] });
    expect(!empty.ok && empty.errors.map((issue) => [issue.code, issue.path])).toEqual([["invalid_shape", ["image_url"]]]);
    expect(image.safe({ endpoint: "ideogram/v4.0", prompt: "a fox" }).ok).toBe(true);
  });

  test("a video route's id is only signposted: it is not this view's wide address's either", () => {
    const result = imageEdit.safe({ endpoint: "bytedance/seedance-2.5/text-to-video", prompt: "x" } as never);
    expect(result.ok && result.warnings.map((issue) => [issue.severity, issue.meta?.["address"]])).toEqual([["warning", "higgsfield.video"]]);
  });

  test("an excluded id is a warning with its reason", () => {
    const result = imageEdit.safe({ endpoint: "higgsfiled/genjutsu/object-swap/v1.0", image_url: PICTURE });
    expect(result.ok && result.warnings.map((issue) => issue.code)).toEqual(["unknown_model"]);
  });

  test("a `data:` URI is reported with the upload route, and a local path is refused with it", () => {
    const inline = imageEdit.safe({ endpoint: "higgsfield-ai/soul/v2/image-to-image", prompt: "x", image_url: "data:image/png;base64,AAAA" });
    expect(inline.ok && inline.warnings.map((issue) => issue.meta?.["hint"])).toEqual(["https://docs.higgsfield.ai/docs/concepts/file-uploads.md"]);
    const local = imageEdit.safe({ endpoint: "higgsfield-ai/soul/v2/image-to-image", prompt: "x", image_url: "/tmp/a.png" });
    expect(!local.ok && local.errors[0]?.message).toContain("POST https://api.higgsfield.ai/files/generate-upload-url");
  });

  test("a list-taking route caps its list from its own row", () => {
    const result = imageEdit.safe({ endpoint: QWEN, prompt: "x", image_urls: [PICTURE, PICTURE, PICTURE, PICTURE] });
    expect(!result.ok && result.errors[0]?.message).toBe("`image_urls` accepts at most 3 entries on alibaba/qwen-image-3/edit; got 4.");
  });
});
