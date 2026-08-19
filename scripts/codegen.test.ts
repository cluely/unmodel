import { describe, expect, test } from "bun:test";
import { generate, sortKeysDeep } from "./codegen";

const miniSnapshot = {
  "beta-ai": {
    id: "beta-ai",
    name: "Beta AI",
    env: ["BETA_API_KEY"],
    api: "https://api.beta.example/v1",
    models: {
      "beta-video": {
        id: "beta-video",
        name: "Beta Video",
        attachment: false,
        reasoning: false,
        tool_call: false,
        open_weights: true,
        modalities: { input: ["text", "image"], output: ["video"] },
        limit: { context: 8000 },
        // no cost, no output limit — both optional upstream
      },
    },
  },
  "acme": {
    id: "acme",
    name: "Acme",
    env: ["ACME_API_KEY", "ACME_KEY"],
    doc: "https://docs.acme.example",
    models: {
      "acme-chat-2": {
        id: "acme-chat-2",
        name: "Acme Chat 2",
        family: "acme-chat",
        attachment: true,
        reasoning: true,
        tool_call: true,
        structured_output: true,
        temperature: false,
        open_weights: false,
        release_date: "2026-01-01",
        last_updated: "2026-02-01",
        knowledge: "2025-12-31",
        status: "beta",
        modalities: { input: ["text", "image", "pdf"], output: ["text"] },
        limit: { context: 200000, output: 64000 },
        cost: { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 },
        some_future_field: { anything: true },
      },
      "acme-image-1": {
        id: "acme-image-1",
        name: "Acme Image 1",
        attachment: false,
        reasoning: false,
        tool_call: false,
        open_weights: false,
        modalities: { input: ["text"], output: ["image"] },
        limit: { context: 4000, output: 0 },
        cost: { input: 5 },
      },
    },
  },
};

describe("codegen", () => {
  test("is deterministic — two runs are byte-identical", () => {
    const a = generate(miniSnapshot);
    const b = generate(structuredClone(miniSnapshot));
    expect([...a.keys()]).toEqual([...b.keys()]);
    for (const [name, content] of a) {
      expect(b.get(name)).toBe(content);
    }
  });

  test("emits one file per provider plus the index, providers sorted", () => {
    const files = generate(miniSnapshot);
    expect([...files.keys()]).toEqual(["acme.gen.ts", "beta-ai.gen.ts", "index.ts"]);
  });

  test("provider file: camelCase normalization, unions, satisfies contract", () => {
    const acme = generate(miniSnapshot).get("acme.gen.ts")!;
    expect(acme).toContain("as const satisfies Record<string, ModelInfo>");
    expect(acme).toContain("toolCall: true");
    expect(acme).toContain("structuredOutput: true");
    expect(acme).toContain("openWeights: false");
    expect(acme).toContain("cacheRead: 0.3");
    expect(acme).toContain('status: "beta"');
    // Pre-split modality unions.
    expect(acme).toContain('export type AcmeTextModelId = "acme-chat-2";');
    expect(acme).toContain('export type AcmeImageModelId = "acme-image-1";');
    expect(acme).toContain("export type AcmeVideoModelId = never;");
    // Unknown upstream fields are ignored, not emitted.
    expect(acme).not.toContain("some_future_field");
  });

  test("optional fields are omitted, not emitted as undefined", () => {
    const beta = generate(miniSnapshot).get("beta-ai.gen.ts")!;
    expect(beta).not.toContain("undefined");
    expect(beta).not.toContain("cost:");
    expect(beta).toContain("limit: { context: 8000 },");
  });

  test("index aggregates all providers with a ProviderId union and getModel", () => {
    const index = generate(miniSnapshot).get("index.ts")!;
    expect(index).toContain('import * as acmeGen from "./acme.gen";');
    expect(index).toContain('import * as betaAiGen from "./beta-ai.gen";');
    expect(index).toContain('| "acme"');
    expect(index).toContain('| "beta-ai"');
    expect(index).toContain("export function getModel(");
  });

  test("rejects a snapshot with a broken known field, naming the path", () => {
    const broken = structuredClone(miniSnapshot) as Record<string, { models: Record<string, { limit: unknown }> }>;
    broken["acme"]!.models["acme-chat-2"]!.limit = { context: "lots" };
    expect(() => generate(broken)).toThrow(/acme.*limit.*context/s);
  });

  test("sortKeysDeep sorts recursively without touching arrays", () => {
    expect(JSON.stringify(sortKeysDeep({ b: { d: 1, c: 2 }, a: [3, { z: 1, y: 2 }] }))).toBe(
      '{"a":[3,{"y":2,"z":1}],"b":{"c":2,"d":1}}',
    );
  });
});
