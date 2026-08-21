/**
 * Every value the music tables autocomplete, compiled and validated.
 *
 * The smallest of the three audio sweeps, matching the smallest vocabulary:
 * `outputFormat` is the only canonical word with a per-model enum behind it, so
 * `codecs` and `extras` are the whole of what a music row declares.
 *
 * The two providers are also the category's whole argument for per-model
 * typing. Stability's `output_format` is `"mp3" | "wav"` — two codecs, the
 * narrowest list in the library — while ElevenLabs publishes a composite enum
 * covering mp3, Opus, PCM, μ-law and A-law. `outputFormat: "opus"` is therefore
 * a compile error at one and ordinary at the other, from one vocabulary.
 *
 * See `test/unified/tts-presets.test.ts` for why a codec cell tries a short
 * ladder of spellings rather than one, and why a warning does not fail a cell.
 */
import { describe, expect, test } from "bun:test";
import type { AudioFormatCodec } from "../../src/core/unified/vocabulary/audio";
import type { MusicModelParams } from "../../src/core/unified/vocabulary/model-params";
import { music } from "../../src/unified/music";
import { music as elevenlabs } from "../../src/providers/elevenlabs/unified-music";
import { music as stability } from "../../src/providers/stability/unified-music";

interface Adapter {
  readonly provider: string;
  readonly models: readonly string[];
  readonly modelParams?: Readonly<Record<string, MusicModelParams>>;
}

const ADAPTERS: readonly Adapter[] = [elevenlabs, stability];

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

const BASE = { prompt: "slow post-rock build, no vocals" };

interface Outcome {
  ok: boolean;
  errors: string[];
  wire: string;
}

function run(ref: string, params: Record<string, unknown>): Outcome {
  const result = music.safe({ model: ref, ...params } as never) as {
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
  // ElevenLabs' `output_format` rides in the query string, not the body.
  return {
    ok: true,
    errors: [],
    wire: JSON.stringify(result.params) + JSON.stringify(result.params?.request ?? {}),
  };
}

function spellings(codec: AudioFormatCodec): unknown[] {
  return [
    codec,
    { format: codec, container: "raw" },
    { format: codec, sampleRate: 44100 },
    { format: codec, sampleRate: 44100, bitrate: 128000 },
    { format: codec, sampleRate: 48000 },
    { format: codec, sampleRate: 8000 },
  ];
}

describe("every declared music preset is a value the provider accepts", () => {
  test("every music adapter declares a per-model table", () => {
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

  const codecCells: Array<[string, string, () => string]> = [];
  const codecNegatives: Array<[string, string, () => string]> = [];
  const extraCells: Array<[string, string, () => string]> = [];
  const SENTINEL = "__unmodel_probe__";

  for (const adapter of ADAPTERS) {
    for (const [model, row] of Object.entries(adapter.modelParams ?? {})) {
      const ref = `${adapter.provider}/${model}`;
      for (const codec of row.codecs ?? []) {
        codecCells.push([
          ref,
          codec,
          () => {
            let last = "no spelling compiles";
            for (const value of spellings(codec)) {
              const probe = run(ref, { ...BASE, outputFormat: value });
              if (probe.ok) return "";
              last = probe.errors.join("; ");
            }
            return last;
          },
        ]);
      }
      const codecs = row.codecs;
      if (codecs !== undefined) {
        const off = ALL_CODECS.find((codec) => !codecs.includes(codec));
        if (off !== undefined) {
          codecNegatives.push([
            ref,
            off,
            () => {
              const probe = run(ref, { ...BASE, outputFormat: off });
              if (probe.ok) return "accepted";
              return probe.errors.some((error) => error.includes("@outputFormat"))
                ? ""
                : `refused, but not at \`outputFormat\`: ${probe.errors.join("; ")}`;
            },
          ]);
        }
      }
      for (const key of Object.keys(row.extras ?? {})) {
        extraCells.push([
          ref,
          key,
          () => {
            const probe = run(ref, { ...BASE, [key]: SENTINEL });
            if (!probe.ok) return "";
            return probe.wire.includes(SENTINEL) ? "" : "dropped";
          },
        ]);
      }
    }
  }

  test("the sweep is not empty", () => {
    expect(codecCells.length).toBe(14);
    expect(extraCells.length).toBe(14);
  });

  test.each(codecCells)("music %s outputFormat %s", (_ref, _codec, probe) => {
    expect(probe()).toBe("");
  });

  test.each(codecNegatives)("music %s refuses outputFormat %s", (_ref, _codec, probe) => {
    expect(probe()).toBe("");
  });

  test.each(extraCells)(
    "the extra %s.%s reaches the wire or is refused, never dropped",
    (_ref, _key, probe) => {
      expect(probe()).toBe("");
    },
  );

  /**
   * The sibling-refusal check the other two categories make has no run-time
   * analogue here, and saying so is more useful than manufacturing one.
   *
   * `applyExtras` refuses an extra by name when **some other model on the same
   * adapter** declares it — that is what makes the message able to say "it is
   * taken by …". Music has no such pair: both ElevenLabs ids share one row and
   * both Stability ids share another, because their endpoints genuinely do not
   * differ by model. So the only cross-model mistake available is a *cross
   * provider* one. `ExactKeys` catches it for typed callers; the canonical
   * envelope check is the matching runtime backstop for JSON and JavaScript.
   */
  test("the cross-provider case is rejected by the type and runtime backstops", () => {
    // @ts-expect-error — `steps` is Stability's; ElevenLabs' row has no such key.
    const rejected = music.safe({ model: "elevenlabs/music_v1", prompt: "x", steps: 40 });
    expect(rejected.ok).toBe(false);
    if (rejected.ok) return;
    expect(rejected.errors[0]).toMatchObject({ code: "unsupported_param", path: ["steps"] });

    for (const adapter of ADAPTERS) {
      const rosters = Object.values(adapter.modelParams ?? {}).map((row) =>
        Object.keys(row.extras ?? {}).sort().join(","),
      );
      expect(new Set(rosters).size, `${adapter.provider} extras rosters`).toBe(1);
    }
  });

  test("a model's own extras go on the wire verbatim, beside the compiled params", () => {
    const stable = music({
      model: "stability/stable-audio-2.5",
      prompt: "x",
      durationSeconds: 45,
      outputFormat: "mp3",
      steps: 8,
      cfg_scale: 7,
    } as never) as unknown as Record<string, unknown>;
    expect(stable).toMatchObject({ duration: 45, output_format: "mp3", steps: 8, cfg_scale: 7 });

    const eleven = music({
      model: "elevenlabs/music_v2",
      prompt: "x",
      finetune_id: "ft_1",
      finetune_strength: 0.5,
      sign_with_c2pa: true,
    } as never) as unknown as Record<string, unknown>;
    expect(eleven).toMatchObject({
      finetune_id: "ft_1",
      finetune_strength: 0.5,
      sign_with_c2pa: true,
    });
  });
});
