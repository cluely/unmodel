/**
 * Every value the transcribe tables autocomplete, compiled and validated.
 *
 * `test/unified/speech-presets.test.ts` explains the shape; what differs here
 * is which fields a row narrows and one thing the category does that no other
 * does.
 *
 * ## `timestamps` is the interesting column, and `"none"` is the interesting cell
 *
 * A row lists `"none"` exactly when the route can genuinely *return* no
 * timings: OpenAI's models produce them only when asked, ElevenLabs has a
 * scalar `none | word | character` enum, Cartesia's array can be omitted. Six
 * of the eleven providers have no such switch — AssemblyAI, Deepgram, Gladia,
 * Rev AI, Soniox and Speechmatics all return word timings on every response —
 * and their rows say `["word"]` or `["word", "segment"]` with **no `"none"`**,
 * which makes `timestamps: "none"` a compile error there.
 *
 * That is the one place in this wave where the type is deliberately *stricter*
 * than the wire: those routes accept the request and return timings anyway. The
 * negative sweep below therefore never probes with `"none"` — it would be
 * accepted-and-ignored, which is precisely the outcome the row exists to warn a
 * caller away from. What it probes is a granularity the route cannot report,
 * and that is refused by name.
 *
 * ## Two required params, both per model
 *
 * `speechmatics/melia-1` "requires `language: "multi"`" and `gladia/solaria-3`
 * is single-language ("pass exactly one language"), so both carry one in the
 * probe base — the same trick `video-presets` uses for the routes whose schema
 * marks a field required with no default, and for the same reason: without it
 * the sweep would be measuring the missing field instead of the preset.
 *
 * `inworld` is swept for nothing: its `audioInputs` is empty, because the route
 * takes base64 audio inline and a synchronous compile step cannot produce it
 * from a `Blob`. There is no request to build, so there is nothing to run —
 * `src/providers/inworld/unified-transcribe.ts` argues the case, and its table
 * is still checked by the structural tests below.
 */
import { describe, expect, test } from "bun:test";
import type { TranscribeModelParams } from "../../src/core/unified/vocabulary/model-params";
import type {
  AudioInputKind,
  TimestampGranularity,
} from "../../src/core/unified/vocabulary/transcribe";
import { transcribe } from "../../src/unified/transcribe";
import { transcribe as assemblyai } from "../../src/providers/assemblyai/unified";
import { transcribe as cartesia } from "../../src/providers/cartesia/unified-transcribe";
import { transcribe as deepgram } from "../../src/providers/deepgram/unified-transcribe";
import { transcribe as elevenlabs } from "../../src/providers/elevenlabs/unified-transcribe";
import { transcribe as gladia } from "../../src/providers/gladia/unified";
import { transcribe as inworld } from "../../src/providers/inworld/unified-transcribe";
import { transcribe as mistral } from "../../src/providers/mistral/unified";
import { transcribe as openai } from "../../src/providers/openai/unified-transcribe";
import { transcribe as revai } from "../../src/providers/revai/unified";
import { transcribe as soniox } from "../../src/providers/soniox/unified";
import { transcribe as speechmatics } from "../../src/providers/speechmatics/unified";

interface Adapter {
  readonly provider: string;
  readonly models: readonly string[];
  readonly audioInputs: readonly AudioInputKind[];
  readonly modelParams?: Readonly<Record<string, TranscribeModelParams>>;
}

const ADAPTERS: readonly Adapter[] = [
  openai,
  deepgram,
  assemblyai,
  elevenlabs,
  gladia,
  speechmatics,
  mistral,
  soniox,
  revai,
  cartesia,
  inworld,
];

const GRANULARITIES: readonly TimestampGranularity[] = ["none", "word", "segment", "character"];
const LANGUAGE_POOL = ["en", "fr", "de", "es", "pt", "zh", "ja", "ru", "multi", "cy"];

/** The `audio` shape this route accepts, in whichever form it takes. */
function audioFor(adapter: Adapter): Record<string, unknown> | undefined {
  if (adapter.audioInputs.includes("url")) return { url: "https://example.com/interview.wav" };
  if (adapter.audioInputs.includes("file")) {
    return { file: new Blob(["probe"], { type: "audio/wav" }) };
  }
  if (adapter.audioInputs.includes("fileId")) return { fileId: "file_probe" };
  return undefined;
}

/** Per-model params the route marks required with no server default. */
const REQUIRED: Readonly<Record<string, Record<string, unknown>>> = {
  "speechmatics/melia-1": { language: "multi" },
  "gladia/solaria-3": { language: "en" },
};

interface Outcome {
  ok: boolean;
  errors: string[];
  wire: string;
}

function run(ref: string, params: Record<string, unknown>): Outcome {
  const result = transcribe.safe({ model: ref, ...params } as never) as {
    ok: boolean;
    errors?: Array<{ code: string; path: Array<string | number>; message: string }>;
    params?: { request?: unknown };
  };
  if (!result.ok) {
    return {
      ok: false,
      wire: "",
      errors: (result.errors ?? []).map((i) => `${i.code}@${i.path.join(".")}: ${i.message}`),
    };
  }
  // Deepgram's whole option surface is query params, so `.request` is where its
  // extras land — the body is `{ url }` and nothing else.
  return {
    ok: true,
    errors: [],
    wire: JSON.stringify(result.params) + JSON.stringify(result.params?.request ?? {}),
  };
}

interface Cell {
  ref: string;
  base: Record<string, unknown>;
  row: TranscribeModelParams;
}

/** One model per distinct declared surface; see the speech sweep for why. */
function representatives(): Cell[] {
  const cells: Cell[] = [];
  for (const adapter of ADAPTERS) {
    const audio = audioFor(adapter);
    if (audio === undefined) continue;
    const seen = new Set<string>();
    for (const [model, row] of Object.entries(adapter.modelParams ?? {})) {
      const signature = JSON.stringify([
        row.timestamps,
        row.languages,
        Object.keys(row.extras ?? {}),
      ]);
      if (seen.has(signature)) continue;
      seen.add(signature);
      const ref = `${adapter.provider}/${model}`;
      cells.push({ ref, row, base: { audio, ...(REQUIRED[ref] ?? {}) } });
    }
  }
  return cells;
}

const CELLS = representatives();

describe("every declared transcribe preset is a value the provider accepts", () => {
  test("every transcribe adapter declares a per-model table", () => {
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
      expect(rows.slice().sort(), adapter.provider).toEqual([...adapter.models].sort());
    }
  });

  test("the sweep covers every adapter that can be called at all", () => {
    // Ten of eleven: `inworld` has no `audio` shape this vocabulary can build.
    expect(new Set(CELLS.map((cell) => cell.ref.split("/")[0])).size).toBe(ADAPTERS.length - 1);
  });

  // -------------------------------------------------------------------------
  // timestamps
  // -------------------------------------------------------------------------

  const stampCells: Array<[string, string, () => string]> = [];
  for (const { ref, base, row } of CELLS) {
    for (const granularity of row.timestamps ?? []) {
      stampCells.push([
        ref,
        granularity,
        () => {
          const probe = run(ref, { ...base, timestamps: granularity });
          return probe.ok ? "" : probe.errors.join("; ");
        },
      ]);
    }
  }

  test("the timestamps sweep is not empty", () => {
    expect(stampCells.length).toBeGreaterThan(20);
  });

  test.each(stampCells)("transcribe %s timestamps %s", (_ref, _granularity, probe) => {
    expect(probe()).toBe("");
  });

  /**
   * The other direction, never probed with `"none"` — see the module note: on
   * the six always-on routes `"none"` is accepted and ignored rather than
   * refused, which is a claim the *type* makes and the wire cannot.
   */
  const stampNegatives: Array<[string, string, () => string]> = [];
  for (const { ref, base, row } of CELLS) {
    const granularities = row.timestamps;
    if (granularities === undefined) continue;
    const off = GRANULARITIES.find((g) => g !== "none" && !granularities.includes(g));
    if (off === undefined) continue;
    stampNegatives.push([
      ref,
      off,
      () => {
        const probe = run(ref, { ...base, timestamps: off });
        if (probe.ok) return "accepted";
        return probe.errors.some((error) => error.includes("@timestamps"))
          ? ""
          : `refused, but not at \`timestamps\`: ${probe.errors.join("; ")}`;
      },
    ]);
  }

  test.each(stampNegatives)("transcribe %s refuses timestamps %s", (_ref, _g, probe) => {
    expect(probe()).toBe("");
  });

  // -------------------------------------------------------------------------
  // languages
  // -------------------------------------------------------------------------

  const languageCells: Array<[string, string, () => string]> = [];
  for (const { ref, base, row } of CELLS) {
    for (const language of row.languages ?? []) {
      languageCells.push([
        ref,
        language,
        () => {
          const probe = run(ref, { ...base, language });
          return probe.ok ? "" : probe.errors.join("; ");
        },
      ]);
    }
  }

  test("the language sweep is not empty", () => {
    expect(languageCells.length).toBeGreaterThan(100);
  });

  test.each(languageCells)("transcribe %s language %s", (_ref, _language, probe) => {
    expect(probe()).toBe("");
  });

  const languageNegatives: Array<[string, string, () => string]> = [];
  for (const { ref, base, row } of CELLS) {
    const languages = row.languages;
    if (languages === undefined) continue;
    const off = LANGUAGE_POOL.find((code) => !languages.includes(code));
    if (off === undefined) continue;
    languageNegatives.push([
      ref,
      off,
      () => {
        const probe = run(ref, { ...base, language: off });
        if (probe.ok) return "accepted";
        return probe.errors.some((error) => error.includes("@language"))
          ? ""
          : `refused, but not at \`language\`: ${probe.errors.join("; ")}`;
      },
    ]);
  }

  test.each(languageNegatives)("transcribe %s refuses language %s", (_ref, _l, probe) => {
    expect(probe()).toBe("");
  });

  // -------------------------------------------------------------------------
  // No silent drop, for every extra
  // -------------------------------------------------------------------------

  const SENTINEL = "__unmodel_probe__";
  const extraCells: Array<[string, string, () => string]> = [];
  for (const { ref, base, row } of CELLS) {
    for (const key of Object.keys(row.extras ?? {})) {
      extraCells.push([
        ref,
        key,
        () => {
          const probe = run(ref, { ...base, [key]: SENTINEL });
          if (!probe.ok) return "";
          return probe.wire.includes(SENTINEL) ? "" : "dropped";
        },
      ]);
    }
  }

  test("the extras sweep is not empty", () => {
    expect(extraCells.length).toBeGreaterThan(150);
  });

  test.each(extraCells)(
    "the extra %s.%s reaches the wire or is refused, never dropped",
    (_ref, _key, probe) => {
      expect(probe()).toBe("");
    },
  );

  test("an extra belonging to a sibling model is refused, naming the models that take it", () => {
    // Deepgram's keyterm prompting is Nova-3's; on any other model the API
    // accepts the param and ignores it, which is why the table refuses it here.
    const nova2 = transcribe.safe({
      model: "deepgram/nova-2",
      audio: { url: "https://example.com/a.wav" },
      keyterm: "unmodel",
    } as never);
    expect(nova2.ok).toBe(false);
    if (nova2.ok) return;
    expect(nova2.errors[0]).toMatchObject({ code: "unsupported_param", path: ["keyterm"] });
    expect(nova2.errors[0]!.message).toContain("nova-3");

    // AssemblyAI's two gated blocks point in opposite directions.
    const slam = transcribe.safe({
      model: "assemblyai/slam-1",
      audio: { url: "https://example.com/a.wav" },
      summarization: true,
    } as never);
    expect(slam.ok).toBe(false);
    if (slam.ok) return;
    expect(slam.errors[0]!.message).toContain("universal-2");
  });

  test("nested extras land under their own wire prefix, beside the compiled params", () => {
    // AssemblyAI: `speaker_options` already carries the counts compiled from
    // `diarization`, and the extra merges into it.
    const assembly = transcribe({
      model: "assemblyai/universal-2",
      audio: { url: "https://example.com/a.wav" },
      diarization: { enabled: true, maxSpeakers: 4 },
      advanced_speaker_segmentation: true,
    } as never) as unknown as Record<string, unknown>;
    expect(assembly["speaker_options"]).toEqual({
      max_speakers_expected: 4,
      advanced_speaker_segmentation: true,
    });
    expect(assembly["advanced_speaker_segmentation"]).toBeUndefined();

    // Speechmatics: the job config's own two levels, from one table.
    const smx = transcribe({
      model: "speechmatics/enhanced",
      audio: { url: "https://example.com/a.wav" },
      domain: "medical",
      output_locale: "en-US",
      summarization_config: { summary_type: "bullets" },
    } as never) as unknown as Record<string, Record<string, unknown>>;
    expect(smx["transcription_config"]).toMatchObject({
      domain: "medical",
      output_locale: "en-US",
    });
    expect(smx["summarization_config"]).toEqual({ summary_type: "bullets" });

    // Gladia: `code_switching` shares `language_config` with the compiled
    // language array rather than replacing it.
    const gld = transcribe({
      model: "gladia/solaria-1",
      audio: { url: "https://example.com/a.wav" },
      language: "pt",
      code_switching: true,
    } as never) as unknown as Record<string, unknown>;
    expect(gld["language_config"]).toEqual({ languages: ["pt"], code_switching: true });
  });
});
