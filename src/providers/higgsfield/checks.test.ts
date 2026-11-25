import { describe, expect, test } from "bun:test";
import { createIssueSink, type PipelineContext } from "../../core/pipeline";
import type { ValidateOptions } from "../../core/options";
import type { Issue } from "../../core/issues";
import { heuristicTokenizer } from "../../core/tokens";
import { runSubmitChecks, type HiggsfieldCheckSpec, type HiggsfieldView } from "./checks";
import type { HiggsfieldEndpointShape } from "./shape-types";

/**
 * The check battery, against HAND-WRITTEN shape rows.
 *
 * Deliberately not the generated tables: those move every week, and a rule
 * such as "a closed route refuses an undeclared key" should not need
 * re-pinning because Seedance gained a field. Each row below is the smallest
 * shape that exercises one behaviour; `image.test.ts`, `image-edit.test.ts`
 * and `video.test.ts` are where the real rows meet the real addresses.
 */

const SHAPES = {
  "maker/open": {
    order: ["count", "flag", "image_url", "image_urls", "label", "mode", "preset_id", "prompt", "ratio", "seed", "strength", "style", "watermark"],
    props: {
      count: { t: "integer", min: 1, max: 4 },
      flag: { t: "boolean" },
      image_url: { t: "string", nul: true, fmt: "uri" },
      image_urls: { t: "array", minItems: 1, maxItems: 2, items: { t: "string", fmt: "uri" } },
      label: { t: "string", pat: "^#[0-9a-fA-F]{6}$" },
      mode: { t: "string", enum: ["std", "pro"] },
      preset_id: { t: "string", fmt: "uuid" },
      prompt: { t: "string", req: true, minLen: 2, maxLen: 20, softMaxLen: 10 },
      ratio: { t: "number", xmin: 0, xmax: 2, step: 0.01 },
      seed: { t: "integer", nul: true, nulWarn: true },
      strength: { t: "number", min: 0, max: 1, softXmin: 0 },
      style: {
        t: "object",
        nul: true,
        closed: true,
        props: {
          version: { t: "string", req: true, enum: ["v2"] },
          choices: { t: "object", props: { pinned: { t: "string", enum: ["a"] } }, values: { t: "string", enum: ["x", "y"] }, maxProps: 2 },
        },
      },
      watermark: { t: "boolean", const: false },
    },
  },
  "maker/closed": {
    order: ["prompt", "shots"],
    props: {
      prompt: { t: "string" },
      shots: { t: "array", items: { t: "object", props: { duration: { t: "integer", min: 1 }, prompt: { t: "string", req: true } } } },
    },
    closed: true,
  },
  "maker/rules": {
    order: ["audio_urls", "dynamic_range", "enhance", "image_url", "image_urls", "multi", "multi_prompt", "pinned", "preset_id", "prompt", "quality", "resolution", "tier", "traits", "video_urls"],
    props: {
      audio_urls: { t: "array", items: { t: "string" } },
      dynamic_range: { t: "string", enum: ["sdr", "hdr"] },
      enhance: { t: "boolean" },
      image_url: { t: "string" },
      image_urls: { t: "array", items: { t: "string" } },
      multi: { t: "boolean" },
      multi_prompt: { t: "array", items: { t: "string" } },
      pinned: { t: "string", nul: true },
      preset_id: { t: "string" },
      prompt: { t: "string" },
      quality: { t: "string", enum: ["low", "high"] },
      resolution: { t: "string", enum: ["720p", "1080p", "4k"] },
      tier: { t: "string", enum: ["normal", "insects"] },
      traits: { t: "object", nul: true, props: { animals: { t: "object", nul: true, values: { t: "integer" } } } },
      video_urls: { t: "array", items: { t: "string" } },
    },
    rules: [
      { kind: "atLeastOne", params: [{ name: "image_url" }, { name: "image_urls", nonEmpty: true }, { name: "video_urls", nonEmpty: true }] },
      // `if` requires the parameter: an omitted `enhance` is the else branch.
      { kind: "when", if: [{ name: "enhance", in: [true] }], absent: "else", then: { required: ["preset_id"], props: { image_urls: { minItems: 1, maxItems: 2 }, quality: { in: ["high"] } } } },
      // The agreed default satisfies the `if`: an omitted `tier` is the then branch.
      { kind: "when", if: [{ name: "tier", in: ["normal"] }], absent: "then", then: { props: { pinned: { null: true }, traits: { props: { animals: { null: true } } } } } },
      // The two readings of an omitted `multi` disagree: one branch must hold.
      { kind: "when", if: [{ name: "multi", in: [true] }], absent: "either", then: { required: ["multi_prompt"] }, else: { required: ["prompt"] } },
      { kind: "when", if: [{ name: "dynamic_range", in: ["hdr"] }], absent: "else", then: { props: { resolution: { in: ["1080p", "4k"] } }, defaulted: { resolution: "1080p" } } },
      { kind: "tokens", prompt: "prompt", arrays: { image: "image_urls", video: "video_urls", audio: "audio_urls" } },
    ],
  },
  "maker/sibling": {
    order: ["motion", "prompt"],
    props: { motion: { t: "string" }, prompt: { t: "string" } },
  },
} as const satisfies Record<string, HiggsfieldEndpointShape>;

const VIEW: HiggsfieldView = { does: "edit a picture", wide: "higgsfield.image", needsOneOf: ["image_url", "image_urls"] };

function specOf(overrides: Partial<HiggsfieldCheckSpec> = {}): HiggsfieldCheckSpec {
  return {
    shapes: SHAPES,
    ids: Object.keys(SHAPES),
    elsewhere: { "higgsfield.video": ["maker/clip"] },
    gateKeys: new Set(["endpoint", "hf_webhook", ...Object.values(SHAPES).flatMap((shape) => shape.order), "foreign_key"]),
    ...overrides,
  };
}

function run(params: Record<string, unknown>, spec: HiggsfieldCheckSpec = specOf(), options: ValidateOptions = {}): Issue[] {
  const sink = createIssueSink(options);
  const ctx: PipelineContext = { endpoint: "higgsfield.image", options, tokenizer: heuristicTokenizer, report: (issue) => sink.report(issue) };
  runSubmitChecks(spec, params, ctx);
  return sink.issues;
}

/** A body that satisfies `maker/rules`' presence rule, so one test reads one rule. */
const RULES = { endpoint: "maker/rules", image_url: "https://example.com/a.png", prompt: "a fox" };
const OPEN = { endpoint: "maker/open", prompt: "a fox" };

function only(issues: Issue[]): Issue {
  expect(issues).toHaveLength(1);
  return issues[0] as Issue;
}

describe("checkAddress", () => {
  test("a valid request on a served route is clean, and cites nothing", () => {
    expect(run(OPEN)).toEqual([]);
  });

  test("a route another wide address types is a WARNING naming that address, and nothing else is checked", () => {
    const issue = only(run({ endpoint: "maker/clip", prompt: 7, anything: true }));
    expect(issue.severity).toBe("warning");
    expect(issue.code).toBe("unsupported_capability");
    expect(issue.path).toEqual(["endpoint"]);
    expect(issue.message).toBe(
      "`maker/clip` is a Higgsfield route that `higgsfield.video` validates; higgsfield.image did not check the body. " +
        "The request itself is unaffected — the route id is the path, whichever address builds it.",
    );
    expect(issue.meta?.["address"]).toBe("higgsfield.video");
  });

  test("an excluded route gets its recorded reason, as a warning", () => {
    const issue = only(run({ endpoint: "higgsfiled/genjutsu/object-swap/v1.0", video_url: "https://example.com/a.mp4" }));
    expect(issue.severity).toBe("warning");
    expect(issue.code).toBe("unknown_model");
    expect(issue.message).toStartWith("unmodel deliberately does not type `higgsfiled/genjutsu/object-swap/v1.0`: A misspelled legacy path");
    expect(issue.message).toEndWith("this is a recorded decision, not catalog lag.");
    expect(issue.meta?.["excluded"]).toBe(true);
  });

  test("a route no row knows is a warning at `endpoint`, and nothing about its body is checked", () => {
    const issue = only(run({ endpoint: "maker/brand-new", prompt: 7, duration: "5s", seed: null }));
    expect(issue).toMatchObject({ severity: "warning", code: "unknown_model", path: ["endpoint"], model: "maker/brand-new" });
    expect(issue.message).toBe(
      "`maker/brand-new` is not a Higgsfield route unmodel has a row for, so higgsfield.image checked nothing about its body. " +
        "The request is routed and sent as written. If the route is newer than this version's snapshot that is expected; otherwise check the id's spelling.",
    );
  });

  test("a value that cannot be a route id is refused with the id it should have been", () => {
    const pasted = only(run({ endpoint: "https://api.higgsfield.ai/maker/open", prompt: "a fox" }));
    expect(pasted).toMatchObject({ severity: "error", code: "invalid_shape", path: ["endpoint"] });
    expect(pasted.message).toBe(
      "`endpoint` is a route id, the path after `https://api.higgsfield.ai/` with no slash at either end " +
        '(`higgsfield-ai/soul/standard`); got "https://api.higgsfield.ai/maker/open", which is a whole URL. Send `maker/open`.',
    );
    expect(pasted.meta?.["suggestion"]).toBe("maker/open");

    expect(only(run({ endpoint: "/maker/open", prompt: "a fox" })).message).toEndWith('got "/maker/open", which has an empty path segment. Send `maker/open`.');
    expect(only(run({ endpoint: "maker/open/", prompt: "a fox" })).meta?.["suggestion"]).toBe("maker/open");
    const relative = only(run({ endpoint: "../v1/custom-references?x=1" }));
    expect(relative.message).toEndWith("which carries a query string or a fragment.");
    expect(relative.meta?.["suggestion"]).toBeUndefined();
    expect(only(run({ endpoint: "" })).message).toEndWith('got "", which is empty.');
  });

  test("the VIEW refuses a route of its wide address that is not its own", () => {
    const spec = specOf({ ids: ["maker/open"], view: VIEW });
    const issue = only(run({ endpoint: "maker/sibling", prompt: "x" }, spec));
    expect(issue.severity).toBe("error");
    expect(issue.code).toBe("unsupported_capability");
    expect(issue.message).toBe(
      "higgsfield.image serves the Higgsfield routes that edit a picture, and `maker/sibling` is not one of them. `higgsfield.image` validates it.",
    );
  });

  test("the VIEW still only signposts a route that belongs to another wide address", () => {
    const spec = specOf({ ids: ["maker/open"], view: VIEW });
    expect(only(run({ endpoint: "maker/clip" }, spec)).severity).toBe("warning");
  });

  test("the VIEW needs the thing that makes the request its kind of request", () => {
    const spec = specOf({ ids: ["maker/open"], view: VIEW });
    const issue = only(run(OPEN, spec));
    expect(issue.severity).toBe("error");
    expect(issue.path).toEqual(["image_url"]);
    expect(issue.message).toBe(
      "higgsfield.image is for requests that edit a picture: send `image_url` or `image_urls`. " +
        "Without one this is a plain generation on maker/open, which `higgsfield.image` validates.",
    );
    expect(run({ ...OPEN, image_urls: ["https://example.com/a.png"] }, spec)).toEqual([]);
    // An explicit `null` is not a picture.
    expect(run({ ...OPEN, image_url: null }, spec)).toHaveLength(1);
  });
});

describe("checkRequired", () => {
  test("a missing required parameter is an error at its own path", () => {
    const issue = only(run({ endpoint: "maker/open" }));
    expect(issue).toMatchObject({ severity: "error", code: "invalid_shape", path: ["prompt"], message: "`prompt` is required by maker/open." });
  });

  test("a required key of a nested object is checked where the object is sent", () => {
    const issue = only(run({ ...OPEN, style: {} }));
    expect(issue).toMatchObject({ severity: "error", path: ["style", "version"], message: "`style.version` is required by maker/open." });
  });

  test("…and inside every item of an array of objects", () => {
    const issue = only(run({ endpoint: "maker/closed", shots: [{ prompt: "a" }, { duration: 2 }] }));
    expect(issue).toMatchObject({ path: ["shots", 1, "prompt"], message: "`shots[1].prompt` is required by maker/closed." });
  });
});

describe("types, vocabularies and null", () => {
  test("the wrong type is reported once, with what was expected", () => {
    const issue = only(run({ ...OPEN, count: "2" }));
    expect(issue).toMatchObject({ severity: "error", path: ["count"], message: '`count` must be a whole number on maker/open; got "2".' });
    expect(issue.meta?.["expected"]).toBe("integer");
  });

  test("a fraction is not a whole number", () => {
    expect(only(run({ ...OPEN, count: 1.5 })).message).toBe("`count` must be a whole number on maker/open; got 1.5.");
  });

  test("a value outside a closed vocabulary lists the vocabulary", () => {
    const issue = only(run({ ...OPEN, mode: "turbo" }));
    expect(issue).toMatchObject({ severity: "error", code: "invalid_enum_value", message: '`mode` must be "std" or "pro" on maker/open; got "turbo".' });
    expect(issue.meta?.["allowed"]).toEqual(["std", "pro"]);
  });

  test("a boolean `const` admits its one value", () => {
    expect(run({ ...OPEN, watermark: false })).toEqual([]);
    expect(only(run({ ...OPEN, watermark: true })).message).toBe(
      "`watermark` must be false on maker/open, the only value this route's schema declares for it; got true.",
    );
  });

  test("`null` is accepted where the route says so, and refused where it does not", () => {
    expect(run({ ...OPEN, image_url: null, style: null })).toEqual([]);
    expect(only(run({ ...OPEN, mode: null }))).toMatchObject({ severity: "error", message: "`mode` does not accept `null` on maker/open; omit it instead." });
  });

  test("a `null` the two publications contradict each other on is accepted and reported", () => {
    const issue = only(run({ ...OPEN, seed: null }));
    expect(issue.severity).toBe("warning");
    expect(issue.message).toContain("contradict each other on whether an explicit `null` is accepted");
  });

  test("a map's named key has its own vocabulary, every other key the map's, and `maxProperties` holds", () => {
    expect(run({ ...OPEN, style: { version: "v2", choices: { pinned: "a", other: "x" } } })).toEqual([]);
    const issues = run({ ...OPEN, style: { version: "v2", choices: { pinned: "x", other: "z", third: "y" } } });
    expect(issues.map((issue) => issue.message)).toEqual([
      '`style.choices.pinned` must be "a" on maker/open; got "x". That is the only value this route\'s schema declares for it.',
      '`style.choices.other` must be "x" or "y" on maker/open; got "z".',
      "`style.choices` accepts at most 2 keys on maker/open; got 3.",
    ]);
  });

  test("a closed NESTED object refuses an undeclared key, whatever the route does at the top", () => {
    const issue = only(run({ ...OPEN, style: { version: "v2", extra: 1 } }));
    expect(issue).toMatchObject({ severity: "error", code: "unsupported_param", path: ["style", "extra"] });
    // A stale snapshot can be wrong about a nested key as well as a top-level one.
    expect(issue.message).toEndWith(
      "and nothing else (`additionalProperties: false`). If this key is newer than unmodel's snapshot, pass `{ severity: { unsupported_param: \"warning\" } }` for this call.",
    );
  });
});

describe("ranges", () => {
  test("inclusive and exclusive numeric bounds", () => {
    expect(only(run({ ...OPEN, count: 0 })).message).toBe("`count` must be at least 1 on maker/open; got 0.");
    expect(only(run({ ...OPEN, count: 5 })).message).toBe("`count` must be at most 4 on maker/open; got 5.");
    expect(only(run({ ...OPEN, ratio: 0 })).message).toBe("`ratio` must be greater than 0 on maker/open; got 0.");
    expect(only(run({ ...OPEN, ratio: 2 })).message).toBe("`ratio` must be less than 2 on maker/open; got 2.");
  });

  test("string lengths", () => {
    expect(only(run({ endpoint: "maker/open", prompt: "a" })).message).toBe("`prompt` must be at least 2 characters on maker/open; got 1.");
    expect(only(run({ endpoint: "maker/open", prompt: "a".repeat(21) }))).toMatchObject({ severity: "error", message: "`prompt` must be at most 20 characters on maker/open; got 21." });
  });

  test("string lengths count code points, as JSON Schema does: an emoji is one character", () => {
    // 20 code points, 40 UTF-16 units: inside the hard cap (the soft one only warns).
    expect(run({ endpoint: "maker/open", prompt: "🦊".repeat(20) }).filter((issue) => issue.severity === "error")).toEqual([]);
    expect(only(run({ endpoint: "maker/open", prompt: "🦊".repeat(21) })).message).toBe("`prompt` must be at most 20 characters on maker/open; got 21.");
    // One code point, two UTF-16 units: under the minimum of 2.
    expect(only(run({ endpoint: "maker/open", prompt: "🦊" })).message).toBe("`prompt` must be at least 2 characters on maker/open; got 1.");
  });

  test("array lengths, and each item's own spec", () => {
    expect(only(run({ ...OPEN, image_urls: [] })).message).toBe("`image_urls` needs at least 1 entry on maker/open; got 0.");
    const many = ["https://example.com/a.png", "https://example.com/b.png", "https://example.com/c.png"];
    expect(only(run({ ...OPEN, image_urls: many })).message).toBe("`image_urls` accepts at most 2 entries on maker/open; got 3.");
    expect(only(run({ ...OPEN, image_urls: [7] })).path).toEqual(["image_urls", 0]);
  });

  test("a soft bound is a WARNING: the schema accepts the value", () => {
    const issue = only(run({ ...OPEN, strength: 0 }));
    expect(issue.severity).toBe("warning");
    expect(issue.message).toBe(
      "`strength` must be greater than 0 on maker/open; got 0. The route's schema accepts it and another of its published documents does not, so it is sent as written.",
    );
    const long = only(run({ endpoint: "maker/open", prompt: "a".repeat(11) }));
    expect(long.severity).toBe("warning");
    expect(long.message).toBe(
      "`prompt` is 11 characters, and maker/open's published documents disagree on the limit: one says 10, another 20. It is sent as written.",
    );
  });

  test("`multipleOf` is a WARNING, and a float that is a multiple is not reported", () => {
    // 0.07 / 0.01 is 7.000000000000001.
    expect(run({ ...OPEN, ratio: 0.07 })).toEqual([]);
    const issue = only(run({ ...OPEN, ratio: 0.075 }));
    expect(issue.severity).toBe("warning");
    expect(issue.message).toBe("`ratio` is documented as a multiple of 0.01 on maker/open; got 0.075. It is sent as written.");
  });
});

describe("formats and patterns", () => {
  test("a UUID is checked for format, never for membership", () => {
    expect(run({ ...OPEN, preset_id: "c2143317-f28d-4c3c-a0b8-39bd547e08a7" })).toEqual([]);
    const issue = only(run({ ...OPEN, preset_id: "Editorial" }));
    expect(issue).toMatchObject({ severity: "error", message: '`preset_id` must be a UUID on maker/open; got "Editorial". Send the id from the route\'s own list, not a name.' });
  });

  test("an `http(s)` URL passes", () => {
    expect(run({ ...OPEN, image_url: "https://example.com/a.png", image_urls: ["http://example.com/b.png"] })).toEqual([]);
  });

  test("a string that is not a URL at all is refused, with the upload route", () => {
    const issue = only(run({ ...OPEN, image_url: "./photos/a.png" }));
    expect(issue.severity).toBe("error");
    expect(issue.message).toBe(
      '`image_url` must be a URL Higgsfield can fetch on maker/open; got "./photos/a.png", which is not a URL (it reads like a local path or a bare id). ' +
        "No Higgsfield route takes bytes: `POST https://api.higgsfield.ai/files/generate-upload-url` with `{ content_type }`, `PUT` the file to the `upload_url` it answers, and send its `public_url` here.",
    );
    expect(issue.meta?.["hint"]).toBe("https://docs.higgsfield.ai/docs/concepts/file-uploads.md");
  });

  test("a `data:` URI is REPORTED and sent: `format: uri` does not refuse it", () => {
    const issue = only(run({ ...OPEN, image_urls: ["data:image/png;base64,AAAA"] }));
    expect(issue.severity).toBe("warning");
    expect(issue.path).toEqual(["image_urls", 0]);
    expect(issue.message).toStartWith("`image_urls[0]` is a `data:` URI on maker/open. Higgsfield documents its inputs as public HTTPS URLs it fetches;");
    expect(issue.message).toContain("POST https://api.higgsfield.ai/files/generate-upload-url");
  });

  test("bytes handed to a URL parameter get the upload route, not a bare type error", () => {
    const issue = only(run({ ...OPEN, image_urls: [{ file: "…" }] }));
    expect(issue.severity).toBe("error");
    expect(issue.message).toStartWith("`image_urls[0]` must be the URL of a file, as a string, on maker/open; got an object. No Higgsfield route takes bytes:");
  });

  test("a published pattern is enforced as published", () => {
    expect(run({ ...OPEN, label: "#a1B2c3" })).toEqual([]);
    expect(only(run({ ...OPEN, label: "red" })).message).toBe(
      '`label` must match the pattern maker/open publishes for it, `^#[0-9a-fA-F]{6}$`; got "red".',
    );
  });
});

describe("unknown keys", () => {
  test("a closed route REFUSES an undeclared key, and says how to override a stale snapshot", () => {
    const issue = only(run({ endpoint: "maker/closed", prompt: "x", draft: true }));
    expect(issue.severity).toBe("error");
    expect(issue.code).toBe("unsupported_param");
    expect(issue.message).toBe(
      "`draft` is not a parameter maker/closed declares, and its published schema refuses undeclared keys (`additionalProperties: false`). " +
        'It takes "prompt" and "shots". If this field is newer than unmodel\'s snapshot, pass `{ severity: { unsupported_param: "warning" } }` for this call.',
    );
  });

  test("…and the override it names downgrades exactly that", () => {
    const issue = only(run({ endpoint: "maker/closed", prompt: "x", draft: true }, specOf(), { severity: { unsupported_param: "warning" } }));
    expect(issue.severity).toBe("warning");
  });

  test("an open route sends a sibling's key with a warning naming the routes that take it", () => {
    const issue = only(run({ ...OPEN, motion: "pan" }));
    expect(issue.severity).toBe("warning");
    expect(issue.code).toBe("unknown_param");
    expect(issue.message).toContain("`motion` is not a parameter maker/open declares");
    expect(issue.message).toContain("One other route at higgsfield.image does take it (`maker/sibling`)");
    expect(issue.message).toEndWith("It is sent as written: this route's schema does not refuse undeclared keys.");
    expect(issue.meta?.["takenBy"]).toEqual(["maker/sibling"]);
  });

  test("a key only the other output type's routes declare is still this file's to report", () => {
    const issue = only(run({ ...OPEN, foreign_key: 1 }));
    expect(issue.message).toContain("Other Higgsfield routes do take it, so this reads like a request written for a different one.");
  });

  test("a key no route declares is the pipeline's to report, so an open route says nothing here", () => {
    expect(run({ ...OPEN, promt: "typo" })).toEqual([]);
  });

  test("the two URL parameters are never unknown", () => {
    expect(run({ endpoint: "maker/closed", prompt: "x", hf_webhook: "https://example.com/hook" })).toEqual([]);
  });
});

describe("rules: atLeastOne", () => {
  test("none sent is one error naming every option", () => {
    const issue = only(run({ endpoint: "maker/rules", prompt: "x" }));
    expect(issue).toMatchObject({
      severity: "error",
      path: ["image_url"],
      message: "maker/rules needs at least one of `image_url`, `image_urls` (non-empty), `video_urls` (non-empty); the request sends none.",
    });
  });

  test("an EMPTY array does not satisfy a `nonEmpty` option, and a non-empty one does", () => {
    expect(run({ endpoint: "maker/rules", prompt: "x", image_urls: [] })).toHaveLength(1);
    expect(run({ endpoint: "maker/rules", prompt: "x", video_urls: ["https://example.com/a.mp4"] })).toEqual([]);
  });

  test("sending several is fine: this is not JSON Schema's `oneOf`", () => {
    expect(run({ ...RULES, image_urls: ["https://example.com/b.png"] })).toEqual([]);
  });
});

describe("rules: when", () => {
  test("`absent: else` — an omitted `if` parameter is not held to `then`", () => {
    expect(run(RULES)).toEqual([]);
    expect(run({ ...RULES, enhance: false })).toEqual([]);
  });

  test("the `then` branch requires, bounds and enumerates", () => {
    const issues = run({ ...RULES, enhance: true, image_urls: ["a", "b", "c"], quality: "low" });
    expect(issues.map((issue) => issue.message)).toEqual([
      "`preset_id` is required by maker/rules when `enhance` is true.",
      "`image_urls` accepts at most 2 entries on maker/rules when `enhance` is true; got 3.",
      '`quality` must be "high" on maker/rules when `enhance` is true; got "low".',
    ]);
  });

  test("a branch constraint applies only to a value that is PRESENT", () => {
    expect(run({ ...RULES, enhance: true, preset_id: "p" })).toEqual([]);
  });

  test("`absent: then` — an omitted `if` parameter IS held to `then`", () => {
    const issue = only(run({ ...RULES, pinned: "cat" }));
    expect(issue.message).toBe('`pinned` must be `null` or left out on maker/rules when `tier` is "normal"; got "cat".');
    expect(run({ ...RULES, pinned: null })).toEqual([]);
    expect(run({ ...RULES, tier: "insects", pinned: "ant" })).toEqual([]);
  });

  test("a branch reaches into a nested object", () => {
    const issue = only(run({ ...RULES, tier: "normal", traits: { animals: { cat: 1 } } }));
    expect(issue.path).toEqual(["traits", "animals"]);
    expect(run({ ...RULES, tier: "normal", traits: null })).toEqual([]);
  });

  test("`absent: either` — an omitted `if` parameter is refused only when it satisfies NEITHER branch", () => {
    const { prompt: _, ...bare } = RULES;
    expect(run(RULES)).toEqual([]);
    expect(run({ ...bare, multi_prompt: ["a", "b"] })).toEqual([]);
    const neither = only(run(bare));
    expect(neither).toMatchObject({ code: "invalid_shape", path: ["multi_prompt"] });
    expect(neither.message).toBe(
      "maker/rules omits `multi`, and the request satisfies neither branch its schema takes on that: " +
        "`multi_prompt` is required by maker/rules when `multi` is true; or `prompt` is required by maker/rules when `multi` is not true.",
    );
    expect(only(run({ ...RULES, multi: true })).message).toBe("`multi_prompt` is required by maker/rules when `multi` is true.");
    expect(only(run({ ...bare, multi: false })).message).toBe("`prompt` is required by maker/rules when `multi` is not true.");
  });

  test("a `then` can narrow a vocabulary, and a requirement its published default satisfies is a warning", () => {
    const omitted = only(run({ ...RULES, dynamic_range: "hdr" }));
    expect(omitted).toMatchObject({ severity: "warning", code: "invalid_shape", path: ["resolution"] });
    expect(omitted.message).toBe(
      "maker/rules's schema requires `resolution` when `dynamic_range` is \"hdr\", and the request omits it. Its published default, " +
        '"1080p", satisfies that requirement, so a server that fills defaults first fulfils this request; ' +
        "whether Higgsfield's does was not probed. It is sent as written — state the value to be safe.",
    );
    expect(omitted.meta?.["default"]).toBe("1080p");
    expect(only(run({ ...RULES, dynamic_range: "hdr", resolution: "720p" })).message).toBe(
      '`resolution` must be "1080p" or "4k" on maker/rules when `dynamic_range` is "hdr"; got "720p".',
    );
    expect(run({ ...RULES, dynamic_range: "sdr", resolution: "720p" })).toEqual([]);
  });
});

describe("rules: tokens", () => {
  test("a token that indexes an attached item is fine", () => {
    expect(run({ ...RULES, prompt: "<<<image_1>>> then <<<video_2>>>", image_urls: ["a"], video_urls: ["b", "c"] })).toEqual([]);
  });

  test("a token past the end of its array, or at zero, is an error", () => {
    const issue = only(run({ ...RULES, prompt: "use <<<image_2>>>", image_urls: ["a"] }));
    expect(issue).toMatchObject({
      severity: "error",
      path: ["prompt"],
      message:
        "`prompt` names <<<image_2>>>, and `image_urls` has 1 item on this request. Tokens are one-based on maker/rules and each must refer to an attached item of the same media type.",
    });
    expect(run({ ...RULES, prompt: "<<<image_0>>>", image_urls: ["a"] })).toHaveLength(1);
  });

  test("a token of a kind with nothing attached is an error; a token of an unknown kind is not this rule's", () => {
    expect(only(run({ ...RULES, prompt: "<<<audio_1>>>" })).meta?.["count"]).toBe(0);
    expect(run({ ...RULES, prompt: "<<<mesh_1>>>" })).toEqual([]);
  });
});

describe("hf_webhook", () => {
  function fault(hfWebhook: string): string | undefined {
    const issues = run({ ...OPEN, hf_webhook: hfWebhook });
    return issues[0]?.message;
  }

  test("a public https URL passes", () => {
    expect(run({ ...OPEN, hf_webhook: "https://hooks.example.com/higgsfield?token=1" })).toEqual([]);
  });

  test("each fault decidable from the string is an error quoting the rule", () => {
    expect(fault("not a url")).toStartWith("`hf_webhook` is not a URL. Higgsfield rejects the submit:");
    expect(fault("http://hooks.example.com/h")).toStartWith("`hf_webhook` must be an `https:` URL.");
    expect(fault("https://user:pass@hooks.example.com/h")).toStartWith("`hf_webhook` must not carry credentials.");
    for (const host of ["localhost", "127.0.0.1", "10.1.2.3", "192.168.0.4", "172.16.9.9", "169.254.1.1", "[::1]", "[fd00::1]", "[fe80::1]"]) {
      expect(fault(`https://${host}/h`)).toStartWith("`hf_webhook` must be a public address.");
    }
    expect(fault("https://172.32.0.1/h")).toBeUndefined();
    expect(fault("https://[2001:db8::1]/h")).toBeUndefined();
  });

  test("it is checked on a route this address does not serve too: the URL is built either way", () => {
    const issues = run({ endpoint: "maker/clip", hf_webhook: "http://example.com/h" });
    expect(issues.map((issue) => issue.severity)).toEqual(["error", "warning"]);
  });
});
