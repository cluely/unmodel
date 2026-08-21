/**
 * Every value the speech tables autocomplete, compiled and validated.
 *
 * ## Why this file exists
 *
 * `tts({ model: "hume/octave", outputFormat: … })` offers that model's own
 * two codecs, and a suggestion is only worth having if it is one the provider
 * accepts. So the promise is checked rather than asserted: every `codecs` entry
 * and every `languages` entry on all fifteen speech adapters is compiled
 * through the unified surface and run through the provider's own validator,
 * and one off-set neighbour of each is asserted to fail — because a closed list
 * makes a claim in both directions, and without the negative half a table that
 * listed all eleven codecs would pass the positive sweep and describe nothing.
 *
 * This is `test/unified/video-presets.test.ts` for the audio categories, with
 * two differences that come from what audio requests are like.
 *
 * ## Why a codec cell tries more than one spelling
 *
 * `outputFormat` is not one value, it is a *decision* — codec, container,
 * sample rate, bitrate — and which parts are required differs per provider:
 * Cartesia's mp3 arm lists `sample_rate` as required with no documented
 * default, and Rime's Mist v2 publishes `audio/L16` but not `audio/wav`, so
 * `pcm_s16le` is reachable there only as a raw stream. A declared codec is
 * therefore asserted **reachable**: it must compile cleanly under at least one
 * of a short ladder of spellings. That is the honest statement a codec list can
 * make, and it is exactly how the lists were derived — the ladder was run
 * against every cell and every one of them lands on the first three rungs.
 *
 * Warnings are allowed on a codec cell, and deliberately: naming a bare codec
 * at ElevenLabs fills in a sample rate and a bitrate, and those
 * `approximated_param` warnings are the honest report of an invented value, not
 * a defect in the list. `language` is held to the same `ok` bar for the same
 * reason at MiniMax, whose `language_boost` is an English word rather than a
 * code.
 *
 * ## Why the sweep runs one model per distinct row
 *
 * Rows are shared wherever the wire is: Deepgram's 103 Aura voices are one
 * `/v1/speak` surface, and the table says so with one generated row. Running
 * the same seven codec cells 103 times would prove nothing the first pass does
 * not, so the sweep is keyed by the row's *signature* — its lists and its extra
 * names — and a separate test asserts that every model an adapter serves has a
 * row, so nothing goes unrepresented.
 */
import { describe, expect, test } from "bun:test";
import type { AudioFormatCodec } from "../../src/core/unified/vocabulary/audio";
import type { TtsModelParams } from "../../src/core/unified/vocabulary/model-params";
import { tts } from "../../src/unified/tts";
import { tts as cartesia } from "../../src/providers/cartesia/unified-tts";
import { tts as deepgram } from "../../src/providers/deepgram/unified-tts";
import { tts as elevenlabs } from "../../src/providers/elevenlabs/unified-tts";
import { tts as fishAudio } from "../../src/providers/fish-audio/unified";
import { tts as google } from "../../src/providers/google/unified-tts";
import { tts as hume } from "../../src/providers/hume/unified";
import { tts as inworld } from "../../src/providers/inworld/unified-tts";
import { tts as lmnt } from "../../src/providers/lmnt/unified";
import { tts as minimax } from "../../src/providers/minimax/unified-tts";
import { tts as murf } from "../../src/providers/murf/unified";
import { tts as openai } from "../../src/providers/openai/unified-tts";
import { tts as resemble } from "../../src/providers/resemble/unified";
import { tts as rime } from "../../src/providers/rime/unified";
import { tts as smallestAi } from "../../src/providers/smallest-ai/unified";
import { tts as speechify } from "../../src/providers/speechify/unified";

interface Adapter {
  readonly provider: string;
  readonly models: readonly string[];
  readonly modelParams?: Readonly<Record<string, TtsModelParams>>;
}

const ADAPTERS: readonly Adapter[] = [
  openai,
  elevenlabs,
  cartesia,
  deepgram,
  google,
  hume,
  minimax,
  rime,
  lmnt,
  fishAudio,
  murf,
  resemble,
  smallestAi,
  speechify,
  inworld,
];

/** Every codec the vocabulary has — the pool an off-set neighbour comes from. */
const ALL_CODECS: readonly AudioFormatCodec[] = [
  "mp3",
  "aac",
  "flac",
  "opus",
  "vorbis",
  "pcm_s16le",
  "pcm_s24le",
  "pcm_s32le",
  "pcm_f32le",
  "pcm_mulaw",
  "pcm_alaw",
];

/** Codes wide enough that some model on some provider does not serve them. */
const LANGUAGE_POOL = ["en", "fr", "de", "es", "pt", "zh", "ja", "ru", "ko", "hi", "ar", "tlh", "cy"];

/**
 * The request every probe is built on.
 *
 * `voice` is required by twelve of the fifteen (it is the field the whole
 * request is about), and the three exceptions are the three facts worth
 * recording here: at Deepgram the voice **is** the model, so sending one that
 * disagrees with the ref is an error by design; at OpenAI `voice` is a closed
 * nine-name enum rather than an opaque id; and at Google it is a closed
 * thirty-**name** list, so both placeholders have to be real. Cartesia's
 * `outputFormat` is on the base because POST /tts/bytes documents no default
 * for it — the one required encoding field in the category — so a probe about
 * *anything else* has to carry a valid one.
 */
function base(provider: string): Record<string, unknown> {
  const params: Record<string, unknown> = { text: "A probe." };
  if (provider === "openai") params["voice"] = "alloy";
  else if (provider === "google") params["voice"] = "Kore";
  else if (provider !== "deepgram") params["voice"] = "v1";
  if (provider === "cartesia") params["outputFormat"] = { format: "mp3", sampleRate: 44100 };
  return params;
}

interface Outcome {
  ok: boolean;
  errors: string[];
  /** Issue-space warnings, as `code@path`, for the warn-only language cell. */
  warnings: string[];
  /** The wire body plus its `.request`, for the no-drop check. */
  wire: string;
}

function run(ref: string, params: Record<string, unknown>): Outcome {
  const result = tts.safe({ model: ref, ...params } as never) as {
    ok: boolean;
    errors?: Array<{ code: string; path: Array<string | number>; message: string }>;
    warnings?: Array<{ code: string; path: Array<string | number> }>;
    params?: { request?: unknown };
  };
  const warnings = (result.warnings ?? []).map((i) => `${i.code}@${i.path.join(".")}`);
  if (!result.ok) {
    return {
      ok: false,
      wire: "",
      warnings,
      errors: (result.errors ?? []).map((i) => `${i.code}@${i.path.join(".")}: ${i.message}`),
    };
  }
  // Both halves, because half this category's params do not ride in the body:
  // Deepgram's encoding is a query param, Rime's is an `Accept` header, and
  // ElevenLabs' composite is `?output_format=`.
  return {
    ok: true,
    errors: [],
    warnings,
    wire: JSON.stringify(result.params) + JSON.stringify(result.params?.request ?? {}),
  };
}

/**
 * The providers whose off-list language is a **warning** rather than an error.
 *
 * One entry, and it is a documentary fact rather than a leniency: Gemini's
 * 78-row table is headed "Supported languages" and states which languages the
 * models *speak*, while the REST reference's own `languageCode` example
 * ("en-US") is a value that table does not carry. So `checkLanguageCode`
 * reports `invalid_enum_value` at `severity: "warning"` — the library never
 * fails a request the API may well fulfil — and the negative half of the
 * completion claim is asserted here as "compiles, and says so" rather than
 * "refused". Enumerated so a second provider cannot join it silently.
 */
const WARN_ONLY_LANGUAGES: ReadonlySet<string> = new Set(["google"]);

/**
 * The spellings a codec is tried in, in order.
 *
 * Short on purpose: the first rung answers for 948 of the 954 declared cells,
 * `"raw"` picks up Rime's legacy Mist ids (which publish `audio/L16` and not
 * `audio/wav`) and `44100` picks up Cartesia's mp3 arm (whose `sample_rate` is
 * required and has no documented default). The rest are there so that a
 * provider added later is not a false failure.
 */
function spellings(codec: AudioFormatCodec): unknown[] {
  return [
    codec,
    { format: codec, container: "raw" },
    { format: codec, sampleRate: 44100 },
    { format: codec, sampleRate: 44100, bitrate: 128000 },
    { format: codec, sampleRate: 24000 },
    { format: codec, sampleRate: 8000 },
    { format: codec, container: "raw", sampleRate: 8000 },
    { format: codec, sampleRate: 48000 },
    { format: codec, sampleRate: 22050, bitrate: 32000 },
  ];
}

/** `""` when some spelling of `codec` compiles, otherwise the last attempt's errors. */
function codecReachable(ref: string, provider: string, codec: AudioFormatCodec): string {
  let last = "no spelling compiles";
  for (const value of spellings(codec)) {
    const probe = run(ref, { ...base(provider), outputFormat: value });
    if (probe.ok) return "";
    last = probe.errors.join("; ");
  }
  return last;
}

/**
 * One model per distinct declared surface.
 *
 * The signature is the row's own content — its codec list, its language list
 * and its extra *names* — so two models collapse only when the table says they
 * are the same request surface, which is the thing under test.
 */
interface Cell {
  ref: string;
  provider: string;
  row: TtsModelParams;
}

function representatives(): Cell[] {
  const cells: Cell[] = [];
  for (const adapter of ADAPTERS) {
    const seen = new Set<string>();
    for (const [model, row] of Object.entries(adapter.modelParams ?? {})) {
      const signature = JSON.stringify([row.codecs, row.languages, Object.keys(row.extras ?? {})]);
      if (seen.has(signature)) continue;
      seen.add(signature);
      cells.push({ ref: `${adapter.provider}/${model}`, provider: adapter.provider, row });
    }
  }
  return cells;
}

const CELLS = representatives();

describe("every declared speech preset is a value the provider accepts", () => {
  test("every speech adapter declares a per-model table", () => {
    for (const adapter of ADAPTERS) {
      expect(adapter.modelParams, `${adapter.provider} has no modelParams`).toBeDefined();
    }
  });

  test("every table row names a model the adapter serves, and every model has a row", () => {
    for (const adapter of ADAPTERS) {
      const rows = Object.keys(adapter.modelParams ?? {});
      for (const row of rows) {
        expect(adapter.models, `${adapter.provider} table row "${row}"`).toContain(row);
      }
      // Total, like the video table and unlike the image one: every speech
      // model has a codec set worth narrowing, so a missing row is an oversight
      // rather than a model with nothing to declare.
      expect(rows.slice().sort(), adapter.provider).toEqual([...adapter.models].sort());
    }
  });

  test("the distinct-surface sweep covers every adapter", () => {
    expect(new Set(CELLS.map((cell) => cell.provider)).size).toBe(ADAPTERS.length);
  });

  // -------------------------------------------------------------------------
  // codecs
  // -------------------------------------------------------------------------

  const codecCells: Array<[string, string, () => string]> = [];
  for (const { ref, provider, row } of CELLS) {
    for (const codec of row.codecs ?? []) {
      codecCells.push([ref, codec, () => codecReachable(ref, provider, codec)]);
    }
  }

  test("the codec sweep is not empty", () => {
    expect(codecCells.length).toBeGreaterThan(80);
  });

  test.each(codecCells)("speech %s outputFormat %s", (_ref, _codec, probe) => {
    expect(probe()).toBe("");
  });

  const codecNegatives: Array<[string, string, () => string]> = [];
  for (const { ref, provider, row } of CELLS) {
    const codecs = row.codecs;
    if (codecs === undefined) continue;
    const off = ALL_CODECS.find((codec) => !codecs.includes(codec));
    if (off === undefined) continue;
    codecNegatives.push([
      ref,
      off,
      () => {
        const probe = run(ref, { ...base(provider), outputFormat: off });
        if (probe.ok) return "accepted";
        return probe.errors.some((error) => error.includes("@outputFormat"))
          ? ""
          : `refused, but not at \`outputFormat\`: ${probe.errors.join("; ")}`;
      },
    ]);
  }

  test.each(codecNegatives)("speech %s refuses outputFormat %s", (_ref, _codec, probe) => {
    expect(probe()).toBe("");
  });

  // -------------------------------------------------------------------------
  // languages
  // -------------------------------------------------------------------------

  const languageCells: Array<[string, string, () => string]> = [];
  for (const { ref, provider, row } of CELLS) {
    for (const language of row.languages ?? []) {
      languageCells.push([
        ref,
        language,
        () => {
          const probe = run(ref, { ...base(provider), language });
          return probe.ok ? "" : probe.errors.join("; ");
        },
      ]);
    }
  }

  test("the language sweep is not empty", () => {
    expect(languageCells.length).toBeGreaterThan(150);
  });

  test.each(languageCells)("speech %s language %s", (_ref, _language, probe) => {
    expect(probe()).toBe("");
  });

  const languageNegatives: Array<[string, string, () => string]> = [];
  for (const { ref, provider, row } of CELLS) {
    const languages = row.languages;
    if (languages === undefined) continue;
    const off = LANGUAGE_POOL.find((code) => !languages.includes(code));
    if (off === undefined) continue;
    languageNegatives.push([
      ref,
      off,
      () => {
        const probe = run(ref, { ...base(provider), language: off });
        if (WARN_ONLY_LANGUAGES.has(provider)) {
          if (!probe.ok) return `refused, but this provider only warns: ${probe.errors.join("; ")}`;
          return probe.warnings.includes("invalid_enum_value@language")
            ? ""
            : `accepted in silence; warnings were ${JSON.stringify(probe.warnings)}`;
        }
        if (probe.ok) return "accepted";
        return probe.errors.some((error) => error.includes("@language"))
          ? ""
          : `refused, but not at \`language\`: ${probe.errors.join("; ")}`;
      },
    ]);
  }

  test.each(languageNegatives)("speech %s refuses language %s", (_ref, _language, probe) => {
    expect(probe()).toBe("");
  });

  // -------------------------------------------------------------------------
  // No silent drop, for every extra
  // -------------------------------------------------------------------------

  /**
   * The same question the image and video sweeps ask: does an extra **reach the
   * wire** or get **refused**? A request that validates with the key nowhere in
   * it is the only wrong answer.
   *
   * The probe is a sentinel string rather than a legal value, on purpose: what
   * is under test is whether the key travels, not whether the value is any
   * good. A schema that rejects `"__unmodel_probe__"` answers `ok: false`,
   * which is a refusal and therefore fine.
   */
  const SENTINEL = "__unmodel_probe__";
  const extraCells: Array<[string, string, () => string]> = [];
  for (const { ref, provider, row } of CELLS) {
    for (const key of Object.keys(row.extras ?? {})) {
      extraCells.push([
        ref,
        key,
        () => {
          const probe = run(ref, { ...base(provider), [key]: SENTINEL });
          if (!probe.ok) return "";
          return probe.wire.includes(SENTINEL) ? "" : "dropped";
        },
      ]);
    }
  }

  test("the extras sweep is not empty", () => {
    expect(extraCells.length).toBeGreaterThan(90);
  });

  test.each(extraCells)(
    "the extra %s.%s reaches the wire or is refused, never dropped",
    (_ref, _key, probe) => {
      expect(probe()).toBe("");
    },
  );

  test("an extra belonging to a sibling model is refused, naming the models that take it", () => {
    const result = tts.safe({
      model: "openai/tts-1",
      text: "hi",
      voice: "alloy",
      instructions: "speak slowly",
    } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatchObject({ code: "unsupported_param", path: ["instructions"] });
    expect(result.errors[0]!.message).toContain("gpt-4o-mini-tts");

    // Rime's Coda denies all four Mist-family knobs, so its row has no extras
    // at all and the message names the six ids that do.
    const coda = tts.safe({
      model: "rime/coda",
      text: "hi",
      voice: "astra",
      pauseBetweenBrackets: true,
    } as never);
    expect(coda.ok).toBe(false);
    if (coda.ok) return;
    expect(coda.errors[0]!.message).toContain("mistv2");
  });

  test("nested extras land under their own wire prefix, beside the compiled params", () => {
    // ElevenLabs: `voice_settings` already carries the `speed` this adapter
    // compiled, and `applyExtras` merges into it rather than replacing it.
    const eleven = tts({
      model: "elevenlabs/eleven_v3",
      text: "hi",
      voice: "v1",
      speed: 1.1,
      stability: 0.3,
      seed: 7,
    } as never) as unknown as Record<string, unknown>;
    expect(eleven["voice_settings"]).toEqual({ speed: 1.1, stability: 0.3 });
    expect(eleven["seed"]).toBe(7);
    expect(eleven["stability"]).toBeUndefined();

    // MiniMax: two prefixes and a body-root object from one table.
    const mini = tts({
      model: "minimax/speech-2.6-hd",
      text: "hi",
      voice: "v1",
      emotion: "whisper",
      tone: ["a/1"],
      voice_modify: { pitch: 5 },
    } as never) as unknown as Record<string, unknown>;
    expect(mini["voice_setting"]).toMatchObject({ voice_id: "v1", emotion: "whisper" });
    expect(mini["pronunciation_dict"]).toEqual({ tone: ["a/1"] });
    expect(mini["voice_modify"]).toEqual({ pitch: 5 });

    // Hume: the one provider whose extras reach into an ARRAY the compiler
    // built — `description` is a sibling of the text, not of the request.
    const octave = tts({
      model: "hume/octave-2",
      text: "hi",
      voice: "Kore",
      description: "warm",
      trailing_silence: 0.5,
      temperature: 0.5,
    } as never) as unknown as { utterances: Array<Record<string, unknown>>; temperature: number };
    expect(octave.utterances[0]).toMatchObject({
      text: "hi",
      description: "warm",
      trailing_silence: 0.5,
    });
    expect(octave.temperature).toBe(0.5);
  });
});
