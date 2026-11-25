import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { imageEdit, type EditParams } from "./image-edit";
import {
  EDIT_URL,
  PHOTOROOM_EDIT_MAX_BYTES,
  PHOTOROOM_REQUEST_HEADERS,
  PHOTOROOM_RESPONSE_HEADERS,
} from "./constants";
import { PHOTOROOM_EDIT_FAMILIES, PHOTOROOM_EDIT_FIELDS } from "./gen/image-edit-fields.gen";
import {
  PHOTOROOM_EDIT_FAMILY_SCHEMAS,
  PHOTOROOM_EDIT_FIELD_SCHEMAS,
} from "./gen/image-edit-schema.gen";
import { PHOTOROOM_PRICING_CAVEAT, models } from "./models";
import { toFormData } from "./form";
import { familySlot } from "./shared";
import type { PhotoroomFieldSpec } from "./field-types";
import type { Issue } from "../../core/issues";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";

type Unchecked = (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown> & { request: { headers: Record<string, string> } }>;

const unchecked = imageEdit.safe as unknown as Unchecked;

function png(bytes = 3): Blob {
  return new Blob([new Uint8Array(bytes)], { type: "image/png" });
}

/** Runs a request and returns its issues, whichever way it went. */
function run(params: Record<string, unknown>): { ok: boolean; errors: Issue[]; warnings: Issue[] } {
  const result = unchecked(params);
  return { ok: result.ok, errors: result.ok ? [] : result.errors, warnings: result.warnings };
}

function at(issues: Issue[], path: string): Issue | undefined {
  return issues.find((issue) => issue.path.join("/") === path);
}

describe("photoroom.imageEdit — the request", () => {
  test("posts to the Image Editing host", () => {
    expect(EDIT_URL).toBe("https://image-api.photoroom.com/v2/edit");
  });

  test("a minimal body is a multipart POST with no headers", () => {
    const image = png();
    const req = imageEdit({ imageFile: image });
    expect(req.request).toEqual({ url: EDIT_URL, method: "POST", headers: {}, body: "form" });
    expect(req.imageFile).toBe(image);
    expect(Object.keys(req)).toEqual(["imageFile"]);
    expect(req.toSdk("photoroom")).toEqual({ imageFile: image });
  });

  test("the five feature headers are lifted onto .request.headers and off the body", () => {
    const req = imageEdit({
      imageFile: png(),
      "shadow.mode": "ai.auto-with-overrides",
      "pr-ai-background-model-version": "background-studio-beta-2025-03-17",
      "pr-ai-shadows-model-version": "2026-04-15",
      "pr-hd-background-removal": "auto",
      "pr-ai-upscale-model-version": "ai-upscale-2025-07-29",
      "pr-ironing-model-version": "v2",
    });
    expect(req.request.headers).toEqual({
      "pr-ai-background-model-version": "background-studio-beta-2025-03-17",
      "pr-ai-shadows-model-version": "2026-04-15",
      "pr-hd-background-removal": "auto",
      "pr-ai-upscale-model-version": "ai-upscale-2025-07-29",
      "pr-ironing-model-version": "v2",
    });
    expect(Object.keys(req).sort()).toEqual(["imageFile", "shadow.mode"]);
    expect([...toFormData(req).keys()].sort()).toEqual(["imageFile", "shadow.mode"]);
    // Never a content-type: fetch derives the multipart boundary.
    expect(Object.keys(req.request.headers).every((name) => name.startsWith("pr-"))).toBe(true);
    expect(Object.keys(req.request.headers).sort()).toEqual([...PHOTOROOM_REQUEST_HEADERS].sort());
  });

  test("a header value is open — a version Photoroom ships later is not refused", () => {
    const req = imageEdit({ imageFile: png(), "pr-ai-background-model-version": "4" });
    expect(req.request.headers).toEqual({ "pr-ai-background-model-version": "4" });
    expect(at(run({ imageFile: png(), "pr-ironing-model-version": "" }).errors, "pr-ironing-model-version")?.message).toBe(
      '`pr-ironing-model-version` must not be empty; got ""',
    );
  });

  test("toFormData: a Blob is a file part, everything else its text", () => {
    const image = png();
    const req = imageEdit({
      imageFile: image,
      removeBackground: false,
      padding: 0.15,
      marginTop: "10%",
      "export.dpi": 300,
      "export.format": "webp",
    });
    const form = toFormData(req);
    expect(form.get("imageFile")).toBeInstanceOf(Blob);
    expect((form.get("imageFile") as Blob).size).toBe(image.size);
    expect(form.get("removeBackground")).toBe("false");
    expect(form.get("padding")).toBe("0.15");
    expect(form.get("marginTop")).toBe("10%");
    expect(form.get("export.dpi")).toBe("300");
    expect(form.get("export.format")).toBe("webp");
  });

  test("a number written as text is the same form part as the number, and is sent as written", () => {
    // The OpenAPI document's own `examples`: `maxWidth: ["200"]`, `background.guidance.scale: ["0.6"]`, `editWithAI.seed: ["123456"]`.
    const quoted = { imageFile: png(), maxWidth: "200", maxHeight: "200", "background.guidance.scale": "0.6", "editWithAI.seed": "123456" } as const;
    const result = imageEdit.safe(quoted);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(result.warnings).toEqual([]);
    const form = toFormData(result.params);
    expect(form.get("maxWidth")).toBe("200");
    expect(form.get("maxWidth")).toBe(toFormData(imageEdit({ imageFile: png(), maxWidth: 200 })).get("maxWidth"));
    expect(form.get("background.guidance.scale")).toBe("0.6");
    // Nothing is converted: the validated value is the caller's string.
    expect((result.params as Record<string, unknown>)["maxWidth"]).toBe("200");
  });

  test("toFormData writes a number in full: no exponent reaches the form", () => {
    const form = toFormData({ small: 1e-7, smaller: 1.5e-9, large: 1e21, larger: 1.2345e22, negative: -2.5e-7, plain: 0.02, whole: 1234567, text: "1e-7" });
    expect(form.get("small")).toBe("0.0000001");
    expect(form.get("smaller")).toBe("0.0000000015");
    expect(form.get("large")).toBe("1000000000000000000000");
    expect(form.get("larger")).toBe("12345000000000000000000");
    expect(form.get("negative")).toBe("-0.00000025");
    expect(form.get("plain")).toBe("0.02");
    expect(form.get("whole")).toBe("1234567");
    // A string is the caller's own spelling and is not rewritten.
    expect(form.get("text")).toBe("1e-7");
  });

  test("undefined and null fields are skipped by the schema and by toFormData", () => {
    const result = unchecked({ imageFile: png(), "shadow.mode": undefined, padding: null });
    expect(result.ok).toBe(true);
    if (result.ok) expect([...toFormData(result.params).keys()]).toEqual(["imageFile"]);
  });

  test("the response header names are exported", () => {
    expect(PHOTOROOM_RESPONSE_HEADERS).toEqual([
      "x-uncertainty-score",
      "pr-ai-background-seed",
      "pr-texts-detected",
      "pr-unsupported-attributes",
    ]);
  });
});

describe("photoroom.imageEdit — the catalog row and the estimate", () => {
  test("a plain edit is the `image-editing` row at $0.10", () => {
    const result = imageEdit.safe({ imageFile: png(), "lighting.mode": "ai.auto", removeBackground: false });
    expect(result.ok && result.estimate).toEqual({ costUSD: 0.1 });
    expect(models["image-editing"].cost.perImage).toBe(0.1);
  });

  test("`editWithAI.mode` selects the `edit-with-ai` row — same route, same rate", () => {
    const withAI = { imageFile: png(), removeBackground: false, "editWithAI.mode": "ai.auto", "editWithAI.prompt": "make it winter" } as const;
    const result = imageEdit.safe(withAI, { maxCostUSD: 0.05 });
    // Over a 5-cent budget, the issue names the row the request resolved to.
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.map((e) => [e.code, e.model])).toEqual([["over_budget", "edit-with-ai"]]);
    const plain = imageEdit.safe({ imageFile: png() }, { maxCostUSD: 0.05 });
    if (!plain.ok) expect(plain.errors.map((e) => e.model)).toEqual(["image-editing"]);
    expect(models["edit-with-ai"].cost.perImage).toBe(models["image-editing"].cost.perImage);
  });

  test("no estimate for `virtualModel.quality` above standard — the 2K/4K outputs have no published price", () => {
    const base = { imageFile: png(), removeBackground: false, "virtualModel.mode": "ai.auto" } as const;
    for (const quality of ["advanced", "premium"] as const) {
      const result = imageEdit.safe({ ...base, "virtualModel.quality": quality });
      expect(result.ok && result.estimate).toEqual({});
    }
    const standard = imageEdit.safe({ ...base, "virtualModel.quality": "standard" });
    expect(standard.ok && standard.estimate).toEqual({ costUSD: 0.1 });
    expect(PHOTOROOM_PRICING_CAVEAT).toContain("`virtualModel.quality` above `standard`");
  });
});

describe("photoroom.imageEdit — field refusals, from the generated leaves", () => {
  const image = png();
  const cases: ReadonlyArray<readonly [string, Record<string, unknown>, string, string]> = [
    ["an enum", { "shadow.mode": "soft" }, "shadow.mode", '`shadow.mode` must be one of "ai.soft", "ai.hard", "ai.floating", "ai.preset-soft", "ai.preset-hard", "ai.auto-with-overrides"; got "soft"'],
    ["a const", { "expand.mode": "auto" }, "expand.mode", '`expand.mode` must be one of "ai.auto"; got "auto"'],
    ["an exclusive minimum", { "background.blur.radius": 0 }, "background.blur.radius", "`background.blur.radius` must be greater than 0; got 0"],
    ["a maximum", { "background.blur.radius": 0.06 }, "background.blur.radius", "`background.blur.radius` must be at most 0.05; got 0.06"],
    ["a minimum", { "export.dpi": 71 }, "export.dpi", "`export.dpi` must be at least 72; got 71"],
    ["a minLength", { "imageFromPrompt.prompt": "" }, "imageFromPrompt.prompt", '`imageFromPrompt.prompt` must not be empty; got ""'],
    ["a pattern", { outputSize: "1000 x 1000" }, "outputSize", '`outputSize` must match ^(auto|\\d+x\\d+|originalImage|croppedSubject)$; got "1000 x 1000"'],
    ["a uuid", { templateId: "my-template" }, "templateId", '`templateId` must be a UUID; got "my-template"'],
    ["a file given as a string", { "background.imageFile": "/tmp/bg.png" }, "background.imageFile", '`background.imageFile` must be a Blob — it is a file part of the multipart form; got "/tmp/bg.png"'],
    ["a boolean given as another string", { removeBackground: "no" }, "removeBackground", '`removeBackground` must be a boolean or the string "true" or "false"; got "no"'],
    ["text that is not a number", { "export.dpi": "300dpi" }, "export.dpi", '`export.dpi` must be a finite number, or one written as text; got "300dpi"'],
    ["a number written as text, out of range", { "export.dpi": "50" }, "export.dpi", '`export.dpi` must be at least 72; got "50"'],
    ["a number-or-preset written as text that is neither", { "shadow.spreadOverride": "1.5x" }, "shadow.spreadOverride", '`shadow.spreadOverride` must be a number or one of "short", "medium", "long"; got "1.5x"'],
    ["a number-or-preset", { "shadow.spreadOverride": "wide" }, "shadow.spreadOverride", '`shadow.spreadOverride` must be a number or one of "short", "medium", "long"; got "wide"'],
    ["a number-or-string", { padding: true }, "padding", "`padding` must be a number or a string; got true"],
  ];

  for (const [name, fields, path, message] of cases) {
    test(name, () => {
      const { ok, errors } = run({ imageFile: image, ...fields });
      expect(ok).toBe(false);
      expect(errors.map((e) => [e.code, e.path.join("/"), e.message])).toEqual([["invalid_shape", path, message]]);
    });
  }

  test("both spellings of a boolean, both spellings of jpeg, and both colour syntaxes pass", () => {
    for (const fields of [
      { removeBackground: false },
      { removeBackground: "false" },
      { ignorePaddingAndSnapOnCroppedSides: "true" },
      { "export.format": "jpg" },
      { "export.format": "jpeg" },
      { "background.color": "#FF0000" },
      { "background.color": "FF0000EE" },
      { padding: 0.75 },
      { padding: "100px" },
      { "shadow.directionOverride": 135, "shadow.mode": "ai.auto-with-overrides", "pr-ai-shadows-model-version": "2026-04-15" },
    ]) {
      expect(run({ imageFile: image, ...fields })).toEqual({ ok: true, errors: [], warnings: [] });
    }
  });

  test("params that are not an object are refused at the root", () => {
    for (const bad of ["imageFile", 3, null, [png()]]) {
      const result = unchecked(bad);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.map((e) => [e.path, e.message])).toEqual([
          [[], "params must be an object whose keys are the form's field names"],
        ]);
      }
    }
  });

  test("every generated field and family has a schema leaf, and nothing else does", () => {
    expect(Object.keys(PHOTOROOM_EDIT_FIELD_SCHEMAS)).toEqual(Object.keys(PHOTOROOM_EDIT_FIELDS));
    expect(Object.keys(PHOTOROOM_EDIT_FAMILY_SCHEMAS)).toEqual(Object.keys(PHOTOROOM_EDIT_FAMILIES));
    // No header name collides with a form field.
    for (const header of PHOTOROOM_REQUEST_HEADERS) expect(Object.keys(PHOTOROOM_EDIT_FIELDS)).not.toContain(header);
  });
});

describe("photoroom.imageEdit — the open-keyed families", () => {
  const image = png();

  test("every documented notation is accepted, validated and not warned about", () => {
    const params: EditParams = {
      imageFile: image,
      removeBackground: false,
      "editWithAI.mode": "ai.auto",
      "editWithAI.prompt": "combine them",
      "editWithAI.additionalImages.styleRef.imageUrl": "https://example.com/style.jpg",
      "editWithAI.additionalImages[1].imageFile": png(),
    };
    params["editWithAI.additionalImages.2.imageFile"] = png();
    expect(run(params as Record<string, unknown>)).toEqual({ ok: true, errors: [], warnings: [] });

    expect(
      run({
        templateId: "0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0",
        "layers.product.image.imageFile": png(),
        "layers.product.image.removeBackground": "auto",
        "layers.product.image.margin": "10%",
        "layers.author.text.content": "Tom C.",
        "layers.hero.image.imageFromPrompt.seed": 7,
        "virtualModel.additionalProductImages[0].imageFile": png(),
        "virtualModel.additionalProductImages.1.imageUrl": "https://example.com/back.jpg",
        "virtualModel.additionalProductImages[].imageUrl": "https://example.com/side.jpg",
      }),
    ).toEqual({ ok: true, errors: [], warnings: [] });
  });

  test("a family value is validated by its own leaf", () => {
    const errors = run({
      imageFile: image,
      "editWithAI.additionalImages.ref.imageFile": "/tmp/ref.png",
      "layers.product.image.removeBackground": true,
      "layers.hero.image.imageFromPrompt.prompt": "",
    }).errors;
    expect(errors.map((e) => e.message)).toEqual([
      '`editWithAI.additionalImages.ref.imageFile` must be a Blob — it is a file part of the multipart form; got "/tmp/ref.png"',
      '`layers.product.image.removeBackground` must be one of "auto", "never"; got true',
      '`layers.hero.image.imageFromPrompt.prompt` must not be empty; got ""',
    ]);
  });

  test("a family key with a misspelt suffix or no slot is an unknown field", () => {
    const { ok, warnings } = run({
      imageFile: image,
      "editWithAI.additionalImages.ref.imagefile": png(),
      "layers.text.content": "no layer id",
      "editWithAI.additionalImages.imageFile": png(),
    });
    expect(ok).toBe(true);
    expect(warnings.map((w) => [w.code, w.path[0]])).toEqual([
      ["unknown_param", "editWithAI.additionalImages.ref.imagefile"],
      ["unknown_param", "layers.text.content"],
      ["unknown_param", "editWithAI.additionalImages.imageFile"],
    ]);
  });

  test("familySlot normalises the two index spellings to one slot", () => {
    const family = PHOTOROOM_EDIT_FAMILIES["editWithAI.additionalImages.{key}.imageFile"];
    expect(familySlot(family, "editWithAI.additionalImages[0].imageFile")).toBe("0");
    expect(familySlot(family, "editWithAI.additionalImages.0.imageFile")).toBe("0");
    expect(familySlot(family, "editWithAI.additionalImages.styleRef.imageFile")).toBe("styleRef");
    expect(familySlot(family, "editWithAI.additionalImages.imageFile")).toBeUndefined();
    expect(familySlot(family, "editWithAI.additionalImagesX.imageFile")).toBeUndefined();
    expect(familySlot(PHOTOROOM_EDIT_FAMILIES["layers.{key}.text.content"], "layers[0].text.content")).toBeUndefined();
  });

  test("an undocumented slot spelling still has to open with a bracket or a dot", () => {
    const family = PHOTOROOM_EDIT_FAMILIES["virtualModel.additionalProductImages[].imageFile"];
    expect(familySlot(family, "virtualModel.additionalProductImages[0].imageFile")).toBe("0");
    expect(familySlot(family, "virtualModel.additionalProductImages.0.imageFile")).toBe("0");
    expect(familySlot(family, "virtualModel.additionalProductImages[].imageFile")).toBe("[]");
    expect(familySlot(family, "virtualModel.additionalProductImagesX.imageFile")).toBeUndefined();
    expect(familySlot(family, "virtualModel.additionalProductImages..imageFile")).toBeUndefined();

    const { ok, warnings } = run({ imageFile: image, "virtualModel.additionalProductImagesX.imageFile": png() });
    expect(ok).toBe(true);
    expect(warnings.map((w) => [w.code, w.path[0]])).toEqual([
      ["unknown_param", "virtualModel.additionalProductImagesX.imageFile"],
    ]);
  });

  test("a number leaf and a boolean leaf each take both documented spellings", () => {
    expect(run({ imageFile: image, "export.dpi": "300" }).ok).toBe(true);
    expect(run({ imageFile: image, "export.dpi": "three hundred" }).errors.map((e) => e.path[0])).toEqual(["export.dpi"]);
    expect(run({ imageFile: image, "export.dpi": 300, removeBackground: "false" }).ok).toBe(true);
    expect(run({ imageFile: image, removeBackground: false }).ok).toBe(true);
  });
});

describe("photoroom.imageEdit — unknown fields", () => {
  test("an unknown field is a warning that says what the server does with it, and passes through", () => {
    const result = unchecked({ imageFile: png(), "shadow.mod": "ai.soft" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.params["shadow.mod"]).toBe("ai.soft");
    expect(result.warnings.map((w) => [w.code, w.path, w.message])).toEqual([
      [
        "unknown_param",
        ["shadow.mod"],
        "`shadow.mod` is not a field POST /v2/edit documents. Photoroom does not refuse an unknown field today — the request succeeds, is billed, and the field is listed in the `pr-unsupported-attributes` response header (\"[Temporary] … Soon to be replaced by a 400 Bad Request response\"). It was passed through.",
      ],
    ]);
  });

  test("top-level `imageUrl` is not a POST field: warned, naming the GET endpoint, never refused", () => {
    const { ok, errors, warnings } = run({ imageUrl: "https://example.com/a.png" });
    expect(ok).toBe(true);
    expect(errors).toEqual([]);
    expect(warnings.length).toBe(1);
    expect(warnings[0]?.code).toBe("unknown_param");
    expect(warnings[0]?.message).toContain('"The POST endpoint accepts `imageFile` only.');
    expect(Object.keys(PHOTOROOM_EDIT_FIELDS)).not.toContain("imageUrl");
  });
});

describe("photoroom.imageEdit — cross-field rules", () => {
  const image = png();

  test("an input is required: imageFile, imageFromPrompt.prompt or templateId", () => {
    const { ok, errors } = run({ "shadow.mode": "ai.soft" });
    expect(ok).toBe(false);
    expect(errors.map((e) => [e.code, e.path])).toEqual([["invalid_shape", ["imageFile"]]]);
    expect(run({ removeBackground: false, "imageFromPrompt.prompt": "three mugs" }).ok).toBe(true);
    expect(run({ templateId: "0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0" }).ok).toBe(true);
  });

  test("a file over 30 MB is media_too_large — on each of the three sized file fields", () => {
    const big = { size: PHOTOROOM_EDIT_MAX_BYTES + 1 };
    Object.setPrototypeOf(big, Blob.prototype);
    const edge = { size: PHOTOROOM_EDIT_MAX_BYTES };
    Object.setPrototypeOf(edge, Blob.prototype);
    expect(PHOTOROOM_EDIT_MAX_BYTES).toBe(31_457_280);
    expect(run({ imageFile: edge }).ok).toBe(true);
    const errors = run({ imageFile: big, "background.imageFile": big, "background.guidance.imageFile": big }).errors;
    expect(errors.filter((e) => e.code === "media_too_large").map((e) => e.path[0])).toEqual([
      "imageFile",
      "background.imageFile",
      "background.guidance.imageFile",
    ]);
    expect(errors[0]?.meta).toMatchObject({ limit: PHOTOROOM_EDIT_MAX_BYTES, actual: PHOTOROOM_EDIT_MAX_BYTES + 1 });
  });

  test("a layer's image file states the same 30 MB limit", () => {
    const big = { size: PHOTOROOM_EDIT_MAX_BYTES + 1 };
    Object.setPrototypeOf(big, Blob.prototype);
    const errors = run({ imageFile: image, "layers.bg.image.imageFile": big }).errors;
    expect(errors.map((e) => [e.code, e.path[0]])).toEqual([["media_too_large", "layers.bg.image.imageFile"]]);
  });

  test("`virtualModel.additionalProductImages` takes at most four entries, counted by slot across imageFile and imageUrl", () => {
    const base = { imageFile: image, "virtualModel.mode": "ai.auto" };
    const four = Object.fromEntries([0, 1, 2, 3].map((k) => [`virtualModel.additionalProductImages[${k}].imageFile`, png()]));
    expect(run({ ...base, ...four }).ok).toBe(true);
    // `.0` is the same entry as `[0]`.
    expect(run({ ...base, ...four, "virtualModel.additionalProductImages.0.imageUrl": "https://example.com/a.png" }).errors).toEqual([]);
    const five = run({ ...base, ...four, "virtualModel.additionalProductImages[4].imageUrl": "https://example.com/e.png" });
    expect(five.errors.map((e) => [e.code, e.path[0], e.meta?.["maxItems"], e.meta?.["count"]])).toEqual([
      ["invalid_shape", "virtualModel.additionalProductImages[4].imageUrl", 4, 5],
    ]);
  });

  test("background.prompt excludes a background image (error); guidance does not", () => {
    for (const field of ["background.imageFile", "background.imageUrl"]) {
      const value = field.endsWith("File") ? png() : "https://example.com/bg.png";
      const { ok, errors } = run({ imageFile: image, "background.prompt": "on a beach", [field]: value });
      expect(ok).toBe(false);
      expect(errors.map((e) => [e.code, e.path, e.meta?.conflicts])).toEqual([
        ["unsupported_param", ["background.prompt"], [field]],
      ]);
    }
    expect(run({ imageFile: image, "background.prompt": "on a beach", "background.guidance.imageFile": png() })).toEqual({
      ok: true,
      errors: [],
      warnings: [],
    });
  });

  test("background.scaling without a background image is a warning", () => {
    const { ok, warnings } = run({ imageFile: image, "background.scaling": "fit" });
    expect(ok).toBe(true);
    expect(warnings.map((w) => [w.code, w.path, w.severity])).toEqual([["unsupported_param", ["background.scaling"], "warning"]]);
    expect(run({ imageFile: image, "background.scaling": "fit", "background.imageFile": png() }).warnings).toEqual([]);
    expect(run({ imageFile: image, "background.scaling": "fit", "background.imageUrl": "https://example.com/b.png" }).warnings).toEqual([]);
  });

  test("a background image with removeBackground false is an error, in both spellings of false", () => {
    for (const off of [false, "false"]) {
      const { ok, errors } = run({ imageFile: image, removeBackground: off, "background.imageFile": png() });
      expect(ok).toBe(false);
      expect(errors.map((e) => [e.code, e.path])).toEqual([["unsupported_param", ["background.imageFile"]]]);
    }
    expect(run({ imageFile: image, removeBackground: false, "background.imageUrl": "https://example.com/b.png" }).errors.map((e) => e.path)).toEqual([
      ["background.imageUrl"],
    ]);
    expect(run({ imageFile: image, removeBackground: true, "background.imageFile": png() }).ok).toBe(true);
    expect(run({ imageFile: image, "background.imageFile": png() }).ok).toBe(true);
  });

  test("background guidance with removeBackground false is only a warning", () => {
    const { ok, warnings } = run({ imageFile: image, removeBackground: false, "background.guidance.imageFile": png() });
    expect(ok).toBe(true);
    expect(warnings.map((w) => [w.code, w.path])).toEqual([["unsupported_param", ["background.guidance.imageFile"]]]);
  });

  test("referenceBox with removeBackground false is NOT flagged — the docs send the pair", () => {
    expect(run({ imageFile: image, removeBackground: false, referenceBox: "originalImage" })).toEqual({
      ok: true,
      errors: [],
      warnings: [],
    });
  });

  test("maxWidth / maxHeight warn only against an explicit WxH outputSize", () => {
    const { ok, warnings } = run({ imageFile: image, outputSize: "1000x1000", maxWidth: 800, maxHeight: 800 });
    expect(ok).toBe(true);
    expect(warnings.map((w) => [w.code, w.path])).toEqual([
      ["unsupported_param", ["maxWidth"]],
      ["unsupported_param", ["maxHeight"]],
    ]);
    for (const outputSize of [undefined, "auto", "originalImage", "croppedSubject"]) {
      expect(run({ imageFile: image, outputSize, maxWidth: 800 }).warnings).toEqual([]);
    }
  });

  test("a shadow override without ai.auto-with-overrides is a warning", () => {
    const { ok, warnings } = run({
      imageFile: image,
      "shadow.mode": "ai.preset-soft",
      "shadow.softnessOverride": 0.3,
      "pr-ai-shadows-model-version": "2026-04-15",
    });
    expect(ok).toBe(true);
    expect(warnings.map((w) => [w.code, w.path])).toEqual([["unsupported_param", ["shadow.softnessOverride"]]]);
    expect(warnings[0]?.message).toContain('`shadow.mode` is "ai.preset-soft"');
  });

  test("the new shadow modes and the overrides want the shadows header", () => {
    for (const mode of ["ai.auto-with-overrides", "ai.preset-soft", "ai.preset-hard"]) {
      const { ok, warnings } = run({ imageFile: image, "shadow.mode": mode });
      expect(ok).toBe(true);
      expect(warnings.map((w) => [w.code, w.path])).toEqual([["unsupported_param", ["shadow.mode"]]]);
      expect(warnings[0]?.message).toContain('Pass `"pr-ai-shadows-model-version": "2026-04-15"` as a param');
      expect(run({ imageFile: image, "shadow.mode": mode, "pr-ai-shadows-model-version": "2026-04-15" }).warnings).toEqual([]);
    }
    // An override alone draws both: it needs the mode, and it needs the header.
    expect(run({ imageFile: image, "shadow.intensityOverride": 0.8 }).warnings.map((w) => w.path[0])).toEqual([
      "shadow.intensityOverride",
      "shadow.intensityOverride",
    ]);
  });

  test("a legacy shadow mode with the shadows header is a warning; without it, clean", () => {
    for (const mode of ["ai.soft", "ai.hard", "ai.floating"]) {
      expect(run({ imageFile: image, "shadow.mode": mode })).toEqual({ ok: true, errors: [], warnings: [] });
      const { ok, warnings } = run({ imageFile: image, "shadow.mode": mode, "pr-ai-shadows-model-version": "2026-04-15" });
      expect(ok).toBe(true);
      expect(warnings.map((w) => [w.code, w.path])).toEqual([["unsupported_param", ["shadow.mode"]]]);
    }
  });

  test("editWithAI.mode and .prompt alone are warnings, in both directions", () => {
    const modeOnly = run({ imageFile: image, "editWithAI.mode": "ai.auto" });
    expect(modeOnly.ok).toBe(true);
    expect(modeOnly.warnings.map((w) => [w.code, w.path, w.severity])).toEqual([["invalid_shape", ["editWithAI.prompt"], "warning"]]);
    const promptOnly = run({ imageFile: image, "editWithAI.prompt": "make it winter" });
    expect(promptOnly.ok).toBe(true);
    expect(promptOnly.warnings.map((w) => [w.code, w.path])).toEqual([["invalid_shape", ["editWithAI.mode"]]]);
  });

  test("at most four additional images, counted by slot", () => {
    const base = { imageFile: image, removeBackground: false, "editWithAI.mode": "ai.auto", "editWithAI.prompt": "merge" };
    const four = Object.fromEntries(["a", "b", "c", "d"].map((name) => [`editWithAI.additionalImages.${name}.imageFile`, png()]));
    expect(run({ ...base, ...four })).toEqual({ ok: true, errors: [], warnings: [] });
    const five = run({ ...base, ...four, "editWithAI.additionalImages.e.imageUrl": "https://example.com/e.png" });
    expect(five.ok).toBe(false);
    expect(five.errors.map((e) => [e.code, e.path, e.meta?.given, e.meta?.max])).toEqual([
      ["invalid_shape", ["editWithAI.additionalImages.e.imageUrl"], 5, 4],
    ]);
  });

  test("one additional image written two ways is one image with two sources", () => {
    const { ok, errors } = run({
      imageFile: image,
      removeBackground: false,
      "editWithAI.mode": "ai.auto",
      "editWithAI.prompt": "merge",
      "editWithAI.additionalImages[0].imageFile": png(),
      "editWithAI.additionalImages.0.imageUrl": "https://example.com/0.png",
    });
    expect(ok).toBe(false);
    expect(errors.map((e) => [e.code, e.path])).toEqual([["invalid_shape", ["editWithAI.additionalImages.0.imageUrl"]]]);
    expect(errors[0]?.message).toContain('The additional image "0" was given 2 sources');
  });

  test("colorSpace original refuses the operations the spec names, and spares the default background", () => {
    const base = { imageFile: image, colorSpace: "original" };
    expect(run({ ...base, "export.format": "png", referenceBox: "originalImage", padding: 0.1, outputSize: "800x800" })).toEqual({
      ok: true,
      errors: [],
      warnings: [],
    });
    expect(run({ ...base, "background.color": "transparent" }).ok).toBe(true);
    // An 8-digit hex that may be fully transparent, whichever end the alpha is on.
    for (const color of ["00000000", "FFFFFF00", "00ffffff", "#FFFFFF00"]) {
      expect(run({ ...base, "background.color": color }).ok).toBe(true);
    }
    const conflicts: ReadonlyArray<Record<string, unknown>> = [
      { "background.color": "FFFFFF" },
      { "background.color": "FF0000EE" },
      { "background.prompt": "on a beach" },
      { "shadow.mode": "ai.soft" },
      { "export.format": "jpeg" },
      { "export.dpi": 300 },
      { keepExistingAlphaChannel: "auto" },
      { preserveMetadata: "exifSubset" },
      { preserveMetadata: "exifSubsetWithXmpCompatibility" },
    ];
    for (const conflict of conflicts) {
      const { ok, errors } = run({ ...base, ...conflict });
      expect(ok).toBe(false);
      expect(errors.map((e) => [e.code, e.path[0]])).toEqual([["unsupported_param", Object.keys(conflict)[0]]]);
    }
    for (const fine of [{ keepExistingAlphaChannel: "never" }, { preserveMetadata: "xmp" }, { preserveMetadata: "never" }]) {
      expect(run({ ...base, ...fine }).ok).toBe(true);
    }
    // And none of it applies to the default colour space.
    expect(run({ imageFile: image, colorSpace: "sRGB", "export.format": "jpeg", "shadow.mode": "ai.soft" }).ok).toBe(true);
  });

  test("beautify.onSubjectMismatch error is refused only with a non-food mode", () => {
    for (const mode of ["ai.auto", "ai.car"]) {
      const { ok, errors } = run({ imageFile: image, "beautify.mode": mode, "beautify.onSubjectMismatch": "error" });
      expect(ok).toBe(false);
      expect(errors.map((e) => [e.code, e.path])).toEqual([["unsupported_param", ["beautify.onSubjectMismatch"]]]);
    }
    expect(run({ imageFile: image, "beautify.mode": "ai.food", "beautify.onSubjectMismatch": "error" }).ok).toBe(true);
    expect(run({ imageFile: image, "beautify.mode": "ai.car", "beautify.onSubjectMismatch": "ignore" }).ok).toBe(true);
    // With no beautify.mode nothing says the field is read, so it is left alone.
    expect(run({ imageFile: image, "beautify.onSubjectMismatch": "error" })).toEqual({ ok: true, errors: [], warnings: [] });
    // `null` is a field the form does not send, exactly like an absent one.
    expect(run({ imageFile: image, "beautify.mode": null, "beautify.onSubjectMismatch": "error" })).toEqual({ ok: true, errors: [], warnings: [] });
  });

  test("every cross-field issue cites its source", () => {
    const issues = [
      ...run({ "shadow.mode": "ai.soft" }).errors,
      ...run({ imageFile: image, "background.prompt": "x", "background.imageFile": png() }).errors,
      ...run({ imageFile: image, "background.scaling": "fit" }).warnings,
      ...run({ imageFile: image, outputSize: "10x10", maxWidth: 5 }).warnings,
      ...run({ imageFile: image, "shadow.intensityOverride": 0.8 }).warnings,
      ...run({ imageFile: image, "editWithAI.mode": "ai.auto" }).warnings,
      ...run({ imageFile: image, colorSpace: "original", "export.dpi": 300 }).errors,
      ...run({ imageFile: image, bogus: 1 }).warnings,
    ];
    expect(issues.length).toBe(9);
    for (const issue of issues) expect(String(issue.meta?.source)).toMatch(/^https:\/\/(docs|image-api)\.photoroom\.com\//);
  });
});

// ---------------------------------------------------------------------------
// The provider's own documentation
// ---------------------------------------------------------------------------

interface DocsExample {
  page: string;
  url: string;
  fields: Record<string, string>;
  headers?: Record<string, string>;
}

const EXAMPLES = (
  JSON.parse(readFileSync(new URL("../../../test/fixtures/photoroom/docs-examples.json", import.meta.url), "utf8")) as {
    examples: DocsExample[];
  }
).examples.filter((example) => example.url === EDIT_URL);

/** The docs write a placeholder where a real template id goes. */
const TEMPLATE_PLACEHOLDER = "YOUR_TEMPLATE_ID";

/**
 * A docs example as params, AS PUBLISHED: a form value is text, and every
 * field goes in as the text the example sends (`maxWidth=2000` is `"2000"`).
 */
function paramsOf(example: DocsExample): Record<string, unknown> {
  const params: Record<string, unknown> = { ...example.headers };
  for (const [key, text] of Object.entries(example.fields)) {
    if (text === "@file") params[key] = png();
    else if (text === TEMPLATE_PLACEHOLDER) params[key] = "0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0";
    else params[key] = text;
  }
  return params;
}

/** The same example the way a caller would write it in JS: a field the table types as a number, as a number. */
function typedParamsOf(example: DocsExample): Record<string, unknown> {
  const fields: Readonly<Record<string, PhotoroomFieldSpec>> = PHOTOROOM_EDIT_FIELDS;
  const params = paramsOf(example);
  for (const [key, text] of Object.entries(example.fields)) {
    const spec = Object.hasOwn(fields, key) ? fields[key] : undefined;
    if (spec?.t === "number" || (spec?.t === "numberOrEnum" && !spec.enum?.includes(text))) params[key] = Number(text);
  }
  return params;
}

describe("photoroom.imageEdit — Photoroom's own docs examples", () => {
  test("the fixture covers the feature pages", () => {
    expect(EXAMPLES.length).toBe(49);
    expect(new Set(EXAMPLES.map((example) => example.page)).size).toBeGreaterThanOrEqual(25);
  });

  test("every example validates with no error and no warning, as published and with its numbers as numbers", () => {
    const complaints: unknown[] = [];
    for (const example of EXAMPLES) {
      for (const params of [paramsOf(example), typedParamsOf(example)]) {
        const { ok, errors, warnings } = run(params);
        if (ok && warnings.length === 0) continue;
        complaints.push({ page: example.page, fields: Object.keys(example.fields), issues: [...errors, ...warnings].map((i) => i.message) });
      }
    }
    expect(complaints).toEqual([]);
  });

  test("the examples include numbers, which the docs send as text", () => {
    const numeric = EXAMPLES.filter((example) => JSON.stringify(paramsOf(example)) !== JSON.stringify(typedParamsOf(example)));
    expect(numeric.length).toBeGreaterThanOrEqual(5);
  });

  test("the pair `removeBackground=false` + `referenceBox=originalImage` appears, and passes", () => {
    const pairs = EXAMPLES.filter(
      (example) => example.fields.removeBackground === "false" && example.fields.referenceBox === "originalImage",
    );
    expect(pairs.length).toBeGreaterThanOrEqual(8);
    for (const example of pairs) expect(run(paramsOf(example))).toEqual({ ok: true, errors: [], warnings: [] });
  });

  test("an example's headers come back as headers, and its form round-trips to the published text", () => {
    const shadows = EXAMPLES.find((example) => example.headers?.["pr-ai-shadows-model-version"] !== undefined) as DocsExample;
    const result = unchecked(paramsOf(shadows));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.params.request.headers).toEqual({ "pr-ai-shadows-model-version": "2026-04-15" });
    const form = toFormData(result.params);
    for (const [key, text] of Object.entries(shadows.fields)) {
      if (text !== "@file") expect(form.get(key)).toBe(text);
    }
  });
});
