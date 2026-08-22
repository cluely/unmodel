/**
 * `unmodel/voice-clone` end to end, through the ready pack: the kernel's
 * envelope and routing, each adapter's compile, the provider validator, and
 * the provenance remap — asserted on real calls rather than on the pieces.
 */
import { describe, expect, test } from "bun:test";
import { TranslationUnavailableError } from "../../src/core/translate/errors";
import { voiceClone } from "../../src/unified/voice-clone";

const blob = () => new Blob([new Uint8Array(8)], { type: "audio/wav" });
const fileSample = () => ({ audio: { file: blob() } });

describe("the pack", () => {
  test("registers exactly the six clone providers", () => {
    expect([...voiceClone.providers]).toEqual([
      "cartesia",
      "elevenlabs",
      "fish-audio",
      "inworld",
      "lmnt",
      "minimax",
    ]);
  });

  test("an unregistered provider is a structural error, not a validation one", () => {
    expect(() =>
      voiceClone({
        model: "resemble/voice-clone" as never,
        operation: "clone",
        name: "n",
        samples: [fileSample()] as never,
      }),
    ).toThrow(TranslationUnavailableError);
  });

  test("an unknown model on a registered provider warns and still compiles", () => {
    const result = voiceClone.safe({
      model: "elevenlabs/ivc-next",
      operation: "clone",
      name: "Narrator",
      samples: [fileSample()],
    } as never);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.map((w) => w.code)).toContain("unknown_model");
  });

  test("the result is the provider's own Validated", () => {
    const result = voiceClone.safe({
      model: "elevenlabs/ivc",
      operation: "clone",
      name: "Narrator",
      samples: [fileSample()],
    } as never);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const validated = result.params as unknown as {
      request: { url: string; method: string };
      toSdk: (target: string) => unknown;
      warnings: readonly unknown[];
    };
    expect(validated.request.url).toBe("https://api.elevenlabs.io/v1/voices/add");
    expect(validated.request.method).toBe("POST");
    expect(validated.toSdk("elevenlabs")).toMatchObject({ name: "Narrator" });
    expect(validated.warnings).toEqual([]);
  });

  test("providerOptions reaches the wire — MiniMax's preview pair rides there", () => {
    const result = voiceClone.safe(
      {
        model: "minimax/voice-clone",
        operation: "clone",
        voiceId: "MyVoice01",
        samples: [{ audio: { fileId: "123456789" } }],
      } as never,
      undefined,
    );
    expect(result.ok).toBe(true);

    const withPreview = voiceClone.safe({
      model: "minimax/voice-clone",
      operation: "clone",
      voiceId: "MyVoice01",
      samples: [{ audio: { fileId: "123456789" } }],
      providerOptions: { minimax: { text: "A short preview.", model: "speech-2.8-hd" } },
    } as never);
    expect(withPreview.ok).toBe(true);
    if (!withPreview.ok) return;
    expect(JSON.parse(JSON.stringify(withPreview.params))).toMatchObject({
      text: "A short preview.",
      model: "speech-2.8-hd",
    });
  });
});

describe("provenance: wire findings arrive at canonical paths", () => {
  test("a missing name is the wire's non-empty check, at `name`", () => {
    for (const ref of [
      "elevenlabs/ivc",
      "fish-audio/fast",
      "lmnt/voice-clone",
      "cartesia/voice-clone",
    ]) {
      const samples = [fileSample()];
      const request: Record<string, unknown> = { model: ref, operation: "clone", samples };
      if (ref.startsWith("cartesia")) request["language"] = "en";
      if (ref.startsWith("fish-audio")) request["visibility"] = "private";
      const result = voiceClone.safe(request as never);
      expect(result.ok, ref).toBe(false);
      if (result.ok) continue;
      expect(
        result.errors.some((e) => e.path?.[0] === "name"),
        `${ref}: ${JSON.stringify(result.errors)}`,
      ).toBe(true);
    }
  });

  test("MiniMax's voice_id grammar arrives at `voiceId`", () => {
    const result = voiceClone.safe({
      model: "minimax/voice-clone",
      operation: "clone",
      voiceId: "no",
      samples: [{ audio: { fileId: "123456789" } }],
    } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const issue = result.errors.find((e) => e.path?.[0] === "voiceId");
    expect(issue?.code).toBe("invalid_shape");
    expect(issue?.message).toContain("8–256");
  });

  test("a non-numeric fileId is refused before the wire", () => {
    const result = voiceClone.safe({
      model: "minimax/voice-clone",
      operation: "clone",
      voiceId: "MyVoice01",
      samples: [{ audio: { fileId: "file-abc" } }],
    } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const issue = result.errors.find((e) => e.code === "invalid_shape");
    expect(issue?.path).toEqual(["samples", 0, "audio", "fileId"]);
  });
});

describe("the category's own rules", () => {
  test("fish: some-but-not-all transcripts is refused naming the parallel-array rule", () => {
    const result = voiceClone.safe({
      model: "fish-audio/fast",
      operation: "clone",
      name: "Narrator",
      visibility: "private",
      samples: [{ ...fileSample(), transcript: "Hello." }, fileSample()],
    } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const issue = result.errors.find((e) => e.path?.[0] === "samples");
    expect(issue?.message).toContain("`texts` array parallels `voices`");
  });

  test("fish: omitting visibility surfaces the public-by-default warning", () => {
    const result = voiceClone.safe({
      model: "fish-audio/fast",
      operation: "clone",
      name: "Narrator",
      samples: [fileSample()],
    } as never);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const warning = result.warnings.find((w) => w.path?.[0] === "visibility");
    expect(warning?.message).toContain('"public"');
  });

  test('cartesia: visibility "unlisted" is refused naming the two access values', () => {
    const result = voiceClone.safe({
      model: "cartesia/voice-clone",
      operation: "clone",
      name: "Narrator",
      language: "en",
      visibility: "unlisted",
      samples: [fileSample()],
    } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const issue = result.errors.find((e) => e.path?.[0] === "visibility");
    expect(issue?.code).toBe("invalid_enum_value");
    expect(issue?.meta?.["allowed"]).toEqual(["private", "public"]);
  });

  test("cartesia: a missing language is the wire's own required-check, at `language`", () => {
    const result = voiceClone.safe({
      model: "cartesia/voice-clone",
      operation: "clone",
      name: "Narrator",
      samples: [fileSample()],
    } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.path?.[0] === "language")).toBe(true);
  });

  test("inworld: an oversized base64 sample is media_too_large at its element", () => {
    const oversized = "A".repeat(Math.ceil((4 * 1024 * 1024 + 1024) / 3) * 4);
    const result = voiceClone.safe({
      model: "inworld/voice-clone",
      operation: "clone",
      name: "Narrator",
      samples: [{ audio: { data: oversized } }],
    } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const issue = result.errors.find((e) => e.code === "media_too_large");
    expect(issue).toBeDefined();
  });

  test("elevenlabs: an undocumented labels key is refused through the extras path", () => {
    const result = voiceClone.safe({
      model: "elevenlabs/ivc",
      operation: "clone",
      name: "Narrator",
      samples: [fileSample()],
      labels: { mood: "cheerful" },
    } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.code === "invalid_enum_value")).toBe(true);
  });
});
