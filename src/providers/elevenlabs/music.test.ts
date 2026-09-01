import { describe, expect, test } from "bun:test";
import {
  music,
  musicUrl,
  requestedDurationMs,
  MUSIC_URL,
  MUSIC_LENGTH_MS_MAX,
  MUSIC_OUTPUT_FORMATS,
  MUSIC_PROMPT_MAX_CHARACTERS,
  MUSIC_FINETUNE_STRENGTH_MAX,
} from "./music";
import {
  models,
  MUSIC_MODEL_IDS,
  MUSIC_PER_AUDIO_MINUTE,
  SOUND_EFFECTS_PER_AUDIO_MINUTE,
  VOICE_CHANGER_PER_AUDIO_MINUTE,
} from "./models";
import { UnmodelValidationError } from "../../core/issues";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";

const safeUnchecked = music.safe as unknown as (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;

const sectionsPlan = {
  positive_global_styles: ["pop", "warm synths"],
  negative_global_styles: ["metal"],
  sections: [
    {
      section_name: "Verse 1",
      positive_local_styles: ["pop"],
      negative_local_styles: [],
      duration_ms: 15000,
      lines: ["City lights are fading"],
    },
  ],
};

const chunksPlan = {
  chunks: [
    { text: "[Verse]\nCity lights", duration_ms: 15000, positive_styles: ["pop"] },
    { text: "[Chorus]\nHold on", duration_ms: 15000, positive_styles: ["uplifting"] },
  ],
};

describe("elevenlabs.music wire shape", () => {
  test("output_format is a query param, stripped from the body", () => {
    const v = music({
      prompt: "An uplifting synthwave track",
      music_length_ms: 30000,
      model_id: "music_v2",
      output_format: "mp3_48000_192",
    });

    expect(Object.keys(v)).toEqual(["prompt", "music_length_ms", "model_id"]);
    expect(v.request.url).toBe(`${MUSIC_URL}?output_format=mp3_48000_192`);
    expect(v.request.method).toBe("POST");
    expect(v.request.headers["content-type"]).toBe("application/json");
  });

  test("no output_format → bare endpoint URL", () => {
    expect(musicUrl()).toBe(MUSIC_URL);
    expect(music({ prompt: "hi" }).request.url).toBe(MUSIC_URL);
  });

  test("toSdk camelCases keys, drops nulls and carries outputFormat", () => {
    const v = music({
      prompt: "hi",
      music_length_ms: 10000,
      model_id: "music_v2",
      force_instrumental: true,
      finetune_id: null,
      output_format: "mp3_44100_128",
    });
    expect(v.toSdk("elevenlabs")).toEqual({
      prompt: "hi",
      musicLengthMs: 10000,
      modelId: "music_v2",
      forceInstrumental: true,
      outputFormat: "mp3_44100_128",
    });
  });

  test("an undocumented output_format is invalid_enum_value", () => {
    // `output_format` is a closed union, so the bogus value only reaches the
    // runtime check through the unchecked cast.
    const r = safeUnchecked({ prompt: "hi", output_format: "mp3_96000_512" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("invalid_enum_value");
      expect(r.errors[0]?.path).toEqual(["output_format"]);
    }
  });

  test("every MUSIC_OUTPUT_FORMATS preset validates cleanly", () => {
    // Keep in sync with ElevenlabsMusicOutputFormat — the union is closed
    // (no `(string & {})` tail), so every value it advertises must pass
    // checkOutputFormat or autocomplete would offer formats the API rejects.
    expect(MUSIC_OUTPUT_FORMATS.length).toBe(26);
    for (const output_format of MUSIC_OUTPUT_FORMATS) {
      const r = music.safe({ prompt: "hi", output_format });
      expect(r.ok, `preset ${output_format} should validate`).toBe(true);
      if (r.ok) expect(r.warnings, `preset ${output_format} should be warning-free`).toEqual([]);
    }
  });
});

describe("elevenlabs.music model gate", () => {
  test("both music ids pass", () => {
    for (const model_id of MUSIC_MODEL_IDS) {
      expect(music.safe({ prompt: "hi", model_id }).ok).toBe(true);
    }
  });

  test("a TTS model id is rejected as unsupported_capability", () => {
    const r = music.safe({ prompt: "hi", model_id: "eleven_multilingual_v2" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("unsupported_capability");
      expect(r.errors[0]?.path).toEqual(["model_id"]);
    }
  });

  test("an id absent from the catalog only warns", () => {
    const r = music.safe({ prompt: "hi", model_id: "music_v3" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
  });
});

describe("elevenlabs.music prompt / composition_plan rules", () => {
  test("prompt and composition_plan together is invalid_shape", () => {
    const r = music.safe({ prompt: "hi", composition_plan: sectionsPlan });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((e) => e.code === "invalid_shape");
      expect(issue?.path).toEqual(["composition_plan"]);
    }
  });

  test("music_length_ms and force_instrumental are prompt-only (ignored with a plan)", () => {
    const r = music.safe({
      composition_plan: sectionsPlan,
      model_id: "music_v1",
      music_length_ms: 30000,
      force_instrumental: true,
    });
    // The docs never say the API rejects them, so they warn instead of failing
    // a request the API fulfils.
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings.map((w) => w.path[0]).sort()).toEqual([
        "force_instrumental",
        "music_length_ms",
      ]);
      expect(r.warnings.every((w) => w.meta?.ignored === true)).toBe(true);
    }
  });

  test("a chunks plan requires music_v2; a sections plan requires music_v1", () => {
    expect(music.safe({ composition_plan: chunksPlan, model_id: "music_v2" }).ok).toBe(true);
    expect(music.safe({ composition_plan: sectionsPlan, model_id: "music_v1" }).ok).toBe(true);

    const wrongChunks = music.safe({ composition_plan: chunksPlan, model_id: "music_v1" });
    expect(wrongChunks.ok).toBe(false);
    if (!wrongChunks.ok) {
      expect(wrongChunks.errors[0]?.path).toEqual(["composition_plan", "chunks"]);
    }

    const wrongSections = music.safe({ composition_plan: sectionsPlan, model_id: "music_v2" });
    expect(wrongSections.ok).toBe(false);
    if (!wrongSections.ok) {
      expect(wrongSections.errors[0]?.path).toEqual(["composition_plan", "sections"]);
    }
  });

  test("the default model (music_v1) is what an omitted model_id is checked against", () => {
    const r = music.safe({ composition_plan: chunksPlan });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.model).toBe("music_v1");
  });
});

describe("elevenlabs.music ignored-param warnings", () => {
  test("respect_sections_durations warns on music_v2", () => {
    const r = music.safe({
      composition_plan: chunksPlan,
      model_id: "music_v2",
      respect_sections_durations: false,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings.map((w) => w.code)).toEqual(["unsupported_param"]);
      expect(r.warnings[0]?.meta?.ignored).toBe(true);
    }
  });

  test("seed alongside prompt warns but passes", () => {
    const r = music.safe({ prompt: "hi", seed: 42 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings[0]?.path).toEqual(["seed"]);
    // With a plan instead of a prompt there is nothing to warn about.
    expect(
      music.safe({ composition_plan: sectionsPlan, model_id: "music_v1", seed: 42 }).warnings ?? [],
    ).toEqual([]);
  });
});

describe("elevenlabs.music shape bounds", () => {
  test("music_length_ms outside 3000–600000 is invalid_shape", () => {
    for (const ms of [2999, MUSIC_LENGTH_MS_MAX + 1]) {
      const r = music.safe({ prompt: "hi", music_length_ms: ms });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors[0]?.path).toEqual(["music_length_ms"]);
    }
    expect(music.safe({ prompt: "hi", music_length_ms: 3000 }).ok).toBe(true);
  });

  test("prompt longer than 4100 characters is invalid_shape", () => {
    const r = music.safe({ prompt: "x".repeat(MUSIC_PROMPT_MAX_CHARACTERS + 1) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["prompt"]);
  });

  test("a section duration outside 3000–120000 ms is invalid_shape", () => {
    const r = safeUnchecked({
      model_id: "music_v1",
      composition_plan: {
        positive_global_styles: [],
        negative_global_styles: [],
        sections: [
          {
            section_name: "Verse 1",
            positive_local_styles: [],
            negative_local_styles: [],
            duration_ms: 120001,
            lines: [],
          },
        ],
      },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("invalid_shape");
  });

  test("unknown body params warn but pass through", () => {
    const r = safeUnchecked({ prompt: "hi", lyrics_text: "la la la" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["unknown_param"]);
  });
});

// The two `x-fern-ignore` body fields: real on the served spec
// (https://api.elevenlabs.io/openapi.json#/paths/~1v1~1music/post), absent from
// the rendered docs page and from the generated SDK.
describe("elevenlabs.music finetune_strength / use_phonetic_names", () => {
  test("both reach the wire body, and toSdk passes them through unmapped", () => {
    const v = music({
      prompt: "hi",
      finetune_id: "ft_123",
      finetune_strength: 0.6,
      use_phonetic_names: true,
    });
    expect(JSON.parse(JSON.stringify(v))).toEqual({
      prompt: "hi",
      finetune_id: "ft_123",
      finetune_strength: 0.6,
      use_phonetic_names: true,
    });
    expect(v.toSdk("elevenlabs")).toEqual({
      prompt: "hi",
      finetuneId: "ft_123",
      finetune_strength: 0.6,
      use_phonetic_names: true,
    });
  });

  test("finetune_strength is bounded by 0 < x <= 2 (exclusive minimum)", () => {
    const ok = (value: number) =>
      music.safe({ prompt: "hi", finetune_id: "ft_123", finetune_strength: value }).ok;
    expect(ok(MUSIC_FINETUNE_STRENGTH_MAX)).toBe(true);
    expect(ok(1)).toBe(true);
    expect(ok(0.0001)).toBe(true);

    // 0 is excluded: the spec says `"exclusiveMinimum": 0`.
    const zero = music.safe({ prompt: "hi", finetune_id: "ft_123", finetune_strength: 0 });
    expect(zero.ok).toBe(false);
    if (!zero.ok) {
      expect(zero.errors[0]?.code).toBe("invalid_shape");
      expect(zero.errors[0]?.path).toEqual(["finetune_strength"]);
    }

    const tooBig = music.safe({
      prompt: "hi",
      finetune_id: "ft_123",
      finetune_strength: MUSIC_FINETUNE_STRENGTH_MAX + 0.1,
    });
    expect(tooBig.ok).toBe(false);
    if (!tooBig.ok) expect(tooBig.errors[0]?.path).toEqual(["finetune_strength"]);

    expect(music.safe({ prompt: "hi", finetune_id: "ft_123", finetune_strength: -1 }).ok).toBe(
      false,
    );
  });

  test("finetune_strength without finetune_id only warns", () => {
    const r = music.safe({ prompt: "hi", finetune_strength: 0.5 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const warning = r.warnings.find((w) => w.path[0] === "finetune_strength");
      expect(warning?.code).toBe("unsupported_param");
      expect(warning?.meta?.ignored).toBe(true);
    }
  });

  test("a wrongly typed use_phonetic_names is invalid_shape", () => {
    const r = safeUnchecked({ prompt: "hi", use_phonetic_names: "yes" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["use_phonetic_names"]);
  });
});

describe("elevenlabs.music cost estimation", () => {
  test("catalog carries $0.15 per generated minute", () => {
    expect(models.music_v2.cost?.perAudioMinute).toBe(MUSIC_PER_AUDIO_MINUTE);
    expect(MUSIC_PER_AUDIO_MINUTE).toBe(0.15);
  });

  /**
   * The two rates on the same page that this catalog shipped as "no USD rate
   * published" — a false provenance claim rather than the "unverifiable →
   * caveat" rule acting. Pinned here beside Music because the same
   * elevenlabs.io/pricing/api card set carries all three, so one refresh pass
   * either updates every number or fails this file.
   */
  test("sound effects and voice changer carry the $0.12 per-minute rate", () => {
    expect(SOUND_EFFECTS_PER_AUDIO_MINUTE).toBe(0.12);
    expect(VOICE_CHANGER_PER_AUDIO_MINUTE).toBe(0.12);
    expect(models.eleven_text_to_sound_v2.cost?.perAudioMinute).toBe(
      SOUND_EFFECTS_PER_AUDIO_MINUTE,
    );
    for (const id of ["eleven_multilingual_sts_v2", "eleven_english_sts_v2", "eleven_english_sts_v1"] as const) {
      expect(models[id].cost?.perAudioMinute, id).toBe(VOICE_CHANGER_PER_AUDIO_MINUTE);
    }
  });

  test("music_length_ms drives the estimate", () => {
    const r = music.safe({ prompt: "hi", music_length_ms: 60000, model_id: "music_v2" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.15, 10);
  });

  test("a composition plan is costed from its summed durations", () => {
    expect(requestedDurationMs({ composition_plan: chunksPlan })).toBe(30000);
    const r = music.safe({ composition_plan: chunksPlan, model_id: "music_v2" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.075, 10);
  });

  test("no stated length → no estimate (the model picks the length)", () => {
    const r = music.safe({ prompt: "hi" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeUndefined();
  });

  test("maxCostUSD turns a long track into over_budget", () => {
    const r = music.safe({ prompt: "hi", music_length_ms: 600000 }, { maxCostUSD: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.code === "over_budget")).toBe(true);
  });

  test("the throwing form throws UnmodelValidationError", () => {
    const throwing = music as unknown as (params: unknown) => unknown;
    let caught: unknown;
    try {
      throwing({ prompt: "hi", composition_plan: sectionsPlan });
    } catch (error) {
      caught = error;
    }
    expect(UnmodelValidationError.isInstance(caught)).toBe(true);
  });
});
