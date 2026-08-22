/**
 * The capability table for `unmodel/voice-clone`, committed and then PROBED:
 * every `unsupported` declaration must exist on the adapter AND be rejected at
 * the canonical path by a real call, and every sample-transport declaration
 * (`sampleInputs` + `sampleLimits`) must match what the runtime enforces.
 *
 * The table is the category's honesty ledger. Reading down a column shows a
 * caller what travels: `visibility` exists at exactly two providers (and
 * defaults differently at each — the reason it is canonical), `voiceId` at
 * exactly one, per-sample transcripts at three. A declaration that appears
 * here but not on the adapter — or the reverse — fails the sweep, so the
 * ledger cannot rot.
 */
import { describe, expect, test } from "bun:test";
import { voiceClone } from "../../src/unified/voice-clone";
import { voiceClone as elevenlabs } from "../../src/providers/elevenlabs/unified-voice-clone";
import { voiceClone as fishAudio } from "../../src/providers/fish-audio/unified-voice-clone";
import { voiceClone as inworld } from "../../src/providers/inworld/unified-voice-clone";
import { voiceClone as minimax } from "../../src/providers/minimax/unified-voice-clone";
import { voiceClone as cartesia } from "../../src/providers/cartesia/unified-voice-clone";
import { voiceClone as lmnt } from "../../src/providers/lmnt/unified-voice-clone";

const ADAPTERS = { elevenlabs, "fish-audio": fishAudio, inworld, minimax, cartesia, lmnt };

/**
 * The committed table. `unsupported` names the canonical words each route
 * refuses; `inputs`/`limits` are the sample-transport declarations.
 */
const TABLE: Record<
  keyof typeof ADAPTERS,
  {
    ref: string;
    inputs: readonly string[];
    limits: { min: number; max: number };
    unsupported: readonly string[];
  }
> = {
  elevenlabs: {
    ref: "elevenlabs/ivc",
    inputs: ["file"],
    limits: { min: 1, max: Infinity },
    unsupported: ["language", "visibility", "voiceId"],
  },
  "fish-audio": {
    ref: "fish-audio/fast",
    inputs: ["file"],
    limits: { min: 1, max: 20 },
    unsupported: ["language", "noiseReduction", "voiceId"],
  },
  inworld: {
    ref: "inworld/voice-clone",
    inputs: ["data"],
    limits: { min: 1, max: Infinity },
    unsupported: ["visibility", "voiceId"],
  },
  minimax: {
    ref: "minimax/voice-clone",
    inputs: ["fileId"],
    limits: { min: 1, max: 1 },
    unsupported: ["name", "description", "language", "visibility"],
  },
  cartesia: {
    ref: "cartesia/voice-clone",
    inputs: ["file"],
    limits: { min: 1, max: 1 },
    unsupported: ["noiseReduction", "voiceId"],
  },
  lmnt: {
    ref: "lmnt/voice-clone",
    inputs: ["file"],
    limits: { min: 1, max: 1 },
    unsupported: ["language", "noiseReduction", "visibility", "voiceId"],
  },
};

/** A request every provider accepts up to the probed word. */
function base(ref: string): Record<string, unknown> {
  const provider = ref.slice(0, ref.indexOf("/"));
  const kind = TABLE[provider as keyof typeof TABLE].inputs[0];
  const audio =
    kind === "file"
      ? { file: new Blob([new Uint8Array(8)], { type: "audio/wav" }) }
      : kind === "data"
        ? { data: "UklGRgAAAABXQVZF" }
        : { fileId: "123456789" };
  return {
    model: ref,
    operation: "clone",
    // minimax refuses `name` and requires `voiceId`; everyone else the reverse.
    ...(provider === "minimax" ? { voiceId: "MyVoice01" } : { name: "Narrator" }),
    samples: [{ audio }],
  };
}

test("the pack is exactly the committed providers", () => {
  expect([...voiceClone.providers]).toEqual(Object.keys(TABLE).sort());
});

describe.each(Object.entries(TABLE))("%s", (provider, row) => {
  const adapter = ADAPTERS[provider as keyof typeof ADAPTERS];

  test("declares the committed sample transport", () => {
    // Widened before comparing: the adapter's literals would otherwise narrow
    // the matcher's expected type to themselves.
    const inputs: readonly string[] = adapter.sampleInputs;
    const limits: { min: number; max: number } = adapter.sampleLimits;
    expect([...inputs]).toEqual([...row.inputs]);
    expect(limits).toEqual(row.limits);
  });

  test("declares exactly the committed unsupported words", () => {
    expect(Object.keys(adapter.unsupported ?? {}).sort()).toEqual([...row.unsupported].sort());
  });

  test.each([...row.unsupported])("refuses `%s` at the canonical path", (word) => {
    const probe: Record<string, unknown> = { ...base(row.ref) };
    if (word === "name") probe["name"] = "Narrator";
    else if (word === "voiceId") probe["voiceId"] = "MyVoice01";
    else if (word === "visibility") probe["visibility"] = "private";
    else if (word === "noiseReduction") probe["noiseReduction"] = true;
    else if (word === "language") probe["language"] = "en";
    else if (word === "description") probe["description"] = "d";

    const result = voiceClone.safe(probe as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const issue = result.errors.find((e) => e.path?.[0] === word);
    expect(issue?.code).toBe("unsupported_param");
    // The refusal is the adapter's own sentence, verbatim.
    expect(issue?.message).toContain(
      (adapter.unsupported as Record<string, string>)[word] ?? "",
    );
  });

  test("a wrong sample shape is refused by name", () => {
    const wrongKind = row.inputs.includes("url") ? "file" : "url";
    const probe = {
      ...base(row.ref),
      samples: [{ audio: { [wrongKind]: wrongKind === "url" ? "https://e.com/a.wav" : "x" } }],
    };
    const result = voiceClone.safe(probe as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const issue = result.errors.find((e) => e.code === "unsupported_param" || e.code === "invalid_shape");
    expect(issue?.path?.[0]).toBe("samples");
  });

  test("a count breach names the bound", () => {
    if (row.limits.max === Infinity) {
      const result = voiceClone.safe({ ...base(row.ref), samples: [] } as never);
      expect(result.ok).toBe(false);
      return;
    }
    const one = (base(row.ref) as { samples: unknown[] }).samples[0];
    const over = Array.from({ length: row.limits.max + 1 }, () => one);
    const result = voiceClone.safe({ ...base(row.ref), samples: over } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const issue = result.errors.find((e) => e.path?.[0] === "samples");
    expect(issue?.meta?.["max"]).toBe(row.limits.max);
  });

  test("the wrong operation is refused by name", () => {
    const result = voiceClone.safe({ ...base(row.ref), operation: "design" } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const issue = result.errors.find((e) => e.path?.[0] === "operation");
    expect(issue?.code).toBe("invalid_enum_value");
  });
});
