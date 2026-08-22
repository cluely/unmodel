import { describe, expect, test } from "bun:test";
import { voiceDesignSave, TEXT_TO_VOICE_URL } from "./voice-design-save";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";

// Bypasses the compile-time surface so runtime enforcement can be exercised.
const safeUnchecked = voiceDesignSave.safe as unknown as (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;

describe("elevenlabs.voiceDesignSave happy path", () => {
  test("returns the exact JSON body and request", () => {
    const v = voiceDesignSave({
      voice_name: "Narrator",
      voice_description: "A calm, deep narrator",
      generated_voice_id: "gv_123",
    });

    expect(Object.keys(v)).toEqual(["voice_name", "voice_description", "generated_voice_id"]);
    expect(JSON.parse(JSON.stringify(v))).toEqual({
      voice_name: "Narrator",
      voice_description: "A calm, deep narrator",
      generated_voice_id: "gv_123",
    });

    expect(v.request.url).toBe(TEXT_TO_VOICE_URL);
    expect(v.request.method).toBe("POST");
    expect(v.request.headers["content-type"]).toBe("application/json");
  });

  test("labels and RLHF ids validate; toSdk camelCases with nulls dropped", () => {
    const v = voiceDesignSave({
      voice_name: "Narrator",
      voice_description: "desc",
      generated_voice_id: "gv_123",
      labels: { use: "audiobooks" },
      played_not_selected_voice_ids: ["gv_124", "gv_125"],
    });
    expect(v.toSdk("elevenlabs")).toEqual({
      voiceName: "Narrator",
      voiceDescription: "desc",
      generatedVoiceId: "gv_123",
      labels: { use: "audiobooks" },
      playedNotSelectedVoiceIds: ["gv_124", "gv_125"],
    });
  });

  test("no model concept: no unknown_model warning ever fires", () => {
    const r = voiceDesignSave.safe({
      voice_name: "n",
      voice_description: "d",
      generated_voice_id: "gv_1",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  test("unknown top-level params warn", () => {
    const r = safeUnchecked({
      voice_name: "n",
      voice_description: "d",
      generated_voice_id: "gv_1",
      brand_new_param: 1,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const unknown = r.warnings.find((w) => w.code === "unknown_param");
      expect(unknown?.path).toEqual(["brand_new_param"]);
    }
  });
});

describe("elevenlabs.voiceDesignSave shape enforcement", () => {
  test("each of the three required fields must be a non-empty string", () => {
    for (const params of [
      { voice_name: "", voice_description: "d", generated_voice_id: "gv_1" },
      { voice_name: "n", voice_description: "", generated_voice_id: "gv_1" },
      { voice_name: "n", voice_description: "d", generated_voice_id: "" },
    ]) {
      const r = voiceDesignSave.safe(params);
      expect(r.ok).toBe(false);
    }
  });

  test("a missing required field is rejected", () => {
    const r = safeUnchecked({ voice_name: "n", voice_description: "d" });
    expect(r.ok).toBe(false);
  });
});
