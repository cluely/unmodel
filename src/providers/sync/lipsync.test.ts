/**
 * `sync.lipsync` and `sync.avatar` — two addresses on ONE url, and the
 * cross-field rules that make sync. worth validating rather than passing
 * through.
 *
 * Six of those rules are stated in sync.'s own documentation and every one of
 * them is either a 4xx or a silent no-op if broken: the `input` arity rule
 * (exactly one visual, one voice), the `url`-or-`assetId` pairing the spec
 * encodes as an `anyOf` and therefore leaves both fields optional, the
 * image-narrows-the-model rule, the four model-gated `options`, the `dubParams`
 * conflict that has its own error code, and the `segments`/`refId` linkage.
 */

import { describe, expect, test } from "bun:test";
import { lipsync } from "./lipsync";
import { avatar } from "./avatar";
import { models, provider } from "./models";
import {
  ANALYZE_COST_URL,
  ERRORS_URL,
  GENERATE_URL,
  SYNC_ERROR_CODES,
  SYNC_IMAGE_MODELS,
  SYNC_MODELS,
  generationUrl,
} from "./shared";

const CLIP = { type: "video", url: "https://example.com/take-3.mp4" } as const;
const VOICE = { type: "audio", url: "https://example.com/vo.wav" } as const;
const STILL = { type: "image", url: "https://example.com/headshot.jpg" } as const;

describe("the wire", () => {
  test("both addresses post to the SAME url, and the body is the params", () => {
    const clip = lipsync({ model: "lipsync-2", input: [CLIP, VOICE] });
    expect(clip.request.url).toBe("https://api.sync.so/v2/generate");
    expect(clip.request.method).toBe("POST");
    expect(JSON.parse(JSON.stringify(clip))).toEqual({
      model: "lipsync-2",
      input: [CLIP, VOICE],
    });

    const still = avatar({ model: "sync-3", input: [STILL, VOICE] });
    expect(still.request.url).toBe(clip.request.url);
    expect(JSON.parse(JSON.stringify(still))).toEqual({
      model: "sync-3",
      input: [STILL, VOICE],
    });
  });

  test("the URL constants are the ones the module publishes", () => {
    expect(GENERATE_URL).toBe("https://api.sync.so/v2/generate");
    expect(generationUrl("gen_abc123")).toBe("https://api.sync.so/v2/generate/gen_abc123");
    expect(ANALYZE_COST_URL).toBe("https://api.sync.so/v2/analyze/cost");
    expect(ERRORS_URL).toBe("https://api.sync.so/v2/errors");
  });

  test("generationUrl carries the three documented query params — and the XOR is a compile error", () => {
    // The no-arg call is the regression guard: an optional second argument
    // must not change what every existing caller already gets.
    expect(generationUrl("gen_abc123")).toBe("https://api.sync.so/v2/generate/gen_abc123");

    expect(generationUrl("gen_abc123", { include: "progress" })).toBe(
      "https://api.sync.so/v2/generate/gen_abc123?include=progress",
    );
    expect(generationUrl("gen_abc123", { wait: true, timeout: 8 })).toBe(
      "https://api.sync.so/v2/generate/gen_abc123?wait=true&timeout=8",
    );
    // `wait: false` is a real value, not an omission.
    expect(generationUrl("gen_abc123", { wait: false })).toBe(
      "https://api.sync.so/v2/generate/gen_abc123?wait=false",
    );

    // `GenerationId` is typed `string`, not a uuid, so the path segment is encoded.
    expect(generationUrl("gen abc/123")).toBe(
      "https://api.sync.so/v2/generate/gen%20abc%2F123",
    );

    // sync. documents it: "Cannot be combined with include=progress." The
    // union says so at compile time rather than at the 400.
    // @ts-expect-error `wait` and `include: "progress"` are mutually exclusive.
    expect(generationUrl("gen_abc123", { wait: true, include: "progress" })).toContain("include");
  });

  test('`.toSdk("sync")` returns the body unchanged', () => {
    const params = lipsync({ model: "lipsync-2", input: [CLIP, VOICE] });
    expect(params.toSdk("sync")).toEqual({ model: "lipsync-2", input: [CLIP, VOICE] });
  });

  test("auth is prose, never a header unmodel writes", () => {
    const params = lipsync({ model: "lipsync-2", input: [CLIP, VOICE] });
    const headers = Object.keys(params.request.headers).map((key) => key.toLowerCase());
    expect(headers).not.toContain("x-api-key");
    expect(headers).not.toContain("authorization");
    expect(params.request.headers).toEqual({ "content-type": "application/json" });
    // The env var the vendor's own SDK reads.
    expect(provider.env).toEqual(["SYNC_API_KEY"]);
  });
});

describe("the input array's arity rule", () => {
  test("exactly one visual input, and two clips is refused by count", () => {
    const two = lipsync.safe({
      model: "lipsync-2",
      input: [CLIP, { type: "video", url: "https://example.com/take-4.mp4" }, VOICE],
    });
    expect(two.ok).toBe(false);
    if (two.ok) return;
    expect(two.errors[0]?.code).toBe("invalid_shape");
    expect(two.errors[0]?.message).toContain("exactly one visual input");
  });

  test("a request with no voice input is refused, naming both ways to give one", () => {
    const result = lipsync.safe({ model: "lipsync-2", input: [CLIP] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((issue) => issue.message.includes("elevenlabs"))).toBe(true);
  });

  test("a `text` input counts as the voice, and carries its provider config", () => {
    const result = lipsync({
      model: "lipsync-2",
      input: [
        CLIP,
        {
          type: "text",
          provider: { name: "elevenlabs", voiceId: "voice_abc", script: "bonjour" },
        },
      ],
    });
    expect(JSON.parse(JSON.stringify(result))).toMatchObject({
      input: [CLIP, { type: "text" }],
    });
  });

  test("two voices need `segments` to place them, and the message says so", () => {
    const result = lipsync.safe({
      model: "lipsync-2",
      input: [CLIP, VOICE, { type: "audio", url: "https://example.com/vo-2.wav" }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.message).toContain("`segments`");
  });

  test("a media item with neither `url` nor `assetId` is refused by index", () => {
    const result = lipsync.safe({ model: "lipsync-2", input: [{ type: "video" }, VOICE] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const issue = result.errors.find((error) => error.path.join(".") === "input.0.url");
    expect(issue?.code).toBe("invalid_shape");
    expect(issue?.message).toContain("assetId");
  });

  test("an `assetId` satisfies the pairing on its own", () => {
    const result = lipsync.safe({
      model: "lipsync-2",
      input: [{ type: "video", assetId: "asset_abc" }, VOICE],
    });
    expect(result.ok, JSON.stringify(result.ok ? [] : result.errors)).toBe(true);
  });
});

describe("the image gate", () => {
  test("`sync-3` is the only model that reads a still", () => {
    expect([...SYNC_IMAGE_MODELS]).toEqual(["sync-3"]);
    expect(avatar.safe({ model: "sync-3", input: [STILL, VOICE] }).ok).toBe(true);
  });

  test("an image input at any other model is refused, naming the one that takes it", () => {
    for (const model of ["lipsync-2", "lipsync-2-pro", "react-1"]) {
      const result = avatar.safe({ model, input: [STILL, VOICE] });
      expect(result.ok, model).toBe(false);
      if (result.ok) continue;
      const issue = result.errors.find((error) => error.path.join(".") === "model");
      expect(issue?.code, model).toBe("unsupported_capability");
      expect(issue?.message, model).toContain('"sync-3"');
    }
  });

  test("the clip address does not accept an image item at all", () => {
    // Earlier than `checkImageModel`, and deliberately: `sync.lipsync`'s own
    // schema types `input` as `Video | Audio | TTS`, so a `{ type: "image" }`
    // item is a shape error at the zod layer rather than a model gate. The
    // gate is what catches an image at the AVATAR address with the wrong model.
    const result = lipsync.safe({ model: "lipsync-2", input: [STILL, VOICE] } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((issue) => issue.path.join(".").startsWith("input"))).toBe(true);
  });
});

/** The warning paths a request produced — the `safe` form is where they live. */
function warningsOf(result: { ok: boolean; warnings: readonly { path: readonly (string | number)[] }[] }): string[] {
  return result.warnings.map((issue) => issue.path.join("."));
}

describe("the four model-gated options", () => {
  test("`temperature` is a lipsync-2-family dial and warns elsewhere", () => {
    const ok = lipsync.safe({
      model: "lipsync-2",
      input: [CLIP, VOICE],
      options: { temperature: 0.9 },
    });
    expect(ok.ok).toBe(true);
    expect(ok.warnings).toEqual([]);

    const warned = lipsync.safe({
      model: "sync-3",
      input: [CLIP, VOICE],
      options: { temperature: 0.9 },
    });
    // A WARNING and not an error, because sync. accepts the request and ignores
    // the dial — refusing would reject something the API fulfils.
    expect(warned.ok).toBe(true);
    expect(warningsOf(warned)).toContain("options.temperature");
    expect(warned.warnings[0]?.severity).toBe("warning");
    expect(warned.warnings[0]?.message).toContain("ignores an option a model does not take");
  });

  test("`occlusion_detection_enabled` is absent on sync-3, which does it natively", () => {
    const warned = lipsync.safe({
      model: "sync-3",
      input: [CLIP, VOICE],
      options: { occlusion_detection_enabled: true },
    });
    expect(warningsOf(warned)).toContain("options.occlusion_detection_enabled");
  });

  test("`prompt` and `model_mode` are react-1 only", () => {
    const ok = lipsync.safe({
      model: "react-1",
      input: [CLIP, VOICE],
      options: { prompt: "happy", model_mode: "head" },
    });
    expect(ok.warnings).toEqual([]);

    const warned = lipsync.safe({
      model: "lipsync-2",
      input: [CLIP, VOICE],
      options: { prompt: "happy", model_mode: "head" },
    });
    const paths = warningsOf(warned);
    expect(paths).toContain("options.prompt");
    expect(paths).toContain("options.model_mode");
  });

  test("`sync_mode` is gated on nothing and reaches every model", () => {
    for (const model of SYNC_MODELS) {
      const result = lipsync.safe({
        model,
        input: [CLIP, VOICE],
        options: { sync_mode: "remap" },
      });
      expect(result.warnings, model).toEqual([]);
    }
  });
});

describe("the two options a still ignores", () => {
  test("`sync_mode` warns on the image address — an image has no duration", () => {
    const result = avatar.safe({
      model: "sync-3",
      input: [STILL, VOICE],
      options: { sync_mode: "loop" },
    });
    expect(warningsOf(result)).toContain("options.sync_mode");
    expect(result.warnings[0]?.message).toContain("no duration to mismatch");
  });

  test("`auto_detect: true` is an ERROR, and the message gives the alternative", () => {
    const result = avatar.safe({
      model: "sync-3",
      input: [STILL, VOICE],
      options: { active_speaker_detection: { auto_detect: true } },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const issue = result.errors.find(
      (error) => error.path.join(".") === "options.active_speaker_detection.auto_detect",
    );
    expect(issue?.code).toBe("unsupported_param");
    expect(issue?.message).toContain("frame_number: 0");
    expect(issue?.message).toContain("NATIVE PIXEL");
  });

  test("manual speaker selection on a still is accepted", () => {
    const result = avatar.safe({
      model: "sync-3",
      input: [STILL, VOICE],
      options: { active_speaker_detection: { coordinates: [512, 384], frame_number: 0 } },
    });
    expect(result.ok, JSON.stringify(result.ok ? [] : result.errors)).toBe(true);
  });
});

describe("dubbing and segments", () => {
  test("`dubParams` forbids a voice input, and that is its own error code at sync.", () => {
    const result = lipsync.safe({
      model: "lipsync-2",
      input: [CLIP, VOICE],
      dubParams: { providerName: "elevenlabs", targetLang: "fr" },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const issue = result.errors.find((error) => error.path.join(".") === "dubParams");
    expect(issue?.code).toBe("invalid_shape");
    expect(issue?.message).toContain('"fr"');
  });

  test("a dubbed request with only the clip compiles", () => {
    const result = lipsync.safe({
      model: "lipsync-2",
      input: [CLIP],
      dubParams: { providerName: "elevenlabs", targetLang: "ja", sourceLang: "auto" },
    });
    expect(result.ok, JSON.stringify(result.ok ? [] : result.errors)).toBe(true);
  });

  test("`segments` requires a unique `refId` on every voice input", () => {
    const missing = lipsync.safe({
      model: "lipsync-2",
      input: [CLIP, VOICE],
      segments: [{ startTime: 0, endTime: 4, audioInput: { refId: "a" } }],
    });
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.errors.some((issue) => issue.message.includes("`refId`"))).toBe(true);

    const duplicated = lipsync.safe({
      model: "lipsync-2",
      input: [
        CLIP,
        { ...VOICE, refId: "a" },
        { type: "audio", url: "https://example.com/vo-2.wav", refId: "a" },
      ],
      segments: [
        { startTime: 0, endTime: 4, audioInput: { refId: "a" } },
        { startTime: 4, endTime: 8, audioInput: { refId: "a" } },
      ],
    });
    expect(duplicated.ok).toBe(false);
    if (duplicated.ok) return;
    expect(duplicated.errors.some((issue) => issue.message.includes("more than one input"))).toBe(
      true,
    );
  });

  test("a segment naming a track that does not exist is refused by index", () => {
    const result = lipsync.safe({
      model: "lipsync-2",
      input: [CLIP, { ...VOICE, refId: "french" }],
      segments: [{ startTime: 0, endTime: 4, audioInput: { refId: "german" } }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const issue = result.errors.find(
      (error) => error.path.join(".") === "segments.0.audioInput.refId",
    );
    expect(issue?.message).toContain('"french"');
  });

  test("a backwards time range and a half-given crop are both caught", () => {
    const backwards = lipsync.safe({
      model: "lipsync-2",
      input: [CLIP, { ...VOICE, refId: "a" }],
      segments: [{ startTime: 8, endTime: 4, audioInput: { refId: "a" } }],
    });
    expect(backwards.ok).toBe(false);

    const halfCrop = lipsync.safe({
      model: "lipsync-2",
      input: [CLIP, { ...VOICE, refId: "a" }],
      segments: [{ startTime: 0, endTime: 4, audioInput: { refId: "a", startTime: 1 } }],
    });
    expect(halfCrop.ok).toBe(false);
    if (halfCrop.ok) return;
    expect(halfCrop.errors.some((issue) => issue.message.includes("PAIR"))).toBe(true);
  });

  test("a well-formed multi-voice segmented request compiles", () => {
    const result = lipsync.safe({
      model: "lipsync-2",
      input: [
        CLIP,
        { ...VOICE, refId: "french" },
        { type: "audio", url: "https://example.com/vo-de.wav", refId: "german" },
      ],
      segments: [
        { startTime: 0, endTime: 4, audioInput: { refId: "french" } },
        { startTime: 4, endTime: 8, audioInput: { refId: "german", startTime: 0, endTime: 4 } },
      ],
    });
    expect(result.ok, JSON.stringify(result.ok ? [] : result.errors)).toBe(true);
  });
});

describe("the catalog", () => {
  test("every published model id has a row, and the roster is the five documented ones", () => {
    expect([...(SYNC_MODELS as readonly string[])].sort()).toEqual(Object.keys(models).sort());
    expect(SYNC_MODELS).toHaveLength(5);
    // The two ids that appear only in the full backend spec — no docs page, no
    // rate, no SDK type — are deliberately absent.
    expect(Object.keys(models)).not.toContain("lipsync-2-mini");
    expect(Object.keys(models)).not.toContain("appearence-1");
  });

  test("every row carries the per-second rate, and they are all different", () => {
    const rates = Object.values(models).map((row) => row.cost?.perVideoSecond);
    expect(rates.every((rate) => typeof rate === "number")).toBe(true);
    expect(new Set(rates).size).toBe(rates.length);
    // The list rate, which is the top of each published band.
    expect(models["lipsync-2"].cost?.perVideoSecond).toBe(0.05);
    expect(models["sync-3"].cost?.perVideoSecond).toBe(0.133);
  });

  test("only sync-3 declares an image input, which is the avatar half's whole basis", () => {
    for (const [id, row] of Object.entries(models)) {
      expect((row.modalities.input as readonly string[]).includes("image"), id).toBe(
        id === "sync-3",
      );
      expect(row.modalities.output, id).toEqual(["video"]);
    }
  });

  test("no row has a token context window, and 0 is what says so", () => {
    for (const row of Object.values(models)) expect(row.limit.context).toBe(0);
  });
});

describe("the error catalog", () => {
  test("62 codes, transcribed from the unauthenticated endpoint", () => {
    expect(SYNC_ERROR_CODES).toHaveLength(62);
    expect(new Set(SYNC_ERROR_CODES).size).toBe(62);
  });

  test("the codes the checks in this file exist to pre-empt are all in it", () => {
    for (const code of [
      "generation_unsupported_model",
      "generation_input_too_many_visual",
      "generation_input_dub_audio_conflict",
      "generation_input_segments_invalid",
    ]) {
      expect(SYNC_ERROR_CODES as readonly string[]).toContain(code);
    }
  });
});
