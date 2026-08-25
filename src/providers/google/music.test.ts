import { describe, expect, test } from "bun:test";
import { CREATE_INTERACTION_URL, music, musicInteractionUrl } from "./music";
import { LYRIA_PRICE_PER_SONG_USD, musicModels } from "./lyria-models";
import {
  GOOGLE_MUSIC_MODEL_PARAMS,
  LYRIA_MAX_INPUT_IMAGES,
  LYRIA_MUSIC_DOCS_URL,
  LYRIA_REALTIME_MODEL_ID,
  MODELS,
} from "./music-params";
import { music as adapter } from "./unified-music";
import type { Issue } from "../../core/issues";
import type { ValidateResult } from "../../core/result";

function expectError(result: ValidateResult<unknown>, code: Issue["code"]): Issue {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected validation failure");
  const issue = result.errors.find((e) => e.code === code);
  expect(issue).toBeDefined();
  return issue!;
}

function expectOk<V>(result: ValidateResult<V>) {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`expected ok, got: ${JSON.stringify(result.errors)}`);
  return result;
}

describe("wire purity", () => {
  test("model stays IN the body — the Interactions URL carries no id", () => {
    const validated = music({
      model: "lyria-3-clip-preview",
      input: "A short instrumental acoustic guitar piece.",
    });
    expect(Object.keys(validated).sort()).toEqual(["input", "model"]);
    expect(JSON.parse(JSON.stringify(validated))).toEqual({
      model: "lyria-3-clip-preview",
      input: "A short instrumental acoustic guitar piece.",
    });
    expect(validated.request.url).toBe(CREATE_INTERACTION_URL);
    expect(validated.request.url).toBe(musicInteractionUrl());
    expect(validated.request.url).not.toContain("lyria");
    expect(validated.request.method).toBe("POST");
    expect(validated.request.headers["content-type"]).toBe("application/json");
  });

  test("a models/-prefixed id is normalized to the bare body spelling", () => {
    const validated = music({
      model: "models/lyria-3-pro-preview" as "lyria-3-pro-preview",
      input: "hi",
    });
    expect(validated.model).toBe("lyria-3-pro-preview");
  });

  test("toSdk('google') is the body verbatim — ai.interactions.create takes the wire shape", () => {
    const body = {
      model: "lyria-3-pro-preview",
      input: "An upbeat synthwave track",
      response_format: { type: "audio", mime_type: "audio/wav" },
    } as const;
    const sdk = music(body).toSdk("google");
    expect(sdk).toEqual(body);
  });
});

describe("input blocks", () => {
  test("text + image blocks validate", () => {
    expectOk(
      music.safe({
        model: "lyria-3-pro-preview",
        input: [
          { type: "text", text: "A song matching this painting's mood" },
          { type: "image", mime_type: "image/jpeg", data: "aGk=" },
        ],
      }),
    );
  });

  test("an empty block array fails the schema", () => {
    expectError(music.safe({ model: "lyria-3-pro-preview", input: [] }), "invalid_shape");
  });

  test("audio blocks are chat shapes, refused here", () => {
    const issue = expectError(
      music.safe({
        model: "lyria-3-pro-preview",
        input: [
          { type: "text", text: "hi" },
          { type: "audio", data: "aGk=" } as never,
        ],
      }),
      "invalid_shape",
    );
    expect(issue.path).toEqual(["input", 1, "type"]);
    expect(issue.meta?.["allowed"]).toEqual(["text", "image"]);
  });

  test("more than 10 images exceed the documented cap", () => {
    const images = Array.from({ length: LYRIA_MAX_INPUT_IMAGES + 1 }, () => ({
      type: "image" as const,
      data: "aGk=",
    }));
    const issue = expectError(
      music.safe({
        model: "lyria-3-pro-preview",
        input: [{ type: "text", text: "hi" }, ...images],
      }),
      "invalid_shape",
    );
    expect(issue.meta?.["limit"]).toBe(10);
    expect(issue.meta?.["source"]).toBe(LYRIA_MUSIC_DOCS_URL);
  });

  test("images without a text block warn — undocumented, not refused", () => {
    const result = expectOk(
      music.safe({
        model: "lyria-3-pro-preview",
        input: [{ type: "image", data: "aGk=" }],
      }),
    );
    expect(result.warnings.some((w) => w.code === "invalid_shape")).toBe(true);
  });
});

describe("response_format (WAV is Pro-only)", () => {
  test("Pro takes the guide's bare { type: 'audio' } WAV switch", () => {
    expectOk(
      music.safe({
        model: "lyria-3-pro-preview",
        input: "hi",
        response_format: { type: "audio" },
      }),
    );
  });

  test("Clip refuses response_format with the guide's quote", () => {
    const issue = expectError(
      music.safe({
        model: "lyria-3-clip-preview",
        input: "hi",
        response_format: { type: "audio" } as never,
      }),
      "unsupported_param",
    );
    expect(issue.path).toEqual(["response_format"]);
    expect(issue.meta?.["source"]).toBe(LYRIA_MUSIC_DOCS_URL);
  });

  test("a non-audio format variant is a chat shape on a music model", () => {
    const issue = expectError(
      music.safe({
        model: "lyria-3-pro-preview",
        input: "hi",
        response_format: { type: "json_schema" } as never,
      }),
      "invalid_enum_value",
    );
    expect(issue.path).toEqual(["response_format", "type"]);
  });

  test("mime types outside audio/mp3 and audio/wav are refused", () => {
    const issue = expectError(
      music.safe({
        model: "lyria-3-pro-preview",
        input: "hi",
        response_format: { type: "audio", mime_type: "audio/ogg_opus" as never },
      }),
      "invalid_enum_value",
    );
    expect(issue.meta?.["allowed"]).toEqual(["audio/mp3", "audio/wav"]);
  });

  test("bit_rate on WAV is refused — compressed formats only", () => {
    const issue = expectError(
      music.safe({
        model: "lyria-3-pro-preview",
        input: "hi",
        response_format: { type: "audio", mime_type: "audio/wav", bit_rate: 128000 },
      }),
      "unsupported_param",
    );
    expect(issue.path).toEqual(["response_format", "bit_rate"]);
  });

  test("bit_rate on MP3 passes", () => {
    expectOk(
      music.safe({
        model: "lyria-3-pro-preview",
        input: "hi",
        response_format: { type: "audio", mime_type: "audio/mp3", bit_rate: 128000 },
      }),
    );
  });
});

describe("single-turn and model gating", () => {
  test("previous_interaction_id is refused — music generation is single-turn", () => {
    const issue = expectError(
      music.safe({
        model: "lyria-3-pro-preview",
        input: "hi",
        previous_interaction_id: "int_123" as never,
      }),
      "unsupported_param",
    );
    expect(issue.path).toEqual(["previous_interaction_id"]);
  });

  test("lyria-realtime-exp is WebSocket-only and rejected by name, without unknown_model noise", () => {
    const result = music.safe({ model: LYRIA_REALTIME_MODEL_ID, input: "hi" });
    const issue = expectError(result, "unsupported_capability");
    expect(issue.message).toContain("ai.live.music.connect");
    if (!result.ok) {
      expect(result.errors.some((e) => e.code === "unknown_model")).toBe(false);
    }
  });

  // The validator's catalog is the mirrored Lyria trio (see ./lyria-models —
  // importing the generated google catalog here would put ~90 KiB of chat
  // rows inside `unmodel/music`), so a text model is simply unknown to this
  // surface: the standard unknown_model warning, not a modality error. The
  // modality gate still exists for any future catalogued row whose output
  // lacks audio.
  test("a text-only model is outside the music catalog — warns, does not pass silently", () => {
    const result = expectOk(music.safe({ model: "gemini-2.5-flash", input: "hi" }));
    expect(result.warnings.some((w) => w.code === "unknown_model")).toBe(true);
  });

  test("an unknown future Lyria id warns but validates", () => {
    const result = expectOk(music.safe({ model: "lyria-4-preview", input: "hi" }));
    expect(result.warnings.some((w) => w.code === "unknown_model")).toBe(true);
  });

  test("unknown top-level keys warn as unknown_param", () => {
    const result = expectOk(
      music.safe({
        model: "lyria-3-pro-preview",
        input: "hi",
        // @ts-expect-error deliberately unknown wire key
        tools: [],
      }),
    );
    expect(result.warnings.some((w) => w.code === "unknown_param")).toBe(true);
  });
});

describe("catalog and pricing", () => {
  test("both batch ids REUSE generated catalog rows; realtime is supplemented", () => {
    for (const id of MODELS) {
      expect(musicModels[id]).toBeDefined();
      expect(musicModels[id]?.family).toBe("lyria");
      expect(musicModels[id]?.modalities.output).toContain("audio");
    }
    expect(musicModels[LYRIA_REALTIME_MODEL_ID]).toBeDefined();
  });

  test("flat per-song pricing: $0.04 Clip, $0.08 Pro", () => {
    expect(LYRIA_PRICE_PER_SONG_USD["lyria-3-clip-preview"]).toBe(0.04);
    expect(LYRIA_PRICE_PER_SONG_USD["lyria-3-pro-preview"]).toBe(0.08);
    const clip = expectOk(music.safe({ model: "lyria-3-clip-preview", input: "hi" }));
    expect(clip.estimate.costUSD).toBeCloseTo(0.04, 10);
    const pro = expectOk(music.safe({ model: "lyria-3-pro-preview", input: "hi" }));
    expect(pro.estimate.costUSD).toBeCloseTo(0.08, 10);
  });
});

describe("unified adapter", () => {
  function compileCtx() {
    const warnings: Array<{ code: string; path?: Array<string | number> }> = [];
    return {
      warnings,
      make(model: string) {
        return {
          model,
          warn: (w: { code: string; path?: Array<string | number> }) => warnings.push(w),
          fail: (w: { code: string }) => warnings.push(w),
          from: () => {},
          take: <T,>(d: { value?: T }) => d.value,
        };
      },
    };
  }

  test("prompt lands at input; outputFormat wav compiles to response_format on Pro", () => {
    const ctx = compileCtx();
    const { params } = adapter.compile(
      { model: "google/lyria-3-pro-preview", prompt: "hi", outputFormat: "pcm_s16le", seed: 7 },
      ctx.make("lyria-3-pro-preview") as never,
    );
    expect(params).toEqual({
      model: "lyria-3-pro-preview",
      input: "hi",
      response_format: { type: "audio", mime_type: "audio/wav" },
      generation_config: { seed: 7 },
    });
  });

  test("outputFormat mp3 on Clip is a silent no-op — the model's own default", () => {
    const ctx = compileCtx();
    const { params } = adapter.compile(
      { model: "google/lyria-3-clip-preview", prompt: "hi", outputFormat: "mp3" },
      ctx.make("lyria-3-clip-preview") as never,
    );
    expect(params).toEqual({ model: "lyria-3-clip-preview", input: "hi" });
    expect(ctx.warnings).toEqual([]);
  });

  test("durationSeconds and instrumental are declared gaps", () => {
    expect(adapter.unsupported.durationSeconds).toContain("controllable using prompt");
    expect(adapter.unsupported.instrumental).toContain("prompt");
  });

  test("the rows publish the codec split the guide documents", () => {
    expect(GOOGLE_MUSIC_MODEL_PARAMS["lyria-3-pro-preview"].codecs).toEqual([
      "mp3",
      "pcm_s16le",
    ]);
    expect(GOOGLE_MUSIC_MODEL_PARAMS["lyria-3-clip-preview"].codecs).toEqual(["mp3"]);
    expect(adapter.models).toBe(MODELS);
    expect(adapter.modelParams).toBe(GOOGLE_MUSIC_MODEL_PARAMS);
  });
});
