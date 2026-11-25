import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { imageEditRemoveBackground } from "./image-edit-remove-background";
import { EDIT_URL, PHOTOROOM_SEGMENT_MAX_BYTES, SEGMENT_URL } from "./constants";
import { PHOTOROOM_SEGMENT_FIELDS } from "./gen/image-edit-remove-background-fields.gen";
import { PHOTOROOM_SEGMENT_FIELD_SCHEMAS } from "./gen/image-edit-remove-background-schema.gen";
import { models, provider } from "./models";
import { toFormData } from "./form";
import type { Issue } from "../../core/issues";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";

type Unchecked = (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;

const unchecked = imageEditRemoveBackground.safe as unknown as Unchecked;

function png(bytes = 3): Blob {
  return new Blob([new Uint8Array(bytes)], { type: "image/png" });
}

function run(params: Record<string, unknown>): { ok: boolean; errors: Issue[]; warnings: Issue[] } {
  const result = unchecked(params);
  return { ok: result.ok, errors: result.ok ? [] : result.errors, warnings: result.warnings };
}

describe("photoroom.imageEditRemoveBackground — the request", () => {
  test("posts to the Remove Background host, which is not the Image Editing one", () => {
    expect(SEGMENT_URL).toBe("https://sdk.photoroom.com/v1/segment");
    expect(new URL(SEGMENT_URL).host).not.toBe(new URL(EDIT_URL).host);
  });

  test("a minimal body is a multipart POST with empty headers", () => {
    const image = png();
    const req = imageEditRemoveBackground({ image_file: image });
    expect(req.request).toEqual({ url: SEGMENT_URL, method: "POST", headers: {}, body: "form" });
    expect(Object.keys(req)).toEqual(["image_file"]);
    expect(req.toSdk("photoroom")).toEqual({ image_file: image });
  });

  test("every field, and toFormData sends each as its text", () => {
    const req = imageEditRemoveBackground({
      image_file: png(),
      format: "jpg",
      channels: "alpha",
      bg_color: "#FF00FF",
      size: "hd",
      crop: "true",
      despill: "false",
    });
    const form = toFormData(req);
    expect([...form.keys()].sort()).toEqual(["bg_color", "channels", "crop", "despill", "format", "image_file", "size"]);
    expect(form.get("image_file")).toBeInstanceOf(Blob);
    expect(form.get("crop")).toBe("true");
    expect(form.get("format")).toBe("jpg");
  });

  test("the estimate is the Basic rate — a fifth of the Image Editing one", () => {
    const result = imageEditRemoveBackground.safe({ image_file: png() });
    expect(result.ok && result.estimate).toEqual({ costUSD: 0.02 });
    expect(models["remove-background"].cost.perImage).toBe(0.02);
    expect(models["image-editing"].cost.perImage / models["remove-background"].cost.perImage).toBeCloseTo(5);
  });

  test("the catalog: three synthetic rows, none token-billed", () => {
    expect(Object.keys(models).sort()).toEqual(["edit-with-ai", "image-editing", "remove-background"]);
    for (const model of Object.values(models)) {
      expect(model.limit).toEqual({ context: 0 });
      expect(model.modalities.output).toEqual(["image"]);
    }
    expect(provider).toEqual({
      id: "photoroom",
      name: "Photoroom",
      env: ["PHOTOROOM_API_KEY"],
      doc: "https://docs.photoroom.com/",
    });
  });
});

describe("photoroom.imageEditRemoveBackground — refusals", () => {
  test("`image_file` is required", () => {
    const { ok, errors } = run({ format: "png" });
    expect(ok).toBe(false);
    expect(errors.map((e) => [e.code, e.path, e.message])).toEqual([
      ["invalid_shape", ["image_file"], "`image_file` is required"],
    ]);
  });

  test("`format` is jpg, not jpeg — the message names the three it takes", () => {
    const { ok, errors } = run({ image_file: png(), format: "jpeg" });
    expect(ok).toBe(false);
    expect(errors.map((e) => e.message)).toEqual(['`format` must be one of "png", "jpg", "webp"; got "jpeg"']);
  });

  test("`crop` and `despill` take a boolean as well as its text: the form part is the same", () => {
    const result = imageEditRemoveBackground.safe({ image_file: png(), crop: true, despill: false });
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    const form = toFormData(result.params);
    expect(form.get("crop")).toBe("true");
    expect(form.get("despill")).toBe("false");
    const { ok, errors } = run({ image_file: png(), crop: "yes" });
    expect(ok).toBe(false);
    expect(errors.map((e) => e.message)).toEqual(['`crop` must be a boolean or the string "true" or "false"; got "yes"']);
  });


  test("the remove.bg values Photoroom does not carry over are refused by name", () => {
    expect(run({ image_file: png(), size: "auto" }).errors.map((e) => e.message)).toEqual([
      '`size` must be one of "preview", "medium", "hd", "full"; got "auto"',
    ]);
    expect(run({ image_file: png(), format: "zip" }).ok).toBe(false);
    expect(run({ image_file: png(), channels: "rgb" }).ok).toBe(false);
  });

  test("`image_file` must be a Blob", () => {
    expect(run({ image_file: "/tmp/a.png" }).errors.map((e) => e.message)).toEqual([
      '`image_file` must be a Blob — it is a file part of the multipart form; got "/tmp/a.png"',
    ]);
  });

  test("a file over 50 MB is media_too_large", () => {
    expect(PHOTOROOM_SEGMENT_MAX_BYTES).toBe(52_428_800);
    const edge = { size: PHOTOROOM_SEGMENT_MAX_BYTES };
    Object.setPrototypeOf(edge, Blob.prototype);
    expect(run({ image_file: edge }).ok).toBe(true);
    const big = { size: PHOTOROOM_SEGMENT_MAX_BYTES + 1 };
    Object.setPrototypeOf(big, Blob.prototype);
    const { ok, errors } = run({ image_file: big });
    expect(ok).toBe(false);
    expect(errors.map((e) => [e.code, e.path, e.meta?.limit])).toEqual([
      ["media_too_large", ["image_file"], PHOTOROOM_SEGMENT_MAX_BYTES],
    ]);
  });

  test("a remove.bg argument Photoroom does not take is a warning that lists what it does take", () => {
    const { ok, warnings } = run({ image_file: png(), image_url: "https://example.com/a.png", add_shadow: "true" });
    expect(ok).toBe(true);
    expect(warnings.map((w) => [w.code, w.path[0]])).toEqual([
      ["unknown_param", "image_url"],
      ["unknown_param", "add_shadow"],
    ]);
    expect(warnings[0]?.message).toContain(
      "It takes `image_file`, `format`, `channels`, `bg_color`, `size`, `crop` and `despill`",
    );
    expect(String(warnings[0]?.meta?.source)).toContain("how-to-migrate-from-remove.bg-api");
  });

  test("the Image Editing feature headers are not fields here", () => {
    const { ok, warnings } = run({ image_file: png(), "pr-hd-background-removal": "auto" });
    expect(ok).toBe(true);
    expect(warnings.map((w) => w.path[0])).toEqual(["pr-hd-background-removal"]);
  });

  test("the schema leaves are exactly the seven generated fields", () => {
    expect(Object.keys(PHOTOROOM_SEGMENT_FIELD_SCHEMAS)).toEqual(Object.keys(PHOTOROOM_SEGMENT_FIELDS));
    expect(Object.keys(PHOTOROOM_SEGMENT_FIELDS).length).toBe(7);
  });
});

interface DocsExample {
  page: string;
  url: string;
  fields: Record<string, string>;
}

describe("photoroom.imageEditRemoveBackground — Photoroom's own docs examples", () => {
  const examples = (
    JSON.parse(
      readFileSync(new URL("../../../test/fixtures/photoroom/docs-examples.json", import.meta.url), "utf8"),
    ) as { examples: DocsExample[] }
  ).examples.filter((example) => example.url === SEGMENT_URL);

  test("every example validates with no error and no warning", () => {
    expect(examples.length).toBe(7);
    for (const example of examples) {
      const params = Object.fromEntries(
        Object.entries(example.fields).map(([key, text]) => [key, text === "@file" ? png() : text]),
      );
      expect({ page: example.page, ...run(params) }).toEqual({ page: example.page, ok: true, errors: [], warnings: [] });
    }
  });
});
