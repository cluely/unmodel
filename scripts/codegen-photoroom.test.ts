import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { generate, lower, lowerSchema, type GenerateInput, type Leaf } from "./codegen-photoroom";

/**
 * Three suites, split the way `codegen-revana.test.ts` splits them.
 *
 * The first lowers **schema fragments**: one test per lowering rule, on the
 * smallest schema that exercises it.
 *
 * The second runs a **mini document**: it pins the refusals — the constructs
 * this generator must stop on rather than guess at. A fixture is the only way
 * to test a refusal, because the committed snapshot deliberately contains none.
 *
 * The third runs against the **real committed snapshot** and pins its counts
 * and its shape census. A refresh that changes Photoroom's surface then fails
 * here, naming what moved — which is the cue to re-read the hand-written checks
 * in `src/providers/photoroom/image-edit.ts`.
 */

type Json = Record<string, unknown>;

function leaves(name: string, schema: Json, description?: string): Leaf[] {
  const out: Leaf[] = [];
  lowerSchema(name, schema, description, out);
  return out;
}

describe("lowering: one schema shape per rule", () => {
  test("a string enum, with its default", () => {
    expect(leaves("scaling", { type: "string", enum: ["fit", "fill"], default: "fit" })).toEqual([
      { path: "scaling", t: "string", enum: ["fit", "fill"], def: "fit" },
    ]);
  });

  test("`const` is a one-member enum", () => {
    expect(leaves("expand.mode", { type: "string", const: "ai.auto" })).toEqual([
      { path: "expand.mode", t: "string", enum: ["ai.auto"] },
    ]);
  });

  test("number bounds keep inclusive and exclusive apart", () => {
    expect(leaves("r", { type: "number", exclusiveMinimum: 0, maximum: 0.05 })).toEqual([
      { path: "r", t: "number", max: 0.05, xmin: 0 },
    ]);
    expect(leaves("dpi", { type: "number", minimum: 72, maximum: 1200 })).toEqual([
      { path: "dpi", t: "number", min: 72, max: 1200 },
    ]);
  });

  test("string constraints: minLength, pattern, uuid, binary", () => {
    expect(leaves("p", { type: "string", minLength: 1 })).toEqual([{ path: "p", t: "string", minLen: 1 }]);
    expect(leaves("s", { type: "string", pattern: "^a$" })).toEqual([{ path: "s", t: "string", pattern: "^a$" }]);
    expect(leaves("id", { type: "string", format: "uuid" })).toEqual([{ path: "id", t: "string", format: "uuid" }]);
    expect(leaves("f", { type: "string", format: "binary" })).toEqual([{ path: "f", t: "blob" }]);
  });

  test('`type: ["number", "string"]` is one numberOrString leaf', () => {
    expect(leaves("padding", { type: ["number", "string"], default: 0 })).toEqual([
      { path: "padding", t: "numberOrString", def: 0 },
    ]);
  });

  test("`anyOf [number, string enum]` is one numberOrEnum leaf", () => {
    const schema = { anyOf: [{ type: "number" }, { type: "string", enum: ["short", "long"] }] };
    expect(leaves("shadow.spreadOverride", schema, "Spread.")).toEqual([
      { path: "shadow.spreadOverride", t: "numberOrEnum", enum: ["short", "long"], description: "Spread." },
    ]);
  });

  test("an object flattens to dotted leaves, and its nested `required` is dropped", () => {
    const schema = {
      type: "object",
      additionalProperties: false,
      required: ["prompt"],
      properties: { prompt: { type: "string", minLength: 1 }, seed: { type: "number" } },
    };
    expect(leaves("imageFromPrompt", schema)).toEqual([
      { path: "imageFromPrompt.prompt", t: "string", minLen: 1 },
      { path: "imageFromPrompt.seed", t: "number" },
    ]);
  });

  test("`anyOf` of objects contributes every arm's leaves, and a composite default lands on its leaf", () => {
    const schema = {
      anyOf: [
        {
          type: "object",
          required: ["preset"],
          properties: {
            preset: { type: "object", required: ["name"], properties: { name: { type: "string", enum: ["avery", "sam"] } } },
          },
        },
        {
          type: "object",
          required: ["custom"],
          properties: {
            custom: { type: "object", properties: { imageFile: { type: "string", format: "binary" }, imageUrl: { type: "string" } } },
          },
        },
      ],
      default: { preset: { name: "avery" } },
    };
    expect(leaves("virtualModel.model", schema)).toEqual([
      { path: "virtualModel.model.preset.name", t: "string", enum: ["avery", "sam"], def: "avery" },
      { path: "virtualModel.model.custom.imageFile", t: "blob" },
      { path: "virtualModel.model.custom.imageUrl", t: "string" },
    ]);
  });

  test("`anyOf` of constants and an object keeps the scalar AND the object's leaves", () => {
    const schema = {
      anyOf: [
        { type: "string", const: "auto" },
        { type: "string", const: "never" },
        { type: "object", required: ["mode"], properties: { mode: { type: "string", enum: ["ai.auto", "ai.never"] } } },
      ],
    };
    expect(leaves("background.expandPrompt", schema)).toEqual([
      { path: "background.expandPrompt", t: "string", enum: ["auto", "never"] },
      { path: "background.expandPrompt.mode", t: "string", enum: ["ai.auto", "ai.never"] },
    ]);
  });

  test("a map with a schema for its keys is a `{key}` family", () => {
    const schema = {
      type: "object",
      additionalProperties: { type: "object", properties: { content: { type: "string" } } },
    };
    expect(leaves("layers", schema)).toEqual([{ path: "layers.{key}.content", t: "string" }]);
  });

  test("an array is a `[]` family that carries its `maxItems`", () => {
    const schema = {
      type: "array",
      minItems: 1,
      maxItems: 4,
      items: { type: "object", properties: { imageUrl: { type: "string" } } },
    };
    expect(leaves("images", schema)).toEqual([{ path: "images[].imageUrl", t: "string", maxItems: 4 }]);
  });

  test("a leaf's own description wins over the inherited one", () => {
    expect(leaves("a", { type: "string", description: "own" }, "inherited")[0]?.description).toBe("own");
    expect(leaves("a", { type: "string" }, "inherited")[0]?.description).toBe("inherited");
  });
});

// ---------------------------------------------------------------------------
// A mini document
// ---------------------------------------------------------------------------

const PROVENANCE = { reason: "r", source: "https://example.com", date: "2026-11-24" };

function overlays(overrides: Json = {}): Json {
  return {
    getOnly: {},
    families: {},
    booleans: { acceptStrings: true, ...PROVENANCE },
    deprecated: {},
    deprecatedValues: {},
    preview: {},
    ...overrides,
  };
}

interface MiniEdit {
  get?: Record<string, Json>;
  post?: Record<string, Json>;
  required?: string[];
  getRequired?: string[];
}

function document(edit: MiniEdit = {}, segment: Json = {}): Json {
  const get = edit.get ?? { scaling: { type: "string", enum: ["fit", "fill"] } };
  const post = edit.post ?? Object.fromEntries(Object.keys(get).map((name) => [name, { type: "string" }]));
  return {
    paths: {
      "/v2/edit": {
        get: {
          parameters: Object.entries(get).map(([name, schema]) => ({
            name,
            in: "query",
            schema,
            ...(edit.getRequired?.includes(name) ? { required: true } : {}),
          })),
        },
        post: {
          requestBody: {
            content: {
              "multipart/form-data": {
                schema: { type: "object", properties: post, ...(edit.required ? { required: edit.required } : {}) },
              },
            },
          },
        },
      },
      "/v1/segment": {
        post: {
          requestBody: {
            content: {
              "multipart/form-data": { schema: { $ref: "#/components/schemas/remove-background-post-params" } },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        "remove-background-post-params": {
          type: "object",
          properties: { image_file: { type: "string", format: "binary" }, format: { type: "string", enum: ["png", "jpg"] } },
          required: ["image_file"],
          ...segment,
        },
      },
    },
  };
}

function run(openapi: Json, overlayInput: Json = overlays()): Map<string, string> {
  return generate({ openapi, overlays: overlayInput });
}

describe("the generator on a mini document", () => {
  test("emits three files per route, deterministically", () => {
    const first = run(document());
    expect([...first.keys()].sort()).toEqual([
      "image-edit-fields.gen.ts",
      "image-edit-remove-background-fields.gen.ts",
      "image-edit-remove-background-schema.gen.ts",
      "image-edit-remove-background-wire.gen.ts",
      "image-edit-schema.gen.ts",
      "image-edit-wire.gen.ts",
    ]);
    expect([...run(document()).entries()]).toEqual([...first.entries()]);
  });

  test("the POST field takes its constraints from the GET parameter of the same name", () => {
    const files = run(document());
    expect(files.get("image-edit-fields.gen.ts")).toContain('scaling: { t: "string", enum: ["fit", "fill"] }');
    expect(files.get("image-edit-wire.gen.ts")).toContain('scaling?: "fit" | "fill";');
    expect(files.get("image-edit-schema.gen.ts")).toContain('scaling: z.enum(["fit", "fill"]');
  });

  test("a required segment field is `req`, non-optional, and listed", () => {
    const files = run(document());
    expect(files.get("image-edit-remove-background-fields.gen.ts")).toContain('image_file: { t: "blob", req: true }');
    expect(files.get("image-edit-remove-background-wire.gen.ts")).toContain("  image_file: Blob;");
    expect(files.get("image-edit-remove-background-schema.gen.ts")).toContain(
      'export const PHOTOROOM_SEGMENT_REQUIRED = ["image_file"] as const;',
    );
  });

  test("booleans take the form spelling on /v2/edit when the overlay says so, and only there", () => {
    const doc = document({ get: { removeBackground: { type: "boolean", default: true } }, post: { removeBackground: { type: "boolean" } } });
    expect(run(doc).get("image-edit-wire.gen.ts")).toContain('removeBackground?: boolean | "true" | "false";');
    const strict = run(doc, overlays({ booleans: { acceptStrings: false, ...PROVENANCE } }));
    expect(strict.get("image-edit-wire.gen.ts")).toContain("removeBackground?: boolean;");
  });

  test("a `{key}` placeholder in a parameter NAME is a family, split at the placeholder", () => {
    const doc = document({
      get: { "refs.{key}.imageUrl": { type: "string" } },
      post: { "refs.{key}.imageFile": { type: "string", format: "binary" } },
    });
    const over = overlays({
      getOnly: { "refs.{key}.imageUrl": { typed: true, ...PROVENANCE } },
      families: { refs: { notations: ["map", "index"], ...PROVENANCE } },
    });
    const files = run(doc, over);
    expect(files.get("image-edit-fields.gen.ts")).toContain(
      '"refs.{key}.imageFile": { prefix: "refs", suffix: ".imageFile", notations: ["map", "index"], t: "blob" }',
    );
    const wire = files.get("image-edit-wire.gen.ts") as string;
    expect(wire).toContain("[key: `refs.${string}.imageFile`]: Blob | undefined;");
    expect(wire).toContain("[key: `refs[${number}].imageFile`]: Blob | undefined;");
    expect(wire).toContain("[key: `refs.${string}.imageUrl`]: string | undefined;");
  });

  test("a GET-only parameter decided `typed: false` is left off POST", () => {
    const doc = document({
      get: { scaling: { type: "string" }, imageUrl: { type: "string" } },
      post: { scaling: { type: "string" } },
    });
    const files = run(doc, overlays({ getOnly: { imageUrl: { typed: false, ...PROVENANCE } } }));
    expect(files.get("image-edit-fields.gen.ts")).not.toContain("imageUrl");
  });

  test("deprecated, preview and unverified overlays reach the JSDoc and the row", () => {
    const doc = document({
      get: { "old.mode": { type: "string" }, "new.mode": { type: "string" }, bgUrl: { type: "string" } },
      post: { "old.mode": { type: "string" }, "new.mode": { type: "string" } },
    });
    const files = run(
      doc,
      overlays({
        getOnly: { bgUrl: { typed: true, unverified: "Not confirmed.", ...PROVENANCE } },
        deprecated: { "old.*": { ...PROVENANCE, reason: "Use new." } },
        preview: { "new.mode": PROVENANCE },
      }),
    );
    const fields = files.get("image-edit-fields.gen.ts") as string;
    expect(fields).toContain('"old.mode": { t: "string", deprecated: true }');
    expect(fields).toContain('"new.mode": { t: "string", preview: true }');
    const wire = files.get("image-edit-wire.gen.ts") as string;
    expect(wire).toContain("@deprecated Use new.");
    expect(wire).toContain("Preview feature — https://example.com");
    expect(wire).toContain("Unverified: Not confirmed.");
  });

  test("only the first paragraph of a description is emitted", () => {
    const doc = document({
      get: { scaling: { type: "string", description: "First\nparagraph.\n\nSecond paragraph." } },
    });
    const wire = run(doc).get("image-edit-wire.gen.ts") as string;
    expect(wire).toContain("/** First paragraph. */");
    expect(wire).not.toContain("Second paragraph");
  });
});

describe("the generator stops on what it does not model", () => {
  test("an unknown schema keyword, naming the parameter", () => {
    const doc = document({ get: { scaling: { type: "string", maxLength: 9 } } });
    expect(() => run(doc)).toThrow("`scaling`: schema keyword `maxLength` is not modelled");
  });

  test("an unknown type, format and anyOf shape", () => {
    expect(() => run(document({ get: { n: { type: "integer" } }, post: { n: { type: "integer" } } }))).toThrow(
      '`n`: the schema type `"integer"` is not modelled',
    );
    expect(() => run(document({ get: { d: { type: "string", format: "date" } }, post: { d: { type: "string", format: "date" } } }))).toThrow(
      "`d`: the string format `date` is not modelled",
    );
    expect(() => run(document({ get: { u: { anyOf: [{ type: "string" }, { type: "boolean" }] } }, post: { u: {} } }))).toThrow(
      "`u`: this `anyOf` shape is not modelled",
    );
  });

  test("a `required` on /v2/edit, at either level it can appear", () => {
    expect(() => run(document({ required: ["scaling"] }))).toThrow("POST /v2/edit now marks [scaling] required");
    expect(() => run(document({ getRequired: ["scaling"] }))).toThrow("GET /v2/edit `scaling` is now `required`");
  });

  test("a parameter listed on GET and not on POST, with no recorded decision", () => {
    const doc = document({ get: { scaling: { type: "string" }, imageUrl: { type: "string" } }, post: { scaling: { type: "string" } } });
    expect(() => run(doc)).toThrow("`imageUrl` is listed on GET /v2/edit and not on POST");
  });

  test("POST and GET disagreeing about a scalar's type", () => {
    const doc = document({ get: { seed: { type: "number" } }, post: { seed: { type: "string" } } });
    expect(() => run(doc)).toThrow("`seed`: POST /v2/edit types it");
  });

  test("an array family with no recorded index notation", () => {
    const array = { type: "array", items: { type: "object", properties: { imageUrl: { type: "string" } } } };
    const doc = document({ get: { images: array }, post: { images: { type: "array" } } });
    expect(() => run(doc)).toThrow("`images[].imageUrl`: an array family");
  });

  test("a form key two families would both claim", () => {
    const doc = document({
      get: { "a.{key}.x": { type: "string" }, "a.b.{key}.x": { type: "string" } },
      post: { "a.{key}.x": { type: "string" }, "a.b.{key}.x": { type: "string" } },
    });
    expect(() => run(doc)).toThrow("two families a key can belong to at once cannot be routed");
  });

  test("an overlay entry that matches nothing", () => {
    expect(() => run(document(), overlays({ deprecated: { "gone.*": PROVENANCE } }))).toThrow(
      "`deprecated.gone.*` matches nothing in the snapshot",
    );
    expect(() => run(document(), overlays({ families: { gone: { notations: ["map"], ...PROVENANCE } } }))).toThrow(
      "`families.gone` matches nothing in the snapshot",
    );
  });

  test("a deprecated value the field no longer lists", () => {
    const over = overlays({ deprecatedValues: { scaling: { values: ["stretch"], ...PROVENANCE } } });
    expect(() => run(document(), over)).toThrow('`deprecatedValues.scaling` names "stretch"');
  });

  test("an overlay entry without its provenance", () => {
    expect(() => run(document(), overlays({ preview: { scaling: { reason: "r" } } }))).toThrow();
  });

  test("a second content type on POST /v2/edit, and a moved segment schema", () => {
    const json = document();
    const edit = (json.paths as Record<string, { post: { requestBody: { content: Json } } }>)["/v2/edit"];
    (edit as { post: { requestBody: { content: Json } } }).post.requestBody.content["application/json"] = {};
    expect(() => run(json)).toThrow("this generator models `multipart/form-data` and nothing else");

    const moved = document();
    const segment = (moved.paths as Record<string, { post: { requestBody: { content: Record<string, { schema: Json }> } } }>)["/v1/segment"];
    (segment as { post: { requestBody: { content: Record<string, { schema: Json }> } } }).post.requestBody.content["multipart/form-data"] = {
      schema: { $ref: "#/components/schemas/other" },
    };
    expect(() => run(moved)).toThrow("its form schema is now `#/components/schemas/other`");
  });
});

// ---------------------------------------------------------------------------
// The committed snapshot
// ---------------------------------------------------------------------------

const DATA = new URL("../data/photoroom/", import.meta.url).pathname;
const GEN = new URL("../src/providers/photoroom/gen/", import.meta.url).pathname;

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function committed(): GenerateInput {
  return { openapi: readJson(join(DATA, "openapi.json")), overlays: readJson(join(DATA, "overlays.json")) };
}

function census(leafList: readonly Leaf[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const leaf of leafList) counts[leaf.t] = (counts[leaf.t] ?? 0) + 1;
  return counts;
}

describe("the committed Photoroom snapshot", () => {
  const input = committed();
  const { edit, segment } = lower(input);

  test("the generated files on disk are exactly what the snapshot produces", () => {
    const files = generate(input);
    const onDisk = readdirSync(GEN).filter((name) => name.endsWith(".gen.ts")).sort();
    expect(onDisk).toEqual([...files.keys()].sort());
    for (const [name, content] of files) expect(readFileSync(join(GEN, name), "utf8")).toBe(content);
  });

  test("the snapshot record names the document and its raw hash", () => {
    const snapshot = readJson(join(DATA, "snapshot.json")) as Record<string, unknown>;
    expect(snapshot.url).toBe("https://image-api.photoroom.com/openapi");
    expect(snapshot.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(snapshot.fetchedUTC).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("the two operations' name sets: 87 GET, 86 POST, 4 GET-only, 3 POST-only", () => {
    const paths = (input.openapi as { paths: Record<string, Json> }).paths;
    const op = paths["/v2/edit"] as {
      get: { parameters: Array<{ name: string }> };
      post: { requestBody: { content: Record<string, { schema: { properties: Json } }> } };
    };
    const get = op.get.parameters.map((parameter) => parameter.name);
    const post = Object.keys(op.post.requestBody.content["multipart/form-data"]?.schema.properties ?? {});
    expect(get.length).toBe(87);
    expect(post.length).toBe(86);
    expect(get.filter((name) => !post.includes(name)).sort()).toEqual([
      "background.guidance.imageUrl",
      "background.imageUrl",
      "editWithAI.additionalImages.{key}.imageUrl",
      "imageUrl",
    ]);
    expect(post.filter((name) => !get.includes(name)).sort()).toEqual([
      "background.imageFile",
      "editWithAI.additionalImages.{key}.imageFile",
      "imageFile",
    ]);
  });

  test("/v2/edit lowers to 90 fixed fields and 30 family members", () => {
    expect(edit.fixed.length).toBe(90);
    expect(edit.families.length).toBe(30);
    expect(census(edit.fixed)).toEqual({ string: 54, number: 16, blob: 5, boolean: 2, numberOrString: 10, numberOrEnum: 3 });
    expect(census(edit.families)).toEqual({ string: 16, number: 1, blob: 3, numberOrString: 10 });
  });

  test("three families, and how each writes its slot", () => {
    const byPrefix: Record<string, { count: number; notations: string[] }> = {};
    for (const leaf of edit.families) {
      const prefix = leaf.prefix as string;
      byPrefix[prefix] = { count: (byPrefix[prefix]?.count ?? 0) + 1, notations: leaf.notations as string[] };
    }
    expect(byPrefix).toEqual({
      "editWithAI.additionalImages": { count: 2, notations: ["map", "index"] },
      layers: { count: 26, notations: ["map"] },
      "virtualModel.additionalProductImages": { count: 2, notations: ["any"] },
    });
    for (const leaf of edit.families) {
      if (leaf.prefix === "virtualModel.additionalProductImages") expect(leaf.maxItems).toBe(4);
    }
  });

  test("top-level `imageUrl` is not a POST field; the three nested URL fields are", () => {
    const paths = edit.fixed.map((leaf) => leaf.path);
    expect(paths).not.toContain("imageUrl");
    expect(paths).toContain("background.imageUrl");
    expect(paths).toContain("background.guidance.imageUrl");
    expect(edit.families.map((leaf) => leaf.path)).toContain("editWithAI.additionalImages.{key}.imageUrl");
    expect(edit.fixed.filter((leaf) => leaf.unverified !== undefined).map((leaf) => leaf.path)).toEqual([
      "background.guidance.imageUrl",
      "background.imageUrl",
    ]);
  });

  test("the union parameters flatten as the docs send them", () => {
    const paths = edit.fixed.map((leaf) => leaf.path);
    for (const path of [
      "background.expandPrompt",
      "background.expandPrompt.mode",
      "virtualModel.model.preset.name",
      "virtualModel.model.custom.imageFile",
      "virtualModel.model.custom.imageUrl",
      "virtualModel.scene.preset.name",
      "virtualModel.scene.custom.imageFile",
      "virtualModel.scene.custom.imageUrl",
    ]) {
      expect(paths).toContain(path);
    }
    const find = (path: string): Leaf => edit.fixed.find((leaf) => leaf.path === path) as Leaf;
    expect(find("virtualModel.model.preset.name").enum?.length).toBe(17);
    expect(find("virtualModel.model.preset.name").def).toBe("avery");
    expect(find("virtualModel.scene.preset.name").enum?.length).toBe(23);
    expect(find("virtualModel.scene.preset.name").def).toBe("random");
    expect(find("virtualModel.pose").enum?.length).toBe(12);
  });

  test("constraints that only the GET schema states reach the POST field", () => {
    const find = (path: string): Leaf => edit.fixed.find((leaf) => leaf.path === path) as Leaf;
    expect(find("background.blur.radius")).toMatchObject({ t: "number", xmin: 0, max: 0.05, def: 0.01 });
    expect(find("export.dpi")).toMatchObject({ t: "number", min: 72, max: 1200 });
    expect(find("export.format").enum).toEqual(["png", "jpeg", "jpg", "webp", "avif"]);
    expect(find("outputSize")).toMatchObject({ pattern: "^(auto|\\d+x\\d+|originalImage|croppedSubject)$", def: "auto" });
    expect(find("templateId")).toMatchObject({ format: "uuid", preview: expect.any(String) });
    expect(find("removeBackground")).toMatchObject({ t: "boolean", def: true });
    expect(find("editWithAI.prompt")).toMatchObject({ t: "string", minLen: 1 });
    expect(find("shadow.directionOverride").t).toBe("numberOrEnum");
    // No bound on `padding`: the description and the positioning page disagree, and the schema states neither.
    expect(find("padding")).toEqual(expect.not.objectContaining({ max: expect.anything() }));
  });

  test("the deprecated and preview fields are the ones the overlays name", () => {
    expect(edit.fixed.filter((leaf) => leaf.deprecated !== undefined).map((leaf) => leaf.path)).toEqual([
      "background.expandPrompt",
      "background.negativePrompt",
      "describeAnyChange.mode",
      "describeAnyChange.prompt",
      "describeAnyChange.seed",
    ]);
    expect(edit.fixed.filter((leaf) => leaf.preview !== undefined).map((leaf) => leaf.path)).toEqual([
      "segmentation.mode",
      "segmentation.negativePrompt",
      "segmentation.prompt",
      "templateId",
      "upscale.downscaleIfNeeded",
      "upscale.mode",
    ]);
    expect(edit.families.filter((leaf) => leaf.preview !== undefined).length).toBe(26);
    const metadata = edit.fixed.find((leaf) => leaf.path === "preserveMetadata") as Leaf;
    expect(metadata.deprecatedValues?.values).toEqual(["exifSubset"]);
  });

  test("/v1/segment is seven fields, `image_file` the only required one", () => {
    expect(segment.fixed.map((leaf) => leaf.path)).toEqual([
      "bg_color",
      "channels",
      "crop",
      "despill",
      "format",
      "image_file",
      "size",
    ]);
    expect(segment.fixed.filter((leaf) => leaf.req).map((leaf) => leaf.path)).toEqual(["image_file"]);
    const find = (path: string): Leaf => segment.fixed.find((leaf) => leaf.path === path) as Leaf;
    // `jpg`, not `jpeg` — and `crop` is a string enum, not a boolean.
    expect(find("format").enum).toEqual(["png", "jpg", "webp"]);
    expect(find("crop")).toMatchObject({ t: "string", enum: ["true", "false"], def: "false" });
  });

  test("every overlay entry carries a reason, a source and a date", () => {
    const hand = input.overlays as Record<string, Record<string, Json>>;
    for (const section of ["getOnly", "families", "deprecated", "deprecatedValues", "preview"] as const) {
      for (const [key, entry] of Object.entries(hand[section] ?? {})) {
        expect({ key, reason: typeof entry.reason, source: typeof entry.source }).toEqual({ key, reason: "string", source: "string" });
        expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    }
  });
});
