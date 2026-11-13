import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { image } from "./image";
import { music } from "./music";
import { tts } from "./tts";
import { video } from "./video";
import { REVANA_IMAGE_MODELS, REVANA_MUSIC_MODELS, REVANA_TTS_MODELS, REVANA_VIDEO_MODELS } from "./gen/ids.gen";
import type { ValidateResult } from "../../core/result";

/**
 * unmodel's validators, replayed against what the API itself answered.
 *
 * `test/fixtures/revana/quote-oracle.json` is 714 request bodies and the
 * verbatim answer `POST /v1/generations/quote` gave each one on 2026-11-12
 * (the fixture's README explains why a quote is a validation oracle). The
 * three promises this file holds the validators to are the three the provider
 * is built on:
 *
 * 1. **Never refuse what the API accepts** — the one failure this library
 *    must not have.
 * 2. **Refuse what the MODEL refuses** — every model-level sentence.
 * 3. **Never price above the quote** — the estimate is the listed price, a
 *    lower bound.
 *
 * A route-level refusal ("No route for … can take this input") is asserted
 * nowhere: it is a fact about that day's routes, and not turning it into an
 * error is the design.
 *
 * When a catalog refresh fails a row here, the model changed. Re-ask the quote
 * endpoint and re-record the row; do not bend the expectation to the code.
 */

interface OracleRow {
  model: string;
  case: string;
  input: Record<string, unknown>;
  status: number;
  passes: boolean;
  level?: "model" | "route";
  message?: string;
  quoted_usd?: number;
}

const rows = JSON.parse(
  readFileSync(join(import.meta.dir, "../../../test/fixtures/revana/quote-oracle.json"), "utf8"),
) as OracleRow[];

type Loose = (params: unknown) => ValidateResult<Record<string, unknown>>;

function validatorFor(model: string): Loose {
  const has = (ids: readonly string[]): boolean => ids.includes(model);
  const validator = has(REVANA_VIDEO_MODELS)
    ? video
    : has(REVANA_IMAGE_MODELS)
      ? image
      : has(REVANA_TTS_MODELS)
        ? tts
        : has(REVANA_MUSIC_MODELS)
          ? music
          : undefined;
  if (validator === undefined) throw new Error(`"${model}" is no longer in the Revana catalog — re-record its rows`);
  return validator.safe as unknown as Loose;
}

const label = (row: OracleRow): string => `${row.model} [${row.case}] ${JSON.stringify(row.input).slice(0, 160)}`;

describe("the recorded quote oracle", () => {
  test("is the sample the README describes", () => {
    expect(rows.length).toBe(714);
    expect(new Set(rows.map((row) => row.model)).size).toBe(25);
    expect(rows.every((row) => row.status === 200 || row.status === 422)).toBe(true);
  });

  test("unmodel never refuses a body the API accepted", () => {
    const refused = rows
      .filter((row) => row.passes)
      .filter((row) => !validatorFor(row.model)({ model: row.model, input: row.input }).ok)
      .map(label);
    expect(refused).toEqual([]);
  });

  test("unmodel refuses every body the API refused at model level", () => {
    const accepted = rows
      .filter((row) => row.level === "model")
      .filter((row) => validatorFor(row.model)({ model: row.model, input: row.input }).ok)
      .map((row) => `${label(row)} — API: ${row.message}`);
    expect(accepted).toEqual([]);
  });

  test("a route-level `negative_prompt` refusal is a warning, never an error", () => {
    const routeRows = rows.filter(
      (row) => row.level === "route" && row.case === "negative" && row.message?.includes("cannot take negative_prompt"),
    );
    expect(routeRows.length).toBeGreaterThan(10);
    for (const row of routeRows) {
      const result = validatorFor(row.model)({ model: row.model, input: row.input });
      expect(result.ok).toBe(true);
      expect(result.warnings.map((w) => w.path.join("."))).toContain("input.negative_prompt");
    }
  });

  test("the estimate never exceeds the quote, and equals it wherever the listed price is the whole story", () => {
    const priced = rows.flatMap((row) => {
      if (row.quoted_usd === undefined) return [];
      const result = validatorFor(row.model)({ model: row.model, input: row.input });
      const cost = result.ok ? result.estimate.costUSD : undefined;
      return cost === undefined ? [] : [{ row, cost, quoted: row.quoted_usd }];
    });
    expect(priced.length).toBeGreaterThan(40);
    expect(priced.filter(({ cost, quoted }) => cost > quoted + 1e-9).map(({ row }) => label(row))).toEqual([]);

    // The one sampled request the listed price falls short of: Seedance 2.5
    // with sound, whose rate table has no audio key. "Some inputs cost more
    // than the listed per-second rate …, so quote the exact request."
    const below = priced.filter(({ cost, quoted }) => cost < quoted - 1e-9).map(({ row }) => `${row.model} [${row.case}]`);
    expect(below).toEqual(["seedance-2.5 [dur-30]"]);
  });
});
