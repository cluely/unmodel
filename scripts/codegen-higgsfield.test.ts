import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CANONICAL_KEY_LISTS } from "../src/core/unified/canonical-keys";
import {
  CONSOLE_NO_PRICING,
  PACK_VOCABULARY,
  comparable,
  differingPointers,
  generate,
  labelledAmounts,
  parseConsoleDocument,
  parseDocsPage,
  quotedAmounts,
  readPageValue,
  type GenerateInput,
} from "./codegen-higgsfield";

/**
 * Four suites, split the way `codegen-revana.test.ts` splits them.
 *
 * The first covers the **readers**: the three parsers that turn a documented
 * page into a snapshot row, on inline samples of each page's own format.
 *
 * The second runs a **mini fixture** through `generate()`: it pins the emitted
 * file set, determinism, each lowering rule and every refusal. A fixture is the
 * only way to test a refusal, because the committed snapshot deliberately
 * contains none.
 *
 * The third does the same for the **unified rows**: what each pack's row
 * carries, which routes a pack addresses, and every way a row can stop the run.
 *
 * The fourth runs against the **real committed snapshot**, one test per fact
 * the provider builds on, naming the route that exercises it. A refresh that
 * changes one of those facts then fails with a message saying which.
 */

type Json = Record<string, unknown>;

// ---------------------------------------------------------------------------
// The readers
// ---------------------------------------------------------------------------

describe("reading the documented sources", () => {
  test("page data: bare keys, `!0` / `!1`, slot assignments and back-references", () => {
    const html = 'x data:$R[7]={model:$R[8]={slug:"a/b","ui:order":$R[9]=["x","*"],on:!0,off:!1,n:-1.5e2,none:null,again:$R[9],text:"q\\"\\x3c"}},rest:1';
    expect(readPageValue(html, /data:\$R\[\d+\]=\{model:/)).toEqual({
      slug: "a/b",
      "ui:order": ["x", "*"],
      on: true,
      off: false,
      n: -150,
      none: null,
      again: ["x", "*"],
      text: 'q"<',
    });
  });

  test("page data: stops on anything that is not a literal, and never evaluates it", () => {
    expect(() => readPageValue("results:[(stream) => 1]", /results:/)).toThrow(/unexpected token/);
    expect(() => readPageValue("results:$R[3]", /results:/)).toThrow(/slot 3/);
    expect(() => readPageValue("nothing here", /results:/)).toThrow(/no \/results:\//);
  });

  const CONSOLE_DOCUMENT = [
    "# Soul Standard",
    "",
    "> Generates photos.",
    "",
    "## Overview",
    "",
    "- **Endpoint**: `https://api.higgsfield.ai/higgsfield-ai/soul/standard`",
    "- **Category**: image_edit, text2image",
    "",
    "## Pricing",
    "",
    "First paragraph: $0.10.",
    "",
    "- second: $0.20",
    "",
    "## Authentication",
    "",
    "### Input JSON Schema",
    "",
    "```json",
    '{ "type": "object", "properties": { "prompt": { "type": "string" } } }',
    "```",
    "",
    "### Required Parameters Example",
    "",
    "```json",
    '{ "prompt": "x" }',
    "```",
    "",
  ].join("\n");

  test("a console document: title, category, the whole pricing section and the input schema", () => {
    expect(parseConsoleDocument("higgsfield-ai/soul/standard", CONSOLE_DOCUMENT)).toEqual({
      url: "https://dash.higgsfield.ai/models/higgsfield-ai/soul/standard/llms.txt",
      title: "Soul Standard",
      category: "image_edit, text2image",
      pricing: "First paragraph: $0.10.\n\n- second: $0.20",
      input_schema: { type: "object", properties: { prompt: { type: "string" } } },
    });
  });

  test("a console document missing a part stops the refresh", () => {
    expect(() => parseConsoleDocument("a/b", CONSOLE_DOCUMENT.replace("## Pricing", "## Prices"))).toThrow(/missing one of/);
  });

  const DOCS_PAGE = [
    "# Soul ID — Create character API",
    "",
    "**Endpoint:** `POST https://api.higgsfield.ai/v1/custom-references`",
    "",
    "**Catalog ID:** `soul-id`",
    "",
    "## Usage notes",
    "",
    "* name has a maximum length of 100; input\\_images must contain 1–100 objects.",
    "* Poll GET /v1/custom-references/\\{id}.",
    "",
    "## Quick start",
    "",
    "```json",
    '{ "name": "not the schema" }',
    "```",
    "",
    "> [accordion] Complete JSON schema",
    ">",
    '> ```json theme={"theme":{"light":"github-light"}}',
    "> {",
    '>   "type": "object",',
    '>   "required": ["name"]',
    "> }",
    "> ```",
    "",
  ].join("\n");

  test("a docs page: the route is the endpoint path, the schema is the accordion's, notes keep their Markdown", () => {
    expect(parseDocsPage("https://docs.example/soul-id/create-character.md", "image", DOCS_PAGE)).toEqual({
      id: "v1/custom-references",
      docs: {
        url: "https://docs.example/soul-id/create-character.md",
        category: "image",
        title: "Soul ID — Create character",
        method: "POST",
        catalog_id: "soul-id",
        schema: { type: "object", required: ["name"] },
        usage_notes: [
          "name has a maximum length of 100; input\\_images must contain 1–100 objects.",
          "Poll GET /v1/custom-references/\\{id}.",
        ],
      },
    });
  });

  test("a docs page with no schema block stops the refresh", () => {
    expect(() => parseDocsPage("u", "video", DOCS_PAGE.replace("Complete JSON schema", "Schema"))).toThrow(/missing one of/);
  });

  test("comparable: annotations, enum order and the two spellings of nullable are not differences", () => {
    const docs = {
      type: "object",
      required: ["b", "a"],
      properties: {
        seed: { anyOf: [{ type: "integer", minimum: 1 }, { type: "null" }], default: null, title: "Seed" },
        ratio: { type: "string", enum: ["1:1", "16:9"], description: "Aspect ratio." },
        strength: { type: "number", format: "float" },
        // A PROPERTY named like an annotation keyword is still a property.
        title: { type: "string" },
      },
    };
    const consoleSchema = {
      type: "object",
      title: "Playground",
      required: ["a", "b"],
      properties: {
        seed: { type: ["integer", "null"], minimum: 1 },
        ratio: { type: "string", enum: ["16:9", "1:1"], default: "1:1" },
        strength: { type: "number" },
        title: { type: "string", examples: ["x"] },
      },
    };
    expect(differingPointers(comparable(docs), comparable(consoleSchema))).toEqual([]);
    expect(differingPointers(comparable(docs), comparable({ ...consoleSchema, properties: { ...consoleSchema.properties, title: undefined } }))).toEqual([
      "/properties/title",
    ]);
  });

  test("differingPointers: the deepest pointer that differs, with arrays as wholes", () => {
    const a = { properties: { p: { maxLength: 800, enum: ["a"] }, q: { type: "string" } }, allOf: [{ if: {} }] };
    const b = { properties: { p: { maxLength: 2500, enum: ["a", "b"] } }, allOf: [{ if: { x: 1 } }] };
    expect(differingPointers(comparable(a), comparable(b))).toEqual(["/allOf", "/properties/p/enum", "/properties/p/maxLength", "/properties/q"]);
  });

  test("quotedAmounts: whole numbers, so a truncated figure is not found inside a longer one", () => {
    expect(quotedAmounts("480p: $0.1540; 720p: $0.3446. Per 1M tokens: text input $5. USD 0.08/sec.")).toEqual([0.154, 0.3446, 5, 0.08]);
    expect(quotedAmounts("$0.1540")).not.toContain(0.15);
  });

  test("labelledAmounts: the amount a sentence states beside a label, in each of the three ways the price sentences do", () => {
    expect(labelledAmounts("Rates: 480p: $0.0804; 720p: $0.1735; 4K: $0.8907. Total = rate × seconds.")).toEqual(
      new Map([
        ["480p", [0.0804]],
        ["720p", [0.1735]],
        ["4k", [0.8907]],
      ]),
    );
    expect(labelledAmounts("Price per second (output): 480p — $0.0739; 720p — $0.1471.")).toEqual(
      new Map([
        ["480p", [0.0739]],
        ["720p", [0.1471]],
      ]),
    );
    expect(labelledAmounts("Without / with video input: 720p $0.1257 / $0.1544; 1080p $0.1879 / $0.2336.").get("1080p")).toEqual([0.1879, 0.2336]);
    const shared = labelledAmounts("Images cost $0.054 each at 1k and 1.5k and $0.108 each at 2k.");
    expect([shared.get("1k"), shared.get("1.5k"), shared.get("2k")]).toEqual([[0.054], [0.054], [0.108]]);
    expect(labelledAmounts("Images cost $0.063 each at 2k, $0.094 each at 4k and $0.157 each at 8k.").get("4k")).toEqual([0.094]);
    const clips = labelledAmounts("Video costs $0.0467 per second at 768p for 6 second clips and $0.056 per second for 10 second clips.");
    expect(clips.get("6")).toEqual([0.0467]);
    expect(clips.get("10")).toEqual([0.056]);
    // A label that opens a list is not beside an amount, and is left out.
    expect(labelledAmounts("4K:\n- Without video input: $0.549 × output duration in seconds.").has("4k")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The fixture
// ---------------------------------------------------------------------------

const PROVENANCE = { reason: "because", source: "https://example.com", date: "2026-11-24" };

interface RouteOptions {
  /** The console schema. `null`: the console does not publish the route. */
  schema?: Json | null;
  /** The docs schema. Absent: the docs do not publish the route. */
  docs?: Json;
  output?: string;
  category?: string;
  pricing?: string;
  sentence?: string | null;
  description?: string;
  variant?: string | null;
  notes?: string[];
}

const PROMPT_ONLY = { type: "object", required: ["prompt"], properties: { prompt: { type: "string" } } };

function route(id: string, options: RouteOptions = {}): Json {
  const schema = options.schema === undefined ? PROMPT_ONLY : options.schema;
  const output = options.output ?? "video";
  const category = options.category ?? (output === "image" ? "text2image" : "text2video");
  return {
    id,
    console:
      schema === null
        ? null
        : {
            url: `https://dash.higgsfield.ai/models/${id}/llms.txt`,
            title: id,
            category,
            input_schema: schema,
            pricing: options.pricing ?? CONSOLE_NO_PRICING,
          },
    page:
      schema === null
        ? null
        : {
            url: `https://open.higgsfield.ai/models/${id}/api-reference`,
            title: "Model",
            variant_title: options.variant === undefined ? id : options.variant,
            description: options.description ?? "",
            company: "maker",
            output_type: output,
            operation_type: category.split(", ")[0],
            input_types: ["text"],
            availability_state: "available",
            released_on: "2026-01-02",
            related_models_description: options.sentence ?? null,
          },
    docs:
      options.docs === undefined
        ? null
        : {
            url: `https://docs.higgsfield.ai/docs/models/${id}.md`,
            category: output === "image" ? "image" : "video",
            title: `Docs ${id}`,
            method: "POST",
            catalog_id: null,
            schema: options.docs,
            usage_notes: options.notes ?? [],
          },
  };
}

interface Patch {
  curation?: Json;
  overlays?: Json[];
  pricing?: Record<string, Json>;
}

function unpriced(snapshot: Json): Json {
  const consoleSource = snapshot["console"] as { pricing: string; url: string } | null;
  return consoleSource === null
    ? { unpriced: "No surface states a price.", source: "https://example.com", verified: "2026-11-24" }
    : { unpriced: "No price.", source: consoleSource.url, verified: "2026-11-24", quote: consoleSource.pricing };
}

function input(routes: Json[], patch: Patch = {}): GenerateInput {
  const pricing: Record<string, Json> = {};
  const curation = { handWritten: {}, views: { imageEdit: { exclude: {} } }, excluded: { routes: {} }, ...patch.curation };
  const skipped = new Set([...Object.keys(curation.handWritten), ...Object.keys(curation.excluded.routes)]);
  for (const snapshot of routes) {
    const id = snapshot["id"] as string;
    if (!skipped.has(id)) pricing[id] = patch.pricing?.[id] ?? unpriced(snapshot);
  }
  for (const [id, row] of Object.entries(patch.pricing ?? {})) pricing[id] ??= row;
  return {
    routes: Object.fromEntries(routes.map((snapshot) => [snapshot["id"] as string, snapshot])),
    curation,
    overlays: { overlays: patch.overlays ?? [] },
    pricing: { endpoints: pricing },
  };
}

/** One generated row, as the single block of text it is emitted as. */
function block(file: string | undefined, id: string): string {
  const text = file ?? "";
  const start = text.indexOf(`  ${JSON.stringify(id)}: {`);
  if (start < 0) return "";
  const end = text.indexOf("\n  },", start);
  return text.slice(start, end);
}

/**
 * A slice of a unified row file with its hoisted lists and maps written back
 * in place, so a test reads a row the way the adapter does.
 */
function inlined(file: string, slice: string): string {
  const shared = new Map([...file.matchAll(/^const ([A-Z]_[0-9a-f]{6}) = (.+) as const;$/gm)].map((match) => [match[1] as string, match[2] as string]));
  return slice.replace(/\b[A-Z]_[0-9a-f]{6}\b/g, (name) => shared.get(name) ?? name);
}

/** A generated file with its JSDoc blocks un-wrapped, so a sentence can be matched wherever the re-flow broke it. */
function prose(file: string | undefined): string {
  return (file ?? "").replace(/\n\s*\*\s?/g, " ");
}

function properties(props: Json, extra: Json = {}): Json {
  return { type: "object", properties: props, ...extra };
}

const STILL = route("maker/still", { output: "image" });
const CLIP = route("maker/clip");

describe("codegen-higgsfield on a mini fixture", () => {
  const files = generate(input([CLIP, STILL]));

  test("emits the id lists, the rates, the one gate, three files per output type, and one row file per pack", () => {
    expect([...files.keys()]).toEqual([
      "endpoints.gen.ts",
      "image-edit-params.gen.ts",
      "image-narrow.gen.ts",
      "image-params.gen.ts",
      "image-wire.gen.ts",
      "input-schema.gen.ts",
      "models-image.gen.ts",
      "models-video.gen.ts",
      "pricing.gen.ts",
      "video-narrow.gen.ts",
      "video-params.gen.ts",
      "video-wire.gen.ts",
    ]);
  });

  test("is deterministic and independent of the order routes are read in", () => {
    expect([...generate(input([STILL, CLIP])).entries()]).toEqual([...files.entries()]);
  });

  test("writes nothing outside the provider's own modules: every import is a sibling, a hand leaf, core or zod", () => {
    const imports = [...files.values()].flatMap((content) => [...content.matchAll(/from "([^"]+)"/g)].map((match) => match[1]));
    expect([...new Set(imports)].sort()).toEqual([
      "../../../core/catalog-types",
      "../param-types",
      "../pricing-types",
      "../shape-types",
      "./endpoints.gen",
      "zod",
    ]);
  });

  test("a route is filed by what it answers, and named from its page", () => {
    const endpoints = files.get("endpoints.gen.ts") ?? "";
    expect(endpoints).toContain('export const HIGGSFIELD_IMAGE_ENDPOINTS = [\n  "maker/still",\n] as const;');
    expect(endpoints).toContain('export const HIGGSFIELD_VIDEO_ENDPOINTS = [\n  "maker/clip",\n] as const;');
    expect(endpoints).toContain('export const HIGGSFIELD_ENDPOINTS = [\n  "maker/clip",\n  "maker/still",\n] as const;');
    expect(block(files.get("models-video.gen.ts"), "maker/clip")).toContain('name: "Model — maker/clip"');
    expect(block(files.get("models-video.gen.ts"), "maker/clip")).toContain('releaseDate: "2026-01-02"');
    expect(files.get("video-wire.gen.ts")).toContain("export interface MakerClipInput {\n  prompt: string;\n}");
  });

  test("a route only the docs publish is filed by its category index and named from its docs page", () => {
    const docsOnly = generate(input([route("maker/quiet", { schema: null, docs: PROMPT_ONLY, output: "image" })]));
    expect(docsOnly.get("endpoints.gen.ts")).toContain('HIGGSFIELD_IMAGE_ENDPOINTS = [\n  "maker/quiet",\n]');
    const row = block(docsOnly.get("models-image.gen.ts"), "maker/quiet");
    expect(row).toContain('name: "Docs maker/quiet"');
    expect(row).not.toContain("releaseDate");
    expect(docsOnly.get("endpoints.gen.ts")).toContain('"maker/quiet": "https://docs.higgsfield.ai/docs/models/maker/quiet.md"');
  });

  test("the picture-editing view is the image routes filed under image_edit, minus curation's exclusions", () => {
    const schema = properties({ prompt: { type: "string" }, image_url: { type: "string", format: "uri" } });
    const edit = route("maker/edit", { output: "image", category: "image_edit", schema });
    const both = route("maker/both", { output: "image", category: "image_edit, text2image", schema });
    const sheet = route("maker/sheet", { output: "image", category: "image_edit, text2image", schema });
    const view = generate(input([edit, both, sheet, STILL], { curation: { views: { imageEdit: { exclude: { "maker/sheet": PROVENANCE } } } } }));
    expect(view.get("endpoints.gen.ts")).toContain('HIGGSFIELD_IMAGE_EDIT_ENDPOINTS = [\n  "maker/both",\n  "maker/edit",\n] as const;');
    expect(view.get("models-image.gen.ts")).toContain(
      'export const imageEditModels = {\n  "maker/both": imageModels["maker/both"],\n  "maker/edit": imageModels["maker/edit"],\n} as const satisfies Record<string, ModelInfo>;',
    );
    expect(view.get("image-wire.gen.ts")).toContain("Pick<HiggsfieldImageBodyById, HiggsfieldImageEditEndpointId>");
    expect(() => generate(input([STILL], { curation: { views: { imageEdit: { exclude: { "maker/still": PROVENANCE } } } } }))).toThrow(
      /does not file under image_edit/,
    );
  });

  test("an excluded route is not generated and is published with its reason", () => {
    const legacy = route("makre/clip", { schema: null });
    const out = generate(input([CLIP, legacy], { curation: { excluded: { routes: { "makre/clip": { ...PROVENANCE, reason: "A misspelled path." } } } } }));
    expect(out.get("endpoints.gen.ts")).toContain('"makre/clip": "A misspelled path."');
    expect(out.get("endpoints.gen.ts")).not.toContain('  "makre/clip",');
  });

  test("a hand-written route is exempt from reconciliation and from lowering", () => {
    const training = route("v1/train", { schema: { title: "Train" }, docs: PROMPT_ONLY, output: "image", category: "character" });
    expect(() => generate(input([training]))).toThrow(/File it under `handWritten`/);
    const out = generate(input([training, STILL], { curation: { handWritten: { "v1/train": PROVENANCE } } }));
    expect(out.get("endpoints.gen.ts")).not.toContain("v1/train");
  });

  // -- two schemas for one route ------------------------------------------

  const DOCS = properties({ prompt: { type: "string", maxLength: 800 } });
  const CONSOLE = properties({ prompt: { type: "string", maxLength: 2500 }, draft: { type: "boolean" } });
  const TWICE = route("maker/twice", { schema: CONSOLE, docs: DOCS });
  const PREFER_DRAFT = { kind: "prefer", route: "maker/twice", pointer: "/properties/draft", prefer: "console", ...PROVENANCE };
  const PREFER_LENGTH = { kind: "prefer", route: "maker/twice", pointer: "/properties/prompt/maxLength", prefer: "docs", ...PROVENANCE };

  test("a pointer the two sources differ at stops the run, naming the route, the pointer and both values", () => {
    expect(() => generate(input([TWICE]))).toThrow(/maker\/twice: the docs and console schemas differ at \/properties\/draft — docs: undefined, console: \{"type":"boolean"\}/);
    expect(() => generate(input([TWICE], { overlays: [PREFER_DRAFT] }))).toThrow(/differ at \/properties\/prompt\/maxLength — docs: 800, console: 2500/);
  });

  test("a `prefer` entry decides each pointer: the console's value is taken, the docs' is kept", () => {
    const out = generate(input([TWICE], { overlays: [PREFER_DRAFT, PREFER_LENGTH] }));
    const row = block(out.get("video-narrow.gen.ts"), "maker/twice");
    expect(row).toContain('draft: { t: "boolean" }');
    expect(row).toContain('prompt: { t: "string", maxLen: 800 }');
    const flipped = generate(
      input([TWICE], { overlays: [{ ...PREFER_DRAFT, prefer: "docs" }, { ...PREFER_LENGTH, prefer: "console" }] }),
    );
    expect(block(flipped.get("video-narrow.gen.ts"), "maker/twice")).not.toContain("draft");
    expect(block(flipped.get("video-narrow.gen.ts"), "maker/twice")).toContain("maxLen: 2500");
  });

  test("a console `prefer` at a pointer the published schema does not spell stops the run instead of dropping the field", () => {
    // `type: [T, "null"]` is compared as an `anyOf`, so the differing pointers
    // below exist in the compared form of one schema and in the text of neither.
    const nullableType = properties({ prompt: { type: "string" }, seed: { type: ["integer", "null"] } });
    const prefer = { kind: "prefer", route: "maker/twice", prefer: "console", ...PROVENANCE };
    const plain = route("maker/twice", { docs: nullableType, schema: properties({ prompt: { type: "string" }, seed: { type: "integer" } }) });
    const split = [
      { ...prefer, pointer: "/properties/seed/anyOf" },
      { ...prefer, pointer: "/properties/seed/type" },
    ];
    expect(() => generate(input([plain], { overlays: split }))).toThrow(
      /maker\/twice: the `prefer` entry at \/properties\/seed\/anyOf names a pointer the docs schema has only once it is normalised/,
    );
    const whole = generate(input([plain], { overlays: [{ ...prefer, pointer: "/properties/seed" }] }));
    expect(block(whole.get("video-narrow.gen.ts"), "maker/twice")).toContain('seed: { t: "integer" }');

    const spelled = properties({ prompt: { type: "string" }, seed: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] } });
    expect(() => generate(input([route("maker/twice", { docs: spelled, schema: nullableType })], { overlays: [split[0] as Json] }))).toThrow(
      /names a pointer the console schema has only once it is normalised/,
    );
  });

  test("an overlay that no longer applies stops the run", () => {
    const agreed = route("maker/twice", { schema: DOCS, docs: DOCS });
    expect(() => generate(input([agreed], { overlays: [PREFER_LENGTH] }))).toThrow(/no longer applies/);
    expect(() => generate(input([CLIP], { overlays: [PREFER_LENGTH] }))).toThrow(/not a generated route/);
  });

  test("a default is stated only where every source that declares the property agrees on it", () => {
    const docs = properties({ a: { type: "string", default: "x" }, b: { type: "boolean", default: false }, c: { type: "integer", default: 5 } });
    const consoleSchema = properties({ a: { type: "string", default: "x" }, b: { type: "boolean", default: true }, c: { type: "integer" } });
    const wire = generate(input([route("maker/defaults", { schema: consoleSchema, docs })])).get("video-wire.gen.ts") ?? "";
    expect(wire).toContain('  /** Default: `"x"`. */\n  a?: string;');
    expect(wire).toContain("  b?: boolean;");
    expect(wire).not.toContain("Default: `false`");
    expect(wire).not.toContain("Default: `5`");
  });

  test("a description comes through as JSDoc, punctuated, and usage notes head the interface without their Markdown escapes", () => {
    const schema = properties({ prompt: { type: "string", description: "Write your prompt here" } });
    const wire = generate(input([route("maker/doc", { schema, docs: schema, notes: ["batch\\_size is 1 or 4 only."] })])).get("video-wire.gen.ts") ?? "";
    expect(wire).toContain("  /** Write your prompt here. */\n  prompt?: string;");
    expect(wire).toContain(" * batch_size is 1 or 4 only.\n");
  });

  // -- strictness ---------------------------------------------------------

  test("`additionalProperties: false` is `closed`; absent and `true` are not", () => {
    const narrow =
      generate(
        input([
          route("maker/closed", { schema: { ...PROMPT_ONLY, additionalProperties: false } }),
          route("maker/open", { schema: { ...PROMPT_ONLY, additionalProperties: true } }),
          CLIP,
        ]),
      ).get("video-narrow.gen.ts") ?? "";
    expect(block(narrow, "maker/closed")).toContain("    closed: true,");
    expect(block(narrow, "maker/open")).not.toContain("closed");
    expect(block(narrow, "maker/clip")).not.toContain("closed");
  });

  // -- the lowering table -------------------------------------------------

  const EVERYTHING = properties(
    {
      aspect_ratio: { type: "string", enum: ["16:9", "1:1"] },
      cfg_scale: { type: "number", minimum: 0, maximum: 1, multipleOf: 0.01 },
      count: { type: "integer", exclusiveMinimum: 0, exclusiveMaximum: 9 },
      image_url: { type: ["string", "null"], format: "uri", minLength: 1, maxLength: 2083 },
      image_urls: { type: "array", items: { type: "string", format: "uri" }, minItems: 1, maxItems: 4 },
      mode: { const: "pro" },
      preset_id: { type: "string", format: "uuid" },
      prompt: { type: "string", pattern: "\\S" },
      shots: { type: "array", items: { type: "object", properties: { duration: { type: "integer" }, prompt: { type: "string" } }, required: ["prompt"] } },
      style: { anyOf: [{ $ref: "#/$defs/Style" }, { type: "null" }] },
      watermark: { type: "boolean", const: false },
    },
    {
      required: ["prompt"],
      $defs: {
        Style: {
          type: "object",
          additionalProperties: false,
          required: ["choices"],
          properties: {
            choices: {
              type: "object",
              additionalProperties: { type: "string", enum: ["a", "b"] },
              maxProperties: 3,
              properties: { special: { enum: ["a", "z"] } },
            },
            weights: { type: "object", additionalProperties: { type: "integer", minimum: 0 } },
          },
        },
      },
    },
  );
  const lowered = generate(input([route("maker/all", { schema: EVERYTHING })]));

  test("each keyword reaches the shape row", () => {
    const row = block(lowered.get("video-narrow.gen.ts"), "maker/all");
    expect(row).toMatch(/aspect_ratio: \{ t: "string", enum: E_[0-9a-f]{6} \}/);
    expect(row).toContain('cfg_scale: { t: "number", min: 0, max: 1, step: 0.01 }');
    expect(row).toContain('count: { t: "integer", xmin: 0, xmax: 9 }');
    expect(row).toContain('image_url: { t: "string", nul: true, minLen: 1, maxLen: 2083, fmt: "uri" }');
    expect(row).toContain('image_urls: { t: "array", minItems: 1, maxItems: 4, items: { t: "string", fmt: "uri" } }');
    expect(row).toMatch(/mode: \{ t: "string", enum: E_[0-9a-f]{6} \}/);
    expect(row).toContain('preset_id: { t: "string", fmt: "uuid" }');
    expect(row).toContain('prompt: { t: "string", req: true, pat: "\\\\S" }');
    expect(row).toContain('shots: { t: "array", items: { t: "object", props: { duration: { t: "integer" }, prompt: { t: "string", req: true } } } }');
    expect(row).toContain("watermark: { t: \"boolean\", const: false }");
    expect(row).toContain('order: ["aspect_ratio", "cfg_scale", "count", "image_url", "image_urls", "mode", "preset_id", "prompt", "shots", "style", "watermark"]');
  });

  test("a `$ref` is inlined, a closed nested object says so, and a map keeps the keys it types apart", () => {
    const row = block(lowered.get("video-narrow.gen.ts"), "maker/all");
    expect(row).toMatch(
      /style: \{ t: "object", nul: true, props: \{ choices: \{ t: "object", req: true, props: \{ special: \{ t: "string", enum: E_[0-9a-f]{6} \} \}, values: \{ t: "string", enum: E_[0-9a-f]{6} \}, maxProps: 3 \}, weights: \{ t: "object", values: \{ t: "integer", min: 0 \} \} \}, closed: true \}/,
    );
  });

  test("the wire interface types what the row carries, and a map's value type admits every named key's vocabulary", () => {
    const wire = lowered.get("video-wire.gen.ts") ?? "";
    expect(wire).toContain('  aspect_ratio?: "16:9" | "1:1";');
    expect(wire).toContain("  image_url?: string | null;");
    expect(wire).toContain('  mode?: "pro";');
    expect(wire).toContain("  shots?: ({ duration?: number; prompt: string })[];");
    expect(wire).toContain('  style?: { choices: Record<string, "a" | "b" | "z">; weights?: Record<string, number> } | null;');
    expect(wire).toContain("  watermark?: false;");
  });

  test("the widened map type says each named key's own vocabulary in its doc", () => {
    const wire = lowered.get("video-wire.gen.ts") ?? "";
    expect(prose(wire)).toContain(
      '`choices`: `special` takes "a", "z"; every other key takes "a", "b". The type admits every list on every key, and the check refuses a value outside the key\'s own list.',
    );
  });

  test("a `required` parameter with a default every source agrees on is optional: Higgsfield fills it before it validates", () => {
    const out = generate(input([route("maker/defaulted", { schema: properties({ prompt: { type: "string" }, duration: { type: "integer", default: 6 } }, { required: ["prompt", "duration"] }) })]));
    expect(block(out.get("video-narrow.gen.ts"), "maker/defaulted")).toContain('duration: { t: "integer" }');
    expect(out.get("video-wire.gen.ts")).toContain("  duration?: number;");
    expect(out.get("video-wire.gen.ts")).toContain("  prompt: string;");
  });

  test("the gate names every body key and types none of them, even where every route agrees on a type", () => {
    const nested = { type: "object", required: ["rgb"], properties: { rgb: { type: "array", items: { type: "integer" } } } };
    const a = route("maker/a", { schema: properties({ ratio: { type: "string", enum: ["1:1"] }, tier: { type: "string", enum: ["x"] }, elements: { type: "array", items: { type: "string" } }, seed: { type: "integer" }, color: nested, urls: { type: "array", items: { type: "string" } } }) });
    const b = route("maker/b", { schema: properties({ ratio: { type: "string", enum: ["1:1"] }, tier: { type: "string", enum: ["y"] }, elements: { type: "integer" }, seed: { type: ["integer", "null"], maximum: 9 }, color: nested, urls: { type: "array", items: { type: "string" } } }) });
    const gate = generate(input([a, b])).get("input-schema.gen.ts") ?? "";
    // A shared type stays out: the gate also runs for a route that does not
    // declare the key and for an id newer than the snapshot, and a finding
    // from it cannot be downgraded per call.
    for (const name of ["color", "elements", "ratio", "seed", "tier", "urls"]) {
      expect(gate).toContain(`  ${name}: z.unknown().optional(),`);
    }
    expect(gate).toContain("  endpoint: z.string(),");
    expect(gate).toContain("  hf_webhook: z.string().optional(),");
    const body = gate.slice(gate.indexOf("export const"));
    expect(body.match(/z\.string\(\)/g)).toHaveLength(2);
    expect(body).not.toMatch(/z\.(enum|number|boolean|array)\(/);
  });

  // -- conditionals -------------------------------------------------------

  const REFS = { image_urls: { type: "array", items: { type: "string" } }, video_urls: { type: "array", items: { type: "string" } }, audio_urls: { type: "array", items: { type: "string" } }, image_url: { type: "string", format: "uri" } };

  function rules(conditional: Json, props: Json = REFS): string {
    const out = generate(input([route("maker/rule", { schema: properties(props, conditional) })]));
    return block(out.get("video-narrow.gen.ts"), "maker/rule");
  }

  test("P1: a chain of `if required … else required` is one atLeastOne, `nonEmpty` only where the schema says minItems", () => {
    expect(
      rules({
        if: { required: ["image_urls"], properties: { image_urls: { minItems: 1, type: "array" } } },
        else: { if: { required: ["video_urls"] }, else: { required: ["audio_urls"], properties: { audio_urls: { minItems: 1 } } } },
      }),
    ).toContain('{ kind: "atLeastOne", params: [{ name: "image_urls", nonEmpty: true }, { name: "video_urls" }, { name: "audio_urls", nonEmpty: true }] }');
  });

  test("P2: a top-level `anyOf` of `required` arms", () => {
    expect(rules({ anyOf: [{ required: ["image_url"] }, { required: ["video_urls"], properties: { video_urls: { minItems: 1 } } }] })).toContain(
      '{ kind: "atLeastOne", params: [{ name: "image_url" }, { name: "video_urls", nonEmpty: true }] }',
    );
  });

  test("P3: `not` over absent-or-empty properties", () => {
    expect(rules({ not: { properties: { image_url: false, image_urls: { maxItems: 0 }, video_urls: { maxItems: 0 } } } })).toContain(
      '{ kind: "atLeastOne", params: [{ name: "image_url" }, { name: "image_urls", nonEmpty: true }, { name: "video_urls", nonEmpty: true }] }',
    );
  });

  test("P4: `if all empty then required non-empty`", () => {
    expect(
      rules({
        if: { properties: { image_urls: { maxItems: 0 }, video_urls: { maxItems: 0 } } },
        then: { required: ["audio_urls"], properties: { audio_urls: { minItems: 1 } } },
      }),
    ).toContain('{ kind: "atLeastOne", params: [{ name: "image_urls", nonEmpty: true }, { name: "video_urls", nonEmpty: true }, { name: "audio_urls", nonEmpty: true }] }');
  });

  const TIERED = {
    tier: { type: "string", enum: ["normal", "freak", "insects"], default: "normal" },
    quality: { type: "string", enum: ["low", "high"] },
    enhance: { type: "boolean", default: false },
    species: { type: ["string", "null"] },
    preset_id: { type: "string" },
    prompt: { type: "string" },
    shots: { type: "array", items: { type: "string" } },
    nested: { type: "object", properties: { inner: { type: ["string", "null"] } } },
  };

  test("P5: an `if` that requires its parameter applies `else` to a request that omits it", () => {
    expect(
      rules(
        {
          allOf: [
            {
              if: { properties: { enhance: { const: true } }, required: ["enhance"] },
              then: { required: ["preset_id"], properties: { quality: { const: "high" }, shots: { minItems: 1, maxItems: 2 } } },
            },
          ],
        },
        TIERED,
      ),
    ).toContain(
      '{ kind: "when", if: [{ name: "enhance", in: [true] }], absent: "else", then: { required: ["preset_id"], props: { quality: { in: ["high"] }, shots: { minItems: 1, maxItems: 2 } } } }',
    );
  });

  test("P5: with no `required`, an agreed default that satisfies the `if` applies `then`", () => {
    expect(
      rules({ allOf: [{ if: { properties: { tier: { enum: ["normal", "freak"] } } }, then: { properties: { species: { type: "null" }, nested: { properties: { inner: { type: "null" } } } } } }] }, TIERED),
    ).toContain(
      '{ kind: "when", if: [{ name: "tier", in: ["normal", "freak"] }], absent: "then", then: { props: { species: { null: true }, nested: { props: { inner: { null: true } } } } } }',
    );
  });

  test("P5: `not` is the complement over the parameter's own closed enum", () => {
    expect(rules({ allOf: [{ if: { properties: { tier: { not: { const: "insects" } } } }, then: { properties: { species: { type: "null" } } } }] }, TIERED)).toContain(
      '{ kind: "when", if: [{ name: "tier", in: ["normal", "freak"] }], absent: "then", then: { props: { species: { null: true } } } }',
    );
    expect(() => rules({ allOf: [{ if: { properties: { prompt: { not: { const: "x" } } } }, then: { required: ["preset_id"] } }] }, TIERED)).toThrow(
      /complement of a `const` \/ `enum` over prompt's own closed enum/,
    );
  });

  test("P5: a default that selects `else` is `either`, and what both branches require is hoisted to the route", () => {
    const row = rules(
      { if: { properties: { enhance: { const: true } } }, then: { required: ["shots", "prompt"] }, else: { required: ["preset_id", "prompt"] } },
      TIERED,
    );
    expect(row).toContain('{ kind: "when", if: [{ name: "enhance", in: [true] }], absent: "either", then: { required: ["shots"] }, else: { required: ["preset_id"] } }');
    expect(row).toContain('prompt: { t: "string", req: true }');
  });

  test("P5: sources that disagree on the default cannot settle the branch, so it is `either`", () => {
    const docs = properties({ ...TIERED, enhance: { type: "boolean", default: true } }, { if: { properties: { enhance: { const: true } } }, then: { required: ["preset_id"] } });
    const consoleSchema = properties(TIERED, { if: { properties: { enhance: { const: true } } }, then: { required: ["preset_id"] } });
    const out = generate(input([route("maker/rule", { schema: consoleSchema, docs })]));
    expect(block(out.get("video-narrow.gen.ts"), "maker/rule")).toContain('absent: "either"');
  });

  test("a conditional outside the patterns stops the run", () => {
    expect(() => rules({ if: { properties: { enhance: { const: true }, tier: { const: "normal" } } }, then: { required: ["prompt"] } }, TIERED)).toThrow(
      /one property's `const` \/ `enum`/,
    );
    expect(() => rules({ allOf: [{ required: ["prompt"] }] }, TIERED)).toThrow(/none of the modelled patterns/);
    expect(() => rules({ anyOf: [{ required: ["prompt"] }, { properties: { tier: { const: "x" } } }] }, TIERED)).toThrow(/list of `required` arms/);
    expect(() => rules({ not: { required: ["prompt"] } }, TIERED)).toThrow(/`false` or `\{ maxItems: 0 \}`/);
    expect(() => rules({ if: { properties: { enhance: { const: true } } }, then: { properties: { quality: { minLength: 2 } } } }, TIERED)).toThrow(
      /not a constraint a conditional's branch is modelled to carry/,
    );
    expect(() => rules({ anyOf: [{ required: ["ghost"] }, { required: ["prompt"] }] }, TIERED)).toThrow(/names ghost, which the route does not declare/);
  });

  // -- overlays that are not `prefer` --------------------------------------

  const SEEDED = route("maker/seeded", {
    schema: properties({
      seed: { type: "integer" },
      strength: { type: "number", minimum: 0, maximum: 1 },
      prompt: { type: "string", maxLength: 2500 },
      image_urls: { type: "array", items: { type: "string" } },
      duration: { type: "integer", mode: { type: "string" } },
    }),
  });
  const SEEDED_OVERLAYS = [
    { kind: "ignoreKeyword", route: "maker/seeded", pointer: "/properties/duration/mode", ...PROVENANCE },
    { kind: "nullable", route: "maker/seeded", param: "seed", warn: true, ...PROVENANCE },
    { kind: "softBound", route: "maker/seeded", param: "strength", keyword: "exclusiveMinimum", value: 0, ...PROVENANCE },
    { kind: "softBound", route: "maker/seeded", param: "prompt", keyword: "maxLength", value: 800, ...PROVENANCE },
    { kind: "tokens", route: "maker/seeded", prompt: "prompt", arrays: { image: "image_urls" }, ...PROVENANCE },
  ];

  test("nullable, softBound, ignoreKeyword and tokens each reach the row", () => {
    const out = generate(input([SEEDED], { overlays: SEEDED_OVERLAYS }));
    const row = block(out.get("video-narrow.gen.ts"), "maker/seeded");
    expect(row).toContain('seed: { t: "integer", nul: true, nulWarn: true }');
    expect(row).toContain('strength: { t: "number", min: 0, max: 1, softXmin: 0 }');
    expect(row).toContain('prompt: { t: "string", maxLen: 2500, softMaxLen: 800 }');
    expect(row).toContain('duration: { t: "integer" }');
    expect(row).toContain('{ kind: "tokens", prompt: "prompt", arrays: { image: "image_urls" } }');
    expect(out.get("video-wire.gen.ts")).toContain("  seed?: number | null;");
  });

  test("a keyword nobody filed stops the run; so does each overlay once it says nothing", () => {
    expect(() => generate(input([SEEDED], { overlays: SEEDED_OVERLAYS.slice(1) }))).toThrow(/the schema keyword `mode` is not modelled/);
    const without = (index: number, replacement: Json): Json[] => SEEDED_OVERLAYS.map((overlay, at) => (at === index ? replacement : overlay));
    expect(() => generate(input([SEEDED], { overlays: without(1, { ...SEEDED_OVERLAYS[1], param: "ghost" }) }))).toThrow(/no longer applies/);
    expect(() => generate(input([SEEDED], { overlays: without(2, { ...SEEDED_OVERLAYS[2], keyword: "minimum" }) }))).toThrow(/no longer applies/);
    expect(() => generate(input([SEEDED], { overlays: without(3, { ...SEEDED_OVERLAYS[3], value: 2500 }) }))).toThrow(/no longer applies/);
    expect(() => generate(input([SEEDED], { overlays: without(4, { ...SEEDED_OVERLAYS[4], arrays: { image: "prompt" } }) }))).toThrow(/no longer applies/);
    const alreadyNullable = route("maker/seeded", { schema: properties({ seed: { type: ["integer", "null"] } }) });
    expect(() => generate(input([alreadyNullable], { overlays: [SEEDED_OVERLAYS[1] as Json] }))).toThrow(/no longer applies/);
  });

  // -- refusals -----------------------------------------------------------

  function refuses(schema: Json, options: RouteOptions = {}): () => unknown {
    return () => generate(input([route("maker/odd", { ...options, schema })]));
  }

  test("refuses every schema construct it does not model, naming the route and the pointer", () => {
    expect(refuses(properties({ p: { type: "string", contentEncoding: "base64" } }))).toThrow(/maker\/odd: the schema keyword `contentEncoding` is not modelled.*\(at \/properties\/p\/contentEncoding\)/);
    expect(refuses(properties({ p: { type: "string", format: "date-time" } }))).toThrow(/the format "date-time" is not modelled/);
    expect(refuses(properties({ p: { type: "string", pattern: "(?P<name>x)" } }))).toThrow(/does not compile as a JavaScript regular expression/);
    expect(refuses(properties({ p: { type: "tuple" } }))).toThrow(/the type "tuple" is not modelled/);
    expect(refuses(properties({ p: { anyOf: [{ type: "string" }, { type: "integer" }] } }))).toThrow(/`anyOf` is modelled only as `\[T, null\]`/);
    expect(refuses(properties({ p: { type: ["string", "integer"] } }))).toThrow(/is not `\[T, "null"\]`/);
    expect(refuses(properties({ p: { type: "string", enum: ["a", 1] } }))).toThrow(/has a member of another type/);
    expect(refuses(properties({ p: { $ref: "#/$defs/Loop" } }, { $defs: { Loop: { type: "array", items: { $ref: "#/$defs/Loop" } } } }))).toThrow(/is recursive/);
    expect(refuses(properties({ p: { $ref: "#/components/X" } }))).toThrow(/does not resolve/);
    expect(refuses({ type: "object", properties: {}, required: ["ghost"] })).toThrow(/`required` names ghost/);
    expect(refuses({ type: "object", properties: {}, dependentRequired: {} })).toThrow(/`dependentRequired` is not modelled/);
    expect(refuses({ type: "array" })).toThrow(/not an object/);
  });

  test("refuses a route that declares one of unmodel's own URL parameters", () => {
    expect(refuses(properties({ endpoint: { type: "string" } }))).toThrow(/declares `endpoint`/);
    expect(refuses(properties({ hf_webhook: { type: "string" } }))).toThrow(/declares `hf_webhook`/);
  });

  test("refuses a media-looking parameter nobody filed", () => {
    expect(refuses(properties({ mask_url: { type: "string" } }))).toThrow(/`mask_url` looks like a media parameter/);
    expect(refuses(properties({ source: { type: "string", format: "uri" } }))).toThrow(/`source` looks like a media parameter/);
  });

  test("refuses an output or operation type it does not model", () => {
    expect(() => generate(input([route("maker/odd", { output: "audio" })]))).toThrow(/the output type "audio" is not modelled/);
    expect(() => generate(input([route("maker/odd", { category: "text2audio" })]))).toThrow(/the operation type text2audio is not modelled/);
  });

  test("refuses a route no source publishes a schema for, two routes with one type name, and stale curation", () => {
    expect(() => generate(input([{ ...route("maker/bare"), console: null }]))).toThrow(/no documented source publishes an input schema/);
    expect(() => generate(input([route("maker/a-b"), route("maker/a/b")]))).toThrow(/both render the type name MakerABInput/);
    expect(() => generate(input([CLIP], { curation: { excluded: { routes: { gone: PROVENANCE } } } }))).toThrow(/no longer lists/);
    expect(() => generate(input([CLIP], { curation: { handWritten: { gone: PROVENANCE } } }))).toThrow(/no longer lists/);
    expect(() => generate({ ...input([CLIP]), routes: { "maker/other": CLIP } })).toThrow(/filed under maker\/other is for maker\/clip/);
  });

  test("media parameters set the row's modalities and `attachment`; a route with no prompt takes no text", () => {
    const media = route("maker/media", { schema: properties({ video_url: { type: "string", format: "uri" }, audio_urls: { type: "array", items: { type: "string", format: "uri" } }, file_url: { type: "string", format: "uri" } }) });
    const row = block(generate(input([media, CLIP])).get("models-video.gen.ts"), "maker/media");
    expect(row).toContain('modalities: { input: ["video", "audio"], output: ["video"] }');
    expect(row).toContain("attachment: true");
    expect(block(generate(input([media, CLIP])).get("models-video.gen.ts"), "maker/clip")).toContain('modalities: { input: ["text"], output: ["video"] }');
  });
});

// ---------------------------------------------------------------------------
// The unified rows, on fixtures
// ---------------------------------------------------------------------------

describe("codegen-higgsfield unified rows", () => {
  const URI = { type: "string", format: "uri" };
  const URIS = { type: "array", items: URI };
  const PROMPT = { type: "string" };

  /** One route's row in a pack's params file, as the block of text it is emitted as. */
  function rowOf(out: Map<string, string>, pack: string, id: string): string {
    const text = out.get(`${pack}-params.gen.ts`) ?? "";
    const name = new RegExp(`^  ${JSON.stringify(id).replace(/[/.]/g, "\\$&")}: (ROW_[0-9a-f]{6}),$`, "m").exec(text)?.[1];
    if (name === undefined) return "";
    const start = text.indexOf(`const ${name} = {`);
    return inlined(text, text.slice(start, text.indexOf("\n} as const;", start)));
  }
  function still(id: string, props: Json, extra: Json = {}, category = "text2image"): Json {
    return route(id, { output: "image", category, schema: properties({ prompt: PROMPT, ...props }, extra) });
  }
  function clip(id: string, props: Json, extra: Json = {}): Json {
    return route(id, { schema: properties(props, extra) });
  }
  const image = (...routes: Json[]): Map<string, string> => generate(input([...routes, CLIP]));
  const video = (...routes: Json[]): Map<string, string> => generate(input([...routes, STILL]));

  test("the packs' vocabularies are the kernel's own key lists", () => {
    expect([...PACK_VOCABULARY.image].sort()).toEqual([...CANONICAL_KEY_LISTS.image].sort());
    expect([...PACK_VOCABULARY["image-edit"]].sort()).toEqual([...CANONICAL_KEY_LISTS.imageEdit].sort());
    expect([...PACK_VOCABULARY.video].sort()).toEqual([...CANONICAL_KEY_LISTS.video].sort());
  });

  test("a row file names its row type, its one wire file, and exports the table and the id list", () => {
    const text = image(still("maker/styled", { style: { type: "string" } })).get("image-params.gen.ts") ?? "";
    expect(text).toContain('import type { HiggsfieldImageParamRow } from "../param-types";');
    expect(text).toContain('import type {\n  MakerStyledInput,\n} from "./image-wire.gen";');
    expect(text).toContain("} as const satisfies Record<string, HiggsfieldImageParamRow>;");
    expect(text).toContain('export const HIGGSFIELD_IMAGE_UNIFIED_MODELS = [\n  "maker/styled",\n] as const;');
    expect(text).toContain('style: EXTRA as MakerStyledInput["style"],');
  });

  test("`keys` are the parameters a canonical word writes, in the route's order; the rest are extras", () => {
    const row = rowOf(image(still("maker/a", { seed: { type: "integer", minimum: 1, maximum: 9 }, negative_prompt: PROMPT, style: PROMPT })), "image", "maker/a");
    expect(row).toContain('keys: ["negative_prompt", "prompt", "seed"],');
    expect(row).toContain("bounds: { seed: { min: 1, max: 9 } },");
    expect(row).toContain('style: EXTRA as MakerAInput["style"],');
    expect(row).not.toContain("negative_prompt: EXTRA");
  });

  test("shapes: `auto` and `adaptive` name no geometry and are dropped; any other member must be a ratio", () => {
    const shaped = (members: string[]): Json => still("maker/shaped", { aspect_ratio: { type: "string", enum: members } });
    expect(rowOf(image(shaped(["auto", "16:9", "adaptive", "2.35:1"])), "image", "maker/shaped")).toContain('ratios: ["16:9", "2.35:1"],');
    expect(() => image(shaped(["16:9", "widescreen"]))).toThrow(/maker\/shaped: `aspect_ratio` enum member "widescreen" reached neither/);
    expect(() => image(still("maker/free", { aspect_ratio: { type: "string" } }))).toThrow(/maker\/free: `aspect_ratio` is not a closed vocabulary/);
    // No `aspect_ratio` at all is an empty list, which types the word `never`.
    expect(rowOf(image(still("maker/plain", {})), "image", "maker/plain")).toContain("ratios: [],");
  });

  test("image tiers: `<n>k` maps in the route's spelling; a pixel class or an odd scale is not a tier", () => {
    const sized = (members: string[]): string =>
      rowOf(image(still("maker/sized", { resolution: { type: "string", enum: members } })), "image", "maker/sized");
    expect(sized(["1K", "1.5k", "2k", "8k"])).toContain('tiers: ["1k", "2k"],\n  tierWire: { "1k": "1K", "2k": "2k" },');
    // Soul's shape: the route HAS a `resolution`, written by nothing canonical.
    const soul = sized(["720p", "1080p"]);
    expect(soul).toContain("tiers: [],");
    expect(soul).not.toContain("tierWire");
    expect(soul).toContain('keys: ["prompt", "resolution"],');
    expect(soul).not.toContain("resolution: EXTRA");
  });

  test("a count is `batch_size` or `series_amount`: its list, its range, and whether it is required", () => {
    const listed = rowOf(image(still("maker/n", { batch_size: { type: "integer", enum: [4, 1] } })), "image", "maker/n");
    expect(listed).toContain('countWire: "batch_size",\n  counts: [1, 4],');
    const series = rowOf(
      image(still("maker/n", { series_amount: { type: "integer", minimum: 2, maximum: 10 } }, { required: ["prompt", "series_amount"] })),
      "image",
      "maker/n",
    );
    expect(series).toContain('countWire: "series_amount",\n  countRequired: true,');
    expect(series).toContain("bounds: { n: { min: 2, max: 10 } },");
    expect(() => image(still("maker/n", { batch_size: { type: "integer" }, series_amount: { type: "integer" } }))).toThrow(
      /maker\/n: declares `batch_size` and `series_amount`, two spellings of the image count/,
    );
  });

  test("a picture `output_format` maps onto the canonical encodings; any other member stops the run", () => {
    const formatted = (members: string[]): Json => still("maker/f", { output_format: { type: "string", enum: members } });
    expect(rowOf(image(formatted(["jpg", "png", "webp"])), "image", "maker/f")).toContain('formatWire: { jpeg: "jpg", png: "png", webp: "webp" },');
    expect(() => image(formatted(["png", "tiff"]))).toThrow(/maker\/f: `output_format` member "tiff" is not a picture format/);
  });

  test("`unmodel/image` addresses a route with a prompt and no required source picture, and says why not otherwise", () => {
    const out = image(
      still("maker/optional", { image_urls: URIS }),
      still("maker/needs", { image_urls: URIS }, { required: ["prompt", "image_urls"] }),
      route("maker/sheet", { output: "image", schema: properties({ seed: { type: "integer" } }) }),
    );
    const text = prose(out.get("image-params.gen.ts"));
    expect(out.get("image-params.gen.ts")).toContain('HIGGSFIELD_IMAGE_UNIFIED_MODELS = [\n  "maker/optional",\n] as const;');
    expect(text).toContain("- `maker/needs`: it requires a source picture (`image_urls`), which `unmodel/image` has no word for;");
    expect(text).toContain("- `maker/sheet`: it declares no `prompt`, the one word every `unmodel/image` request has.");
    // The optional picture is that route's extra.
    expect(rowOf(out, "image", "maker/optional")).toContain('image_urls: EXTRA as MakerOptionalInput["image_urls"],');
  });

  test("`unmodel/image-edit` is the view: where the picture lands, and `resolution` as an extra", () => {
    const out = image(
      still("maker/one", { image_url: URI, resolution: { type: "string", enum: ["720p"] }, negative_prompt: PROMPT }, {}, "image_edit"),
      still("maker/many", { image_urls: URIS }, {}, "image_edit, text2image"),
    );
    const one = rowOf(out, "image-edit", "maker/one");
    expect(one).toContain('keys: ["image_url", "prompt"],');
    expect(one).toContain('imageWire: "image_url",');
    expect(one).toContain('resolution: EXTRA as MakerOneInput["resolution"],');
    expect(one).toContain('negative_prompt: EXTRA as MakerOneInput["negative_prompt"],');
    expect(one).not.toContain("tiers");
    expect(rowOf(out, "image-edit", "maker/many")).toContain('imageWire: "image_urls",');
    expect(out.get("image-edit-params.gen.ts")).toContain('HIGGSFIELD_IMAGE_EDIT_UNIFIED_MODELS = [\n  "maker/many",\n  "maker/one",\n] as const;');
    expect(out.get("image-edit-params.gen.ts")).not.toContain("Not addressed here");
    expect(() => image(still("maker/none", {}, {}, "image_edit"))).toThrow(/maker\/none: is in the picture-editing view and declares neither/);
    expect(() => image(still("maker/two", { image_url: URI, image_urls: URIS }, {}, "image_edit"))).toThrow(
      /maker\/two: declares `image_url` and `image_urls`, two spellings of the picture to edit/,
    );
  });

  test("video lengths: a list, a range, or no parameter at all", () => {
    const timed = (duration: Json | undefined): string =>
      rowOf(video(clip("maker/t", { prompt: PROMPT, ...(duration !== undefined && { duration }) })), "video", "maker/t");
    expect(timed({ type: "integer", enum: [10, 5] })).toContain("durations: [5, 10],");
    const ranged = timed({ type: "integer", minimum: 4, maximum: 30 });
    expect(ranged).not.toContain("durations");
    expect(ranged).toContain("bounds: { duration: { min: 4, max: 30 } },");
    expect(timed(undefined)).toContain("durations: [],");
  });

  test("video tiers: exact spellings, in the route's capitals; `768P` and `2K` are not tiers", () => {
    const sized = (members: string[] | undefined): string =>
      rowOf(video(clip("maker/s", { prompt: PROMPT, ...(members !== undefined && { resolution: { type: "string", enum: members } }) })), "video", "maker/s");
    expect(sized(["480P", "768P", "4K"])).toContain('resolutions: ["480p", "4k"],\n  resolutionWire: { "480p": "480P", "4k": "4K" },');
    const none = sized(["2K"]);
    expect(none).toContain("resolutions: [],");
    expect(none).not.toContain("resolutionWire");
    expect(none).toContain('keys: ["prompt", "resolution"],');
    expect(sized(undefined)).toContain('keys: ["prompt"],');
  });

  test("picture roles are read off the route's own spellings; two spellings of one role stop the run", () => {
    const framed = rowOf(
      video(clip("maker/r", { prompt: PROMPT, first_frame_url: URI, last_image_url: URI, image_urls: URIS })),
      "video",
      "maker/r",
    );
    expect(framed).toContain('roles: ["first", "last", "reference"],');
    expect(framed).toContain('roleWire: { first: "first_frame_url", last: "last_image_url", reference: "image_urls" },');
    expect(rowOf(video(clip("maker/r", { prompt: PROMPT })), "video", "maker/r")).toContain("roles: [],");
    expect(() => video(clip("maker/r", { end_image_url: URI, last_frame_url: URI }))).toThrow(
      /maker\/r: declares `end_image_url` and `last_frame_url`, two spellings of the `last` picture/,
    );
  });

  test("the clip is `video_url` where the route has one, and the list is then its extra", () => {
    const both = rowOf(video(clip("maker/v", { prompt: PROMPT, video_url: URI, video_urls: URIS })), "video", "maker/v");
    expect(both).toContain('videoWire: "video_url",');
    expect(both).toContain('video_urls: EXTRA as MakerVInput["video_urls"],');
    const list = rowOf(video(clip("maker/v", { prompt: PROMPT, video_urls: URIS })), "video", "maker/v");
    expect(list).toContain('videoWire: "video_urls",');
    expect(list).toContain("extras: {},");
  });

  test("`unmodel/video` leaves out a route with no canonical word, and stops on a count", () => {
    const out = video(clip("maker/final", { draft_id: { type: "string", format: "uuid" } }), CLIP);
    expect(out.get("video-params.gen.ts")).toContain('HIGGSFIELD_VIDEO_UNIFIED_MODELS = [\n  "maker/clip",\n] as const;');
    expect(prose(out.get("video-params.gen.ts"))).toContain("- `maker/final`: it declares no `prompt`, no picture and no clip, so no canonical word says what to make.");
    expect(() => video(clip("maker/many", { prompt: PROMPT, batch_size: { type: "integer" } }))).toThrow(
      /maker\/many: a video route declares `batch_size`/,
    );
  });

  test("routes share a row only when their extras have the same TYPES", () => {
    const moded = (id: string, members: string[]): Json => clip(id, { prompt: PROMPT, mode: { type: "string", enum: members } });
    const same = video(moded("maker/a", ["std", "pro"]), moded("maker/b", ["std", "pro"]));
    expect(prose(same.get("video-params.gen.ts"))).toContain("Shared by 2 routes with an identical surface: maker/a, maker/b.");
    const different = video(moded("maker/a", ["std", "pro"]), moded("maker/b", ["std", "4k"]));
    expect(rowOf(different, "video", "maker/a")).toContain('mode: EXTRA as MakerAInput["mode"],');
    expect(rowOf(different, "video", "maker/b")).toContain('mode: EXTRA as MakerBInput["mode"],');
  });

  test("an extra that is spelled like a canonical word stops the run", () => {
    expect(() => image(still("maker/dial", { image_url: URI, strength: { type: "number" } }, {}, "image_edit"))).toThrow(
      /maker\/dial: declares `strength`, which is also a canonical word of unmodel\/image-edit/,
    );
    expect(() => video(clip("maker/dial", { prompt: PROMPT, model: { type: "string" } }))).toThrow(
      /maker\/dial: declares `model`, which is also a canonical word of unmodel\/video/,
    );
  });
});

// ---------------------------------------------------------------------------
// Pricing rows, on fixtures
// ---------------------------------------------------------------------------

describe("codegen-higgsfield pricing rows", () => {
  const SENTENCE = "Images cost $0.0938 each at 720p and $0.1875 each at 1080p.";
  const SIZED = properties({
    prompt: { type: "string" },
    resolution: { type: "string", enum: ["720p", "1080p"], default: "720p" },
    batch_size: { type: "integer", enum: [1, 4], description: "Charged per image." },
    hdr: { type: "boolean" },
    duration: { type: "integer" },
    video_urls: { type: "array", items: { type: "string", format: "uri" } },
    video_url: { type: "string", format: "uri" },
  });
  const PAGE_URL = "https://open.higgsfield.ai/models/maker/sized/api-reference";
  const CONSOLE_URL = "https://dash.higgsfield.ai/models/maker/sized/llms.txt";
  const BASE = { source: PAGE_URL, verified: "2026-11-24", quote: SENTENCE };
  const TABLE = { ...BASE, unit: "per_image", by: "resolution", usd: { "720p": 0.0938, "1080p": 0.1875 } };

  function priced(row: Json, options: RouteOptions = {}): Map<string, string> {
    // The fixture route's console document says no price is public unless `options.pricing` states one, and a
    // rate there needs the owner's ruling. Rows get one here unless a test states `decided` itself.
    if (options.pricing === undefined && !("unpriced" in row) && !("decided" in row)) row = { ...row, decided: "2026-11-24" };
    const output = options.output ?? "image";
    // A count is a picture route's parameter: a video route that declared one would stop the run.
    const { batch_size: _count, ...withoutCount } = SIZED["properties"] as Json;
    const schema = output === "video" ? properties(withoutCount) : SIZED;
    return generate(input([route("maker/sized", { schema, output, sentence: SENTENCE, ...options })], { pricing: { "maker/sized": row } }));
  }
  const models = (out: Map<string, string>): string => block(out.get("models-image.gen.ts") ?? out.get("models-video.gen.ts"), "maker/sized");
  const rate = (out: Map<string, string>): string => (out.get("pricing.gen.ts") ?? "").split("\n").find((line) => line.startsWith('  "maker/sized": ')) ?? "";

  test("a rate keyed by a field is published as a table and kept off `cost`", () => {
    const out = priced(TABLE);
    expect(rate(out)).toBe(
      `  "maker/sized": { unit: "per_image", usd: { "720p": 0.0938, "1080p": 0.1875 }, by: "resolution", defaults: { resolution: "720p" }, contradicted: true, source: "${PAGE_URL}", verified: "2026-11-24" },`,
    );
    expect(models(out)).not.toContain("cost:");
    expect(prose(out.get("models-image.gen.ts"))).toContain("Not on `cost`: no single figure is right for every request this route takes.");
  });

  test("a rate carries the default of each parameter it reads, where every source agrees on one, and no other", () => {
    // `resolution` has a default in the one source that publishes the route; `duration` and `hdr` have none.
    const out = priced({ ...BASE, unit: "per_second", by: "resolution", usd: { "720p": 0.0938, "1080p": 0.1875 }, seconds: "request", undefinedWhen: [{ param: "hdr", in: [true], changes: "rate", reason: "A surcharge." }] }, { output: "video" });
    expect(rate(out)).toContain('defaults: { resolution: "720p" }');
    // `batch_size` is not read by this rate, so its default is not carried either.
    expect(rate(priced({ ...BASE, quote: "Images cost $0.03 each.", unit: "per_image", usd: 0.03 }, { sentence: "Images cost $0.03 each." }))).not.toContain("defaults:");
  });

  test("`catalog` puts the default's figure on `cost`, and only the default every source agrees on", () => {
    const out = priced({ ...TABLE, catalog: "720p", multipliedBy: "batch_size" });
    expect(models(out)).toContain("cost: { perImage: 0.0938 }");
    expect(prose(out.get("models-image.gen.ts"))).toContain("`cost` carries the 720p figure, the default `resolution`");
    expect(rate(out)).toContain('multipliedBy: "batch_size"');
    expect(() => priced({ ...TABLE, catalog: "1080p" })).toThrow(/the default every source agrees on for resolution is "720p"/);
    expect(() => priced({ ...TABLE, catalog: "4k" })).toThrow(/names a key of a `by`-keyed table/);
  });

  test("a rate on a route whose console document says no price is public needs the owner's ruling, and carries the caveat", () => {
    expect(() => priced({ ...TABLE, decided: undefined })).toThrow(/Contradicting pages are not catalogued: file the row as `unpriced`/);
    expect(() => priced({ ...TABLE, decided: "2026-11-24" }, { pricing: SENTENCE })).toThrow(/this route's console document does not contradict it/);
    const flat = "Images cost $0.03 each.";
    for (const out of [priced(TABLE), priced({ ...BASE, quote: flat, unit: "per_image", usd: 0.03 }, { sentence: flat })]) {
      expect(rate(out)).toContain("contradicted: true");
      expect(prose(out.get("models-image.gen.ts"))).toContain(`CAVEAT: the same route's console document says “${CONSOLE_NO_PRICING}” (${CONSOLE_URL}).`);
      expect(out.get("pricing.gen.ts")).toContain(`export const HIGGSFIELD_NO_PUBLIC_PRICING = ${JSON.stringify(CONSOLE_NO_PRICING)};`);
    }
    const stated = priced(TABLE, { pricing: SENTENCE });
    expect(rate(stated)).not.toContain("contradicted");
    expect(prose(stated.get("models-image.gen.ts"))).not.toContain("CAVEAT");
    // The mark is read off the snapshot: a row cannot claim it, so none can omit it.
    expect(() => priced({ ...TABLE, contradiction: { quote: CONSOLE_NO_PRICING, source: CONSOLE_URL } })).toThrow(/Unrecognized key/);
    const unpriced = priced({ source: PAGE_URL, verified: "2026-11-24", quote: SENTENCE, unpriced: "A sample point." });
    expect(rate(unpriced)).not.toContain("contradicted");
  });

  test("a flat per-image rate reaches `cost`; a per-second one only when it bills the request's own duration", () => {
    const flat = "Images cost $0.03 each.";
    expect(models(priced({ ...BASE, quote: flat, unit: "per_image", usd: 0.03 }, { sentence: flat }))).toContain("cost: { perImage: 0.03 }");
    const second = "USD 0.08/sec.";
    const video = { output: "video", pricing: second, sentence: null };
    expect(models(priced({ ...BASE, quote: second, unit: "per_second", usd: 0.08, seconds: "request" }, video))).toContain("cost: { perVideoSecond: 0.08 }");
    const source = priced({ ...BASE, quote: second, unit: "per_second", usd: 0.08, seconds: "source", sourceParam: "video_url", rounding: "up" }, video);
    expect(models(source)).not.toContain("cost:");
    expect(rate(source)).toContain('seconds: "source", sourceParam: "video_url", rounding: "up"');
  });

  test("a cap on the source clip is one a source states in seconds, in the quote or in a second anchored sentence", () => {
    const capped = "720p: $0.0945. Billed on the source video, capped at 15 seconds.";
    const video = { output: "video", pricing: capped, sentence: null, description: "Videos longer than 30 seconds are trimmed." };
    const row = { ...BASE, quote: capped, unit: "per_second", usd: 0.0945, seconds: "source", sourceParam: "video_url", rounding: "nearest" };
    expect(rate(priced({ ...row, maxSeconds: 15 }, video))).toContain('rounding: "nearest", maxSeconds: 15');
    expect(rate(priced({ ...row, maxSeconds: 30, maxSecondsQuote: "Videos longer than 30 seconds are trimmed." }, video))).toContain("maxSeconds: 30");
    expect(() => priced({ ...row, maxSeconds: 20 }, video)).toThrow(/a cap on a source clip that the quote, or `maxSecondsQuote`, states in seconds/);
    expect(() => priced({ ...row, maxSeconds: 30, maxSecondsQuote: "Trimmed to 30 seconds." }, video)).toThrow(/`maxSecondsQuote` is not in the route's committed snapshot/);
  });

  test("an arm that changes the RATE keeps it off `cost`; one that changes the UNIT does not", () => {
    const flat = "Images cost $0.03 each.";
    const arm = { param: "hdr", in: [true], reason: "HDR adds a surcharge." };
    const rateArm = priced({ ...BASE, quote: flat, unit: "per_image", usd: 0.03, undefinedWhen: [{ ...arm, changes: "rate" }] }, { sentence: flat });
    expect(models(rateArm)).not.toContain("cost:");
    expect(rate(rateArm)).toContain('undefinedWhen: [{ param: "hdr", in: [true], reason: "HDR adds a surcharge." }]');
    const unitArm = priced({ ...BASE, quote: flat, unit: "per_image", usd: 0.03, undefinedWhen: [{ ...arm, changes: "unit" }] }, { sentence: flat });
    expect(models(unitArm)).toContain("cost: { perImage: 0.03 }");
  });

  test("a second table for requests with a video input names the fields that carry one, and stays off `cost`", () => {
    const both = "Without video input: 720p: $0.1257; 1080p: $0.1879. With video input: 720p: $0.1544.";
    const out = priced(
      { ...BASE, quote: both, unit: "per_second", by: "resolution", usd: { "720p": 0.1257, "1080p": 0.1879 }, usdWithVideoInput: { "720p": 0.1544 }, videoInputs: ["video_urls"], seconds: "request" },
      { output: "video", pricing: both, sentence: null },
    );
    expect(rate(out)).toContain('usdWithVideoInput: { "720p": 0.1544 }, videoInputs: ["video_urls"], seconds: "request"');
    expect(models(out)).not.toContain("cost:");
  });

  test("a table the route has no field for is published under the quote's own labels, with the reason", () => {
    const out = priced({ ...BASE, unit: "per_image", byUnpublished: "The route has no field that selects it.", usd: { "720p": 0.0938, "1080p": 0.1875 } });
    expect(rate(out)).toContain('byUnpublished: "The route has no field that selects it."');
    expect(models(out)).not.toContain("cost:");
  });

  test("an unpriced row carries its reason and no rate", () => {
    const out = priced({ unpriced: "Token-metered.", source: PAGE_URL, verified: "2026-11-24", quote: SENTENCE });
    expect(rate(out)).toBe(`  "maker/sized": { unpriced: "Token-metered.", source: "${PAGE_URL}", verified: "2026-11-24" },`);
    expect(prose(out.get("models-image.gen.ts"))).toContain("UNPRICED. Token-metered.");
    expect(() => priced({ unpriced: "No.", source: PAGE_URL, verified: "2026-11-24" })).toThrow(/needs the `quote` it was read from/);
  });

  test("guard A: a quote that is not in the snapshot stops the run", () => {
    expect(() => priced({ ...TABLE, quote: "Images cost $0.0938 each at 720p and $0.1875 each at 1080p!" })).toThrow(/`quote` is not in the route's committed snapshot any more/);
    expect(() => priced({ ...TABLE, count: "batch_size", countQuote: "Billed per image." })).toThrow(/`countQuote` is not in the route's committed snapshot/);
    expect(rate(priced({ ...TABLE, count: "batch_size", countQuote: "Charged per image." }))).toContain('count: "batch_size"');
  });

  test("guard B: a rate that is not one of the amounts in its own quote stops the run", () => {
    expect(() => priced({ ...TABLE, usd: { "720p": 0.0983, "1080p": 0.1875 } })).toThrow(/the rate 0.0983 is not one of the amounts in its own quote \(0.0938, 0.1875\)/);
    expect(() => priced({ ...TABLE, usd: { "720p": 0.09, "1080p": 0.1875 } })).toThrow(/the rate 0.09 is not one of the amounts/);
  });

  test("guard B: two figures filed under each other's key stop the run", () => {
    expect(() => priced({ ...TABLE, usd: { "720p": 0.1875, "1080p": 0.0938 } })).toThrow(
      /the rate under "720p" is 0.1875, and the quote puts 0.0938 beside 720p/,
    );
    const both = "Without / with video input: 720p $0.1257 / $0.1544; 1080p $0.1879 / $0.2336.";
    const row = { ...BASE, quote: both, unit: "per_second", by: "resolution", seconds: "request", videoInputs: ["video_urls"] };
    const video = { output: "video", pricing: both, sentence: null };
    const tables = { usd: { "720p": 0.1257, "1080p": 0.1879 }, usdWithVideoInput: { "720p": 0.1544, "1080p": 0.2336 } };
    expect(rate(priced({ ...row, ...tables }, video))).toContain('usdWithVideoInput: { "720p": 0.1544, "1080p": 0.2336 }');
    expect(() => priced({ ...row, ...tables, usdWithVideoInput: { "720p": 0.2336, "1080p": 0.1544 } }, video)).toThrow(
      /the rate under "720p" is 0.2336, and the quote puts 0.1257 and 0.1544 beside 720p/,
    );
  });

  test("a table's keys are the selecting field's wire values, one per member", () => {
    expect(() => priced({ ...TABLE, usd: { "720p": 0.0938 } })).toThrow(/`usd` is keyed \["720p"\] and resolution offers \["720p","1080p"\]/);
    expect(() => priced({ ...TABLE, usd: { "720P": 0.0938, "1080p": 0.1875 } })).toThrow(/Keys are wire values/);
    expect(() => priced({ ...TABLE, by: "prompt" })).toThrow(/has no closed enum to key a table on/);
    expect(() => priced({ ...TABLE, by: "ghost" })).toThrow(/`by` names ghost, which the route does not declare/);
    expect(() => priced({ ...TABLE, by: undefined })).toThrow(/exactly one of `by` and `byUnpublished`/);
  });

  test("refuses a row whose parts do not belong together", () => {
    expect(() => priced({ ...TABLE, seconds: "request" })).toThrow(/a per-second rate states what its seconds are/);
    expect(() => priced({ ...TABLE, usdWithVideoInput: { "720p": 0.0938 } })).toThrow(/come together/);
    expect(() => priced({ ...TABLE, count: "batch_size" })).toThrow(/needs the `countQuote`/);
    expect(() => priced({ ...TABLE, undefinedWhen: [{ param: "resolution", in: ["4k"], changes: "rate", reason: "r" }] })).toThrow(/"4k", which is not a value of resolution/);
    expect(() => priced({ ...TABLE, undefinedWhen: [{ param: "prompt", minItems: 1, changes: "rate", reason: "r" }] })).toThrow(/which is not an array/);
    expect(() => priced({ ...TABLE, undefinedWhen: [{ param: "hdr", changes: "rate", reason: "r" }] })).toThrow(/exactly one of `in` and `minItems`/);
    expect(() => priced({ ...TABLE, usd: { "720p": -1, "1080p": 0.1875 } })).toThrow();
    expect(() => priced({ ...TABLE, surcharge: 1 })).toThrow();
  });

  test("every generated route needs a row, and a row needs a generated route", () => {
    const bare = input([CLIP]);
    expect(() => generate({ ...bare, pricing: { endpoints: {} } })).toThrow(/maker\/clip has no row/);
    expect(() => generate(input([CLIP], { pricing: { "maker/gone": unpriced(CLIP) } }))).toThrow(/maker\/gone is not a generated route/);
  });
});

// ---------------------------------------------------------------------------
// The committed snapshot
// ---------------------------------------------------------------------------

const DATA_DIR = join(import.meta.dir, "..", "data", "higgsfield");
const GEN_DIR = join(import.meta.dir, "..", "src", "providers", "higgsfield", "gen");

function readJson(...path: string[]): unknown {
  return JSON.parse(readFileSync(join(DATA_DIR, ...path), "utf8"));
}

function committedRoutes(): Record<string, unknown> {
  const routes: Record<string, unknown> = {};
  for (const name of readdirSync(join(DATA_DIR, "routes"))) {
    routes[name.slice(0, -".json".length).replace(/__/g, "/")] = readJson("routes", name);
  }
  return routes;
}

function idList(file: string, name: string): string[] {
  const body = new RegExp(`export const ${name} = \\[\\n([\\s\\S]*?)\\n\\] as const;`).exec(file)?.[1] ?? "";
  return [...body.matchAll(/^  "(.+)",$/gm)].map((match) => match[1] as string);
}

describe("codegen-higgsfield on the committed snapshot", () => {
  const routes = committedRoutes();
  const files = generate({
    routes,
    curation: readJson("curation.json"),
    overlays: readJson("overlays.json"),
    pricing: readJson("pricing.json"),
  });
  const file = (name: string): string => files.get(name) ?? "";
  const images = idList(file("endpoints.gen.ts"), "HIGGSFIELD_IMAGE_ENDPOINTS");
  const edits = idList(file("endpoints.gen.ts"), "HIGGSFIELD_IMAGE_EDIT_ENDPOINTS");
  const videos = idList(file("endpoints.gen.ts"), "HIGGSFIELD_VIDEO_ENDPOINTS");
  const shape = (id: string): string => block(file(images.includes(id) ? "image-narrow.gen.ts" : "video-narrow.gen.ts"), id);
  const catalog = (id: string): string => block(file(images.includes(id) ? "models-image.gen.ts" : "models-video.gen.ts"), id);
  const rate = (id: string): string =>
    file("pricing.gen.ts")
      .split("\n")
      .find((line) => line.startsWith(`  ${JSON.stringify(id)}: `)) ?? "";
  /** The members of a route's `aspect_ratio` vocabulary, read off its shape row. */
  function shapeRatios(id: string): string {
    const name = /aspect_ratio: \{ t: "string", enum: (E_[0-9a-f]{6}) \}/.exec(shape(id))?.[1];
    const narrow = file(images.includes(id) ? "image-narrow.gen.ts" : "video-narrow.gen.ts");
    return narrow.split("\n").find((line) => line.startsWith(`const ${name} = `)) ?? "";
  }

  test("the manifest lists exactly the committed route files, with the hash of each one's bytes", () => {
    const manifest = readJson("manifest.json") as { routes: Record<string, { file: string; sha256: string }> };
    expect(Object.keys(manifest.routes).sort()).toEqual(Object.keys(routes).sort());
    for (const row of Object.values(manifest.routes)) {
      const bytes = readFileSync(join(DATA_DIR, row.file), "utf8");
      expect(new Bun.CryptoHasher("sha256").update(bytes).digest("hex")).toBe(row.sha256);
    }
  });

  test("every route is served: 24 image routes, 87 video routes, and a 10-route picture-editing view", () => {
    expect(images).toHaveLength(24);
    expect(videos).toHaveLength(87);
    expect(edits).toHaveLength(10);
    expect(images.filter((id) => videos.includes(id))).toEqual([]);
    expect(edits.every((id) => images.includes(id))).toBe(true);
    for (const id of edits) expect(file("models-image.gen.ts")).toContain(`  ${JSON.stringify(id)}: imageModels[${JSON.stringify(id)}],`);
    expect(file("models-video.gen.ts")).not.toContain("imageEditModels");
    expect(idList(file("endpoints.gen.ts"), "HIGGSFIELD_ENDPOINTS")).toEqual([...images, ...videos].sort());
    // Every snapshotted route is generated, hand-written or excluded: none is dropped.
    expect(images.length + videos.length + 1 + 2).toBe(Object.keys(routes).length);
  });

  test("the hand-written training route and the misspelled legacy paths are in no list", () => {
    const all = [...images, ...videos];
    expect(all).not.toContain("v1/custom-references");
    expect(all.some((id) => id.startsWith("higgsfiled/"))).toBe(false);
    expect(file("endpoints.gen.ts")).toContain('  "higgsfiled/genjutsu/motion-transfer/v1.0": "A misspelled legacy path');
    expect(file("endpoints.gen.ts")).toContain('  "higgsfiled/genjutsu/object-swap/v1.0": "A misspelled legacy path');
  });

  test("the view is the five edit-only routes plus Marketing Studio, Grok Image and Ideogram; AI Influencer stays out", () => {
    expect(edits).toEqual([
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
    expect(images).toContain("higgsfield/ai-influencer");
  });

  test("the four routes only the docs publish are served, filed by their category index", () => {
    expect(images).toContain("higgsfield-ai/soul/cinema");
    expect(videos).toEqual(expect.arrayContaining(["minimax/h3/text-to-video", "minimax/h3/image-to-video", "minimax/h3/reference-to-video"]));
    expect(catalog("higgsfield-ai/soul/cinema")).toContain('name: "SOUL Cinema — Text to image"');
  });

  test("Seedance 2.5: `draft` is the console's, on a closed route", () => {
    expect(shape("bytedance/seedance-2.5/text-to-video")).toContain('draft: { t: "boolean" }');
    expect(shape("bytedance/seedance-2.5/text-to-video")).toContain("    closed: true,");
  });

  test("Ads Studio: the docs' wider aspect-ratio list stands", () => {
    expect(file("image-wire.gen.ts")).toMatch(/export interface HiggsfieldAdsStudioV10Input \{[^}]*aspect_ratio\?: [^;]*"3:1" \| "1:3";/);
  });

  test("strictness is each route's own: Genjutsu is closed, Genjutsu Light and the Soul routes are not", () => {
    expect(shape("higgsfield/genjutsu/restyle/v1.0")).toContain("    closed: true,");
    expect(shape("higgsfield/genjutsu-light/motion-transfer/v1.0")).not.toContain("    closed: true,");
    for (const id of ["higgsfield-ai/soul/standard", "higgsfield-ai/soul/v2/standard", "higgsfield-ai/soul/cinema"]) {
      expect(shape(id)).not.toContain("    closed: true,");
    }
  });

  test("Soul: the docs' reference fields and nullable seed; Soul V2: null accepted with a warning, strength 0 a soft bound", () => {
    const soul = shape("higgsfield-ai/soul/standard");
    expect(soul).toContain('custom_reference_id: { t: "string", nul: true, fmt: "uuid" }');
    expect(soul).toContain('seed: { t: "integer", nul: true, min: 1, max: 1000000 }');
    const v2 = shape("higgsfield-ai/soul/v2/standard");
    expect(v2).toContain('seed: { t: "integer", nul: true, nulWarn: true, min: 1, max: 1000000 }');
    expect(v2).toContain('custom_reference_strength: { t: "number", min: 0, max: 1, softXmin: 0 }');
    expect(v2).toContain('style_strength: { t: "number", min: 0, max: 1 }');
    expect(shape("higgsfield-ai/soul/v2/image-to-image")).toMatch(/seed: \{ t: "integer", nul: true, min/);
  });

  test("Z-Image: the console's 2500-character prompt is the hard bound, the docs' 800 the soft one", () => {
    expect(shape("z-image/turbo")).toContain('prompt: { t: "string", req: true, minLen: 1, maxLen: 2500, softMaxLen: 800 }');
  });

  test("Marketing Studio: enhancement requires a preset and 1–2 images; only 2.0 Alpha pins quality", () => {
    const alpha = shape("marketing-studio/image");
    expect(alpha).toContain(
      '{ kind: "when", if: [{ name: "enhance_prompt", in: [true] }], absent: "else", then: { required: ["preset_id", "image_urls"], props: { image_urls: { maxItems: 2, minItems: 1 }, quality: { in: ["high"] } } } }',
    );
    expect(shape("marketing-studio/image/flare")).toContain('then: { required: ["preset_id", "image_urls"], props: { image_urls: { maxItems: 2, minItems: 1 } } } }');
    expect(shape("marketing-studio/image/flare")).not.toContain("quality: { in:");
  });

  test("AI Influencer: both tier rules apply to a request that omits `tier`, the second as a complement", () => {
    const sheet = shape("higgsfield/ai-influencer");
    expect(sheet).toContain('if: [{ name: "tier", in: ["normal", "freak", "total"] }], absent: "then"');
    expect(sheet).toContain('if: [{ name: "tier", in: ["normal", "freak", "total", "frogs", "cats", "dogs", "capybaras", "birds"] }], absent: "then", then: { props: { pinned_species: { null: true } } }');
  });

  test("Cinema Studio 4.0: 33 camera movements, 50 palettes, the three reference caps and the prompt-token rule", () => {
    const wire = /export interface HiggsfieldCinemaStudio40Input \{([\s\S]*?)\n\}/.exec(file("video-wire.gen.ts"))?.[1] ?? "";
    const members = (name: string): number => (new RegExp(`\\n  ${name}\\?: (.*);`).exec(wire)?.[1] ?? "").split(" | ").length;
    expect(members("camera_movement")).toBe(33);
    expect(members("color_palette")).toBe(50);
    const studio = shape("higgsfield/cinema-studio/4.0");
    expect(studio).toMatch(/image_urls: \{ t: "array", maxItems: 30,/);
    expect(studio).toMatch(/video_urls: \{ t: "array", maxItems: 10,/);
    expect(studio).toMatch(/audio_urls: \{ t: "array", maxItems: 10,/);
    expect(studio).toContain('{ kind: "tokens", prompt: "prompt", arrays: { image: "image_urls", video: "video_urls", audio: "audio_urls" } }');
  });

  test("Kling O3: a request that omits `multi_shots` must satisfy one branch, and the first frame is required outright", () => {
    const frames = shape("kling-video/o3/first-last-frame");
    expect(frames).toContain('{ kind: "when", if: [{ name: "multi_shots", in: [true] }], absent: "either", then: { required: ["multi_prompt"] }, else: { required: ["prompt"] } }');
    expect(frames).toContain('first_frame_url: { t: "string", req: true, fmt: "uri" }');
  });

  test("the reference routes each demand at least one reference, in the schema's own terms", () => {
    expect(shape("bytedance/seedance-2.5/reference-to-video")).toContain('{ kind: "atLeastOne", params: [{ name: "image_urls" }, { name: "video_urls" }, { name: "audio_urls" }] }');
    expect(shape("kling-video/v4.0-flash/reference-to-video")).toContain(
      '{ kind: "atLeastOne", params: [{ name: "image_url" }, { name: "image_urls", nonEmpty: true }, { name: "video_urls", nonEmpty: true }] }',
    );
    expect(shape("sand/magi-2/reference-to-video")).toContain('{ name: "audio_urls", nonEmpty: true }] }');
    expect(shape("minimax/h3-lite/image-to-video")).toContain('{ kind: "atLeastOne", params: [{ name: "image_url" }, { name: "end_image_url" }] }');
  });

  test("`elements` is strings at Kling 3.0 and integers at Kling 4.0, and each route's row says which", () => {
    expect(file("input-schema.gen.ts")).toContain("  elements: z.unknown().optional(),");
    expect(shape("kling-video/v4.0/reference-to-video")).toContain('elements: { t: "array", maxItems: 7, items: { t: "integer", min: 1 } }');
    expect(shape("kling-video/o3/video-edit")).toContain('elements: { t: "array", minItems: 0, maxItems: 4, items: { t: "string" } }');
  });

  test("MiniMax H3 Lite: `aigc_watermark` accepts only `false`", () => {
    expect(shape("minimax/h3-lite/text-to-video")).toContain('aigc_watermark: { t: "boolean", const: false }');
    expect(file("video-wire.gen.ts")).toContain("  aigc_watermark?: false;");
  });

  test("Soul: the page's per-resolution rates, the 720p figure on `cost`, and the console's contradiction recorded", () => {
    expect(rate("higgsfield-ai/soul/standard")).toBe(
      '  "higgsfield-ai/soul/standard": { unit: "per_image", usd: { "720p": 0.0938, "1080p": 0.1875 }, by: "resolution", multipliedBy: "batch_size", defaults: { batch_size: 1, resolution: "720p" }, contradicted: true, ' +
        'source: "https://open.higgsfield.ai/models/higgsfield-ai/soul/standard/api-reference", verified: "2026-11-24" },',
    );
    expect(catalog("higgsfield-ai/soul/standard")).toContain("cost: { perImage: 0.0938 }");
    expect(catalog("higgsfield-ai/soul/v2/standard")).toContain("cost: { perImage: 0.0032 }");
    expect(catalog("higgsfield-ai/soul/v2/image-to-image")).toContain("cost: { perImage: 0.0032 }");
    expect(rate("higgsfield-ai/soul/cinema")).toContain("unpriced:");
    expect(catalog("higgsfield-ai/soul/cinema")).not.toContain("cost:");
  });

  test("a route whose console document says no price is public is unpriced, except the four the owner ruled on", () => {
    const denied = [...images, ...videos].filter((id) => (routes[id] as { console: { pricing: string } | null }).console?.pricing === CONSOLE_NO_PRICING);
    const marked = [...images, ...videos].filter((id) => rate(id).includes("contradicted: true"));
    expect(marked).toEqual(denied.filter((id) => !rate(id).includes("unpriced:")));
    expect(marked.sort()).toEqual(["higgsfield-ai/soul/standard", "higgsfield-ai/soul/v2/image-to-image", "higgsfield-ai/soul/v2/standard", "higgsfield/ai-influencer"]);
    const caveats = prose(file("models-image.gen.ts") + file("models-video.gen.ts")).split(`CAVEAT: the same route's console document says “${CONSOLE_NO_PRICING}”`);
    expect(caveats).toHaveLength(marked.length + 1);
    for (const id of ["ideogram/v4.0", "minimax/hailuo-2.3/standard/text-to-video", "recraft/v4.1/pro/text-to-image"]) {
      expect(rate(id)).toContain("unpriced:");
      expect(catalog(id)).not.toContain("cost:");
    }
    expect(rate("bytedance/seedance-2.5/text-to-video")).not.toContain("contradicted");
  });

  test("AI Influencer: $0.05 per sheet, under the same contradiction", () => {
    expect(rate("higgsfield/ai-influencer")).toContain('unit: "per_image", usd: 0.05, contradicted: true');
    expect(catalog("higgsfield/ai-influencer")).toContain("cost: { perImage: 0.05 }");
  });

  test("a flat rate reaches `cost`; a rate keyed by resolution does not", () => {
    expect(catalog("sand/magi-2/text-to-video")).toContain("cost: { perVideoSecond: 0.08 }");
    expect(catalog("kling-video/v3.0/std/text-to-video")).toContain("cost: { perVideoSecond: 0.0714 }");
    expect(catalog("bytedance/seedance-2.5/text-to-video")).not.toContain("cost:");
    expect(rate("bytedance/seedance-2.5/text-to-video")).toContain('usd: { "480p": 0.1177, "720p": 0.2647, "1080p": 0.6518 }, by: "resolution", seconds: "request"');
  });

  test("a rate billed on the source clip says which parameter and how it rounds, and stays off `cost`", () => {
    expect(rate("higgsfield/genjutsu/motion-transfer/v1.0")).toContain('seconds: "source", sourceParam: "video_url", rounding: "up"');
    expect(rate("kling-video/motion-control/std")).toContain('usd: 0.0523, seconds: "source", sourceParam: "video_url", rounding: "nearest"');
    expect(catalog("kling-video/motion-control/std")).not.toContain("cost:");
  });

  test("Genjutsu bills the source clip after its 30-second trim; Seedance 2.5 video-edit bills a clip length the request does not state", () => {
    expect(rate("higgsfield/genjutsu/object-swap/v1.0")).toContain('seconds: "source", sourceParam: "video_url", rounding: "up", maxSeconds: 30');
    expect(rate("bytedance/seedance-2.5/video-edit")).toContain('seconds: "output"');
    expect(rate("bytedance/seedance-2.5/video-edit")).toContain('undefinedWhen: [{ param: "draft", in: [true]');
  });

  test("sample points, approximate rates and token metering are unpriced", () => {
    for (const id of ["alibaba/happy-horse/text-to-video", "higgsfield/genjutsu/restyle/v1.0", "higgsfield/cinema-studio/4.0", "marketing-studio/image", "xai/grok-imagine-image-2.0"]) {
      expect(rate(id)).toContain("unpriced:");
      expect(catalog(id)).not.toContain("cost:");
    }
  });

  test("every catalog row states where its price, or its lack of one, was read", () => {
    for (const name of ["models-image.gen.ts", "models-video.gen.ts"]) {
      const rows = file(name).split("\n").filter((line) => /^  "[^"]+": \{$/.test(line)).length;
      const sources = file(name).split("\n").filter((line) => /^   \* Source:/.test(line)).length;
      expect(sources).toBe(rows);
    }
  });

  test("the committed gen/ directory is exactly what the snapshot generates", () => {
    expect(readdirSync(GEN_DIR).sort()).toEqual([...files.keys()].sort());
    for (const [name, content] of files) {
      expect(readFileSync(join(GEN_DIR, name), "utf8")).toBe(content);
    }
  });

  test("one gate serves both output types: a field two of them spell differently is not narrowed to either", () => {
    // `output_format` is a picture format on Recraft and a container on Seedance 2.5.
    expect(shape("recraft/v4.1/text-to-image")).toMatch(/output_format: \{ t: "string", enum: E_[0-9a-f]{6} \}/);
    expect(shape("bytedance/seedance-2.5/text-to-video")).toMatch(/output_format: \{ t: "string", enum: E_[0-9a-f]{6} \}/);
    expect(file("input-schema.gen.ts")).toContain("  output_format: z.unknown().optional(),");
    // No type, no `null`, no vocabulary and no nested key anywhere in it:
    // `seed` is nullable on the Soul routes only, `sound` is `on | off` at
    // every route that declares it, and both are named and nothing more.
    expect(file("input-schema.gen.ts")).toContain("  seed: z.unknown().optional(),");
    expect(file("input-schema.gen.ts")).toContain("  sound: z.unknown().optional(),");
    const body = file("input-schema.gen.ts");
    expect(body.slice(body.indexOf("export const"))).not.toMatch(/z\.(enum|record|number|boolean|array)\(|looseObject\(\{ /);
  });

  test("a conditional's `required` whose agreed default satisfies the branch is `defaulted`, not `required`", () => {
    // Both sources give `resolution` the default "1080p", one of the two values HDR allows.
    expect(shape("kling-video/v4.0/text-to-video")).toContain(
      '{ kind: "when", if: [{ name: "dynamic_range", in: ["hdr"] }], absent: "else", then: { props: { resolution: { in: ["1080p", "4k"] } }, defaulted: { resolution: "1080p" } } }',
    );
    expect(file("image-narrow.gen.ts")).toContain('then: { props: { prompt_extend: { in: [true] } }, defaulted: { prompt_extend: true } }');
  });

  test("Soul Standard: `style_id: null` is the console document's own example, so the row admits it with a warning", () => {
    expect(shape("higgsfield-ai/soul/standard")).toContain('style_id: { t: "string", nul: true, nulWarn: true, fmt: "uuid" }');
    expect(file("image-wire.gen.ts")).toMatch(/export interface HiggsfieldAiSoulStandardInput \{[^}]*\n  style_id\?: string \| null;/);
  });

  /** The ids a pack's row file addresses. */
  const packIds = (pack: string): string[] => idList(file(`${pack}-params.gen.ts`), `HIGGSFIELD_${pack.replace("-", "_").toUpperCase()}_UNIFIED_MODELS`);
  /** One route's row in a pack's row file. */
  function unified(pack: string, id: string): string {
    const text = file(`${pack}-params.gen.ts`);
    const name = text.split("\n").find((line) => line.startsWith(`  ${JSON.stringify(id)}: ROW_`))?.slice(-11, -1);
    const start = text.indexOf(`const ${name} = {`);
    return name === undefined ? "" : inlined(text, text.slice(start, text.indexOf("\n} as const;", start)));
  }

  test("`unmodel/image` addresses 18 of the 24 image routes: the five edit-only ones and AI Influencer are left out", () => {
    const ids = packIds("image");
    expect(ids.length).toBe(18);
    expect(images.filter((id) => !ids.includes(id))).toEqual([
      "alibaba/qwen-image-3/edit",
      "bytedance/seedream/v5.0/pro/edit",
      "higgsfield-ai/soul/v2/image-to-image",
      "higgsfield/ai-influencer",
      "kling-image/v4.0/edit",
      "kling-image/v4.0/edit/series",
    ]);
    // Marketing Studio, Grok Image and Ideogram take a picture optionally, so both packs address them.
    for (const id of ["marketing-studio/image", "xai/grok-imagine-image-2.0", "ideogram/v4.0"]) {
      expect(ids).toContain(id);
      expect(edits).toContain(id);
    }
  });

  test("`unmodel/image-edit` addresses exactly the view, and `unmodel/video` every video route but finalize-draft", () => {
    expect(packIds("image-edit")).toEqual(edits);
    expect(videos.filter((id) => !packIds("video").includes(id))).toEqual(["bytedance/seedance-2.5/finalize-draft"]);
  });

  test("Soul: 1 or 4 images in `batch_size`, and a `resolution` no tier names", () => {
    const row = unified("image", "higgsfield-ai/soul/standard");
    expect(row).toContain('countWire: "batch_size",\n  counts: [1, 4],');
    expect(row).toContain("tiers: [],");
    expect(row).toContain('keys: ["aspect_ratio", "batch_size", "prompt", "resolution", "seed"],');
    // On the editing surface there is no tier word, so Soul 2's own is its extra.
    expect(unified("image-edit", "higgsfield-ai/soul/v2/image-to-image")).toContain(
      'resolution: EXTRA as HiggsfieldAiSoulV2ImageToImageInput["resolution"],',
    );
  });

  test("Kling Image series requires its count; Seedream's `1.5k` and Kling's `8k` are not tiers", () => {
    const series = unified("image", "kling-image/v4.0/text-to-image/series");
    expect(series).toContain('countWire: "series_amount",\n  countRequired: true,');
    expect(series).toContain('tiers: ["2k", "4k"],');
    expect(unified("image", "bytedance/seedream/v5.0/pro/text-to-image")).toContain('tiers: ["1k", "2k"],');
  });

  test("Recraft is the one family with a picture `output_format`; Seedance 2.5's is a container and stays an extra", () => {
    const formatted = packIds("image").filter((id) => unified("image", id).includes("formatWire"));
    expect(formatted).toEqual([
      "recraft/v4.1/pro/text-to-image",
      "recraft/v4.1/text-to-image",
      "recraft/v4.1/utility/pro/text-to-image",
      "recraft/v4.1/utility/text-to-image",
    ]);
    expect(unified("video", "bytedance/seedance-2.5/text-to-video")).toContain(
      'output_format: EXTRA as BytedanceSeedance25TextToVideoInput["output_format"],',
    );
  });

  test("the picture to edit is one URL at Soul 2 and Ideogram, a list everywhere else", () => {
    const single = edits.filter((id) => unified("image-edit", id).includes('imageWire: "image_url"'));
    expect(single).toEqual(["higgsfield-ai/soul/v2/image-to-image", "ideogram/v4.0"]);
    for (const id of edits) expect(unified("image-edit", id)).toMatch(/imageWire: "image_urls?",/);
  });

  test("the three spellings of a closing frame, and the two of an opening one", () => {
    expect(unified("video", "alibaba/wan-3.0/image-to-video")).toContain('roleWire: { first: "image_url", last: "end_image_url" },');
    expect(unified("video", "kling-video/v3.0/pro/image-to-video")).toContain('roleWire: { first: "image_url", last: "last_image_url" },');
    expect(unified("video", "kling-video/omni/first-last-frame")).toContain('roleWire: { first: "first_frame_url", last: "last_frame_url" },');
  });

  test("Genjutsu and motion control take the clip in `video_url`; Cinema Studio takes it in the list", () => {
    const genjutsu = unified("video", "higgsfield/genjutsu/motion-transfer/v1.0");
    expect(genjutsu).toContain('roles: ["reference"],');
    expect(genjutsu).toContain('videoWire: "video_url",');
    expect(unified("video", "kling-video/v3/motion-control/pro")).toContain('roles: ["first"],\n  roleWire: { first: "image_url" },\n  videoWire: "video_url",');
    expect(unified("video", "higgsfield/cinema-studio/4.0")).toContain('videoWire: "video_urls",');
    // Seedance 2.5 video-edit has both: the list is its extra.
    const edit = unified("video", "bytedance/seedance-2.5/video-edit");
    expect(edit).toContain('videoWire: "video_url",');
    expect(edit).toContain('video_urls: EXTRA as BytedanceSeedance25VideoEditInput["video_urls"],');
  });

  test("MiniMax H3: `480P` is a tier in its own capitals, `768P` and `2K` are not; 18 routes list `adaptive`", () => {
    expect(unified("video", "minimax/h3-lite/text-to-video")).toContain('resolutions: ["480p"],\n  resolutionWire: { "480p": "480P" },');
    const h3 = unified("video", "minimax/h3/text-to-video");
    expect(h3).toContain("resolutions: [],");
    expect(h3).toContain('ratios: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"],');
    const adaptive = videos.filter((id) => /aspect_ratio: \{ t: "string", enum: (E_[0-9a-f]{6}) \}/.test(shape(id)) && shapeRatios(id).includes("adaptive"));
    expect(adaptive.length).toBe(18);
    for (const id of adaptive) expect(unified("video", id)).not.toContain("adaptive");
  });

  test("a duration is a list on 15 video routes, a range on 59, and absent on 12", () => {
    const rows = packIds("video").map((id) => unified("video", id));
    expect(rows.filter((row) => /durations: \[\d/.test(row)).length).toBe(15);
    const ranged = rows.filter((row) => !row.includes("durations"));
    expect(ranged.length).toBe(59);
    // Every range states both ends, so a picker can draw it.
    for (const row of ranged) expect(row).toMatch(/bounds: \{ duration: \{ min: \d+, max: \d+ \}/);
    expect(rows.filter((row) => row.includes("durations: [],")).length).toBe(12);
  });

  test("a rate's defaults are the ones every source agrees on", () => {
    expect(rate("bytedance/seedance-2.5/text-to-video")).toContain('defaults: { draft: false, duration: 5, resolution: "720p" }');
    expect(rate("ideogram/v4.0")).not.toContain("defaults:");
  });

  test("every curation, overlay and pricing entry carries a reason or quote, a source and a date", () => {
    const dated = /^\d{4}-\d{2}-\d{2}$/;
    const curation = readJson("curation.json") as { handWritten: Json; views: { imageEdit: { exclude: Json } }; excluded: { routes: Json } };
    const entries = [curation.handWritten, curation.views.imageEdit.exclude, curation.excluded.routes].flatMap((group) => Object.values(group) as Json[]);
    const overlays = (readJson("overlays.json") as { overlays: Json[] }).overlays;
    for (const entry of [...entries, ...overlays]) {
      expect(String(entry["reason"]).length).toBeGreaterThan(40);
      expect(String(entry["source"])).toContain("https://");
      expect(String(entry["date"])).toMatch(dated);
    }
    for (const row of Object.values((readJson("pricing.json") as { endpoints: Record<string, Json> }).endpoints)) {
      expect(String(row["source"])).toContain("https://");
      expect(String(row["verified"])).toMatch(dated);
    }
  });
});
