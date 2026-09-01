import { describe, expect, test } from "bun:test";
import {
  sts,
  stsToFormData,
  STS_MODEL_ID,
  VOICE_CONVERSION_JSON_URL,
  VOICE_CONVERSION_URL,
} from "./sts";
import { models } from "./models";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";

// Bypasses the compile-time surface so runtime enforcement can be exercised.
const safeUnchecked = sts.safe as unknown as (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;

const clip = () => new Blob([new Uint8Array([1, 2, 3])], { type: "audio/wav" });

describe("hume.sts happy path", () => {
  test("returns the validated form fields with an empty-headers request", () => {
    const blob = clip();
    const v = sts({ audio: blob });

    expect(Object.keys(v)).toEqual(["audio"]);
    expect(v.audio).toBe(blob);

    expect(v.request.url).toBe(VOICE_CONVERSION_URL);
    expect(v.request.method).toBe("POST");
    // Multipart: fetch must derive the boundary from the FormData body.
    expect(v.request.headers).toEqual({});
  });

  test("all six documented fields validate together — and there are only six", () => {
    const r = sts.safe({
      audio: clip(),
      voice: { name: "Male English Actor", provider: "HUME_AI" },
      format: { type: "mp3" },
      context: { generation_id: "gen_1" },
      strip_headers: true,
      include_timestamp_types: ["word", "phoneme"],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  test("a voice is referenced by id or by name, never both", () => {
    expect(sts.safe({ audio: clip(), voice: { id: "f898a92e" } }).ok).toBe(true);
    expect(sts.safe({ audio: clip(), voice: { name: "Inspiring Man" } }).ok).toBe(true);
    // Both spellings carry the optional provider.
    expect(
      sts.safe({ audio: clip(), voice: { id: "f898a92e", provider: "CUSTOM_VOICE" } }).ok,
    ).toBe(true);
  });

  test("`voice` is optional here — the wire says so, so the substrate does too", () => {
    // The unified `sts()` REQUIRES a target voice; this layer is what keeps the
    // request Hume's schema permits expressible. See src/unified/sts.ts.
    const r = sts.safe({ audio: clip() });
    expect(r.ok).toBe(true);
  });
});

describe("hume.sts synthetic model id", () => {
  test("the route has no model field, so the id never reaches the body", () => {
    const v = sts({ audio: clip() });
    expect(Object.keys(v)).not.toContain("model");
    expect(Object.keys(v)).not.toContain("version");
    expect(STS_MODEL_ID).toBe("voice-conversion");
  });

  test("the catalog row is audio-in/audio-out and carries no cost", () => {
    const info = models["voice-conversion"];
    expect(info.modalities.input).toEqual(["audio"]);
    expect(info.modalities.output).toEqual(["audio"]);
    // hume.ai/pricing publishes no rate for voice conversion — see ./models.ts.
    expect("cost" in info).toBe(false);
  });

  test("there is no estimate, because there is no published rate", () => {
    const r = sts.safe({ audio: clip() });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeUndefined();
  });
});

describe("hume.sts field validation", () => {
  test("audio is required and must be a Blob", () => {
    const missing = safeUnchecked({});
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.errors[0]?.path).toEqual(["audio"]);

    const wrong = safeUnchecked({ audio: "https://example.com/clip.wav" });
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.errors[0]?.path).toEqual(["audio"]);
  });

  test("format.type is the three-member container enum", () => {
    for (const type of ["mp3", "pcm", "wav"] as const) {
      expect(sts.safe({ audio: clip(), format: { type } }).ok).toBe(true);
    }
    expect(safeUnchecked({ audio: clip(), format: { type: "opus" } }).ok).toBe(false);
  });

  test("include_timestamp_types is word/phoneme", () => {
    expect(safeUnchecked({ audio: clip(), include_timestamp_types: ["sentence"] }).ok).toBe(false);
  });

  test("an empty voice id is refused", () => {
    expect(safeUnchecked({ audio: clip(), voice: { id: "" } }).ok).toBe(false);
  });

  test("voice.provider is the two-member enum", () => {
    expect(safeUnchecked({ audio: clip(), voice: { id: "x", provider: "OPENAI" } }).ok).toBe(false);
  });
});

describe("hume.stsToFormData", () => {
  test("objects become JSON parts and the list is appended item by item", () => {
    const v = sts({
      audio: clip(),
      voice: { name: "Male English Actor", provider: "HUME_AI" },
      format: { type: "mp3" },
      context: { generation_id: "gen_1" },
      strip_headers: true,
      include_timestamp_types: ["word", "phoneme"],
    });
    const form = stsToFormData(v);

    expect(form.get("audio")).toBeInstanceOf(Blob);
    expect((form.get("audio") as Blob).size).toBe(3);
    // The official SDK's serialization: one JSON-string part per object.
    expect(form.get("voice")).toBe('{"name":"Male English Actor","provider":"HUME_AI"}');
    expect(form.get("format")).toBe('{"type":"mp3"}');
    expect(form.get("context")).toBe('{"generation_id":"gen_1"}');
    expect(form.get("strip_headers")).toBe("true");
    expect(form.getAll("include_timestamp_types")).toEqual(["word", "phoneme"]);
  });

  test("null and undefined fields are omitted", () => {
    const form = stsToFormData({ audio: clip(), voice: null, context: null });
    expect([...form.keys()]).toEqual(["audio"]);
  });
});

describe("hume.sts siblings", () => {
  test("the /json route takes the same body and is named, not addressed", () => {
    // Same six fields, different response shape — so it is a URL constant
    // rather than a second validator. See the module JSDoc.
    expect(VOICE_CONVERSION_JSON_URL).toBe("https://api.hume.ai/v0/tts/voice_conversion/json");
    expect(VOICE_CONVERSION_URL).toBe("https://api.hume.ai/v0/tts/voice_conversion/file");
  });
});

describe("toSdk('hume')", () => {
  test("camelCases the two multi-word fields and leaves the objects alone", () => {
    const v = sts({
      audio: clip(),
      voice: { id: "f898a92e" },
      format: { type: "wav" },
      strip_headers: false,
      include_timestamp_types: ["word"],
    });
    expect(v.toSdk("hume")).toEqual({
      audio: v.audio,
      voice: { id: "f898a92e" },
      format: { type: "wav" },
      stripHeaders: false,
      includeTimestampTypes: ["word"],
    });
  });
});
