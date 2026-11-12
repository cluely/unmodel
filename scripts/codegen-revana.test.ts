import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { generate, type GenerateInput } from "./codegen-revana";

/**
 * Two suites, split the way `codegen-fal.test.ts` splits them.
 *
 * The first runs a **mini fixture**: it pins the emitted file set, determinism
 * and the refusals — the catalog constructs this generator must stop on rather
 * than guess at. A fixture is the only way to test a refusal, because the
 * committed snapshot deliberately contains none.
 *
 * The second runs against the **real committed snapshot**, one test per
 * lowering rule, naming the model that exercises it. A snapshot refresh that
 * changes one of those facts then fails with a message saying which.
 */

type Json = Record<string, unknown>;

const CAPABILITIES = {
  edit: false,
  image_input: false,
  video_input: false,
  audio_input: false,
  audio_output: false,
  first_last_frame: false,
  reference_images: false,
  upscale: false,
};

function media(id: string, overrides: Json = {}): Json {
  return {
    id,
    object: "model",
    name: id,
    maker: "Maker",
    kind: "video",
    tasks: ["text_to_video"],
    options: {},
    price: { unit: "per_second", usd: 0.1 },
    capabilities: CAPABILITIES,
    route_prices: { "*": [[0.1, 0]] },
    ...overrides,
  };
}

function chat(id: string, overrides: Json = {}): Json {
  return {
    id,
    object: "model",
    owned_by: "Maker",
    name: id,
    maker: "Maker",
    kind: "text",
    tasks: ["chat_completions"],
    endpoint: "/v1/chat/completions",
    price: {
      unit: "per_million_tokens",
      currency: "USD",
      input: 1,
      cached_input: 0.1,
      cache_write: 1.25,
      cache_write_1h: 2,
      output: 5,
    },
    ...overrides,
  };
}

const SPEECH_OVERLAY = {
  fields: ["text", "voice"],
  quote: "It takes text and voice.",
  source: "POST https://api.revana.si/v1/generations/quote",
  date: "2026-11-12",
};

const PROVENANCE = { reason: "because", source: "https://example.com", date: "2026-11-12" };

function input(models: Json[], patch: Partial<Record<"lipsync" | "avatar", Json>> = {}): GenerateInput {
  return {
    catalog: { object: "list", data: models },
    curation: {
      views: { lipsync: patch.lipsync ?? {}, avatar: patch.avatar ?? {} },
      excluded: { routes: {} },
    },
    overlays: {
      speechFields: { speaker: SPEECH_OVERLAY },
      negativePrompt: {
        acceptedBy: [],
        quote: "q",
        source: "s",
        date: "2026-11-12",
      },
    },
  };
}

const SPEAKER = media("speaker", {
  kind: "audio",
  tasks: ["text_to_speech"],
  options: {
    voices: [{ id: "v1", name: "One" }],
    default_voice: "v1",
    max_characters: 100,
    languages: [],
  },
  price: { unit: "per_1k_chars", usd: 0.12 },
});

describe("codegen-revana on a mini fixture", () => {
  const files = generate(input([media("clip"), SPEAKER, chat("talker")]));

  test("emits one shape and one price table per wide address, the id lists, the voices and five catalogs", () => {
    expect([...files.keys()].sort()).toEqual([
      "ids.gen.ts",
      "models-chat.gen.ts",
      "models-image.gen.ts",
      "models-music.gen.ts",
      "models-tts.gen.ts",
      "models-video.gen.ts",
      "prices-image.gen.ts",
      "prices-music.gen.ts",
      "prices-tts.gen.ts",
      "prices-video.gen.ts",
      "shapes-image.gen.ts",
      "shapes-music.gen.ts",
      "shapes-tts.gen.ts",
      "shapes-video.gen.ts",
      "voices.gen.ts",
    ]);
  });

  test("is deterministic and independent of the catalog's row order", () => {
    const reversed = generate(input([chat("talker"), SPEAKER, media("clip")]));
    expect([...reversed.entries()]).toEqual([...files.entries()]);
  });

  test("an empty `languages` list survives lowering — it means `language_code` is refused", () => {
    expect(files.get("shapes-tts.gen.ts")).toContain("languages: []");
  });

  test("a per-1,000-character rate becomes the catalog's per-million unit", () => {
    expect(files.get("models-tts.gen.ts")).toContain("cost: { perMillionCharacters: 120 }");
  });

  test("chat rows state the endpoint's envelope, and no context where none is listed", () => {
    const rows = files.get("models-chat.gen.ts") ?? "";
    expect(rows).toContain("toolCall: true");
    expect(rows).toContain("limit: { context: 0 }");
    expect(rows).toContain("cost: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 }");
  });

  test("refuses an option key it does not model", () => {
    expect(() => generate(input([media("clip", { options: { frame_rates: [24] } })]))).toThrow();
  });

  test("refuses a price unit it does not model", () => {
    expect(() =>
      generate(input([media("clip", { price: { unit: "per_megapixel", usd: 1 } })])),
    ).toThrow();
  });

  test("refuses a duplicate model id", () => {
    expect(() => generate(input([media("clip"), media("clip")]))).toThrow(/duplicate model id/);
  });

  test("refuses a speech model with no recorded field list", () => {
    const stranger = { ...SPEAKER, id: "stranger" };
    expect(() => generate(input([SPEAKER, stranger]))).toThrow(/no `speechFields` entry/);
  });

  test("refuses a video model that takes a sound until curation files it under a verb", () => {
    const talker = media("talking-head", {
      tasks: ["image_to_video"],
      capabilities: { ...CAPABILITIES, audio_input: true },
    });
    expect(() => generate(input([talker, SPEAKER]))).toThrow(/neither `views.lipsync`/);
    const filed = generate(input([talker, SPEAKER], { avatar: { "talking-head": PROVENANCE } }));
    expect(filed.get("ids.gen.ts")).toContain('REVANA_AVATAR_MODELS = ["talking-head"]');
  });

  test("refuses curation that names a model the catalog no longer lists", () => {
    expect(() => generate(input([media("clip"), SPEAKER], { lipsync: { gone: PROVENANCE } }))).toThrow(
      /no longer lists/,
    );
  });
});

// ---------------------------------------------------------------------------
// The committed snapshot
// ---------------------------------------------------------------------------

const ROOT = join(import.meta.dir, "..");
const GEN_DIR = join(ROOT, "src", "providers", "revana", "gen");

function readJson(name: string): unknown {
  return JSON.parse(readFileSync(join(ROOT, "data", "revana", name), "utf8"));
}

describe("codegen-revana on the committed snapshot", () => {
  const files = generate({
    catalog: readJson("models.json"),
    curation: readJson("curation.json"),
    overlays: readJson("overlays.json"),
  });
  const file = (name: string): string => files.get(name) ?? "";
  const row = (name: string, id: string): string =>
    file(name)
      .split("\n")
      .find((line) => line.startsWith(`  ${JSON.stringify(id)}: {`)) ?? "";

  test("the committed gen/ directory is exactly what the snapshot generates", () => {
    expect(readdirSync(GEN_DIR).sort()).toEqual([...files.keys()].sort());
    for (const [name, content] of files) {
      expect(readFileSync(join(GEN_DIR, name), "utf8")).toBe(content);
    }
  });

  test("veo-3.1: a duration LIST, and media read off its three tasks", () => {
    const veo = row("shapes-video.gen.ts", "veo-3.1");
    expect(veo).toContain('media: ["image_url", "end_image_url"]');
    expect(veo).toMatch(/durations: D_[0-9a-f]{6}/);
    expect(veo).toContain("audio: true");
  });

  test("seedance-2.5: a duration RANGE", () => {
    expect(row("shapes-video.gen.ts", "seedance-2.5")).toContain("durations: { min: 4, max: 30 }");
  });

  test("kling-2.1-master: no resolutions key at all — the model takes no `resolution`", () => {
    expect(row("shapes-video.gen.ts", "kling-2.1-master")).not.toContain("resolutions");
  });

  test("recraft-crisp-upscale: an upscaler takes a picture or a clip", () => {
    expect(row("shapes-image.gen.ts", "recraft-crisp-upscale")).toContain(
      'media: ["image_url", "video_url"]',
    );
  });

  test("elevenlabs-v3 takes `dialogue`; elevenlabs-v4 lists no languages and so refuses the field", () => {
    expect(row("shapes-tts.gen.ts", "elevenlabs-v3")).toContain("dialogue: true");
    expect(row("shapes-tts.gen.ts", "elevenlabs-v3")).toMatch(/languages: L_[0-9a-f]{6}/);
    expect(row("shapes-tts.gen.ts", "elevenlabs-v4")).toContain("languages: []");
    expect(row("shapes-tts.gen.ts", "elevenlabs-turbo-2.5")).not.toContain("languages");
  });

  test("only the two recorded models take `negative_prompt`", () => {
    const flagged = [...file("shapes-video.gen.ts").split("\n"), ...file("shapes-image.gen.ts").split("\n")]
      .filter((line) => line.includes("negativePrompt: true"))
      .map((line) => line.trim().split(":")[0]);
    expect(flagged.sort()).toEqual(['"hunyuan-image-3.5-preview"', '"kling-2.5-turbo-pro"']);
  });

  test("a rate keyed by setting stays out of ModelInfo.cost; a flat one goes in", () => {
    const keyed = file("models-video.gen.ts").split('"veo-3.1": {')[1]?.split("\n  },")[0] ?? "";
    expect(keyed).not.toContain("cost:");
    const flat = file("models-image.gen.ts").split('"imagen-4": {')[1]?.split("\n  },")[0] ?? "";
    expect(flat).toContain("cost: { perImage: 0.05 }");
  });

  test("gemini-omni-1.1-flash carries its per-job fee", () => {
    expect(row("prices-video.gen.ts", "gemini-omni-1.1-flash")).toContain("feeUsd: {");
  });

  test("the lipsync and avatar views are the curated ids", () => {
    expect(file("ids.gen.ts")).toContain('REVANA_LIPSYNC_MODELS = ["bytedance-lipsync"]');
    expect(file("ids.gen.ts")).toContain(
      'REVANA_AVATAR_MODELS = ["kling-avatar-pro", "kling-avatar-std", "omnihuman-1.5", "omnihuman-2.0"]',
    );
  });
});
