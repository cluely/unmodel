import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { generate, snapshotFileName } from "./codegen-fal";
import { sortKeysDeep } from "./emit";

/**
 * Two suites, and the split matters.
 *
 * The first runs a **mini fixture** whose every row is visible at once: it
 * pins the emitted file set, determinism, and the refusals — the constructs
 * this generator must stop on rather than guess at. A fixture is the only way
 * to test a refusal, because the committed snapshots deliberately contain none
 * of them.
 *
 * The second runs against the **real committed snapshots**, one test per
 * lowering rule, and that is what makes the first suite honest. A fixture can
 * be written to match whatever the generator happens to do; fal's own
 * documents cannot. Each of those tests names the endpoint that exercises the
 * rule, so a snapshot refresh that changes fal's schema fails with a message
 * saying which fact stopped being true.
 */

// ---------------------------------------------------------------------------
// The mini fixture
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;

/** An input/output component in fal's spelling: properties + order + required. */
function obj(props: Json, order: string[], required: string[] = [], title = "Input"): Json {
  return {
    type: "object",
    title,
    properties: props,
    required,
    "x-fal-order-properties": order,
  };
}

function doc(id: string, input: Json, output: Json, components: Json = {}): Json {
  return {
    metadata: {
      display_name: `Display ${id}`,
      category: "text-to-image",
      status: "active",
      updated_at: "2026-01-02T03:04:05.000Z",
    },
    openapi: {
      openapi: "3.0.4",
      info: {
        title: `Queue OpenAPI for ${id}`,
        "x-fal-metadata": {
          endpointId: id,
          category: "text-to-image",
          documentationUrl: `https://fal.ai/models/${id}/api`,
        },
      },
      paths: {
        [`/${id}`]: {
          post: {
            requestBody: {
              content: { "application/json": { schema: { $ref: "#/components/schemas/Input" } } },
            },
          },
        },
        [`/${id}/requests/{request_id}`]: {
          get: {
            responses: {
              "200": {
                content: { "application/json": { schema: { $ref: "#/components/schemas/Output" } } },
              },
            },
          },
        },
      },
      servers: [{ url: "https://queue.fal.run" }],
      components: { schemas: { Input: input, Output: output, ...components } },
    },
  };
}

const IMAGE_SIZE = obj(
  {
    width: { type: "integer", exclusiveMinimum: 0, maximum: 4096, default: 512 },
    height: { type: "integer", exclusiveMinimum: 0, maximum: 4096, default: 512 },
  },
  ["width", "height"],
  [],
  "ImageSize",
);

const IMAGE_OUT = obj(
  { images: { type: "array", items: { $ref: "#/components/schemas/Image" } } },
  ["images"],
  ["images"],
  "Output",
);

const IMAGE_COMPONENT = obj({ url: { type: "string" } }, ["url"], ["url"], "Image");

/** Two image endpoints with the SAME parameter list, differing only in detail. */
function imageInput(numImagesMax: number, syncMode: Json): Json {
  return obj(
    {
      prompt: { type: "string", description: "The prompt." },
      image_size: {
        default: "square",
        anyOf: [
          { $ref: "#/components/schemas/ImageSize" },
          { type: "string", enum: ["square", "landscape_4_3"] },
        ],
      },
      num_images: { type: "integer", minimum: 1, maximum: numImagesMax, default: 1 },
      sync_mode: syncMode,
    },
    ["prompt", "image_size", "num_images", "sync_mode"],
    ["prompt"],
  );
}

const SNAPSHOTS: Record<string, unknown> = {
  "acme/alpha": doc("acme/alpha", imageInput(4, { type: "boolean", default: false }), IMAGE_OUT, {
    ImageSize: IMAGE_SIZE,
    Image: IMAGE_COMPONENT,
  }),
  "acme/beta": doc(
    "acme/beta",
    imageInput(8, { type: "string", enum: ["cut_off", "loop"], default: "cut_off" }),
    IMAGE_OUT,
    { ImageSize: IMAGE_SIZE, Image: IMAGE_COMPONENT },
  ),
  "acme/gamma": doc(
    "acme/gamma",
    obj(
      {
        text: { type: "string", minLength: 1, maxLength: 500 },
        voice: { type: "string", enum: ["a", "b"], default: "a" },
      },
      ["text", "voice"],
      ["text"],
    ),
    obj({ audio: { $ref: "#/components/schemas/File" } }, ["audio"], ["audio"], "Output"),
    { File: obj({ url: { type: "string" } }, ["url"], ["url"], "File") },
  ),
};

const CURATION = {
  endpoints: {
    "acme/alpha": { verb: "image", textParam: "prompt" },
    "acme/beta": { verb: "image", textParam: "prompt" },
    "acme/gamma": { verb: "tts", textParam: "text" },
  },
};

const PRICING = {
  endpoints: {
    "acme/alpha": {
      unit: "per_image",
      usd: 0.04,
      source: "https://fal.ai/models/acme/alpha",
      verified: "2026-08-24",
      quote: "$0.04 per image.",
    },
    "acme/beta": {
      unit: "per_megapixel",
      usd: 0.01,
      source: "https://fal.ai/models/acme/beta",
      verified: "2026-08-24",
    },
    "acme/gamma": {
      unit: "per_1000_characters",
      usd: 0.05,
      source: "https://fal.ai/models/acme/gamma",
      verified: "2026-08-24",
    },
  },
};

const OVERLAYS = { endpoints: {} };

const fixture = (over: Partial<Parameters<typeof generate>[0]> = {}) =>
  generate({ snapshots: SNAPSHOTS, curation: CURATION, pricing: PRICING, overlays: OVERLAYS, ...over });

/** Deep-clones the fixture and hands the clone to `mutate` before generating. */
function withInput(mutate: (input: { snapshots: Json; curation: Json; pricing: Json; overlays: Json }) => void) {
  const input = structuredClone({
    snapshots: SNAPSHOTS,
    curation: CURATION,
    pricing: PRICING,
    overlays: OVERLAYS,
  }) as { snapshots: Json; curation: Json; pricing: Json; overlays: Json };
  mutate(input);
  return () => generate(input as unknown as Parameters<typeof generate>[0]);
}

/** `acme/alpha` → the `Input` component of its fixture document. */
function inputOf(snapshots: Json, id: string): Json {
  return (
    (snapshots[id] as { openapi: { components: { schemas: Record<string, Json> } } }).openapi.components
      .schemas["Input"] as Json
  );
}

describe("codegen-fal: the fixture", () => {
  test("is deterministic — two runs are byte-identical", () => {
    const a = fixture();
    const b = generate({
      snapshots: structuredClone(SNAPSHOTS),
      curation: structuredClone(CURATION),
      pricing: structuredClone(PRICING),
      overlays: structuredClone(OVERLAYS),
    });
    expect([...a.keys()]).toEqual([...b.keys()]);
    for (const [name, content] of a) expect(b.get(name)).toBe(content);
  });

  test("emits exactly six files per populated verb, plus the three shared ones", () => {
    expect([...fixture().keys()]).toEqual([
      "endpoints.gen.ts",
      // The schema/wire agreement proof. Type-only and imported by nothing —
      // it exists so `tsc --noEmit` fails when the two renderers disagree
      // about a field, rather than shipping a gate that rejects a body the
      // wire type promised was legal. See `AssertExtends` in shape-types.ts.
      "image-check.gen.ts",
      "image-narrow.gen.ts",
      "image-params.gen.ts",
      "image-schema.gen.ts",
      "image-wire.gen.ts",
      "models-image.gen.ts",
      "models-tts.gen.ts",
      // The rate table `src/providers/fal/pricing.ts` computes from. Shared
      // rather than per-verb because a price is a fact about an ENDPOINT, and
      // splitting it by verb would put the same lookup in nine files.
      "pricing.gen.ts",
      "shared.gen.ts",
      "tts-check.gen.ts",
      "tts-narrow.gen.ts",
      "tts-params.gen.ts",
      "tts-schema.gen.ts",
      "tts-wire.gen.ts",
    ]);
  });

  test("a verb with no curated endpoint emits no files at all", () => {
    const names = [...fixture().keys()].join(" ");
    for (const verb of ["video", "lipsync", "avatar", "upscale", "stt", "music", "image-edit"]) {
      expect(names, `${verb} has no endpoints`).not.toContain(`${verb}-wire.gen.ts`);
    }
  });

  test("every generated file carries the DO-NOT-EDIT header and its snapshot provenance", () => {
    for (const [name, content] of fixture()) {
      expect(content, name).toStartWith("// Generated by scripts/codegen-fal.ts — DO NOT EDIT.\n");
      expect(content, name).toContain("data/fal/openapi/acme__");
      expect(content, name).toContain("Regenerate with `bun run codegen:fal`");
    }
  });

  test("id → snapshot file name is reversible", () => {
    expect(snapshotFileName("fal-ai/flux/dev")).toBe("fal-ai__flux__dev.json");
  });

  // -------------------------------------------------------------------------
  // The lowering rules
  // -------------------------------------------------------------------------

  test("a property both endpoints spell identically keeps its exact type", () => {
    const schema = fixture().get("image-schema.gen.ts") as string;
    expect(schema).toContain(
      'image_size: z.union([falImageSizeSchema, z.enum(["square", "landscape_4_3"])]).optional(),',
    );
  });

  test("same type, different details → the bare type, with the reason", () => {
    const schema = fixture().get("image-schema.gen.ts") as string;
    expect(schema).toContain("num_images: z.number().optional(),");
    expect(schema).toContain("but they disagree on");
    // …and the details themselves survive, per endpoint.
    const narrow = fixture().get("image-narrow.gen.ts") as string;
    expect(narrow).toContain("num_images: { t: \"integer\", def: true, min: 1, max: 4 }");
    expect(narrow).toContain("num_images: { t: \"integer\", def: true, min: 1, max: 8 }");
  });

  /**
   * The rule that forbids a "common fal params" fragment. `sync_mode` is a
   * boolean at one endpoint and a five-arm enum at another; a union that
   * accepted both would let each endpoint's wrong type through the shape gate.
   */
  test("divergent types → z.unknown(), naming both endpoints and both types", () => {
    const schema = fixture().get("image-schema.gen.ts") as string;
    expect(schema).toContain("sync_mode: z.unknown().optional(),");
    expect(schema).toContain("boolean at acme/alpha");
    expect(schema).toContain("string at acme/beta");
    expect(schema).toContain("common fal params");
  });

  test("anyOf[$ref, enum] classifies as imageSizeUnion and flattens into a size block", () => {
    expect(fixture().get("image-params.gen.ts") as string).toContain('classes: ["imageSizeUnion"]');
    expect(fixture().get("image-narrow.gen.ts") as string).toContain(
      "size: { presets: E_",
    );
  });

  test("exclusiveMinimum lowers as a NUMBER, under its 2020-12 meaning", () => {
    expect(fixture().get("image-narrow.gen.ts") as string).toContain("width: { xmin: 0, max: 4096, default: 512 }");
  });

  /**
   * Row sharing keys on the WHOLE surface, not on the parameter names.
   *
   * `acme/alpha` and `acme/beta` declare the same four parameters in the same
   * order, and they still get two rows — because `num_images` tops out at 4 on
   * one and 8 on the other. That is the assertion worth having: a row is what
   * the unified surface narrows a caller against, so two endpoints sharing one
   * would publish a limit that is wrong for one of them, and `num_images: 8`
   * would autocomplete on a route that refuses it.
   *
   * The sharing itself is proved against the real snapshots below, where
   * genuinely identical pairs exist (`fal-ai/flux-2-max` and
   * `fal-ai/flux-2-pro`, the two Krea variants, two of the kontext routes).
   */
  test("a differing bound splits the row, even with an identical parameter list", () => {
    const params = fixture().get("image-params.gen.ts") as string;
    expect(params).toContain('keys: ["prompt", "image_size", "num_images", "sync_mode"]');
    expect(params).toContain("bounds: { num_images: { min: 1, max: 4 } }");
    expect(params).toContain("bounds: { num_images: { min: 1, max: 8 } }");
    expect([...params.matchAll(/^const ROW_/gm)], params).toHaveLength(2);
    expect(params).not.toContain("Shared by");
  });

  /**
   * The media rule, in both directions.
   *
   * fal documents a `ui.field` hint for file inputs and emits one almost
   * nowhere — once across the whole committed snapshot set — so a detector
   * built on it alone would classify one parameter in fifty. The parameter's
   * NAME is therefore the primary source, and the rule is deliberately narrow:
   * a name must BOTH end in `_url`/`_urls` AND name a medium.
   *
   * Both halves matter, and this test is here because both halves have an
   * obvious wrong version. Drop the suffix requirement and `image_size` (a
   * union) and `num_images` (an integer) become media parameters, and
   * `checkMediaRefs` starts telling callers their image count is not a valid
   * URL. Drop the medium requirement and `webhook_url` becomes one.
   */
  test("media is read off the parameter name, and only when the name is sure", () => {
    const classified = withInput((input) => {
      const props = (inputOf(input.snapshots, "acme/alpha") as { properties: Json }).properties as Json;
      props["image_url"] = { type: "string" };
      props["mask_url"] = { type: "string" };
      props["reference_video_urls"] = { type: "array", items: { type: "string" } };
      // An address, not media — the reason the rule needs a medium WORD and
      // not merely a `_url` suffix. (`num_images`, already on the fixture, is
      // the other direction: a medium word with no suffix, and an integer.)
      props["webhook_url"] = { type: "string" };
      (inputOf(input.snapshots, "acme/alpha") as { "x-fal-order-properties": string[] })[
        "x-fal-order-properties"
      ].push("image_url", "mask_url", "reference_video_urls", "webhook_url");
    })();
    const narrow = classified.get("image-narrow.gen.ts") as string;
    const alpha = narrow.slice(narrow.indexOf('"acme/alpha"'), narrow.indexOf('"acme/beta"'));

    expect(alpha).toContain('image_url: { t: "string", media: "image" }');
    // A mask is an image, which is what makes the rule a WORD list rather than
    // a "does it say image" check.
    expect(alpha).toContain('mask_url: { t: "string", media: "image" }');
    // …and the medium word may sit anywhere in the stem, including on an array.
    expect(alpha).toMatch(/reference_video_urls: \{ t: "array".*media: "video"/);

    // The two that must NOT be classified.
    expect(alpha).toContain('webhook_url: { t: "string" }');
    expect(alpha).not.toMatch(/webhook_url: \{[^}]*media/);
    expect(alpha).not.toMatch(/num_images: \{[^}]*media/);
  });

  test("a `media` overlay states a kind the name rule cannot see, or unsays one", () => {
    const base = (input: { snapshots: Json; overlays: Json }): void => {
      const props = (inputOf(input.snapshots, "acme/alpha") as { properties: Json }).properties as Json;
      props["source"] = { type: "string" };
      props["image_url"] = { type: "string" };
      (inputOf(input.snapshots, "acme/alpha") as { "x-fal-order-properties": string[] })[
        "x-fal-order-properties"
      ].push("source", "image_url");
    };

    // Stated: a parameter the rule cannot classify, because `source` neither
    // ends in `_url` nor names a medium.
    const stated = withInput((input) => {
      base(input);
      (input.overlays["endpoints"] as Json)["acme/alpha"] = [
        {
          kind: "media",
          param: "source",
          value: "video",
          reason: "fal takes the clip here and the name says nothing about it",
          source: "https://example.com/docs",
          verified: "2026-08-24",
        },
      ];
    })();
    expect(stated.get("image-narrow.gen.ts") as string).toContain(
      'source: { t: "string", media: "video" }',
    );

    // Unsaid: the same overlay with no `value` suppresses a classification the
    // rule made — the direction that matters when a heuristic is WRONG rather
    // than merely silent.
    const suppressed = withInput((input) => {
      base(input);
      (input.overlays["endpoints"] as Json)["acme/alpha"] = [
        {
          kind: "media",
          param: "image_url",
          reason: "this one is an opaque asset id at this endpoint, not a fetchable reference",
          source: "https://example.com/docs",
          verified: "2026-08-24",
        },
      ];
    })();
    const narrow = suppressed.get("image-narrow.gen.ts") as string;
    const alpha = narrow.slice(narrow.indexOf('"acme/alpha"'), narrow.indexOf('"acme/beta"'));
    expect(alpha).toContain('image_url: { t: "string" }');
    expect(alpha).not.toMatch(/image_url: \{[^}]*media/);
  });

  test("a `media` overlay naming no parameter fails", () => {
    expect(
      withInput((input) => {
        (input.overlays["endpoints"] as Json)["acme/alpha"] = [
          {
            kind: "media",
            reason: "no param",
            source: "https://example.com/docs",
            verified: "2026-08-24",
          },
        ];
      }),
    ).toThrow(/media` overlay with no `param`/);
  });

  test("required probes are `required` MINUS everything fal defaults", () => {
    const endpoints = fixture().get("endpoints.gen.ts") as string;
    expect(endpoints).toContain('"acme/alpha": ["prompt"],');
    expect(endpoints).toContain('"acme/gamma": ["text"],');
  });

  test("per-image and per-1k-character rates reach ModelCost; per-megapixel does not", () => {
    const image = fixture().get("models-image.gen.ts") as string;
    expect(image).toContain("cost: { perImage: 0.04 },");
    // ×1000 exactly — a unit conversion, not a rounded estimate.
    expect(fixture().get("models-tts.gen.ts") as string).toContain("cost: { perMillionCharacters: 50 },");
    // acme/beta is per-megapixel: no `cost`, and the row says why.
    expect(image).toContain("ModelCost has no `per_megapixel` unit");
    expect(image.slice(image.indexOf('"acme/beta"'))).not.toContain("cost:");
  });

  test("a tts text cap becomes limit.characters", () => {
    expect(fixture().get("models-tts.gen.ts") as string).toContain("limit: { context: 0, characters: 500 },");
  });

  test("every catalog row is limit.context 0 and satisfies ModelInfo", () => {
    const models = fixture().get("models-image.gen.ts") as string;
    expect(models).toContain("as const satisfies Record<string, ModelInfo>");
    expect([...models.matchAll(/limit: \{ context: 0/g)]).toHaveLength(2);
  });

  /**
   * Only the schema module imports zod as a VALUE.
   *
   * The check files name `z` too, and that is not an exception to the rule:
   * theirs is `import type { z }`, erased before emit, and its only job is to
   * spell `z.input<typeof schema>` so the assignability assertion has a gate
   * type to compare against. Nothing imports a check file, so no bundle sees
   * either the import or the module. Asserted as a `import type` rather than
   * skipped, because a check file that ever imported zod for real would put the
   * schema behind every `unmodel/fal/values` import.
   */
  test("only the schema module imports zod as a value; the rest are data or types", () => {
    for (const [name, content] of fixture()) {
      if (name.endsWith("-schema.gen.ts")) {
        expect(content, name).toContain('import { z } from "zod";');
        continue;
      }
      if (name.endsWith("-check.gen.ts")) {
        expect(content, name).toContain('import type { z } from "zod";');
        expect(content, name).not.toContain('import { z } from "zod";');
        continue;
      }
      expect(content, name).not.toContain('from "zod"');
    }
  });

  test("the check file asserts per-field wire → gate assignability, primitive fields only", () => {
    const check = fixture().get("image-check.gen.ts") as string;
    // One assertion per primitive-shaped field, per endpoint, against the
    // category gate's input type.
    expect(check).toContain('AssertExtends<wire.AcmeAlphaInput["prompt"], Gate["prompt"]>');
    expect(check).toContain('AssertExtends<wire.AcmeBetaInput["sync_mode"], Gate["sync_mode"]>');
    expect(check).toContain("type Gate = z.input<typeof falImageInputSchema>;");
    // `image_size` is a union with a component arm, so it is skipped: an
    // interface has no implicit index signature and can never extend a
    // `looseObject` input — asserting it would fail tsc on every correct build.
    expect(check).not.toContain('["image_size"]');
  });

  test("no generated module reaches the pipeline, a validator or the catalog index", () => {
    for (const [name, content] of fixture()) {
      for (const forbidden of ["core/pipeline", "core/request", "catalog/index", "createValidator"]) {
        expect(content, `${name} must not name ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  // -------------------------------------------------------------------------
  // The refusals
  // -------------------------------------------------------------------------

  test("allOf / oneOf / not / discriminator are refused, naming endpoint and pointer", () => {
    for (const keyword of ["allOf", "oneOf", "not", "discriminator"]) {
      const run = withInput((input) => {
        const props = inputOf(input.snapshots, "acme/alpha")["properties"] as Json;
        props["prompt"] = { [keyword]: [{ type: "string" }] };
      });
      expect(run, keyword).toThrow(new RegExp(`acme/alpha.*${keyword}`, "s"));
    }
  });

  test("a BOOLEAN exclusiveMinimum is refused — fal emits 2020-12 numbers", () => {
    const run = withInput((input) => {
      const props = inputOf(input.snapshots, "acme/alpha")["properties"] as Json;
      props["num_images"] = { type: "integer", exclusiveMinimum: true, minimum: 1 };
    });
    expect(run).toThrow(/exclusiveMinimum.*NUMBER/s);
  });

  test("a top-level `model` property is refused unless curation allow-lists it", () => {
    const props = (input: { snapshots: Json }): Json =>
      inputOf(input.snapshots, "acme/alpha")["properties"] as Json;
    const addModel = (input: { snapshots: Json }): void => {
      props(input)["model"] = { type: "string", enum: ["x"] };
      (inputOf(input.snapshots, "acme/alpha")["x-fal-order-properties"] as string[]).push("model");
    };
    expect(withInput(addModel)).toThrow(/acme\/alpha.*allowsModelProperty/s);
    expect(
      withInput((input) => {
        addModel(input);
        ((input.curation["endpoints"] as Json)["acme/alpha"] as Json)["allowsModelProperty"] = true;
      }),
    ).not.toThrow();
  });

  test("a property named `endpoint` is refused — it is unmodel's route pseudo-param", () => {
    const run = withInput((input) => {
      (inputOf(input.snapshots, "acme/alpha")["properties"] as Json)["endpoint"] = { type: "string" };
      (inputOf(input.snapshots, "acme/alpha")["x-fal-order-properties"] as string[]).push("endpoint");
    });
    expect(run).toThrow(/acme\/alpha.*pseudo-param/s);
  });

  test("x-fal-order-properties must be exactly the property set", () => {
    expect(
      withInput((input) => {
        (inputOf(input.snapshots, "acme/alpha")["x-fal-order-properties"] as string[]).pop();
      }),
    ).toThrow(/disagrees with the property set/);
    expect(
      withInput((input) => {
        delete inputOf(input.snapshots, "acme/alpha")["x-fal-order-properties"];
      }),
    ).toThrow(/x-fal-order-properties.*missing/s);
  });

  /**
   * The submit URL is derived from the document and asserted, never taken from
   * `metadata.model_url` — that field is the SYNC host, and trusting it would
   * turn every request into a blocking one.
   *
   * What is asserted is the HOST, not the path. The path in a fal OpenAPI
   * document is not always the endpoint id: a vendor-namespaced id is written
   * against an internal `fal-ai/…` alias (`ideogram/v4` → `/fal-ai/ideogram-v4`,
   * `xai/grok-imagine-image` → `/fal-ai/xai`). Both spellings are live routes —
   * probed unauthenticated on 2026-08-24, each answering 401 where a fabricated
   * id answers 404 — and unmodel submits to the published id, because that is
   * the one fal documents and the one this catalog is keyed on. So the
   * generator locates the submit path structurally and holds the line where it
   * matters: the queue host.
   */
  test("the submit host is derived and asserted, never taken from metadata", () => {
    const run = withInput((input) => {
      (input.snapshots["acme/alpha"] as { openapi: { servers: Array<{ url: string }> } }).openapi.servers = [
        { url: "https://fal.run" },
      ];
    });
    expect(run).toThrow(/document server is "https:\/\/fal\.run", expected "https:\/\/queue\.fal\.run"/);
  });

  test("a curated endpoint with no pricing row fails", () => {
    expect(
      withInput((input) => {
        delete (input.pricing["endpoints"] as Json)["acme/alpha"];
      }),
    ).toThrow(/acme\/alpha.*pricing\.json/s);
  });

  test("a curated endpoint with no snapshot fails, and vice versa", () => {
    expect(
      withInput((input) => {
        delete input.snapshots["acme/gamma"];
      }),
    ).toThrow(/No committed snapshot.*acme\/gamma/s);
    expect(
      withInput((input) => {
        delete (input.curation["endpoints"] as Json)["acme/gamma"];
      }),
    ).toThrow(/no curation entry.*acme\/gamma/s);
  });

  test("an overlay naming a parameter the schema dropped fails (anti-rot)", () => {
    expect(
      withInput((input) => {
        (input.overlays["endpoints"] as Json)["acme/alpha"] = [
          { kind: "enumAdd", param: "gone", reason: "r", source: "s", verified: "2026-08-24" },
        ];
      }),
    ).toThrow(/no longer declares/);
    expect(
      withInput((input) => {
        (input.overlays["endpoints"] as Json)["acme/nope"] = [
          { kind: "note", reason: "r", source: "s", verified: "2026-08-24" },
        ];
      }),
    ).toThrow(/not a curated endpoint/);
  });

  test("a geometry parameter that fits no shape class fails rather than defaulting", () => {
    const run = withInput((input) => {
      (inputOf(input.snapshots, "acme/alpha")["properties"] as Json)["aspect_ratio"] = {
        type: "object",
        properties: {},
        "x-fal-order-properties": [],
      };
      (inputOf(input.snapshots, "acme/alpha")["x-fal-order-properties"] as string[]).push("aspect_ratio");
    });
    expect(run).toThrow(/cannot classify `aspect_ratio`/);
  });

  test("a verb that disagrees with the response schema fails", () => {
    const run = withInput((input) => {
      ((input.curation["endpoints"] as Json)["acme/gamma"] as Json)["verb"] = "video";
    });
    expect(run).toThrow(/curated as "video".*returns audio/s);
  });

  test("a textParam the schema does not declare fails", () => {
    const run = withInput((input) => {
      ((input.curation["endpoints"] as Json)["acme/alpha"] as Json)["textParam"] = "nope";
    });
    expect(run).toThrow(/textParam "nope"/);
  });

  /**
   * `info.x-fal-metadata` is the PRIMARY source; the top-level listing row is
   * enrichment. fal genuinely ships endpoints whose listing row is partial
   * (wizper carries no `license_type`, `group` or `kind`), so the generator
   * must survive it being absent outright — the display name degrades to the
   * endpoint id and nothing else changes.
   */
  test("a snapshot with no listing metadata still generates a complete row", () => {
    const run = withInput((input) => {
      delete (input.snapshots["acme/gamma"] as Json)["metadata"];
    });
    const models = run().get("models-tts.gen.ts") as string;
    expect(models).toContain('name: "acme/gamma",');
    expect(models).not.toContain("lastUpdated:");
    expect(models).toContain('modalities: { input: ["text"], output: ["audio"] },');
    // The doc URL comes from x-fal-metadata, which is always there.
    expect(run().get("endpoints.gen.ts")).toContain(
      '"acme/gamma": "https://fal.ai/models/acme/gamma/api",',
    );
  });

  test("a retired endpoint ships deprecated, then fails once the escrow expires", () => {
    const retire = (input: { curation: Json }): void => {
      ((input.curation["endpoints"] as Json)["acme/alpha"] as Json)["retiredOn"] = "2026-01-01";
    };
    const shipped = withInput(retire)();
    expect(shipped.get("models-image.gen.ts")).toContain('status: "deprecated",');
    // The escrow is the only thing the date decides — the bytes are the same.
    const withDate = generate({
      snapshots: structuredClone(SNAPSHOTS),
      curation: structuredClone({
        endpoints: {
          ...CURATION.endpoints,
          "acme/alpha": { verb: "image", textParam: "prompt", retiredOn: "2026-01-01" },
        },
      }),
      pricing: PRICING,
      overlays: OVERLAYS,
      today: "2026-02-01",
    });
    expect(withDate.get("models-image.gen.ts")).toBe(shipped.get("models-image.gen.ts") as string);
    expect(() =>
      generate({
        snapshots: structuredClone(SNAPSHOTS),
        curation: {
          endpoints: {
            ...CURATION.endpoints,
            "acme/alpha": { verb: "image", textParam: "prompt", retiredOn: "2026-01-01" },
          },
        },
        pricing: PRICING,
        overlays: OVERLAYS,
        today: "2026-08-24",
      }),
    ).toThrow(/past the 90-day escrow/);
  });
});

// ---------------------------------------------------------------------------
// The committed snapshots — one test per rule, against fal's own documents
// ---------------------------------------------------------------------------

const ROOT = join(import.meta.dir, "..");
const OPENAPI_DIR = join(ROOT, "data", "fal", "openapi");

const readJson = (path: string): Json => JSON.parse(readFileSync(path, "utf8")) as Json;

const curation = readJson(join(ROOT, "data", "fal", "curation.json"));
const pricing = readJson(join(ROOT, "data", "fal", "pricing.json"));
const overlays = readJson(join(ROOT, "data", "fal", "overlays.json"));
const manifest = readJson(join(ROOT, "data", "fal", "manifest.json"));

const snapshots: Record<string, unknown> = Object.fromEntries(
  readdirSync(OPENAPI_DIR)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => [name.slice(0, -".json".length).replace(/__/g, "/"), readJson(join(OPENAPI_DIR, name))]),
);

const real = generate({ snapshots, curation, pricing, overlays });
const file = (name: string): string => real.get(name) as string;

describe("codegen-fal: the committed fal snapshots", () => {
  test("the corpus is not vacuous — every verb is represented", () => {
    expect(Object.keys(snapshots).length).toBeGreaterThanOrEqual(12);
    for (const verb of ["avatar", "image", "image-edit", "lipsync", "music", "stt", "tts", "upscale", "video"]) {
      expect(real.has(`${verb}-wire.gen.ts`), `${verb} has a curated endpoint`).toBe(true);
    }
  });

  test("regenerating the committed snapshots is byte-identical to what is on disk", () => {
    const genDir = join(ROOT, "src", "providers", "fal", "gen");
    const onDisk = readdirSync(genDir).filter((name) => name.endsWith(".gen.ts")).sort();
    expect(onDisk).toEqual([...real.keys()]);
    for (const name of onDisk) {
      expect(readFileSync(join(genDir, name), "utf8"), name).toBe(file(name));
    }
  });

  test("every snapshot is key-sorted, so a refresh diffs on content", () => {
    for (const [id, snapshot] of Object.entries(snapshots)) {
      expect(JSON.stringify(snapshot), id).toBe(JSON.stringify(sortKeysDeep(snapshot)));
    }
  });

  test("the manifest hash matches the committed snapshot bytes", () => {
    const rows = manifest["endpoints"] as Record<string, { sha256: string; file: string }>;
    expect(Object.keys(rows).sort()).toEqual(Object.keys(snapshots).sort());
    for (const [id, row] of Object.entries(rows)) {
      const bytes = readFileSync(join(ROOT, "data", "fal", row.file), "utf8");
      const digest = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
      expect(digest, `${id} — run \`bun run codegen:fal:refresh\``).toBe(row.sha256);
    }
  });

  /**
   * flux/dev — the `anyOf[$ref ImageSize, preset enum]` union.
   *
   * The last two assertions are the division of labour in one test. At 28
   * curated image endpoints `image_size` genuinely means different things —
   * a union here, a bare preset enum there, absent elsewhere — so the CATEGORY
   * schema declines to pick a winner and types it `unknown`. That is not a
   * loss: the presets and the pixel ceilings survive per endpoint in the IR
   * and in the params row, where `checkImageSize` reads them and can say which
   * endpoint's ceiling was exceeded. A union schema that guessed one spelling
   * would accept requests half these endpoints refuse.
   */
  test("flux: image_size lowers to a union plus a flattened size block", () => {
    const narrow = file("image-narrow.gen.ts");
    expect(narrow).toContain('"fal-ai/flux/dev"');
    expect(narrow).toMatch(/image_size: \{ t: "union", def: true, size: \{ presets: E_\w+, width: \{ xmin: 0, max: 14142, default: 512 \}/);
    const params = file("image-params.gen.ts");
    expect(params).toContain('classes: ["imageSizeUnion"]');
    // The presets survive as a real vocabulary, not as `string` — in the row
    // the unified adapter and `unmodel/fal/values` both read.
    expect(params).toContain('sizes: ["square_hd", "square", "portrait_4_3", "portrait_16_9", "landscape_4_3", "landscape_16_9"]');
    expect(narrow).toContain('"landscape_16_9"');
    // …and the category schema refuses to pick a winner, exactly as it does
    // for `num_inference_steps` in the next test.
    expect(file("image-schema.gen.ts")).toContain("image_size: z.unknown()");
  });

  /**
   * Endpoints whose whole surface matches share one frozen row.
   *
   * The d.ts cost of a per-endpoint literal is real at a hundred endpoints,
   * and two identical rows would also imply a distinction fal does not make.
   * `flux-2-max` and `flux-2-pro` take exactly the same parameters with
   * exactly the same bounds — only the price differs, and price is not on this
   * row.
   */
  test("endpoints with an identical surface share one row constant", () => {
    const params = file("image-params.gen.ts");
    expect(params).toContain(
      "Shared by 2 endpoints with an identical surface: fal-ai/flux-2-max, fal-ai/flux-2-pro.",
    );
    // Fewer row constants than endpoints is the whole point of the sharing.
    const rows = [...params.matchAll(/^const ROW_/gm)].length;
    const endpoints = [...params.matchAll(/^  "[^"]+": ROW_/gm)].length;
    expect(rows, `${rows} rows for ${endpoints} endpoints`).toBeLessThan(endpoints);
  });

  /** flux/dev vs flux/schnell — the reason per-endpoint bounds exist. */
  test("flux: dev tops out at 50 inference steps and schnell at 12", () => {
    const narrow = file("image-narrow.gen.ts");
    const dev = narrow.slice(narrow.indexOf('"fal-ai/flux/dev"'), narrow.indexOf('"fal-ai/flux/schnell"'));
    const schnell = narrow.slice(narrow.indexOf('"fal-ai/flux/schnell"'));
    expect(dev).toContain("num_inference_steps: { t: \"integer\", def: true, min: 1, max: 50 }");
    expect(schnell).toContain("num_inference_steps: { t: \"integer\", def: true, min: 1, max: 12 }");
    // …and the category schema refuses to pick a winner.
    expect(file("image-schema.gen.ts")).toContain("num_inference_steps: z.number().optional(),");
  });

  /** sync-lipsync/v2 — the `model` collision, allow-listed per id. */
  test("sync-lipsync/v2 keeps its real `model` wire field, because curation says so", () => {
    const entry = (curation["endpoints"] as Record<string, { allowsModelProperty?: boolean }>)[
      "fal-ai/sync-lipsync/v2"
    ];
    expect(entry?.allowsModelProperty).toBe(true);
    expect(file("lipsync-wire.gen.ts")).toContain('model?: "lipsync-2" | "lipsync-2-pro";');
    expect(file("lipsync-schema.gen.ts")).toContain('model: z.enum(["lipsync-2", "lipsync-2-pro"]).optional(),');
    // No endpoint anywhere declares a property named `endpoint` — that is what
    // makes the pseudo-param safe to strip in finalize.
    for (const [name, content] of real) {
      if (name.endsWith("-wire.gen.ts")) expect(content, name).not.toMatch(/^ {2}endpoint\??:/m);
    }
  });

  /**
   * `sync_mode` — same word, two meanings, and the categories keep them apart.
   *
   * A boolean (data-URI delivery) at flux; a five-arm duration-mismatch enum
   * at sync-lipsync. Because the union schema is per CATEGORY, both stay
   * exactly typed — which is only true as long as nobody hoists a shared
   * fragment across categories.
   */
  test("sync_mode is a boolean in image and an enum in lipsync, and both are exact", () => {
    expect(file("image-schema.gen.ts")).toContain("sync_mode: z.boolean().optional(),");
    expect(file("lipsync-schema.gen.ts")).toContain(
      'sync_mode: z.enum(["cut_off", "loop", "bounce", "silence", "remap"]).optional(),',
    );
    expect(file("image-narrow.gen.ts")).toContain('sync_mode: { t: "boolean", def: true }');
    expect(file("lipsync-narrow.gen.ts")).toMatch(/sync_mode: \{ t: "string", def: true, enum: E_\w+ \}/);
  });

  /**
   * `duration` — one word, four types, and the merge rule that refuses to
   * pretend otherwise.
   *
   * `"5" | "10"` at kling, `"4s" | "6s" | "8s"` at veo3.1, the INTEGER `5` at
   * wan and minimax, and a free integer 1..15 at pixverse. Through wave 1a the
   * curated video roster was two kling/veo endpoints and the category type was
   * a clean `z.string()`; widening to thirty endpoints in wave 1c brought the
   * numeric spellings in and the union type is now `z.unknown()`, which is the
   * documented answer for a divergent parameter rather than a regression: a
   * `z.union([z.string(), z.number()])` would let `duration: "8s"` through the
   * shape gate at kling, which fal refuses.
   *
   * The real type survives per endpoint in the IR, which is the whole reason
   * the IR exists — and the fact that the category type had to widen the moment
   * the roster grew is the argument against ever hoisting a shared fragment,
   * made by the data rather than by a comment.
   */
  test("duration diverges across the video roster and is therefore `unknown` in the union", () => {
    const schema = file("video-schema.gen.ts");
    expect(schema).toContain("duration: z.unknown().optional(),");
    expect(schema).toContain("`duration` means different things at different endpoints");
    expect(schema).toContain("FAL_VIDEO_SHAPES carries the real type per");
    const narrow = file("video-narrow.gen.ts");
    expect(narrow).toContain('["5", "10"]');
    expect(narrow).toContain('["4s", "6s", "8s"]');
    const params = file("video-params.gen.ts");
    expect(params).toContain('"durationStringEnum"');
    expect(params).toContain('"durationNumber"');
    // …and both spellings resolve to the SAME canonical seconds, which is what
    // `unmodel/video`'s `duration: 5` compiles through.
    expect(params).toContain('durationWire: { "10": "10", "5": "5" }');
    expect(params).toContain('durationWire: { "4": "4s", "6": "6s", "8": "8s" }');
  });

  /** wizper — `const` properties, and a metadata block that is NOT complete. */
  test("wizper: `const` lowers to a one-value enum", () => {
    const narrow = file("stt-narrow.gen.ts");
    expect(narrow).toContain('const E_5f6594 = ["segment"] as const;');
    expect(narrow).toMatch(/chunk_level: \{ t: "string", def: true, enum: E_\w+ \}/);
    expect(file("stt-wire.gen.ts")).toContain('chunk_level?: "segment";');
  });

  test("wizper: a partial listing row still produces a complete catalog row", () => {
    // fal's listing for wizper omits fields other endpoints carry
    // (`license_type`, `group`, `kind`), which is exactly the "metadata is
    // enrichment, x-fal-metadata is the source" rule: the row below is built
    // without any of them.
    const listing = (snapshots["fal-ai/wizper"] as { metadata: Json }).metadata;
    for (const absent of ["license_type", "group", "kind"]) expect(listing).not.toHaveProperty(absent);
    expect(file("models-stt.gen.ts")).toContain('"fal-ai/wizper": {');
    expect(file("models-stt.gen.ts")).toContain('modalities: { input: ["audio"], output: ["text"] },');
  });

  test("kling: fal's own ui.field hint becomes a media tag", () => {
    expect(file("video-narrow.gen.ts")).toContain('media: "image"');
  });

  test("minimax: nested $ref inputs become shared types and nested schemas", () => {
    expect(file("shared.gen.ts")).toContain("export interface FalVoiceSetting {");
    expect(file("tts-schema.gen.ts")).toContain("const falVoiceSettingSchema = z.looseObject({");
    expect(file("tts-schema.gen.ts")).toContain("voice_setting: falVoiceSettingSchema.optional(),");
  });

  test("two different components sharing a title get content-derived names", () => {
    const shared = file("shared.gen.ts");
    expect(shared).toMatch(/export interface FalImage_\w{6} \{/);
    // `File` is byte-identical everywhere it appears, so it stays unsuffixed.
    expect(shared).toContain("export interface FalFile {");
  });

  test("every curated endpoint has a price or a stated reason for having none", () => {
    const rows = pricing["endpoints"] as Record<string, Json>;
    for (const id of Object.keys(curation["endpoints"] as Json)) {
      const row = rows[id];
      expect(row, `${id} needs a pricing row`).toBeDefined();
      expect(row?.["source"], id).toBeString();
      expect(row?.["verified"], id).toBeString();
      const priced = row?.["usd"] !== undefined || row?.["tiers"] !== undefined;
      expect(priced || row?.["unpriced"] !== undefined, `${id} states neither a rate nor a reason`).toBe(true);
    }
  });

  /**
   * Conditional and tiered rates never reach `ModelCost`; flat ones do.
   *
   * Asserted per ROW rather than per file, because wave 1c is the first wave
   * where both kinds share a catalog: twenty-eight of the thirty video rows are
   * conditional or tiered and carry a provenance comment instead of a number,
   * while `fal-ai/minimax/hailuo-02/pro/image-to-video` and
   * `fal-ai/kling-video/o3/pro/video-to-video/edit` publish one flat per-second
   * rate each and correctly carry `cost.perVideoSecond`. A whole-file
   * `not.toContain("cost:")` would have to be deleted the first time a flat
   * rate joined, which is precisely when the invariant starts being worth
   * checking.
   */
  test("conditional and tiered rates never reach ModelCost; flat per-second rates do", () => {
    const video = file("models-video.gen.ts");
    expect(video).toContain("Conditional pricing on generate_audio × resolution");
    expect(video).toContain("belongs in the");
    // The two flat rates, on the wire where `ModelCost` can carry them exactly.
    expect(video).toContain("cost: { perVideoSecond: 0.08 }");
    expect(video).toContain("cost: { perVideoSecond: 0.168 }");

    const rates = pricing["endpoints"] as Record<string, Json>;
    for (const [id, entry] of Object.entries(curation["endpoints"] as Json) as Array<
      [string, Record<string, Json>]
    >) {
      const unit = String((rates[id] as Record<string, Json> | undefined)?.["unit"]);
      if (unit !== "conditional" && unit !== "tiered") continue;
      const verb = String(entry["verb"]).replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
      const rows = file(`models-${verb}.gen.ts`);
      const row = rows.slice(rows.indexOf(`${JSON.stringify(id)}: {`));
      const end = row.indexOf("\n  },");
      expect(row.slice(0, end), `${id} is ${String(unit)} and must not carry a scalar cost`).not.toContain(
        "cost:",
      );
    }
  });

  test("every generated catalog row cites its source and quotes the page", () => {
    for (const [name, content] of real) {
      if (!name.startsWith("models-")) continue;
      expect(content, name).toContain("Source: https://fal.ai/models/");
      expect(content, name).toMatch(/verified\s+(?:\*\s+)?2026-/);
    }
  });
});
