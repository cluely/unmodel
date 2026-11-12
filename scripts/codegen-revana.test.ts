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

  test("emits one shape and one price table per wide address, one unified table per category, the id lists, the voices and five catalogs", () => {
    expect([...files.keys()].sort()).toEqual([
      "avatar-params.gen.ts",
      "ids.gen.ts",
      "image-edit-params.gen.ts",
      "image-params.gen.ts",
      "lipsync-params.gen.ts",
      "models-chat.gen.ts",
      "models-image.gen.ts",
      "models-music.gen.ts",
      "models-tts.gen.ts",
      "models-video.gen.ts",
      "music-params.gen.ts",
      "prices-image.gen.ts",
      "prices-music.gen.ts",
      "prices-tts.gen.ts",
      "prices-video.gen.ts",
      "shapes-image.gen.ts",
      "shapes-music.gen.ts",
      "shapes-tts.gen.ts",
      "shapes-video.gen.ts",
      "tts-params.gen.ts",
      "upscale-params.gen.ts",
      "video-params.gen.ts",
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
// The unified rows, on fixtures built to hit each lowering rule
// ---------------------------------------------------------------------------

describe("codegen-revana lowers the catalog to the canonical vocabulary", () => {
  /** The emitted file with every hoisted constant inlined, so a row reads as its values. */
  function inlined(files: Map<string, string>, name: string): string {
    const text = files.get(name) ?? "";
    const constants = new Map<string, string>();
    for (const [, id, literal] of text.matchAll(/^const ([A-Z]_[0-9a-f]{6}) = (.+) as const;$/gm)) {
      constants.set(id as string, literal as string);
    }
    const inline = (source: string): string =>
      source.replace(/\b[A-Z]_[0-9a-f]{6}\b/g, (id) => constants.get(id) ?? id);
    // Twice: an `extras` object names the vocabulary its value is typed from.
    return inline(inline(text));
  }

  function row(files: Map<string, string>, name: string, id: string): string {
    return (
      inlined(files, name)
        .split("\n")
        .find((line) => line.startsWith(`  ${JSON.stringify(id)}: `)) ?? ""
    );
  }

  const video = (id: string, options: Json, overrides: Json = {}): Json =>
    media(id, { options, ...overrides });

  test("a tier maps only to the SAME WORD ignoring case — `4K` is `4k`, `2K` is nothing", () => {
    const files = generate(input([video("clip", { resolutions: ["720p", "2K", "4K"] }), SPEAKER]));
    const clip = row(files, "video-params.gen.ts", "clip");
    expect(clip).toContain('resolutions: ["720p", "4k"]');
    expect(clip).toContain('resolutionWire: { "720p": "720p", "4k": "4K" }');
    expect(clip).not.toContain("1440p");
  });

  test("resolutions with no canonical word keep an EMPTY wire map; no resolutions at all, none", () => {
    const files = generate(
      input([video("named", { resolutions: ["draft", "hd"] }), video("fixed", {}), SPEAKER]),
    );
    expect(row(files, "video-params.gen.ts", "named")).toContain(
      "resolutions: [], resolutionWire: {}",
    );
    const fixed = row(files, "video-params.gen.ts", "fixed");
    expect(fixed).toContain("resolutions: []");
    expect(fixed).not.toContain("resolutionWire");
  });

  test("durations: a list is an enum, a range is left wide, and none is an empty list", () => {
    const files = generate(
      input([
        video("listed", { durations: [4, 8] }),
        video("ranged", { durations: { min: 3, max: 15 } }),
        video("own-length", {}),
        SPEAKER,
      ]),
    );
    expect(row(files, "video-params.gen.ts", "listed")).toContain("durations: [4, 8]");
    expect(row(files, "video-params.gen.ts", "ranged")).not.toContain("durations");
    expect(row(files, "video-params.gen.ts", "own-length")).toContain("durations: []");
  });

  test("a shape list drops `adaptive` and `Auto`; a model that lists none stays free-form", () => {
    const files = generate(
      input([
        video("shaped", { aspect_ratios: ["adaptive", "16:9", "Auto", "19.5:9"] }),
        video("free", {}),
        SPEAKER,
      ]),
    );
    expect(row(files, "video-params.gen.ts", "shaped")).toContain('ratios: ["16:9", "19.5:9"]');
    expect(row(files, "video-params.gen.ts", "free")).not.toContain("ratios");
  });

  test("`audio` is an extra exactly where the option is `true`", () => {
    const files = generate(
      input([video("loud", { audio: true }), video("mute", { audio: false }), SPEAKER]),
    );
    expect(row(files, "video-params.gen.ts", "loud")).toContain("extras: { audio: EXTRA as boolean }");
    expect(row(files, "video-params.gen.ts", "mute")).not.toContain("extras");
  });

  test("a Nemesis row has no duration and no shape, whatever its catalog row lists", () => {
    const files = generate(
      input([
        video(
          "nemesis",
          { durations: { min: 4, max: 30 }, aspect_ratios: ["16:9"], guides: ["scene"], roles: ["person"] },
          { tasks: ["video_to_video"] },
        ),
        SPEAKER,
      ]),
    );
    const nemesis = row(files, "video-params.gen.ts", "nemesis");
    expect(nemesis).toContain("durations: []");
    expect(nemesis).toContain("ratios: []");
    expect(nemesis).toContain('guide: EXTRA as (typeof ["scene"])[number]');
    expect(nemesis).toContain('roles: EXTRA as readonly (typeof ["person"])[number][]');
  });

  test("the video roster leaves the curated views to their own packs", () => {
    const talker = media("talking-head", {
      tasks: ["image_to_video"],
      capabilities: { ...CAPABILITIES, audio_input: true },
    });
    const files = generate(
      input([media("clip"), talker, SPEAKER], { avatar: { "talking-head": PROVENANCE } }),
    );
    expect(files.get("video-params.gen.ts")).toContain('REVANA_VIDEO_UNIFIED_MODELS = ["clip"]');
    expect(files.get("avatar-params.gen.ts")).toContain(
      'REVANA_AVATAR_UNIFIED_MODELS = ["talking-head"]',
    );
    expect(row(files, "avatar-params.gen.ts", "talking-head")).toContain(
      'sources: ["image"], extras: { prompt: EXTRA as string }',
    );
    expect(files.get("lipsync-params.gen.ts")).toContain("REVANA_LIPSYNC_UNIFIED_MODELS = []");
  });

  test("pictures split by task: the image roster starts from a prompt, the edit roster edits", () => {
    const picture = (id: string, tasks: string[], options: Json = {}): Json =>
      media(id, { kind: "image", tasks, options, price: { unit: "per_image", usd: 0.04 } });
    const files = generate(
      input([
        picture("draws", ["text_to_image"], { resolutions: ["1K", "1MP"], aspect_ratios: ["auto", "1:1"] }),
        picture("both", ["text_to_image", "image_to_image"], {
          qualities: ["low", "high"],
          default_quality: "low",
        }),
        picture("edits", ["image_to_image"]),
        picture("bigger", ["upscale"]),
        SPEAKER,
      ]),
    );
    expect(files.get("image-params.gen.ts")).toContain('REVANA_IMAGE_UNIFIED_MODELS = ["both", "draws"]');
    expect(files.get("image-edit-params.gen.ts")).toContain(
      'REVANA_IMAGE_EDIT_UNIFIED_MODELS = ["both", "edits"]',
    );
    expect(files.get("upscale-params.gen.ts")).toContain('REVANA_UPSCALE_UNIFIED_MODELS = ["bigger"]');

    const draws = row(files, "image-params.gen.ts", "draws");
    expect(draws).toContain('ratios: ["1:1"]');
    expect(draws).toContain('tiers: ["1k"], tierWire: { "1k": "1K" }');
    // `quality` is typed from the tiers the catalog lists — on both packs' rows.
    const quality = 'extras: { quality: EXTRA as (typeof ["low", "high"])[number] }';
    expect(row(files, "image-params.gen.ts", "both")).toContain(quality);
    expect(row(files, "image-edit-params.gen.ts", "both")).toContain(quality);
    // An edit row has no tier, and one with nothing to narrow is empty.
    expect(row(files, "image-edit-params.gen.ts", "edits")).toBe('  "edits": {},');
    expect(row(files, "upscale-params.gen.ts", "bigger")).toBe(
      '  "bigger": { sources: ["image"], factors: [] },',
    );
  });

  test("a speech row: no codec, the voice ids, and the extras the API says the model takes", () => {
    const files = generate(input([media("clip"), SPEAKER]));
    // SPEAKER lists `languages: []` — "picks the language from the text" — which
    // narrows nothing, and its overlay names neither `stability` nor
    // `similarity_boost`.
    expect(row(files, "tts-params.gen.ts", "speaker")).toBe('  "speaker": { codecs: [], voices: ["v1"] },');
    expect(files.get("tts-params.gen.ts")).not.toContain("EXTRA");

    const steady = generate({
      ...input([media("clip"), { ...SPEAKER, options: { ...(SPEAKER["options"] as Json), languages: ["en", "pt"] } }]),
      overlays: {
        speechFields: { speaker: { ...SPEECH_OVERLAY, fields: ["text", "voice", "stability"] } },
        negativePrompt: { acceptedBy: [], quote: "q", source: "s", date: "2026-11-12" },
      },
    });
    expect(row(steady, "tts-params.gen.ts", "speaker")).toBe(
      '  "speaker": { codecs: [], voices: ["v1"], languages: ["en", "pt"], extras: { stability: EXTRA as number } },',
    );
  });

  test("a music row carries the two fields a request needs one of, as extras", () => {
    const song = media("singer", {
      kind: "audio",
      tasks: ["text_to_music"],
      options: { instrumental: true },
      price: { unit: "per_job", usd: 0.08 },
    });
    const files = generate(input([song, SPEAKER]));
    expect(row(files, "music-params.gen.ts", "singer")).toBe(
      '  "singer": { codecs: [], extras: { style: EXTRA as string, lyrics: EXTRA as string } },',
    );
  });

  test("every unified table satisfies the kernel's own row type", () => {
    const files = generate(input([media("clip"), SPEAKER]));
    const satisfied = (name: string): string | undefined =>
      /satisfies Record<string, (\w+)>;/.exec(files.get(name) ?? "")?.[1];
    expect(satisfied("video-params.gen.ts")).toBe("RevanaVideoParamRow");
    expect(satisfied("image-params.gen.ts")).toBe("RevanaImageParamRow");
    expect(satisfied("image-edit-params.gen.ts")).toBe("ModelParams");
    expect(satisfied("upscale-params.gen.ts")).toBe("UpscaleModelParams");
    expect(satisfied("lipsync-params.gen.ts")).toBe("LipsyncModelParams");
    expect(satisfied("avatar-params.gen.ts")).toBe("AvatarModelParams");
    expect(satisfied("tts-params.gen.ts")).toBe("TtsModelParams");
    expect(satisfied("music-params.gen.ts")).toBe("MusicModelParams");
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

  // --- the unified rows ----------------------------------------------------

  /** The ids a `<category>-params.gen.ts` roster lists. */
  const roster = (name: string): string[] =>
    JSON.parse(/_UNIFIED_MODELS = (\[.*\]) as const;/.exec(file(name))?.[1] ?? "[]") as string[];

  /** A hoisted constant's literal, by the name a row refers to it with. */
  const constant = (name: string, id: string): string =>
    new RegExp(`^const ${id} = (.+) as const;$`, "m").exec(file(name))?.[1] ?? "";

  /** The constant a row names for one of its keys. */
  const named = (name: string, id: string, key: string): string =>
    constant(name, new RegExp(`${key}: ([A-Z]_[0-9a-f]{6})`).exec(row(name, id))?.[1] ?? "");

  test("the eight rosters: 69 video, 56 image, 46 edit, and the curated and single-model ones", () => {
    expect(roster("video-params.gen.ts")).toHaveLength(69);
    expect(roster("image-params.gen.ts")).toHaveLength(56);
    expect(roster("image-edit-params.gen.ts")).toHaveLength(46);
    expect(roster("upscale-params.gen.ts")).toEqual(["recraft-crisp-upscale"]);
    expect(roster("lipsync-params.gen.ts")).toEqual(["bytedance-lipsync"]);
    expect(roster("avatar-params.gen.ts")).toEqual([
      "kling-avatar-pro",
      "kling-avatar-std",
      "omnihuman-1.5",
      "omnihuman-2.0",
    ]);
    expect(roster("tts-params.gen.ts")).toHaveLength(4);
    expect(roster("music-params.gen.ts")).toEqual(["suno-v6"]);
  });

  test("the video roster is every video model but the two curated views", () => {
    const video = roster("video-params.gen.ts");
    expect(video).toContain("veo-3.1");
    expect(video).toContain("nemesis");
    expect(video).not.toContain("bytedance-lipsync");
    expect(video).not.toContain("omnihuman-2.0");
  });

  test("veo-3.1: its `4K` is the canonical `4k`, its durations an enum, its shapes two", () => {
    expect(named("video-params.gen.ts", "veo-3.1", "durations")).toBe("[4, 6, 8]");
    expect(named("video-params.gen.ts", "veo-3.1", "resolutions")).toBe('["720p", "1080p", "4k"]');
    expect(named("video-params.gen.ts", "veo-3.1", "resolutionWire")).toBe(
      '{ "720p": "720p", "1080p": "1080p", "4k": "4K" }',
    );
    expect(named("video-params.gen.ts", "veo-3.1", "ratios")).toBe('["16:9", "9:16"]');
    expect(named("video-params.gen.ts", "veo-3.1", "extras")).toBe("{ audio: EXTRA as boolean }");
  });

  test("ltx-2.5-fast lists `2K`, which is no canonical tier — `1440p` reaches no model", () => {
    expect(named("video-params.gen.ts", "ltx-2.5-fast", "resolutions")).not.toContain("1440p");
    expect(file("video-params.gen.ts")).not.toContain('"1440p"');
  });

  test("seedance-2.5: a duration RANGE leaves `duration` wide, and `adaptive` is not a shape", () => {
    expect(row("video-params.gen.ts", "seedance-2.5")).not.toContain("durations");
    expect(named("video-params.gen.ts", "seedance-2.5", "ratios")).toBe(
      '["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"]',
    );
  });

  test("nemesis: no duration and no shape — `NemesisInput` has neither field", () => {
    const nemesis = row("video-params.gen.ts", "nemesis");
    expect(nemesis).toContain("durations: []");
    expect(nemesis).toContain("ratios: []");
    expect(named("video-params.gen.ts", "nemesis", "extras")).toMatch(/^\{ guide: .+, sound: .+, roles: .+ \}$/);
  });

  test("kling-2.1-master lists no resolutions: empty tiers and no wire map", () => {
    const kling = row("video-params.gen.ts", "kling-2.1-master");
    expect(kling).toContain("resolutions: []");
    expect(kling).not.toContain("resolutionWire");
  });

  test("nano-banana-pro: three tiers and a shape list; gpt-image-1: `quality` and no tier", () => {
    expect(named("image-params.gen.ts", "nano-banana-pro", "tierWire")).toBe(
      '{ "1k": "1K", "2k": "2K", "4k": "4K" }',
    );
    expect(row("image-params.gen.ts", "gpt-image-1")).toContain("tiers: []");
    expect(named("image-params.gen.ts", "gpt-image-1", "extras")).toMatch(/^\{ quality: EXTRA as /);
    expect(row("image-edit-params.gen.ts", "gpt-image-1")).not.toContain("tiers");
  });

  test("no picture row lists `auto` as a shape", () => {
    for (const name of ["image-params.gen.ts", "image-edit-params.gen.ts"]) {
      expect(file(name)).not.toMatch(/^const A_[0-9a-f]{6} = .*"auto"/m);
    }
  });

  test("the upscaler is a still with no multiplier; the two views take a clip and a still", () => {
    expect(row("upscale-params.gen.ts", "recraft-crisp-upscale")).toBe(
      '  "recraft-crisp-upscale": { sources: ["image"], factors: [] },',
    );
    expect(row("lipsync-params.gen.ts", "bytedance-lipsync")).toContain('sources: ["video"]');
    expect(row("avatar-params.gen.ts", "omnihuman-2.0")).toContain('sources: ["image"]');
  });

  test("elevenlabs-v3 lists languages and takes `stability` alone; -v4's empty list narrows nothing", () => {
    const v3 = row("tts-params.gen.ts", "elevenlabs-v3");
    expect(v3).toContain("codecs: []");
    expect(v3).toMatch(/languages: L_[0-9a-f]{6}/);
    expect(named("tts-params.gen.ts", "elevenlabs-v3", "extras")).toBe("{ stability: EXTRA as number }");
    expect(row("tts-params.gen.ts", "elevenlabs-v4")).not.toContain("languages");
    expect(named("tts-params.gen.ts", "elevenlabs-v4", "extras")).toBe(
      "{ stability: EXTRA as number, similarity_boost: EXTRA as number }",
    );
  });

  test("suno-v6 carries `style` and `lyrics`", () => {
    expect(named("music-params.gen.ts", "suno-v6", "extras")).toBe(
      "{ style: EXTRA as string, lyrics: EXTRA as string }",
    );
  });
});
