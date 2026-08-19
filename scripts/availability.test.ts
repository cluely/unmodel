import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import {
  buildAvailability,
  defaultEndpointOf,
  normalizeId,
  normalizeName,
  renderAvailabilityFile,
  type AvailabilityBuild,
  type Collision,
} from "./availability";
import { generate } from "./codegen";
import type { AvailabilityEntry } from "../src/core/translate/availability-types";

// ---------------------------------------------------------------------------
// Mini fixture — one provider row per failure mode the heuristic must handle.
// ---------------------------------------------------------------------------

interface ModelSpec {
  name: string;
  context?: number;
  input?: string[];
  output?: string[];
  /** Chat-scope signal: an input-only price means the model generates nothing. */
  cost?: { input?: number; output?: number };
  /** Chat-scope signal: keeps an audio/video-out omni model in scope. */
  toolCall?: boolean;
}

function provider(id: string, models: Record<string, ModelSpec>) {
  return {
    id,
    name: id,
    env: [],
    models: Object.fromEntries(
      Object.entries(models).map(([modelId, spec]) => [
        modelId,
        {
          id: modelId,
          name: spec.name,
          attachment: false,
          reasoning: false,
          tool_call: spec.toolCall ?? false,
          open_weights: false,
          ...(spec.cost !== undefined && { cost: spec.cost }),
          modalities: { input: spec.input ?? ["text"], output: spec.output ?? ["text"] },
          limit: { context: spec.context ?? 128000 },
        },
      ]),
    ),
  };
}

const miniSnapshot = {
  // org-prefix collapse: five spellings of one model.
  groq: provider("groq", {
    "openai/gpt-oss-120b": { name: "GPT OSS 120B" },
    "whisper-large-v3": { name: "Whisper Large v3" },
  }),
  cerebras: provider("cerebras", { "gpt-oss-120b": { name: "GPT-OSS-120B" } }),
  "fireworks-ai": provider("fireworks-ai", {
    "accounts/fireworks/models/gpt-oss-120b": { name: "gpt-oss-120b" },
  }),
  // region aliases + version suffix, on the same model.
  "amazon-bedrock": provider("amazon-bedrock", {
    "openai.gpt-oss-120b": { name: "GPT OSS 120B" },
    "openai.gpt-oss-120b-1:0": { name: "GPT OSS 120B" },
    "us.openai.gpt-oss-120b": { name: "GPT OSS 120B" },
    "eu.openai.gpt-oss-120b": { name: "GPT OSS 120B" },
    "anthropic.claude-haiku-4-5-20251001-v1:0": { name: "Claude Haiku 4.5" },
  }),
  // prefix collision, negative: same id tail, different display name.
  acme: provider("acme", {
    "llama-3-8b": { name: "Llama 3 8B" },
    "meta/llama-3-8b": { name: "Llama 3 8B Turbo" },
  }),
  beta: provider("beta", { "llama-3-8b": { name: "Llama 3 8B" } }),
  // tier suffix, negative: the `-fast` SKU is a different product.
  // Also: the `.`-vs-`-` version separator — openrouter spells the same model
  // `claude-haiku-4.5` where anthropic spells it `claude-haiku-4-5`.
  openrouter: provider("openrouter", {
    "anthropic/claude-opus-5": { name: "Anthropic: Claude Opus 5" },
    "anthropic/claude-opus-5-fast": { name: "Anthropic: Claude Opus 5 Fast" },
    "anthropic/claude-haiku-4.5": { name: "Anthropic: Claude Haiku 4.5" },
    // Non-chat rows, one per signal, so the scope filter is exercised.
    "openai/text-embedding-3-large": {
      name: "Text Embedding 3 Large",
      cost: { input: 0.13, output: 0 },
    },
    "google/lyria-3-pro": { name: "Lyria 3 Pro", output: ["text", "audio"] },
    "openai/gpt-audio": { name: "GPT Audio", output: ["text", "audio"], toolCall: true },
  }),
  // undated alias ↔ dated snapshot.
  anthropic: provider("anthropic", {
    "claude-opus-5": { name: "Claude Opus 5" },
    "claude-haiku-4-5": { name: "Claude Haiku 4.5 (latest)" },
    "claude-haiku-4-5-20251001": { name: "Claude Haiku 4.5" },
  }),
  azure: provider("azure", { "claude-haiku-4-5": { name: "Claude Haiku 4.5" } }),
  // multi-surface provider.
  "google-vertex": provider("google-vertex", {
    "gemini-3-pro": { name: "Gemini 3 Pro" },
    "claude-opus-5@default": { name: "Claude Opus 5" },
    "openai/gpt-oss-120b-maas": { name: "GPT OSS 120B" },
  }),
  google: provider("google", { "gemini-3-pro": { name: "Gemini 3 Pro" } }),
  // narrowing metadata.
  alibaba: provider("alibaba", {
    "qwen3.6-27b": {
      name: "Qwen3.6 27B",
      context: 1000000,
      input: ["text", "image", "audio", "video"],
    },
  }),
  deepinfra: provider("deepinfra", {
    "Qwen/Qwen3.6-27B": { name: "Qwen3.6 27B", context: 131072, input: ["text"] },
  }),
  // force-override candidates: same product, unrelated ids AND names.
  // The embedding / music / omni rows mirror openrouter's so each has a
  // partner to merge with — a scope filter that let them through would emit a
  // real edge, which is what makes the "dropped" assertions meaningful.
  openai: provider("openai", {
    "whisper-1": { name: "Whisper" },
    "text-embedding-3-large": { name: "Text Embedding 3 Large", cost: { input: 0.13, output: 0 } },
    "gpt-audio": { name: "GPT Audio", output: ["text", "audio"], toolCall: true },
  }),
  lyriahost: provider("lyriahost", {
    "lyria-3-pro": { name: "Lyria 3 Pro", output: ["text", "audio"] },
  }),
};

const MINI_PROVIDERS = Object.keys(miniSnapshot).sort();

function miniOverrides(extra: Partial<{ deny: string[][]; force: string[][] }> = {}) {
  return { providers: MINI_PROVIDERS, deny: [], force: [], ...extra };
}

function build(extra?: Parameters<typeof miniOverrides>[0]): AvailabilityBuild {
  return buildAvailability(miniSnapshot, miniOverrides(extra));
}

function targetsOf(build: AvailabilityBuild, providerId: string, modelId: string) {
  const map = build.providers.get(providerId);
  return map?.[modelId];
}

function idOf(entry: AvailabilityEntry | undefined): string | undefined {
  return typeof entry === "string" ? entry : entry?.id;
}

describe("availability — normalization", () => {
  test("normalizeId strips org, path, region, version and tier decorations", () => {
    expect(normalizeId("openai/gpt-oss-120b").key).toBe("gpt-oss-120b");
    expect(normalizeId("accounts/fireworks/models/gpt-oss-120b").key).toBe("gpt-oss-120b");
    expect(normalizeId("@cf/openai/gpt-oss-120b").key).toBe("gpt-oss-120b");
    expect(normalizeId("openai.gpt-oss-120b-1:0").key).toBe("gpt-oss-120b");
    expect(normalizeId("openai/gpt-oss-120b-maas").key).toBe("gpt-oss-120b");
    expect(normalizeId("claude-opus-5@default").key).toBe("claude-opus-5");
    expect(normalizeId("anthropic.claude-opus-5").key).toBe("claude-opus-5");
  });

  test("normalizeId collapses the `.` vs `-` version separator", () => {
    // Anthropic ships `claude-haiku-4-5`; OpenRouter and Vercel ship
    // `anthropic/claude-haiku-4.5`. Without this, 170 directed edges whose
    // display names already agree go missing — including every Claude row on
    // OpenRouter, which makes `.toApi("openrouter")` a compile error on models
    // OpenRouter demonstrably serves.
    expect(normalizeId("anthropic/claude-haiku-4.5").key).toBe(
      normalizeId("claude-haiku-4-5").key,
    );
    expect(normalizeId("anthropic/claude-opus-4.7").key).toBe(normalizeId("claude-opus-4-7").key);
    expect(normalizeId("gemini-2.5-flash").key).toBe(normalizeId("gemini-2-5-flash").key);
    // Only digit-dot-digit: an org prefix or a `.1`-style suffix on a word is
    // untouched, and the name half of the conjunction still guards the merge.
    expect(normalizeId("anthropic.claude-opus-5").key).toBe("claude-opus-5");
    expect(normalizeId("flux.1-dev").key).toBe("flux.1-dev");
  });

  test("normalizeId marks region and tier spellings as aliases, base ids as not", () => {
    expect(normalizeId("us.anthropic.claude-opus-5")).toEqual({ key: "claude-opus-5", alias: true });
    expect(normalizeId("anthropic/claude-opus-5:free")).toEqual({
      key: "claude-opus-5",
      alias: true,
    });
    expect(normalizeId("anthropic.claude-opus-5").alias).toBe(false);
  });

  test("normalizeName drops parentheticals, vendor prefixes and punctuation", () => {
    expect(normalizeName("Claude Haiku 4.5 (latest)")).toBe(normalizeName("Claude Haiku 4.5"));
    expect(normalizeName("MiniMax: MiniMax M1")).toBe(normalizeName("MiniMax M1"));
    expect(normalizeName("GPT OSS 120B")).toBe(normalizeName("gpt-oss-120b"));
    // The conjunction's second half must still separate real SKUs.
    expect(normalizeName("Claude Opus 5")).not.toBe(normalizeName("Claude Opus 5 Fast"));
  });

  test("defaultEndpointOf falls back to <provider>.chat", () => {
    expect(defaultEndpointOf("anthropic")).toBe("anthropic.messages");
    expect(defaultEndpointOf("google")).toBe("google.generateContent");
    expect(defaultEndpointOf("amazon-bedrock")).toBe("amazon-bedrock.converse");
    expect(defaultEndpointOf("groq")).toBe("groq.chat");
  });
});

describe("availability — generation", () => {
  test("is deterministic — two runs are byte-identical", () => {
    const a = build();
    const b = buildAvailability(structuredClone(miniSnapshot), miniOverrides());
    expect([...a.providers.keys()]).toEqual([...b.providers.keys()]);
    for (const [id, map] of a.providers) {
      expect(renderAvailabilityFile(id, b.providers.get(id)!, "// h\n")).toBe(
        renderAvailabilityFile(id, map, "// h\n"),
      );
    }
    expect(b.collisions).toEqual(a.collisions);
    expect(b.aliasLinks).toEqual(a.aliasLinks);
  });

  test("org-prefix collapse — five spellings of gpt-oss-120b merge", () => {
    const targets = targetsOf(build(), "groq", "openai/gpt-oss-120b");
    expect(targets).toBeDefined();
    expect(idOf(targets!["cerebras"])).toBe("gpt-oss-120b");
    expect(idOf(targets!["fireworks-ai"])).toBe("accounts/fireworks/models/gpt-oss-120b");
    expect(idOf(targets!["amazon-bedrock"])).toBe("openai.gpt-oss-120b");
    expect(idOf(targets!["google-vertex"])).toBe("openai/gpt-oss-120b-maas");
  });

  test("prefix collision, negative — same id tail + different name must not merge", () => {
    const acme = build().providers.get("acme")!;
    // "llama-3-8b" merges with beta's row...
    expect(idOf(acme["llama-3-8b"]?.["beta"])).toBe("llama-3-8b");
    // ...but "Llama 3 8B Turbo" is a different product and gets no edge at all.
    expect(acme["meta/llama-3-8b"]).toBeUndefined();
    // The merge that did NOT happen is also visible in the collision probe.
    expect(build().collisions.some((c) => c.provider === "acme")).toBe(false);
  });

  test("the fixture's only collision is the intentional benign bedrock pair", () => {
    expect(build().collisions).toEqual([
      {
        group: "gpt-oss-120b||gptoss120b",
        provider: "amazon-bedrock",
        ids: ["openai.gpt-oss-120b", "openai.gpt-oss-120b-1:0"],
      },
    ]);
  });

  test("tier suffix, negative — the -fast SKU does not merge into the base model", () => {
    const openrouter = build().providers.get("openrouter")!;
    expect(idOf(openrouter["anthropic/claude-opus-5"]?.["anthropic"])).toBe("claude-opus-5");
    expect(openrouter["anthropic/claude-opus-5-fast"]).toBeUndefined();
  });

  test("region aliases collapse, canonical target is the unprefixed id, every source keeps an entry", () => {
    const bedrock = build().providers.get("amazon-bedrock")!;
    // Regional spellings are still usable as sources...
    expect(bedrock["us.openai.gpt-oss-120b"]).toBeDefined();
    expect(bedrock["eu.openai.gpt-oss-120b"]).toBeDefined();
    // ...but never win canonical selection as a target.
    const fromGroq = targetsOf(build(), "groq", "openai/gpt-oss-120b")!;
    expect(idOf(fromGroq["amazon-bedrock"])).toBe("openai.gpt-oss-120b");
  });

  test("version suffix collapses and the shorter id wins canonical selection", () => {
    const cerebras = build().providers.get("cerebras")!;
    expect(idOf(cerebras["gpt-oss-120b"]?.["amazon-bedrock"])).toBe("openai.gpt-oss-120b");
    // Both bedrock spellings remain addressable as sources.
    const bedrock = build().providers.get("amazon-bedrock")!;
    expect(bedrock["openai.gpt-oss-120b-1:0"]).toBeDefined();
  });

  test("alias pass — undated and dated anthropic spellings share one target set", () => {
    const b = build();
    expect(b.aliasLinks).toEqual(["anthropic: claude-haiku-4-5 <-> claude-haiku-4-5-20251001"]);
    const anthropic = b.providers.get("anthropic")!;
    const undated = anthropic["claude-haiku-4-5"]!;
    const dated = anthropic["claude-haiku-4-5-20251001"]!;
    // openrouter joins via the `.`-vs-`-` version-separator collapse.
    expect(Object.keys(undated).sort()).toEqual(["amazon-bedrock", "azure", "openrouter"]);
    expect(Object.keys(dated).sort()).toEqual(["amazon-bedrock", "azure", "openrouter"]);
    // The dated spelling is treated as an alias, so the pair is not a collision.
    expect(b.collisions.some((c) => c.provider === "anthropic")).toBe(false);
  });

  test("multi-surface provider — object form for the off-default surfaces only", () => {
    const b = build();
    // Gemini is on google-vertex's default surface → bare string.
    expect(idOf(b.providers.get("google")!["gemini-3-pro"]?.["google-vertex"])).toBe("gemini-3-pro");
    expect(b.providers.get("google")!["gemini-3-pro"]?.["google-vertex"]).toBe("gemini-3-pro");
    // Claude on Vertex is the Anthropic-shaped rawPredict surface.
    expect(b.providers.get("anthropic")!["claude-opus-5"]?.["google-vertex"]).toEqual({
      id: "claude-opus-5@default",
      endpoint: "google-vertex.messages",
    });
    // MaaS models are on an OpenAI-compatible chat surface.
    expect(
      targetsOf(b, "groq", "openai/gpt-oss-120b")!["google-vertex"],
    ).toEqual({ id: "openai/gpt-oss-120b-maas", endpoint: "google-vertex.chat" });
  });

  test("narrowing metadata — smaller context and lost input modalities", () => {
    const b = build();
    expect(b.providers.get("alibaba")!["qwen3.6-27b"]?.["deepinfra"]).toEqual({
      id: "Qwen/Qwen3.6-27B",
      narrows: { context: 131072, drops: ["image", "audio", "video"] },
    });
    // The reverse direction widens, so it carries no narrows at all.
    expect(b.providers.get("deepinfra")!["Qwen/Qwen3.6-27B"]?.["alibaba"]).toBe("qwen3.6-27b");
  });

  test("deny override removes an edge the heuristic found, in both directions", () => {
    const denied = build({ deny: [["*:*", "azure:*claude*"]] });
    const anthropic = denied.providers.get("anthropic")!;
    expect(Object.keys(anthropic["claude-haiku-4-5"]!).sort()).toEqual([
      "amazon-bedrock",
      "openrouter",
    ]);
    // azure's only chat row loses every edge, so it emits no file at all.
    expect(denied.providers.has("azure")).toBe(false);
  });

  test("deny override falls back to another spelling rather than dropping the provider", () => {
    const denied = build({
      deny: [["amazon-bedrock:openai.gpt-oss-120b", "cerebras:gpt-oss-120b"]],
    });
    // The denied canonical is skipped; the next-best bedrock row is used.
    expect(idOf(denied.providers.get("cerebras")!["gpt-oss-120b"]?.["amazon-bedrock"])).toBe(
      "openai.gpt-oss-120b-1:0",
    );
    // Other sources are unaffected.
    expect(idOf(targetsOf(denied, "groq", "openai/gpt-oss-120b")!["amazon-bedrock"])).toBe(
      "openai.gpt-oss-120b",
    );
  });

  test("force override adds an edge the heuristic missed", () => {
    const forced = build({ force: [["openai:whisper-1", "groq:whisper-large-v3"]] });
    expect(idOf(forced.providers.get("openai")!["whisper-1"]?.["groq"])).toBe("whisper-large-v3");
    expect(idOf(forced.providers.get("groq")!["whisper-large-v3"]?.["openai"])).toBe("whisper-1");
    // Without the override there is no edge — different id tails and names.
    expect(build().providers.get("openai")?.["whisper-1"]).toBeUndefined();
  });

  test("a force ref that no longer resolves fails codegen instead of silently lapsing", () => {
    expect(() => build({ force: [["openai:whisper-9", "groq:whisper-large-v3"]] })).toThrow(
      /force pair references unknown in-scope row\(s\) "openai:whisper-9"/,
    );
  });

  test("an exact deny ref that matches nothing fails codegen", () => {
    expect(() => build({ deny: [["azure:claude-gone", "anthropic:claude-opus-5"]] })).toThrow(
      /deny ref "azure:claude-gone" matches no in-scope chat row/,
    );
  });

  test("a provider listed in the overrides but absent from the snapshot fails codegen", () => {
    expect(() =>
      buildAvailability(miniSnapshot, { providers: [...MINI_PROVIDERS, "ghost"] }),
    ).toThrow(/"ghost", which is not in the snapshot/);
  });

  test("non-text-output models are out of scope", () => {
    const imageOnly = {
      ...miniSnapshot,
      acme: provider("acme", { "acme-image": { name: "Acme Image", output: ["image"] } }),
      beta: provider("beta", { "acme-image": { name: "Acme Image", output: ["image"] } }),
    };
    const b = buildAvailability(imageOnly, miniOverrides());
    expect(b.providers.has("acme")).toBe(false);
    expect(b.providers.has("beta")).toBe(false);
  });

  test("version separator — the `.` and `-` spellings of one model merge", () => {
    const b = build();

    // anthropic:claude-haiku-4-5 ←→ openrouter:anthropic/claude-haiku-4.5
    expect(idOf(targetsOf(b, "anthropic", "claude-haiku-4-5")?.["openrouter"])).toBe(
      "anthropic/claude-haiku-4.5",
    );
    expect(idOf(targetsOf(b, "openrouter", "anthropic/claude-haiku-4.5")?.["anthropic"])).toBe(
      "claude-haiku-4-5",
    );
  });
});

/**
 * `modalities.output` including `text` is necessary but not sufficient:
 * models.dev records embeddings, transcription and music generation as
 * text-out too, and each of those used to land in the chat availability tables
 * and get offered as a `.toApi` source and target. See `isChatRow`.
 */
describe("availability — chat scope", () => {
  const b = build();

  test("an embedding row is dropped — it charges for input and nothing for output", () => {
    // Both providers list it under the same normalized id AND name, so the
    // heuristic would emit the edge; only the scope filter stops it.
    expect(normalizeId("openai/text-embedding-3-large").key).toBe(
      normalizeId("text-embedding-3-large").key,
    );
    expect(targetsOf(b, "openai", "text-embedding-3-large")).toBeUndefined();
    expect(targetsOf(b, "openrouter", "openai/text-embedding-3-large")).toBeUndefined();
  });

  test("a music/speech row is dropped — audio out with no tool calling", () => {
    expect(targetsOf(b, "openrouter", "google/lyria-3-pro")).toBeUndefined();
    expect(b.providers.has("lyriahost")).toBe(false);
  });

  test("an omni chat model that also speaks stays in scope", () => {
    // The `tool_call` conjunct is what separates "chats and can speak" from
    // "is a speech generator".
    expect(idOf(targetsOf(b, "openai", "gpt-audio")?.["openrouter"])).toBe("openai/gpt-audio");
  });
});

/**
 * `targetOnly` suppresses a provider's own source table while keeping it
 * reachable as a destination — the factory-configured providers
 * (amazon-bedrock, azure) wire no `.toApi`, so a source file for them would be
 * generated code with no importer.
 */
describe("availability — target-only providers", () => {
  test("no source file is emitted, but the provider is still a reachable target", () => {
    const b = buildAvailability(miniSnapshot, {
      ...miniOverrides(),
      targetOnly: ["amazon-bedrock"],
    });

    expect(b.providers.has("amazon-bedrock")).toBe(false);
    expect(idOf(targetsOf(b, "groq", "openai/gpt-oss-120b")?.["amazon-bedrock"])).toBe(
      "openai.gpt-oss-120b",
    );
  });

  test("naming a provider that is not in scope at all fails codegen", () => {
    expect(() =>
      buildAvailability(miniSnapshot, { ...miniOverrides(), targetOnly: ["ghost"] }),
    ).toThrow(/targetOnly lists "ghost", which is not in `providers`/);
  });
});

describe("availability — rendering", () => {
  test("emits a const, a satisfies contract and a per-provider type, with no index barrel", () => {
    const rendered = renderAvailabilityFile(
      "amazon-bedrock",
      build().providers.get("amazon-bedrock")!,
      "// Generated — DO NOT EDIT.\n",
    );
    expect(rendered).toStartWith("// Generated — DO NOT EDIT.\n");
    expect(rendered).toContain(
      'import type { AvailabilityMap } from "../../core/translate/availability-types";',
    );
    expect(rendered).toContain("export const availability = {");
    expect(rendered).toContain("} as const satisfies AvailabilityMap;");
    expect(rendered).toContain("export type AmazonBedrockAvailability = typeof availability;");
  });

  test("renders the short form for plain ids and the long form otherwise", () => {
    const b = build();
    expect(renderAvailabilityFile("groq", b.providers.get("groq")!, "")).toContain(
      '"cerebras": "gpt-oss-120b",',
    );
    expect(renderAvailabilityFile("groq", b.providers.get("groq")!, "")).toContain(
      '"google-vertex": { id: "openai/gpt-oss-120b-maas", endpoint: "google-vertex.chat" },',
    );
    expect(renderAvailabilityFile("alibaba", b.providers.get("alibaba")!, "")).toContain(
      '"deepinfra": { id: "Qwen/Qwen3.6-27B", narrows: { context: 131072, drops: ["image", "audio", "video"] } },',
    );
  });
});

describe("codegen integration", () => {
  test("availability files land under availability/ and only when overrides are supplied", () => {
    const withOverrides = generate(miniSnapshot, miniOverrides());
    const withoutOverrides = generate(miniSnapshot);
    const availabilityKeys = [...withOverrides.keys()].filter((k) => k.startsWith("availability/"));
    // Emission order follows the provider id, not the full path.
    expect(availabilityKeys).toEqual(
      [...build().providers.keys()].map((id) => `availability/${id}.gen.ts`),
    );
    expect(availabilityKeys).toContain("availability/anthropic.gen.ts");
    expect([...withoutOverrides.keys()].some((k) => k.startsWith("availability/"))).toBe(false);
  });

  test("generate is byte-identical across runs, availability included", () => {
    const a = generate(miniSnapshot, miniOverrides());
    const b = generate(structuredClone(miniSnapshot), miniOverrides());
    expect([...a.keys()]).toEqual([...b.keys()]);
    for (const [name, content] of a) expect(b.get(name)).toBe(content);
  });
});

// ---------------------------------------------------------------------------
// Whole-snapshot invariants. These guard the `codegen:refresh` path, where a
// hand-written fixture cannot help.
// ---------------------------------------------------------------------------

const REAL_SNAPSHOT = await Bun.file(
  new URL("../data/models-dev.json", import.meta.url).pathname,
).json();
const REAL_OVERRIDES = await Bun.file(
  new URL("../data/availability-overrides.json", import.meta.url).pathname,
).json();
const REAL: AvailabilityBuild = buildAvailability(REAL_SNAPSHOT, REAL_OVERRIDES);

/**
 * THE COLLISION BUDGET.
 *
 * An intra-provider collision means the normalization merged two ids that one
 * provider lists separately — within a single provider, distinct catalog
 * entries are distinct products, so this is the cheapest false-positive proxy
 * available. Both entries below are the same benign case: amazon-bedrock
 * genuinely lists an unversioned and a versioned id for one model, and
 * canonical selection picks the unversioned one deterministically.
 *
 * If `bun run codegen:refresh` introduces a third, this test fails and a human
 * must classify it: benign (extend this list) or a bad merge (add a `deny`
 * pair to data/availability-overrides.json). Do not widen it reflexively — a
 * wrong merge ships a `.toApi` target that 404s at runtime.
 */
const COLLISION_ALLOWLIST: Collision[] = [
  {
    group: "gpt-oss-120b||gptoss120b",
    provider: "amazon-bedrock",
    ids: ["openai.gpt-oss-120b", "openai.gpt-oss-120b-1:0"],
  },
  {
    group: "gpt-oss-20b||gptoss20b",
    provider: "amazon-bedrock",
    ids: ["openai.gpt-oss-20b", "openai.gpt-oss-20b-1:0"],
  },
];

describe("availability — real snapshot invariants", () => {
  test("collision budget: intra-provider collisions equal the committed allowlist", () => {
    expect(REAL.collisions).toEqual(COLLISION_ALLOWLIST);
  });

  test("alias pass links exactly the anthropic undated/dated pairs", () => {
    expect(REAL.aliasLinks).toEqual([
      "anthropic: claude-haiku-4-5 <-> claude-haiku-4-5-20251001",
      "anthropic: claude-opus-4-5 <-> claude-opus-4-5-20251101",
      "anthropic: claude-sonnet-4-5 <-> claude-sonnet-4-5-20250929",
    ]);
  });

  test("referential integrity: every emitted target id exists in that provider's catalog", async () => {
    const { getModel } = await import("../src/catalog/index");
    const missing: string[] = [];
    for (const [sourceProvider, map] of REAL.providers) {
      for (const [modelId, targets] of Object.entries(map)) {
        for (const [targetProvider, entry] of Object.entries(targets)) {
          const targetId = typeof entry === "string" ? entry : entry.id;
          if (getModel(targetProvider, targetId) === undefined) {
            missing.push(`${sourceProvider}:${modelId} → ${targetProvider}:${targetId}`);
          }
        }
      }
    }
    expect(missing).toEqual([]);
  });

  test("no source model ever targets its own provider", () => {
    const selfEdges: string[] = [];
    for (const [providerId, map] of REAL.providers) {
      for (const [modelId, targets] of Object.entries(map)) {
        if (Object.hasOwn(targets, providerId)) selfEdges.push(`${providerId}:${modelId}`);
      }
    }
    expect(selfEdges).toEqual([]);
  });

  test("every emitted provider is inside the declared scope, and every entry is non-empty", () => {
    const scope: string[] = REAL_OVERRIDES.providers;
    for (const [providerId, map] of REAL.providers) {
      expect(scope).toContain(providerId);
      for (const targets of Object.values(map)) {
        expect(Object.keys(targets).length).toBeGreaterThan(0);
      }
    }
  });

  test("RECONCILED v1: no claude edge touches azure or google-vertex's unverified surfaces", () => {
    const leaks: string[] = [];
    for (const [providerId, map] of REAL.providers) {
      for (const [modelId, targets] of Object.entries(map)) {
        for (const [targetProvider, entry] of Object.entries(targets)) {
          const targetId = typeof entry === "string" ? entry : entry.id;
          const claudeTarget =
            /claude/.test(targetId) &&
            (targetProvider === "azure" || targetProvider === "google-vertex");
          const claudeSource =
            /claude/.test(modelId) && (providerId === "azure" || providerId === "google-vertex");
          if (claudeTarget || claudeSource) leaks.push(`${providerId}:${modelId} → ${targetProvider}:${targetId}`);
        }
      }
    }
    expect(leaks).toEqual([]);
  });

  test("the only non-default endpoint emitted is google-vertex's MaaS chat surface", () => {
    const endpoints = new Set<string>();
    for (const map of REAL.providers.values()) {
      for (const targets of Object.values(map)) {
        for (const entry of Object.values(targets)) {
          if (typeof entry !== "string" && entry.endpoint !== undefined) endpoints.add(entry.endpoint);
        }
      }
    }
    expect([...endpoints]).toEqual(["google-vertex.chat"]);
  });

  test("the anthropic table carries the flagship claude-opus-5 row", () => {
    const anthropic = REAL.providers.get("anthropic")!;
    const opus5 = anthropic["claude-opus-5"]!;
    expect(idOf(opus5["openrouter"])).toBe("anthropic/claude-opus-5");
    expect(idOf(opus5["vercel"])).toBe("anthropic/claude-opus-5");
    expect(idOf(opus5["amazon-bedrock"])).toBe("anthropic.claude-opus-5");
    expect(opus5["openai"]).toBeUndefined();
  });

  test("scope matches the chat-validator directories on disk", async () => {
    const providersDir = new URL("../src/providers/", import.meta.url).pathname;
    const entries = await readdir(providersDir, { withFileTypes: true });
    const withChatValidator: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      // The factory itself is not a provider.
      if (entry.name === "openai-compatible") continue;
      const files = await readdir(`${providersDir}${entry.name}`);
      const hasDedicatedChat = files.some((f) =>
        ["chat.ts", "messages.ts", "generate-content.ts", "converse.ts"].includes(f),
      );
      const index = Bun.file(`${providersDir}${entry.name}/index.ts`);
      const usesFleetFactory =
        (await index.exists()) && (await index.text()).includes("createOpenAICompatible");
      if (hasDedicatedChat || usesFleetFactory) withChatValidator.push(entry.name);
    }
    // cohere's chat body is a fifth wire dialect with no translator in v1, so
    // it is deliberately out of the availability scope.
    const expected = withChatValidator.filter((id) => id !== "cohere").sort();
    expect([...(REAL_OVERRIDES.providers as string[])].sort()).toEqual(expected);
  });

  test("no aggregator index is generated under src/catalog/availability", async () => {
    const dir = new URL("../src/catalog/availability/", import.meta.url).pathname;
    const files = await readdir(dir);
    expect(files.filter((f) => !f.endsWith(".gen.ts"))).toEqual([]);
    expect(files.sort()).toEqual([...REAL.providers.keys()].map((id) => `${id}.gen.ts`).sort());
  });

  test("import-graph rule 1 — the availability layer never names src/providers", async () => {
    const offenders: string[] = [];
    const roots = [
      { dir: new URL("../src/core/translate/", import.meta.url).pathname, depth: 0 },
      { dir: new URL("../src/catalog/availability/", import.meta.url).pathname, depth: 0 },
    ];
    for (const { dir } of roots) {
      for (const file of await readdir(dir)) {
        if (!file.endsWith(".ts")) continue;
        // Colocated tests are not shipped, so they cannot create a runtime
        // cycle — and the endpoint table's whole point is to be checked
        // against the provider modules it mirrors, which requires importing
        // them. `test/import-graph.test.ts` excludes them for the same reason.
        if (file.endsWith(".test.ts") || file.endsWith(".test-d.ts")) continue;
        const source = await Bun.file(`${dir}${file}`).text();
        for (const match of source.matchAll(/from\s+"([^"]+)"/g)) {
          const specifier = match[1]!;
          if (specifier.includes("providers/")) offenders.push(`${dir}${file} → ${specifier}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test("per-map size budget — no single table balloons past its bundle budget", async () => {
    // These tables cannot be tree-shaken (`.toApi` is attached in finalize, so
    // the map is always reachable), and each is bundled into exactly one
    // provider subpath. Measured today: 288 KiB total, largest is openrouter
    // at 45 KiB. A refresh that blows through these has almost certainly
    // broken the heuristic rather than genuinely grown the catalog —
    // investigate before bumping.
    const dir = new URL("../src/catalog/availability/", import.meta.url).pathname;
    let total = 0;
    const oversized: string[] = [];
    for (const file of await readdir(dir)) {
      const bytes = (await Bun.file(`${dir}${file}`).text()).length;
      total += bytes;
      if (bytes > 64 * 1024) oversized.push(`${file} (${bytes} bytes)`);
    }
    expect(oversized).toEqual([]);
    expect(total).toBeLessThan(384 * 1024);
  });

  test("committed files match a fresh generation (drift guard)", async () => {
    const dir = new URL("../src/catalog/availability/", import.meta.url).pathname;
    const files = generate(REAL_SNAPSHOT, REAL_OVERRIDES);
    for (const [name, content] of files) {
      if (!name.startsWith("availability/")) continue;
      const onDisk = await Bun.file(`${dir}${name.slice("availability/".length)}`).text();
      expect(onDisk).toBe(content);
    }
  });
});
