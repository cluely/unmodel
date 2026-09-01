/**
 * The golden matrix for `unmodel/sfx`: one canonical request, compiled by each
 * ref, with the exact wire params committed to disk.
 *
 * The tree exists to pin one comparison above all others. `plain` compiles the
 * SAME MODEL two ways — ElevenLabs' own `/v1/sound-generation` and fal's resale
 * of it — and the two committed bodies are different objects at different URLs:
 * fal renames `text`'s cap, drops `model_id` because the endpoint IS the model,
 * and moves `output_format` from the query string into the body. That
 * difference is the category's argument, made in fixtures rather than in prose.
 *
 * **Two `lossy-` cases**, which is one more than most categories have and the
 * reason this one has a per-model duration row at all:
 *
 * - `lossy-provider-default-duration` — the caller stated no length, so Sonilo
 *   will generate 8 seconds and Stable Audio 30. Nothing goes on the wire and
 *   the warning names the number. This is the case the whole vocabulary
 *   argument turns on: absence means the PROVIDER's default, never `"auto"`.
 * - `lossy-invented-sample-rate` — a bitrate without a rate, at a provider
 *   whose format field is a COMPOSITE that has to state both. The fal fixture
 *   in the same case is clean, because Stable Audio publishes the bitrate as
 *   its own field and has no rate to invent.
 *
 * Four assertions per fixture otherwise, as in every other golden tree: the
 * body is exact, the transport is exact, a non-`lossy-` case compiles with zero
 * warnings, and a `lossy-` case commits every warning it produces.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { sfx } from "../../src/unified/sfx";

const GOLDEN = join(import.meta.dir, "golden", "sfx");

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
  headers: Record<string, string>;
  /** Required on `lossy-*` cases, forbidden elsewhere. */
  warnings?: ExpectedWarning[];
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

test("the sfx golden tree is present", () => {
  // A vacuous suite passes by asserting nothing; this is the guard against it.
  expect(caseDirs.length).toBeGreaterThanOrEqual(5);
});

describe.each(caseDirs)("golden sfx/%s", (name) => {
  const dir = join(GOLDEN, name);
  const canonical = readJson<Record<string, unknown>>(join(dir, "canonical.json"));
  const files = readdirSync(dir)
    .filter((file) => file.endsWith(".json") && file !== "canonical.json")
    .sort();
  const lossy = name.startsWith("lossy-");

  test("the case names at least one ref", () => {
    expect(files.length).toBeGreaterThanOrEqual(1);
  });

  describe.each(files)("%s", (file) => {
    const fixture = readJson<Fixture>(join(dir, file));
    const request = { ...canonical, model: fixture.ref };

    test("compiles to the committed wire body, url and headers", () => {
      const result = sfx.safe(request as never);
      expect(result.ok, JSON.stringify(result.ok ? [] : result.errors)).toBe(true);
      if (!result.ok) return;
      const params = result.params as unknown as {
        request: { url: string; headers: Record<string, string> };
      };
      // JSON round-trip: the enumerable properties ARE the body, which is the
      // property being asserted, so compare what `JSON.stringify` sees.
      expect(JSON.parse(JSON.stringify(result.params))).toEqual(fixture.params);
      expect(params.request.url).toBe(fixture.url);
      expect(params.request.headers).toEqual(fixture.headers);
    });

    test(lossy ? "reports exactly the committed warnings" : "maps exactly (no warnings)", () => {
      const result = sfx.safe(request as never);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const warnings = (result.params as unknown as { warnings: readonly ExpectedWarning[] })
        .warnings;
      expect(comparable(warnings)).toEqual(comparable(fixture.warnings ?? []));
      if (!lossy) expect(warnings).toEqual([]);
      // A golden request names a real model, so the issue channel is empty.
      expect(result.warnings).toEqual([]);
    });

    test("the route selector never reaches the wire, whichever kind of route it is", () => {
      // At fal the selector is unmodel's own `endpoint` pseudo-param and must
      // be stripped; at ElevenLabs the route is a fixed URL and `model_id` is a
      // real body field that must SURVIVE.
      expect(Object.keys(fixture.params)).not.toContain("endpoint");
      if (fixture.ref.startsWith("fal/")) {
        expect(fixture.url).toBe(`https://queue.fal.run/${fixture.ref.slice("fal/".length)}`);
        expect(Object.keys(fixture.params)).not.toContain("model_id");
      } else {
        expect(fixture.url.startsWith("https://api.elevenlabs.io/v1/sound-generation")).toBe(true);
        expect(fixture.params["model_id"]).toBe(fixture.ref.slice(fixture.ref.indexOf("/") + 1));
      }
    });
  });
});

describe("the matrix itself", () => {
  const all = caseDirs.flatMap((name) =>
    readdirSync(join(GOLDEN, name))
      .filter((file) => file.endsWith(".json") && file !== "canonical.json")
      .map((file) => ({ name, fixture: readJson<Fixture>(join(GOLDEN, name, file)) })),
  );

  test("every provider in the pack appears in at least two cases", () => {
    const cases = new Map<string, Set<string>>();
    for (const { name, fixture } of all) {
      const provider = fixture.ref.slice(0, fixture.ref.indexOf("/"));
      const seen = cases.get(provider) ?? new Set<string>();
      seen.add(name);
      cases.set(provider, seen);
    }
    const thin = [...cases.entries()]
      .filter(([, seen]) => seen.size < 2)
      .map(([provider]) => provider);
    expect(thin).toEqual([]);
    expect([...cases.keys()].sort()).toEqual([...sfx.providers]);
  });

  test("all six fal endpoints and both vendors' spellings are exercised", () => {
    const refs = new Set(all.map((c) => c.fixture.ref));
    expect(refs.size).toBeGreaterThanOrEqual(7);
    // Three prompt spellings, compiled somewhere.
    const bodies = all.map((c) => c.fixture.params);
    expect(bodies.some((b) => typeof b["prompt"] === "string")).toBe(true);
    expect(bodies.some((b) => typeof b["text"] === "string")).toBe(true);
    expect(bodies.some((b) => typeof b["text_prompt"] === "string")).toBe(true);
    // Three encoding spellings, likewise.
    expect(bodies.some((b) => typeof b["output_format"] === "string")).toBe(true);
    expect(bodies.some((b) => typeof b["audio_format"] === "string")).toBe(true);
    expect(bodies.some((b) => typeof b["upload_audio_format"] === "string")).toBe(true);
    // …and Stable Audio's separate kbps-suffixed bitrate STRING.
    expect(bodies.some((b) => b["bitrate"] === "192k")).toBe(true);
  });

  /**
   * The assertion this tree exists for, and the one a "every provider is
   * covered" check cannot make: the SAME MODEL, compiled two ways, producing
   * two different bodies at two different hosts. If the two adapters ever
   * converged, this is where it would show.
   */
  test("the same ElevenLabs model compiles differently through each provider", () => {
    const native = all.find(
      (c) => c.name === "plain" && c.fixture.ref === "elevenlabs/eleven_text_to_sound_v2",
    );
    const viaFal = all.find(
      (c) => c.name === "plain" && c.fixture.ref === "fal/fal-ai/elevenlabs/sound-effects/v2",
    );
    expect(native).toBeDefined();
    expect(viaFal).toBeDefined();
    expect(native?.fixture.params).not.toEqual(viaFal?.fixture.params);
    // Native carries the model field; fal's route IS the model.
    expect(native?.fixture.params["model_id"]).toBe("eleven_text_to_sound_v2");
    expect(Object.keys(viaFal?.fixture.params ?? {})).not.toContain("model_id");
  });

  /**
   * The lossy tree's own invariant. `lossy-provider-default-duration` must
   * carry the number the provider will pick, and it must NOT put that number on
   * the wire — sending it explicitly would pin a value fal's page is free to
   * change.
   */
  test("a defaulted duration is warned about and never sent", () => {
    const defaulted = all.filter((c) => c.name === "lossy-provider-default-duration");
    expect(defaulted.length).toBeGreaterThanOrEqual(2);
    for (const { fixture } of defaulted) {
      const warning = fixture.warnings?.find((w) => w.path[0] === "durationSeconds");
      expect(warning?.code, fixture.ref).toBe("approximated_param");
      expect(typeof warning?.meta?.["achieved"], fixture.ref).toBe("number");
      expect(Object.keys(fixture.params), fixture.ref).not.toContain("duration");
      expect(Object.keys(fixture.params), fixture.ref).not.toContain("duration_seconds");
    }
    const achieved = defaulted
      .map((c) => c.fixture.warnings?.[0]?.meta?.["achieved"] as number)
      .sort((a, b) => a - b);
    expect(achieved).toEqual([8, 30]);
  });
});
