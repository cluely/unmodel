/**
 * Every language the voice-clone tables complete is provably ACCEPTED through
 * the unified surface — the presets contract from the tts/stt suites, on the
 * one clone provider with a language list. A completion an editor suggests
 * that the wire then refuses would be the library recommending a 4xx.
 */
import { describe, expect, test } from "bun:test";
import { voiceClone } from "../../src/unified/voice-clone";
import { CARTESIA_VOICE_CLONE_MODEL_PARAMS } from "../../src/providers/cartesia/voice-clone-params";

const clip = () => ({ audio: { file: new Blob([new Uint8Array(8)], { type: "audio/wav" }) } });

describe("cartesia/voice-clone languages", () => {
  const row = CARTESIA_VOICE_CLONE_MODEL_PARAMS["voice-clone"];

  test("the row publishes the 44 documented codes", () => {
    expect(row.languages).toHaveLength(44);
  });

  test.each([...(row.languages ?? [])])("`%s` is accepted end to end", (language) => {
    const result = voiceClone.safe({
      model: "cartesia/voice-clone",
      operation: "clone",
      name: "Narrator",
      language,
      samples: [clip()],
    } as never);
    expect(result.ok, JSON.stringify(result.ok ? [] : result.errors)).toBe(true);
    if (!result.ok) return;
    expect((result.params as unknown as { language: string }).language).toBe(language);
  });

  test("an off-list code is refused by the wire's own enum check", () => {
    const result = voiceClone.safe({
      model: "cartesia/voice-clone",
      operation: "clone",
      name: "Narrator",
      language: "xx",
      samples: [clip()],
    } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const issue = result.errors.find((e) => e.path?.[0] === "language");
    expect(issue?.code).toBe("invalid_enum_value");
  });
});
