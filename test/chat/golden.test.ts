/**
 * The unified-vocabulary golden suite — the strongest assertion available for
 * `unmodel/chat`.
 *
 * `test/interop/golden.test.ts` already pins each `golden/<case>/` directory as
 * **one semantic request written in every dialect that can express it**, and
 * proves those hand-written bodies all encode to the *same* `ChatIR`. This
 * suite adds a `unified.json` to each case — the same request a thirteenth
 * time, in the standardized vocabulary — and asserts it lands on that same IR.
 *
 * Why that is the right test and not a decode comparison: the unified encoder
 * has no wire format of its own to check against, so "did it produce the right
 * body?" can only be answered relative to the dialect encoders. Convergence
 * answers it *without* running a decoder, which means a bug in the unified
 * encoder cannot be cancelled out by a compensating decoder bug — the failure
 * mode a one-way `decode(encode())` check is blind to.
 *
 * Three properties, in order of strength:
 *
 * 1. **IR convergence.** `encodeUnified(u, D)` deep-equals `encodeD(bodyD)` for
 *    every dialect fixture the case carries, under the same projection the
 *    dialect-pair suite uses (`test/interop/ir-compare.ts`). Since that suite
 *    already proves every `bodyD` converges with every other, this transitively
 *    puts the unified request on the same point for all of them.
 * 2. **Encode warnings are exhaustive.** `encodeUnified` is lossy only where a
 *    dialect's reasoning vocabulary is narrower than the unified one, or a
 *    `providerOptions` bucket is addressed to nobody. Every case commits its
 *    expected encode warnings in `unified-warnings.json` (keyed by target
 *    dialect); an absent file means "warning-free for every target", which is
 *    the assertion that makes `warnings.length === 0` meaningful.
 * 3. **Round-trip.** For every dialect fixture present, `decodeD(encodeUnified(
 *    u, D))` must be lossless (zero warnings), and re-encoding the body it
 *    produces must land back on the same IR. That is what proves the compiled
 *    body is a *complete* rendering of the unified request rather than one that
 *    merely happens to be accepted.
 *
 * **What is deliberately not asserted here:** that the full pipeline reproduces
 * a `to-<dialect>.json` fixture byte for byte. Those fixtures commit the cost
 * of a *dialect-to-dialect* crossing, and some of that cost is a source-dialect
 * artefact the unified vocabulary simply does not have — Gemini's synthesized
 * tool-call ids, or an Anthropic-only `container` param that, addressed through
 * `providerOptions`, is inert for a non-Anthropic target instead of dropped.
 * Asserting equality there would mean encoding those artefacts into the unified
 * fixtures, which is exactly backwards.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { ChatIR, DecodeContext } from "../../src/core/translate/ir";
import type { DialectId } from "../../src/core/translate/endpoints";
import type { TranslationWarning, Warn } from "../../src/core/translate/warnings";
import { createWarningSink } from "../../src/core/translate/warnings";
import { encodeAnthropic, decodeAnthropic } from "../../src/providers/anthropic/interop";
import { encodeGemini, decodeGemini } from "../../src/providers/google/interop";
import { encodeOpenAIChat, decodeOpenAIChat } from "../../src/providers/openai-compatible/interop";
import { comparableWarnings, convergent, sortedExpectedWarnings } from "../interop/ir-compare";
import { encodeUnified } from "../../src/chat/encode";
import type { ChatParams } from "../../src/chat/types";

const GOLDEN = join(import.meta.dir, "..", "interop", "golden");

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

function run<T>(fn: (warn: Warn) => T): { value: T; warnings: TranslationWarning[] } {
  const sink = createWarningSink("unmodel/chat", "golden");
  return { value: fn(sink.warn), warnings: sink.warnings };
}

const caseDirs = readdirSync(GOLDEN, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

// A vacuous suite is worse than no suite: every golden case must carry a
// unified rendering, or a new dialect-pair case silently escapes this layer.
test("every golden case has a unified rendering", () => {
  const missing = caseDirs.filter((name) => !existsSync(join(GOLDEN, name, "unified.json")));
  expect(missing).toEqual([]);
  expect(caseDirs.length).toBeGreaterThanOrEqual(12);
});

describe.each(caseDirs)("unified %s", (name) => {
  const dir = join(GOLDEN, name);
  const files = readdirSync(dir);
  const params = readJson(join(dir, "unified.json")) as unknown as ChatParams;
  /** The dialects this case is hand-written in — `<dialect>.json`, not `to-*`. */
  const present = DIALECTS.filter((dialect) => files.includes(`${dialect}.json`));
  const expectedWarnings = files.includes("unified-warnings.json")
    ? (readJson(join(dir, "unified-warnings.json")) as Record<string, unknown[] | undefined>)
    : {};

  test("the case is written in at least one dialect", () => {
    expect(present.length).toBeGreaterThanOrEqual(1);
  });

  test("IR convergence: the unified request encodes to the dialect fixtures' IR", () => {
    for (const dialect of present) {
      const dialectIR = run((warn) =>
        (CODECS[dialect] as Codec).encode(readJson(join(dir, `${dialect}.json`)) as never, warn),
      ).value;
      const unifiedIR = run((warn) => encodeUnified(params, dialect, warn)).value;
      expect(convergent(unifiedIR), `unified vs ${dialect}`).toEqual(convergent(dialectIR));
    }
  });

  test("encode warnings are exactly as committed, for every target dialect", () => {
    for (const dialect of DIALECTS) {
      const { warnings } = run((warn) => encodeUnified(params, dialect, warn));
      expect(comparableWarnings(warnings), `encodeUnified → ${dialect}`).toEqual(
        sortedExpectedWarnings(expectedWarnings[dialect] ?? []),
      );
      for (const warning of warnings) expect(warning.message.length).toBeGreaterThan(20);
    }
  });

  test("round-trip: decodeD(encodeUnified(u, D)) is lossless and re-encodes to the same IR", () => {
    for (const dialect of present) {
      const codec = CODECS[dialect] as Codec;
      const body = readJson(join(dir, `${dialect}.json`));
      const once = run((warn) => encodeUnified(params, dialect, warn)).value;
      const decoded = run((warn) =>
        codec.decode(once, warn, { targetModelId: body["model"] as string }),
      );
      expect(comparableWarnings(decoded.warnings), `${dialect} decode must be lossless`).toEqual([]);
      const twice = run((warn) =>
        codec.encode(
          // Gemini's body carries no `model` (it lives in the URL path); put
          // the id back so the second encode sees the same request.
          (codec.bodyCarriesModel
            ? decoded.value
            : { ...(decoded.value as Body), model: body["model"] }) as never,
          warn,
        ),
      ).value;
      expect(convergent(twice), `${dialect} round-trip`).toEqual(convergent(once));
    }
  });
});
