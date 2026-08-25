import { describe, expect, test } from "bun:test";
import {
  music,
  instrumental,
  songQueryUrl,
  instrumentalQueryUrl,
  SONG_GENERATE_URL,
  INSTRUMENTAL_GENERATE_URL,
  LYRICS_MAX_CHARACTERS,
  PROMPT_MAX_CHARACTERS,
} from "./music";
import { models, MUREKA_SONG_MODEL_IDS, MUREKA_INSTRUMENTAL_MODEL_IDS } from "./models";
import { music as musicAdapter } from "./unified";
import { UnmodelValidationError } from "../../core/issues";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";
import type { CompileContext } from "../../core/unified/types";
import type { MusicParams } from "../../core/unified/vocabulary/music";

const safeSongUnchecked = music.safe as unknown as (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;

const safeInstrumentalUnchecked = instrumental.safe as unknown as (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;

const LYRICS = "[Verse]\nIn the stormy night, I wander alone";

describe("mureka.music happy path (POST /v1/song/generate)", () => {
  test("returns a wire-pure body with url/method/headers and identity toSdk", () => {
    const params = {
      lyrics: LYRICS,
      model: "auto" as const,
      prompt: "r&b, slow, passionate, male vocal",
      n: 1,
    };
    const v = music(params);

    expect(Object.keys(v)).toEqual(["lyrics", "model", "prompt", "n"]);
    expect(JSON.parse(JSON.stringify(v))).toEqual(params);
    expect(v.request.url).toBe(SONG_GENERATE_URL);
    expect(v.request.method).toBe("POST");
    expect(v.request.headers["content-type"]).toBe("application/json");
    // No first-party SDK — the docs' code samples are cURL on the raw body.
    expect(v.toSdk("mureka")).toEqual(params);
  });

  test("every documented model id passes clean with lyrics only", () => {
    for (const model of MUREKA_SONG_MODEL_IDS) {
      const r = music.safe({ lyrics: LYRICS, model });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.warnings).toEqual([]);
    }
  });

  test("all documented optional fields pass (documented combo prompt + vocal_id)", () => {
    const r = music.safe({
      lyrics: LYRICS,
      model: "mureka-9.5",
      n: 3,
      prompt: "dream pop, airy",
      gender: "female",
      vocal_id: "vocal_123",
      stream: true,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  test("reference_id + vocal_id is a documented combination — clean", () => {
    const r = music.safe({
      lyrics: LYRICS,
      model: "mureka-9",
      reference_id: "ref_1",
      vocal_id: "vocal_1",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  test("unknown model warns (may be a new release)", () => {
    const r = music.safe({ lyrics: LYRICS, model: "mureka-10" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
  });

  test("unknown top-level key warns", () => {
    const r = safeSongUnchecked({ lyrics: LYRICS, model: "auto", temperature: 1 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toContain("unknown_param");
  });
});

describe("mureka.music schema enforcement", () => {
  test("lyrics is required and non-empty", () => {
    expect(safeSongUnchecked({ model: "auto" }).ok).toBe(false);
    expect(safeSongUnchecked({ lyrics: "", model: "auto" }).ok).toBe(false);
  });

  test("model is required — there is no server-side default", () => {
    const r = safeSongUnchecked({ lyrics: LYRICS });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["model"]);
  });

  test("lyrics over the 5000-character cap is rejected; at the cap passes", () => {
    const over = safeSongUnchecked({ lyrics: "a".repeat(LYRICS_MAX_CHARACTERS + 1), model: "auto" });
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.errors[0]?.path).toEqual(["lyrics"]);
    expect(music.safe({ lyrics: "a".repeat(LYRICS_MAX_CHARACTERS), model: "auto" }).ok).toBe(true);
  });

  test("prompt over the 1024-character cap is rejected", () => {
    const r = safeSongUnchecked({
      lyrics: LYRICS,
      model: "auto",
      prompt: "a".repeat(PROMPT_MAX_CHARACTERS + 1),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["prompt"]);
  });

  test("n outside 1–3 is rejected ('Defaults to 2, maximum 3'); bounds pass", () => {
    for (const n of [0, 4, 1.5]) {
      expect(safeSongUnchecked({ lyrics: LYRICS, model: "auto", n }).ok).toBe(false);
    }
    expect(music.safe({ lyrics: LYRICS, model: "auto", n: 1 }).ok).toBe(true);
    expect(music.safe({ lyrics: LYRICS, model: "auto", n: 3 }).ok).toBe(true);
  });

  test("an undocumented gender is rejected", () => {
    expect(safeSongUnchecked({ lyrics: LYRICS, model: "auto", gender: "androgynous" }).ok).toBe(
      false,
    );
  });

  test("the throwing form throws UnmodelValidationError", () => {
    const unchecked = music as unknown as (params: unknown) => unknown;
    let caught: unknown;
    try {
      unchecked({ lyrics: LYRICS, model: "auto", n: 9 });
    } catch (error) {
      caught = error;
    }
    expect(UnmodelValidationError.isInstance(caught)).toBe(true);
  });
});

describe("mureka.music control-option combinations (doc audit 2026-08-24)", () => {
  test("melody_id combined with any other control option is an error", () => {
    for (const extra of [
      { prompt: "epic" },
      { reference_id: "ref_1" },
      { vocal_id: "vocal_1" },
    ]) {
      const r = safeSongUnchecked({ lyrics: LYRICS, model: "auto", melody_id: "mel_1", ...extra });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.errors[0]?.code).toBe("unsupported_param");
        expect(r.errors[0]?.path).toEqual(["melody_id"]);
      }
    }
  });

  test("melody_id alone is clean", () => {
    const r = music.safe({ lyrics: LYRICS, model: "auto", melody_id: "mel_1" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  test("prompt + reference_id is undocumented — warns, does not fail", () => {
    const r = music.safe({ lyrics: LYRICS, model: "auto", prompt: "jazz", reference_id: "ref_1" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const issue = r.warnings.find((w) => w.code === "unsupported_param");
      expect(issue?.path).toEqual(["reference_id"]);
      expect(issue?.message).toContain("not a documented combination");
    }
  });
});

describe("mureka.music per-model gates", () => {
  test("mureka-o2 rejects vocal_id and melody_id", () => {
    for (const field of ["vocal_id", "melody_id"] as const) {
      const r = safeSongUnchecked({ lyrics: LYRICS, model: "mureka-o2", [field]: "x_1" });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors.some((e) => e.path[0] === field)).toBe(true);
    }
  });

  test("the same fields pass on the regular models", () => {
    expect(music.safe({ lyrics: LYRICS, model: "mureka-9.5", vocal_id: "v_1" }).ok).toBe(true);
    expect(music.safe({ lyrics: LYRICS, model: "mureka-9.5", melody_id: "m_1" }).ok).toBe(true);
  });

  test("legacy mureka-o1 + stream is denied (and the id itself is unknown)", () => {
    const r = music.safe({ lyrics: LYRICS, model: "mureka-o1", stream: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.path[0] === "stream")).toBe(true);
  });

  test("constraintsFor exposes the o2 rule with its docs source", () => {
    expect(music.constraintsFor("mureka-o2").at(0)?.deny?.vocal_id?.source).toContain(
      "platform.mureka.ai",
    );
  });
});

describe("mureka.instrumental (POST /v1/instrumental/generate)", () => {
  test("happy path: wire-pure body, url, identity toSdk", () => {
    const params = { model: "auto" as const, prompt: "lo-fi, mellow, rainy afternoon" };
    const v = instrumental(params);
    expect(Object.keys(v)).toEqual(["model", "prompt"]);
    expect(v.request.url).toBe(INSTRUMENTAL_GENERATE_URL);
    expect(v.request.method).toBe("POST");
    expect(v.toSdk("mureka")).toEqual(params);
  });

  test("every id on the instrumental enum passes clean", () => {
    for (const model of MUREKA_INSTRUMENTAL_MODEL_IDS) {
      const r = instrumental.safe({ model });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.warnings).toEqual([]);
    }
  });

  test("mureka-o2 is song-only — unsupported_capability on this route", () => {
    const r = instrumental.safe({ model: "mureka-o2" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("unsupported_capability");
      expect(r.errors[0]?.path).toEqual(["model"]);
      expect(r.errors[0]?.message).toContain("mureka-o2");
    }
  });

  test("prompt and instrumental_id are mutually exclusive controls", () => {
    const r = instrumental.safe({ model: "auto", prompt: "epic", instrumental_id: "inst_1" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("unsupported_param");
      expect(r.errors[0]?.path).toEqual(["instrumental_id"]);
    }
    expect(instrumental.safe({ model: "auto", instrumental_id: "inst_1" }).ok).toBe(true);
  });

  test("model is required; n and prompt share the song route's bounds", () => {
    expect(safeInstrumentalUnchecked({}).ok).toBe(false);
    expect(safeInstrumentalUnchecked({ model: "auto", n: 4 }).ok).toBe(false);
    expect(
      safeInstrumentalUnchecked({ model: "auto", prompt: "a".repeat(PROMPT_MAX_CHARACTERS + 1) })
        .ok,
    ).toBe(false);
  });

  test("song-only fields are unknown params here (warned by the loose schema)", () => {
    const r = safeInstrumentalUnchecked({ model: "auto", lyrics: LYRICS });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toContain("unknown_param");
  });

  test("unknown model warns", () => {
    const r = instrumental.safe({ model: "mureka-10" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
  });
});

describe("mureka poll helpers (async create-then-poll)", () => {
  test("songQueryUrl and instrumentalQueryUrl build the documented GET paths", () => {
    expect(songQueryUrl("1436211")).toBe("https://api.mureka.ai/v1/song/query/1436211");
    expect(instrumentalQueryUrl("1436211")).toBe(
      "https://api.mureka.ai/v1/instrumental/query/1436211",
    );
  });

  test("task ids are URL-encoded", () => {
    expect(songQueryUrl("a/b")).toBe("https://api.mureka.ai/v1/song/query/a%2Fb");
  });
});

describe("mureka catalog", () => {
  test("every row is music-shaped: text in, audio out, no token window", () => {
    for (const info of Object.values(models)) {
      expect(info.limit.context).toBe(0);
      expect(info.modalities.input).toEqual(["text"]);
      expect(info.modalities.output).toEqual(["audio"]);
      // No published USD rate is scrapable (see the PRICING note in
      // models.ts), so no row may carry a cost that maxCostUSD would trust.
      expect("cost" in info).toBe(false);
    }
  });

  test("the instrumental enum is the song enum minus mureka-o2", () => {
    expect([...MUREKA_SONG_MODEL_IDS].filter((id) => id !== "mureka-o2")).toEqual([
      ...MUREKA_INSTRUMENTAL_MODEL_IDS,
    ]);
  });
});

// ---------------------------------------------------------------------------
// Unified adapter — route dispatch. A minimal hand-rolled CompileContext is
// enough to exercise `compile` directly; the kernel-level behavior (ExactKeys,
// per-model extras typing, `unsupported`) belongs to the unified suites.
// ---------------------------------------------------------------------------

function fakeCtx(model: string) {
  const failures: Array<{ code: string; path: Array<string | number>; message: string }> = [];
  const warnings: Array<{ code: string; path: Array<string | number>; message: string }> = [];
  const ctx = {
    model,
    warn: (issue: { code: string; path: Array<string | number>; message: string }) => {
      warnings.push(issue);
    },
    fail: (issue: { code: string; path: Array<string | number>; message: string }) => {
      failures.push(issue);
    },
    from: () => {},
    take: <T,>(derived: { value?: T }) => derived.value,
  } as unknown as CompileContext<MusicParams>;
  return { ctx, failures, warnings };
}

describe("mureka unified music adapter", () => {
  test("declares the category surface", () => {
    expect(musicAdapter.category).toBe("music");
    expect(musicAdapter.provider).toBe("mureka");
    expect(([...musicAdapter.models] as string[]).sort()).toEqual(Object.keys(models).sort());
    expect(Object.keys(musicAdapter.unsupported).sort()).toEqual([
      "durationSeconds",
      "outputFormat",
      "seed",
    ]);
  });

  test("compiles to the song route by default, carrying lyrics from extras", () => {
    const { ctx, failures } = fakeCtx("auto");
    const call = musicAdapter.compile(
      { model: "mureka/auto", prompt: "synthwave", lyrics: LYRICS } as unknown as MusicParams,
      ctx,
    );
    expect(failures).toEqual([]);
    expect(call.params).toEqual({ lyrics: LYRICS, model: "auto", prompt: "synthwave" });
    const validated = call.validate(call.params);
    expect(validated.ok).toBe(true);
  });

  test("song route without lyrics fails, naming both ways out", () => {
    const { ctx, failures } = fakeCtx("auto");
    musicAdapter.compile({ model: "mureka/auto", prompt: "synthwave" } as MusicParams, ctx);
    expect(failures.map((f) => f.path)).toEqual([["lyrics"]]);
    expect(failures[0]?.message).toContain("instrumental: true");
  });

  test("instrumental: true compiles to the instrumental route", () => {
    const { ctx, failures } = fakeCtx("mureka-9.5");
    const call = musicAdapter.compile(
      { model: "mureka/mureka-9.5", prompt: "lo-fi", instrumental: true, n: 1 } as MusicParams,
      ctx,
    );
    expect(failures).toEqual([]);
    expect(call.params).toEqual({ model: "mureka-9.5", prompt: "lo-fi", n: 1 });
    const validated = call.validate(call.params);
    expect(validated.ok).toBe(true);
    if (validated.ok) {
      expect(validated.params.request.url).toBe(INSTRUMENTAL_GENERATE_URL);
    }
  });

  test("song-only controls on the instrumental route fail with the route named", () => {
    const { ctx, failures } = fakeCtx("auto");
    const call = musicAdapter.compile(
      {
        model: "mureka/auto",
        prompt: "lo-fi",
        instrumental: true,
        lyrics: LYRICS,
        vocal_id: "v_1",
      } as unknown as MusicParams,
      ctx,
    );
    expect(failures.map((f) => f.path[0]).sort()).toEqual(["lyrics", "vocal_id"]);
    expect(call.params).toEqual({ model: "auto", prompt: "lo-fi" });
  });

  test("instrumental_id on the song route fails and is stripped", () => {
    const { ctx, failures } = fakeCtx("auto");
    const call = musicAdapter.compile(
      {
        model: "mureka/auto",
        prompt: "lo-fi",
        lyrics: LYRICS,
        instrumental_id: "inst_1",
      } as unknown as MusicParams,
      ctx,
    );
    expect(failures.some((f) => f.path[0] === "instrumental_id")).toBe(true);
    expect("instrumental_id" in call.params).toBe(false);
  });
});
