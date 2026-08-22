/**
 * The capability table for `unmodel/voice-design`, committed and then PROBED —
 * the ./voice-clone-capabilities contract on the simpler category. What this
 * ledger documents is the `previewText` fault line (required, optional-with-
 * auto, or refused) and which of the three knobs (`n`, `seed`, `guidance`)
 * each wire actually has.
 */
import { describe, expect, test } from "bun:test";
import { voiceDesign } from "../../src/unified/voice-design";
import { voiceDesign as elevenlabs } from "../../src/providers/elevenlabs/unified-voice-design";
import { voiceDesign as fishAudio } from "../../src/providers/fish-audio/unified-voice-design";
import { voiceDesign as inworld } from "../../src/providers/inworld/unified-voice-design";
import { voiceDesign as minimax } from "../../src/providers/minimax/unified-voice-design";

const ADAPTERS = { elevenlabs, "fish-audio": fishAudio, inworld, minimax };

const PROMPT = "An elderly British gentleman with a warm, gravelly storytelling tone";
const SCRIPT =
  "Once upon a time, in a land far away, there lived a clockmaker who wound the stars " +
  "each evening and listened to their slow, patient music.";

const TABLE: Record<
  keyof typeof ADAPTERS,
  { ref: string; unsupported: readonly string[] }
> = {
  elevenlabs: { ref: "elevenlabs/eleven_ttv_v3", unsupported: ["n", "language"] },
  "fish-audio": { ref: "fish-audio/voice-design-1", unsupported: ["previewText"] },
  inworld: { ref: "inworld/voice-design", unsupported: ["seed", "guidance"] },
  minimax: { ref: "minimax/voice-design", unsupported: ["n", "seed", "guidance", "language"] },
};

/** A request every provider accepts up to the probed word. */
function base(ref: string): Record<string, unknown> {
  const provider = ref.slice(0, ref.indexOf("/"));
  return {
    model: ref,
    operation: "design",
    prompt: PROMPT,
    // fish refuses previewText; the two that require it get it.
    ...(provider === "fish-audio" ? {} : { previewText: SCRIPT }),
  };
}

test("the pack is exactly the committed providers", () => {
  expect([...voiceDesign.providers]).toEqual(Object.keys(TABLE).sort());
});

describe.each(Object.entries(TABLE))("%s", (provider, row) => {
  const adapter = ADAPTERS[provider as keyof typeof ADAPTERS];

  test("declares exactly the committed unsupported words", () => {
    expect(Object.keys(adapter.unsupported ?? {}).sort()).toEqual([...row.unsupported].sort());
  });

  test.each([...row.unsupported])("refuses `%s` at the canonical path", (word) => {
    const probe: Record<string, unknown> = { ...base(row.ref) };
    if (word === "n") probe["n"] = 2;
    else if (word === "seed") probe["seed"] = 42;
    else if (word === "guidance") probe["guidance"] = 2;
    else if (word === "language") probe["language"] = "en";
    else if (word === "previewText") probe["previewText"] = SCRIPT;

    const result = voiceDesign.safe(probe as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const issue = result.errors.find((e) => e.path?.[0] === word);
    expect(issue?.code).toBe("unsupported_param");
    expect(issue?.message).toContain(
      (adapter.unsupported as Record<string, string>)[word] ?? "",
    );
  });

  test("the wrong operation is refused by name", () => {
    const result = voiceDesign.safe({ ...base(row.ref), operation: "clone" } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const issue = result.errors.find((e) => e.path?.[0] === "operation");
    expect(issue?.code).toBe("invalid_enum_value");
  });
});

describe("the previewText fault line, probed", () => {
  test("required at inworld and minimax: omitting it is the wire's own non-empty error, remapped", () => {
    for (const ref of ["inworld/voice-design", "minimax/voice-design"]) {
      const result = voiceDesign.safe({ model: ref, operation: "design", prompt: PROMPT } as never);
      expect(result.ok, ref).toBe(false);
      if (result.ok) continue;
      expect(result.errors.some((e) => e.path?.[0] === "previewText")).toBe(true);
    }
  });

  test("omitted at elevenlabs: compiles to auto_generate_text, not an error", () => {
    const result = voiceDesign.safe({
      model: "elevenlabs/eleven_ttv_v3",
      operation: "design",
      prompt: PROMPT,
    } as never);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.params as unknown as { auto_generate_text?: boolean }).auto_generate_text).toBe(
      true,
    );
  });
});
