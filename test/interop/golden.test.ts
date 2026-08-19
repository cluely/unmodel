/**
 * The golden dialect-pair suite — the core translator test.
 *
 * Each directory under `golden/` is **one semantic request, hand-written in
 * every dialect that can express it** (`<dialect-id>.json`). Four things are
 * asserted from that, and the first is the one that earns the layout:
 *
 * 1. **IR convergence** — `encodeX(x)` deep-equals `encodeY(y)` for every pair
 *    present. This is the real equivalence assertion. A one-way
 *    `decode(encode())` comparison hides asymmetric bugs (an encoder that
 *    loses a field and a decoder that invents the same field cancel out);
 *    convergence does not.
 * 2. **One-way equivalence** — `decodeY(encodeX(x))` deep-equals `y` for every
 *    ordered pair, by exact deep equality, not subset matching.
 * 3. **Warnings are exhaustive.** A `lossy-*` case commits its expected
 *    warnings (code + path + meta) in `to-<dialect>.json`; a translation that
 *    starts dropping something new fails the build instead of silently
 *    degrading. That is the enforcement mechanism for the "never silently
 *    drops" contract in `core/translate/warnings.ts`.
 * 4. **Lossless means lossless.** Every non-`lossy-*` case must translate with
 *    `warnings.length === 0` in *every* direction, which is what makes
 *    `warnings.length === 0` meaningful as an assertion elsewhere.
 *
 * Plus the two round-trip properties from the design: `decodeD(encodeD(x))`
 * equals `x` (idempotence within a dialect is a necessary condition for
 * correctness across dialects, and catches roughly half of encoder bugs on its
 * own), and `encodeD(decodeD(encodeD(x)))` equals `encodeD(x)` (stability
 * under a second pass, which is what catches synthesized-id churn on the
 * Gemini path).
 *
 * **What convergence deliberately ignores:** `source` (which dialect wrote the
 * IR), `passthrough` (dialect-owned params, by definition not shared),
 * `model` (ids are not normalized across providers — that is the whole reason
 * the availability tables exist) and `settings.temperatureMax` (a property of
 * the source dialect's scale, not of the request).
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { ChatIR, DecodeContext } from "../../src/core/translate/ir";
import type { DialectId } from "../../src/core/translate/endpoints";
import type { TranslationWarning, Warn } from "../../src/core/translate/warnings";
import { createWarningSink } from "../../src/core/translate/warnings";
import { encodeAnthropic, decodeAnthropic } from "../../src/providers/anthropic/interop";
import { encodeGemini, decodeGemini } from "../../src/providers/google/interop";
import {
  encodeOpenAIChat,
  decodeOpenAIChat,
} from "../../src/providers/openai-compatible/interop";

const GOLDEN = join(import.meta.dir, "golden");

interface Codec {
  encode: (body: never, warn: Warn) => ChatIR;
  decode: (ir: ChatIR, warn: Warn, ctx?: DecodeContext) => object;
  /** Gemini keeps the model id in the URL path, so its wire body has none. */
  bodyCarriesModel: boolean;
}

const CODECS: Readonly<Record<string, Codec>> = {
  "anthropic-messages": {
    encode: encodeAnthropic as Codec["encode"],
    decode: decodeAnthropic as Codec["decode"],
    bodyCarriesModel: true,
  },
  "openai-chat": {
    encode: encodeOpenAIChat as Codec["encode"],
    decode: decodeOpenAIChat as Codec["decode"],
    bodyCarriesModel: true,
  },
  gemini: {
    encode: encodeGemini as Codec["encode"],
    decode: decodeGemini as Codec["decode"],
    bodyCarriesModel: false,
  },
};

const DIALECTS = Object.keys(CODECS) as DialectId[];

type Body = Record<string, unknown>;

function readJson(path: string): Body {
  return JSON.parse(readFileSync(path, "utf8")) as Body;
}

/** Runs one codec call with a fresh sink, returning both halves. */
function run<T>(fn: (warn: Warn) => T): { value: T; warnings: TranslationWarning[] } {
  const sink = createWarningSink("golden", "golden");
  return { value: fn(sink.warn), warnings: sink.warnings };
}

/** The comparable core of an IR — see the header for what is ignored and why. */
function convergent(ir: ChatIR): unknown {
  const { source: _source, passthrough: _passthrough, model: _model, settings, ...rest } = ir;
  const { temperatureMax: _max, ...comparableSettings } = settings;
  return { ...rest, settings: comparableSettings };
}

/** `{code, path, meta}` sorted stably, which is what the fixtures commit. */
function comparableWarnings(warnings: readonly TranslationWarning[]): unknown[] {
  return warnings
    .map((w) => ({ code: w.code, path: w.path, ...(w.meta !== undefined && { meta: w.meta }) }))
    .sort((a, b) => `${a.code}|${a.path.join(".")}`.localeCompare(`${b.code}|${b.path.join(".")}`));
}

function expectedFor(fixture: { warnings?: unknown[] }): unknown[] {
  return [...(fixture.warnings ?? [])].sort((a, b) => {
    const key = (w: unknown): string => {
      const { code, path } = w as { code: string; path: Array<string | number> };
      return `${code}|${path.join(".")}`;
    };
    return key(a).localeCompare(key(b));
  });
}

/** Every fixture body minus the model id, for comparing a decode's output. */
function expectedBody(body: Body, dialect: string): Body {
  if (CODECS[dialect]?.bodyCarriesModel === true) return body;
  const { model: _model, ...rest } = body;
  return rest;
}

const caseDirs = readdirSync(GOLDEN, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

// A vacuous suite is worse than no suite: if the fixture tree ever goes
// missing, this fails rather than silently passing zero assertions.
test("the golden fixture tree is present", () => {
  expect(caseDirs.length).toBeGreaterThanOrEqual(8);
});

describe.each(caseDirs.filter((name) => !name.startsWith("lossy-")))("golden %s", (name) => {
  const dir = join(GOLDEN, name);
  const present = DIALECTS.filter((dialect) =>
    readdirSync(dir).includes(`${dialect}.json`),
  );
  const bodies = new Map<DialectId, Body>(
    present.map((dialect) => [dialect, readJson(join(dir, `${dialect}.json`))]),
  );

  test("the case covers at least two dialects", () => {
    expect(present.length).toBeGreaterThanOrEqual(2);
  });

  test("every encode is warning-free", () => {
    for (const dialect of present) {
      const { warnings } = run((warn) =>
        (CODECS[dialect] as Codec).encode(bodies.get(dialect) as never, warn),
      );
      expect(comparableWarnings(warnings), `encode ${dialect}`).toEqual([]);
    }
  });

  test("IR convergence: every dialect encodes to the same request", () => {
    const [first, ...others] = present;
    const reference = run((warn) =>
      (CODECS[first as DialectId] as Codec).encode(bodies.get(first as DialectId) as never, warn),
    ).value;
    for (const dialect of others) {
      const ir = run((warn) =>
        (CODECS[dialect] as Codec).encode(bodies.get(dialect) as never, warn),
      ).value;
      expect(convergent(ir), `${dialect} vs ${first}`).toEqual(convergent(reference));
    }
  });

  test("one-way equivalence: decodeY(encodeX(x)) === y, losslessly, for every ordered pair", () => {
    for (const from of present) {
      for (const to of present) {
        if (from === to) continue;
        const target = bodies.get(to) as Body;
        const encoded = run((warn) =>
          (CODECS[from] as Codec).encode(bodies.get(from) as never, warn),
        );
        const decoded = run((warn) =>
          (CODECS[to] as Codec).decode(encoded.value, warn, {
            targetModelId: target["model"] as string,
          }),
        );
        expect(decoded.value, `${from} → ${to}`).toEqual(expectedBody(target, to));
        expect(
          comparableWarnings([...encoded.warnings, ...decoded.warnings]),
          `${from} → ${to} must be lossless`,
        ).toEqual([]);
      }
    }
  });

  test("round-trip: decodeD(encodeD(x)) === x", () => {
    for (const dialect of present) {
      const body = bodies.get(dialect) as Body;
      const encoded = run((warn) => (CODECS[dialect] as Codec).encode(body as never, warn));
      const decoded = run((warn) =>
        (CODECS[dialect] as Codec).decode(encoded.value, warn, {
          targetModelId: body["model"] as string,
        }),
      );
      expect(decoded.value, `${dialect} round-trip`).toEqual(expectedBody(body, dialect));
      expect(comparableWarnings(decoded.warnings), `${dialect} round-trip`).toEqual([]);
    }
  });

  test("stability: encodeD(decodeD(encodeD(x))) === encodeD(x)", () => {
    for (const dialect of present) {
      const body = bodies.get(dialect) as Body;
      const once = run((warn) => (CODECS[dialect] as Codec).encode(body as never, warn)).value;
      const back = run((warn) =>
        (CODECS[dialect] as Codec).decode(once, warn, { targetModelId: body["model"] as string }),
      ).value;
      const twice = run((warn) =>
        (CODECS[dialect] as Codec).encode(
          // Gemini's decode drops `model` (it lives in the URL); put the id
          // back so the second encode sees the same request.
          { ...(back as Body), model: body["model"] } as never,
          warn,
        ),
      ).value;
      expect(twice, `${dialect} second pass`).toEqual(once);
    }
  });
});

describe.each(caseDirs.filter((name) => name.startsWith("lossy-")))("golden %s", (name) => {
  const dir = join(GOLDEN, name);
  const files = readdirSync(dir);
  const source = DIALECTS.find((dialect) => files.includes(`${dialect}.json`)) as DialectId;
  const targets = files
    .filter((file) => file.startsWith("to-"))
    .map((file) => file.slice("to-".length, -".json".length) as DialectId);

  test("the case has one source dialect and at least one target", () => {
    expect(source).toBeDefined();
    expect(targets.length).toBeGreaterThanOrEqual(1);
  });

  test.each(targets)("%s: body and warnings are exactly as committed", (target) => {
    const body = readJson(join(dir, `${source}.json`));
    const fixture = readJson(join(dir, `to-${target}.json`)) as {
      body: Body;
      warnings?: unknown[];
    };
    const encoded = run((warn) => (CODECS[source] as Codec).encode(body as never, warn));
    const decoded = run((warn) =>
      (CODECS[target] as Codec).decode(encoded.value, warn, {
        targetModelId: fixture.body["model"] as string,
      }),
    );

    expect(decoded.value).toEqual(expectedBody(fixture.body, target));
    expect(comparableWarnings([...encoded.warnings, ...decoded.warnings])).toEqual(
      expectedFor(fixture),
    );
    // Every warning must actually say something; the codes and paths are
    // asserted exhaustively above, the prose is asserted to exist (comparing
    // it byte-for-byte would make every wording fix a fixture churn).
    for (const warning of [...encoded.warnings, ...decoded.warnings]) {
      expect(warning.message.length).toBeGreaterThan(20);
    }
  });
});
