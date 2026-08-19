import { describe, expect, test } from "bun:test";
import { generate, sortKeysDeep } from "./codegen";
import { catalog } from "../src/catalog/index";
import { chatProfiles } from "../src/catalog/chat-profiles.gen";
import type { ChatModelProfile } from "../src/catalog/chat-profiles.gen";

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

  test("no chat tables without overrides — their scope is the overrides file", () => {
    const files = generate(miniSnapshot);
    expect(files.has("chat-refs.gen.ts")).toBe(false);
    expect(files.has("chat-profiles.gen.ts")).toBe(false);
  });

  test("sortKeysDeep sorts recursively without touching arrays", () => {
    expect(JSON.stringify(sortKeysDeep({ b: { d: 1, c: 2 }, a: [3, { z: 1, y: 2 }] }))).toBe(
      '{"a":[3,{"y":2,"z":1}],"b":{"c":2,"d":1}}',
    );
  });
});

/**
 * The two `unmodel/chat` tables.
 *
 * The scope rule is the interesting part and the only one that can silently go
 * wrong: `providers` minus `targetOnly` minus the factory-configured targets,
 * intersected with models that *output text*. Get it wrong in the permissive
 * direction and `ChatModelRef` promises refs `chat()` cannot serve; get it
 * wrong in the restrictive direction and a real model becomes unaddressable
 * with no error anywhere. Both are asserted below against a mini snapshot
 * where every row is visible at once.
 */
describe("codegen: chat tables", () => {
  const miniOverrides = { providers: ["acme", "beta-ai"], targetOnly: [], deny: [], force: [] };

  const chatFiles = () => generate(miniSnapshot, miniOverrides);

  test("both files are emitted when overrides supply the scope", () => {
    const files = chatFiles();
    expect(files.has("chat-refs.gen.ts")).toBe(true);
    expect(files.has("chat-profiles.gen.ts")).toBe(true);
  });

  test("is deterministic — two runs are byte-identical", () => {
    const a = generate(miniSnapshot, miniOverrides);
    const b = generate(structuredClone(miniSnapshot), structuredClone(miniOverrides));
    for (const name of ["chat-refs.gen.ts", "chat-profiles.gen.ts"]) {
      expect(b.get(name)).toBe(a.get(name));
    }
  });

  test("refs: one arm per text model, and the file is type-only", () => {
    const refs = chatFiles().get("chat-refs.gen.ts") as string;
    expect(refs).toContain('export type ChatProviderId =\n  | "acme";');
    expect(refs).toContain('export type ChatModelRef =\n  | "acme/acme-chat-2";');
    // beta-ai's only model outputs video, so the provider drops out entirely;
    // acme-image-1 outputs images, so it is not a chat ref.
    expect(refs).not.toContain("beta-ai");
    expect(refs).not.toContain("acme-image-1");
    // Type-only: no `export const`, no runtime import, so the file costs zero
    // bytes in any bundle that pulls `ChatModelRef` in.
    expect(refs).not.toContain("export const");
    expect(refs).not.toContain("import ");
  });

  test("profiles: the slim subset only, with modality signatures hoisted", () => {
    const profiles = chatFiles().get("chat-profiles.gen.ts") as string;
    expect(profiles).toContain("export const chatProfiles: ChatCatalog = {");
    expect(profiles).toContain(
      'const M_TEXT_IMAGE_PDF__TEXT = { input: ["text", "image", "pdf"], output: ["text"] } as const;',
    );
    expect(profiles).toContain(
      '"acme-chat-2": { attachment: true, reasoning: true, toolCall: true, structuredOutput: true, ' +
        'temperature: false, status: "beta", modalities: M_TEXT_IMAGE_PDF__TEXT, ' +
        "limit: { context: 200000, output: 64000 }, " +
        "cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 } },",
    );
    // The fields the slim subset deliberately drops.
    for (const dropped of ["name:", "family:", "openWeights:", "releaseDate:", "lastUpdated:", "knowledge:"]) {
      expect(profiles, `chat profiles must not carry \`${dropped}\``).not.toContain(dropped);
    }
    expect(profiles).not.toContain("acme-image-1");
  });

  /**
   * The drift assertion, and the reason the profile emitter writes `false`
   * out rather than omitting it: every profile row must be *exactly* its
   * provider-catalog row narrowed to the slim keys. Anything weaker (subset
   * matching, equality-modulo-defaults) would pass while a codegen bug flips
   * `toolCall` or loses `cacheWrite`.
   */
  test("every committed profile row deep-equals its provider-catalog row", () => {
    const KEYS: ReadonlyArray<keyof ChatModelProfile> = [
      "attachment",
      "reasoning",
      "toolCall",
      "structuredOutput",
      "temperature",
      "status",
      "modalities",
      "limit",
      "cost",
    ];
    const slim = (model: Record<string, unknown>): Record<string, unknown> =>
      Object.fromEntries(KEYS.filter((key) => model[key] !== undefined).map((key) => [key, model[key]]));

    let rows = 0;
    for (const [providerId, models] of Object.entries(chatProfiles)) {
      const source = (catalog as Record<string, { models: Record<string, unknown> } | undefined>)[providerId];
      expect(source, `chatProfiles names provider "${providerId}"`).toBeDefined();
      for (const [modelId, profile] of Object.entries(models)) {
        const catalogRow = (source as { models: Record<string, unknown> }).models[modelId];
        expect(catalogRow, `${providerId}/${modelId} must exist in the provider catalog`).toBeDefined();
        expect(profile, `${providerId}/${modelId}`).toEqual(
          slim(catalogRow as Record<string, unknown>) as never,
        );
        rows += 1;
      }
    }
    // A vacuous sweep would be worse than no sweep.
    expect(rows).toBeGreaterThan(1000);
  });

  test("the committed table covers every text model of every in-scope provider", () => {
    for (const [providerId, models] of Object.entries(chatProfiles)) {
      type TextRows = { models: Record<string, { modalities: { output: readonly string[] } }> };
      const source = (catalog as unknown as Record<string, TextRows | undefined>)[providerId];
      expect(source, providerId).toBeDefined();
      const expected = Object.entries((source as TextRows).models)
        .filter(([, model]) => model.modalities.output.includes("text"))
        .map(([id]) => id)
        .sort();
      expect(Object.keys(models).sort(), providerId).toEqual(expected);
    }
    expect(Object.keys(chatProfiles).length).toBe(32);
  });
});
