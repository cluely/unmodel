/**
 * The golden matrix for `unmodel/video`: **one canonical request, compiled by
 * every provider that can express it**, with each provider's exact wire params
 * committed to disk.
 *
 * Each directory under `golden/video/` is one request. `canonical.json` holds
 * the words a caller writes; every other file is one provider's answer —
 * `{ ref, params, url, warnings?, issues? }`. A provider may appear twice in a
 * case under two file names (`kling.json` and `kling-v3.json`), which is how
 * the two Kling route families end up side by side in `duration-8s` with `"8"`
 * and `8` in the same directory.
 *
 * Four things are asserted, and the second is what earns the layout in *this*
 * category:
 *
 * 1. **The body is exact.** Deep equality against the committed JSON, not a
 *    subset match — a param that appears out of nowhere fails just as loudly as
 *    one that goes missing.
 * 2. **The route is exact.** `url` is committed too, because in this category
 *    the *inputs* pick the endpoint: adding `image` to a request moves it from
 *    `/v1/videos/text2video` to `/v1/videos/image2video`, and tagging that
 *    image `role: "reference"` moves it again. A body assertion alone would let
 *    a derivation quietly compile the right params for the wrong endpoint.
 * 3. **Lossless means lossless.** Every case that is not `lossy-*` must compile
 *    with `warnings.length === 0` at *every* provider in it. That is what makes
 *    "zero warnings means the request mapped exactly" an assertion rather than
 *    a slogan.
 * 4. **Lossy means exactly this much loss.** A `lossy-*` case commits every
 *    warning (code + path + meta), so a translation that starts approximating
 *    something new fails the build instead of quietly degrading.
 *
 * Errors are deliberately **not** here: a duration a model does not offer and a
 * tier it cannot render are refusals, and a fixture tree of refusals would pin
 * messages rather than translations. Those live in `video-e2e.test.ts`, where
 * the message *is* the subject.
 *
 * The cases are chosen so that every duration encoding and every route in the
 * category is covered by some fixture:
 *
 * | encoding | function | where |
 * |---|---|---|
 * | `8` | `toDurationNumber` | google, runway, vidu, bytedance, pixverse, minimax |
 * | `"8"` | `toDurationString` | openai (`seconds`), kling's `/v1/videos/*` family |
 * | `"5s"` | `toDurationSuffixedString` | luma |
 * | `settings.duration: 8` | `toDurationNumber`, nested | kling's path-addressed family |
 * | `null` | — (documented "automatic duration") | lightricks, in `lossy-required-fills` |
 *
 * | route | cases |
 * |---|---|
 * | text | `minimal-text`, `duration-*` |
 * | image | `image-to-video`, `image-1080p`, `first-last-frames`, `inline-bytes` |
 * | reference | `reference-to-video`, `auto-duration` |
 * | video | `video-to-video`, `auto-duration` |
 *
 * `auto-duration` is the one case whose canonical request carries a
 * `providerOptions` block, and it is the only honest way to pin what it pins.
 * Atlas Cloud's Seedance schemas declare `duration: -1` — "let the model choose
 * the length" — as an enum member, and the canonical `duration` cannot carry it:
 * `core/unified/derive.ts` defines the word as a *positive* number of seconds at
 * every provider, and a sentinel is not a duration. So the wire value is reached
 * through the escape hatch, the fixture commits it reaching the wire unchanged
 * beside `omni_reference_task_type: "edit"` (whose documented rules are exactly
 * "one reference video, an adaptive ratio, duration -1"), and the case names one
 * provider because the request is by construction about one provider's wire.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { video } from "../../src/unified/video";

const GOLDEN = join(import.meta.dir, "golden", "video");

interface ExpectedWarning {
  code: string;
  path: Array<string | number>;
  meta?: Record<string, unknown>;
}

interface Fixture {
  /** `"provider/model"`, the ref this fixture's request is pointed at. */
  ref: string;
  /** The exact enumerable wire body. */
  params: Record<string, unknown>;
  url: string;
  /** Translation warnings. Required on `lossy-*` cases, forbidden elsewhere. */
  warnings?: ExpectedWarning[];
  /** Issue-space warnings (`deprecated_model`, …) — a different channel. */
  issues?: Array<{ code: string; path: Array<string | number> }>;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

/** The three fields a warning is pinned on — the message is prose, not a contract. */
function comparable(warnings: readonly { code: string; path: unknown; meta?: unknown }[]) {
  return warnings.map((w) => ({ code: w.code, path: w.path, meta: w.meta }));
}

const caseDirs = readdirSync(GOLDEN, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

test("the video golden tree is present", () => {
  // A vacuous suite passes by asserting nothing; this is the guard against it.
  expect(caseDirs.length).toBeGreaterThanOrEqual(10);
});

describe.each(caseDirs)("golden video/%s", (name) => {
  const dir = join(GOLDEN, name);
  const canonical = readJson<Record<string, unknown>>(join(dir, "canonical.json"));
  const files = readdirSync(dir)
    .filter((file) => file.endsWith(".json") && file !== "canonical.json")
    .sort();
  const lossy = name.startsWith("lossy-");

  test("the case names at least one provider", () => {
    expect(files.length).toBeGreaterThanOrEqual(1);
  });

  describe.each(files)("%s", (file) => {
    const fixture = readJson<Fixture>(join(dir, file));
    const request = { ...canonical, model: fixture.ref };

    test("compiles to the committed wire body and route", () => {
      const result = video.safe(request as never);
      expect(result.ok, JSON.stringify(result.ok ? [] : result.errors)).toBe(true);
      if (!result.ok) return;

      const params = result.params as unknown as { request: { url: string } };
      // JSON round-trip: the enumerable properties ARE the fetch body, which is
      // the property being asserted, so compare what `JSON.stringify` sees.
      expect(JSON.parse(JSON.stringify(result.params))).toEqual(fixture.params);
      expect(params.request.url).toBe(fixture.url);
    });

    test(lossy ? "reports exactly the committed warnings" : "maps exactly (no warnings)", () => {
      const result = video.safe(request as never);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const warnings = (result.params as unknown as { warnings: readonly ExpectedWarning[] })
        .warnings;
      expect(comparable(warnings)).toEqual(comparable(fixture.warnings ?? []));
      if (!lossy) expect(warnings).toEqual([]);
      // Issue-space warnings are a separate channel with a separate meaning;
      // pinned, so a new one cannot arrive unnoticed and a retired model
      // cannot quietly stop being announced as one.
      expect(
        result.warnings.map((issue) => ({ code: String(issue.code), path: issue.path })),
      ).toEqual(fixture.issues ?? []);
    });
  });
});

describe("the matrix itself", () => {
  /** Every fixture in the tree, with the case it belongs to. */
  const all = caseDirs.flatMap((name) =>
    readdirSync(join(GOLDEN, name))
      .filter((file) => file.endsWith(".json") && file !== "canonical.json")
      .map((file) => ({ name, fixture: readJson<Fixture>(join(GOLDEN, name, file)) })),
  );

  test("every provider in the pack appears in at least three cases", () => {
    const cases = new Map<string, Set<string>>();
    for (const { name, fixture } of all) {
      const provider = fixture.ref.slice(0, fixture.ref.indexOf("/"));
      const seen = cases.get(provider) ?? new Set<string>();
      seen.add(name);
      cases.set(provider, seen);
    }
    const thin = [...cases.entries()]
      .filter(([, seen]) => seen.size < 3)
      .map(([provider]) => provider);
    expect(thin).toEqual([]);
    expect([...cases.keys()].sort()).toEqual([...video.providers]);
  });

  test("a lossy case is lossy somewhere, and a lossless one is committed lossless", () => {
    for (const name of caseDirs) {
      const fixtures = all.filter((entry) => entry.name === name).map((entry) => entry.fixture);
      const warnings = fixtures.flatMap((fixture) => fixture.warnings ?? []);
      if (name.startsWith("lossy-")) expect(warnings.length).toBeGreaterThan(0);
      else expect(fixtures.every((fixture) => fixture.warnings === undefined)).toBe(true);
    }
  });

  /**
   * All five duration encodings, read off the committed bodies.
   *
   * This is the assertion the category's whole "duration is a plain number"
   * decision rests on: the same `duration: 8` reaches five different wire
   * shapes, and if one of them silently became another, the caller's clip
   * would change length at exactly one provider.
   */
  test("every duration encoding is committed somewhere", () => {
    const seen = new Set<string>();
    for (const { fixture } of all) {
      const body = fixture.params;
      const settings = body["settings"] as { duration?: unknown } | undefined;
      // `in` rather than `??`: lightricks' documented "automatic duration" IS
      // `null`, and a nullish check would read it as an absent field.
      const duration =
        "duration" in body ? body["duration"] : "seconds" in body ? body["seconds"] : settings?.duration;
      if (duration === undefined) continue;
      if (duration === null) seen.add("null");
      else if (typeof duration === "number") seen.add(settings?.duration === undefined ? "number" : "nested-number");
      else if (typeof duration === "string") seen.add(duration.endsWith("s") ? "suffixed" : "string");
    }
    expect([...seen].sort()).toEqual(["nested-number", "null", "number", "string", "suffixed"]);
  });

  /**
   * The routes, not just the bodies. In this category the *inputs* choose the
   * endpoint, so the URL set the tree reaches is pinned as a set — a
   * derivation that started sending image-to-video bodies to the text route
   * would otherwise produce plausible params at a plausible URL.
   */
  test("the multi-route providers reach every route they dispatch to", () => {
    const urls = new Map<string, Set<string>>();
    for (const { fixture } of all) {
      const provider = fixture.ref.slice(0, fixture.ref.indexOf("/"));
      const seen = urls.get(provider) ?? new Set<string>();
      seen.add(fixture.url);
      urls.set(provider, seen);
    }
    // vidu: three endpoints, one per route the inputs derive.
    expect([...(urls.get("vidu") ?? [])].sort()).toEqual([
      "https://api.vidu.com/ent/v2/img2video",
      "https://api.vidu.com/ent/v2/reference2video",
      "https://api.vidu.com/ent/v2/text2video",
    ]);
    // runway: the same three, plus the reference case, which rides on the text
    // route rather than a fourth endpoint.
    expect([...(urls.get("runway") ?? [])].sort()).toEqual([
      "https://api.dev.runwayml.com/v1/image_to_video",
      "https://api.dev.runwayml.com/v1/text_to_video",
      "https://api.dev.runwayml.com/v1/video_to_video",
    ]);
    // kling: both route families, and the omni route the model id selects.
    expect([...(urls.get("kling") ?? [])].sort()).toEqual([
      "https://api-singapore.klingai.com/omni-video/kling-3.0-omni",
      "https://api-singapore.klingai.com/text-to-video/kling-3.0",
      "https://api-singapore.klingai.com/v1/videos/image2video",
      "https://api-singapore.klingai.com/v1/videos/text2video",
    ]);
  });
});
