import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { UnmodelValidationError } from "../../core/issues";
import { characterTrain, SOUL_MODEL_VERSIONS } from "./character-train";
import { characterTrainModels } from "./character-train-models";

/** The JSON a validated result serialises to: its enumerable properties, which are the wire body. */
function bodyOf(validated: object): unknown {
  return JSON.parse(JSON.stringify(validated));
}

const SAMPLE = { type: "image_url", image_url: "https://example.com/mara-1.jpg" } as const;

describe("higgsfield.characterTrain", () => {
  test("the body is sent as written, to the training route", () => {
    const params = characterTrain({ name: "Mara", model_version: "v2", input_images: [SAMPLE] });
    expect(bodyOf(params)).toEqual({ name: "Mara", model_version: "v2", input_images: [SAMPLE] });
    expect(params.request).toEqual({
      url: "https://api.higgsfield.ai/v1/custom-references",
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    expect(params.toSdk("higgsfield")).toEqual({ name: "Mara", model_version: "v2", input_images: [SAMPLE] });
  });

  test("`model_version` is optional and no default is injected", () => {
    const result = characterTrain.safe({ name: "Mara", input_images: [SAMPLE] });
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(Object.keys(result.params)).toEqual(["name", "input_images"]);
    expect(result.warnings).toEqual([]);
    // No surface states a price for training.
    expect(result.estimate).toEqual({});
  });

  test("the published bounds: a name of at most 100 characters, 1–100 images, a URL of 1–2083 characters", () => {
    function pathsOf(params: unknown): unknown {
      const result = characterTrain.safe(params as never);
      return result.ok ? "ok" : result.errors.map((issue) => issue.path);
    }
    expect(pathsOf({ name: "a".repeat(100), input_images: [SAMPLE] })).toBe("ok");
    expect(pathsOf({ name: "a".repeat(101), input_images: [SAMPLE] })).toEqual([["name"]]);
    // Code points, as `maxLength` counts them: 100 emoji are 200 UTF-16 units and 100 characters.
    expect(pathsOf({ name: "🦊".repeat(100), input_images: [SAMPLE] })).toBe("ok");
    expect(pathsOf({ name: "🦊".repeat(101), input_images: [SAMPLE] })).toEqual([["name"]]);
    expect(pathsOf({ name: "Mara", input_images: [] })).toEqual([["input_images"]]);
    expect(pathsOf({ name: "Mara", input_images: Array.from({ length: 100 }, () => SAMPLE) })).toBe("ok");
    expect(pathsOf({ name: "Mara", input_images: Array.from({ length: 101 }, () => SAMPLE) })).toEqual([["input_images"]]);
    expect(pathsOf({ name: "Mara", input_images: [{ type: "image_url", image_url: "" }] })).toEqual([["input_images", 0, "image_url"]]);
    expect(pathsOf({ name: "Mara", input_images: [{ type: "image_url", image_url: `https://example.com/${"a".repeat(2083)}` }] })).toEqual([["input_images", 0, "image_url"]]);
    expect(pathsOf({ name: "Mara", input_images: [{ type: "file", image_url: SAMPLE.image_url }] })).toEqual([["input_images", 0, "type"]]);
    expect(pathsOf({ name: "Mara", input_images: [SAMPLE], model_version: "v3" })).toEqual([["model_version"]]);
    expect(pathsOf({ input_images: [SAMPLE] })).toEqual([["name"]]);
    expect(() => characterTrain({ name: "Mara", input_images: [] })).toThrow(UnmodelValidationError);
  });

  test("an image that is not a URL is refused with the upload route; a `data:` URI is reported and sent", () => {
    const local = characterTrain.safe({ name: "Mara", input_images: [SAMPLE, { type: "image_url", image_url: "./mara-2.jpg" }] });
    expect(!local.ok && local.errors.map((issue) => issue.path)).toEqual([["input_images", 1, "image_url"]]);
    expect(!local.ok && local.errors[0]?.message).toContain("POST https://api.higgsfield.ai/files/generate-upload-url");
    const inline = characterTrain.safe({ name: "Mara", input_images: [{ type: "image_url", image_url: "data:image/png;base64,AAAA" }] });
    expect(inline.ok && inline.warnings.map((issue) => issue.severity)).toEqual(["warning"]);
  });

  test("an undeclared key is sent with a warning: the schema declares no `additionalProperties`", () => {
    const result = characterTrain.safe({ name: "Mara", input_images: [SAMPLE], hf_webhook: "https://hooks.example.com/hf" } as never);
    expect(result.ok && result.warnings.map((issue) => [issue.code, issue.path])).toEqual([["unknown_param", ["hf_webhook"]]]);
  });

  test("the catalog row is keyed by the path this address posts to, and carries no price", () => {
    const row = characterTrainModels["v1/custom-references"];
    expect(row.id).toBe("v1/custom-references");
    expect(row.limit.context).toBe(0);
    expect("cost" in row).toBe(false);
  });
});

/**
 * The one hand-typed Higgsfield body, held to the committed snapshot of the
 * page it was transcribed from. A refresh that changes the published schema
 * fails here until a person re-reads `./character-train.ts`.
 */
describe("higgsfield.characterTrain — drift against the snapshot", () => {
  const snapshot = JSON.parse(
    readFileSync(new URL("../../../data/higgsfield/routes/v1__custom-references.json", import.meta.url), "utf8"),
  ) as { docs: { url: string; schema: Record<string, any> } };
  const schema = snapshot.docs.schema;

  test("the page is the one the module cites", () => {
    expect(snapshot.docs.url).toBe("https://docs.higgsfield.ai/docs/models/soul-id/create-character.md");
    expect(schema["title"]).toBe("CreateCustomReferenceSchema");
  });

  test("the property names, the required list and `additionalProperties` are what the module types", () => {
    expect(Object.keys(schema["properties"]).sort()).toEqual(["input_images", "model_version", "name"]);
    expect([...schema["required"]].sort()).toEqual(["input_images", "name"]);
    expect("additionalProperties" in schema).toBe(false);
  });

  test("the bounds are the ones the module enforces", () => {
    expect(schema["properties"]["name"]).toMatchObject({ type: "string", maxLength: 100 });
    expect(schema["properties"]["input_images"]).toMatchObject({ type: "array", minItems: 1, maxItems: 100, items: { $ref: "#/$defs/ImageUrlInputImageSchema" } });
    expect(schema["properties"]["model_version"]).toMatchObject({ $ref: "#/$defs/SoulModelVersion", default: "v1" });
    expect(schema["$defs"]["SoulModelVersion"]["enum"]).toEqual([...SOUL_MODEL_VERSIONS]);
    const item = schema["$defs"]["ImageUrlInputImageSchema"];
    expect(Object.keys(item["properties"]).sort()).toEqual(["image_url", "type"]);
    expect([...item["required"]].sort()).toEqual(["image_url", "type"]);
    expect("additionalProperties" in item).toBe(false);
    expect(item["properties"]["type"]).toMatchObject({ const: "image_url" });
    expect(item["properties"]["image_url"]).toMatchObject({ type: "string", format: "uri", minLength: 1, maxLength: 2083 });
  });
});
