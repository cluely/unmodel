import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  AA_ENDPOINTS,
  audit,
  classifyRow,
  fixtureFileName,
  normalizeName,
  parseAliases,
  readFixtureData,
  renderReport,
  sweepCoverage,
  type AaRow,
} from "./leaderboard-audit";
import { catalog } from "../src/catalog/index";

const ROOT = resolve(import.meta.dir, "..");
const realAliases = parseAliases(
  JSON.parse(readFileSync(join(ROOT, "data", "leaderboard-aliases.json"), "utf8")),
);

describe("normalizeName", () => {
  test("drops parentheticals — a quality preset is not a model", () => {
    expect(normalizeName("GPT Image 2 (high)")).toBe("gpt-image-2");
    expect(normalizeName("Nano Banana 2 (Gemini 3.1 Flash Image Preview)")).toBe("nano-banana-2");
  });

  test("drops trailing resolution tokens — a parameter is not a model", () => {
    expect(normalizeName("Dreamina Seedance 2.0 720p")).toBe("dreamina-seedance-2-0");
    expect(normalizeName("Some Model 4K")).toBe("some-model");
  });

  test("collapses punctuation the way the alias keys expect", () => {
    expect(normalizeName("Qwen-Audio-3.0-TTS-Plus")).toBe("qwen-audio-3-0-tts-plus");
    expect(normalizeName("Suno V5.5")).toBe("suno-v5-5");
  });
});

describe("alias file", () => {
  test("the committed file validates", () => {
    expect(Object.keys(realAliases).length).toBeGreaterThanOrEqual(10);
  });

  test("covered without refs fails loudly", () => {
    expect(() =>
      parseAliases({
        $comment: "x",
        entries: { "text-to-image/x": { name: "X", status: "covered", verified: "2026-08-25" } },
      }),
    ).toThrow('status "covered" requires non-empty refs');
  });

  test("excluded without a reason fails loudly", () => {
    expect(() =>
      parseAliases({
        $comment: "x",
        entries: { "text-to-image/x": { name: "X", status: "excluded", verified: "2026-08-25" } },
      }),
    ).toThrow('requires a reason');
  });
});

describe("classifyRow", () => {
  const noAliases = {};
  const used = new Set<string>();

  test("slug exact-matches a bare model id", () => {
    const row: AaRow = { id: "u1", name: "Simba 3.2", slug: "simba-3-2" };
    const result = classifyRow("text-to-speech", row, ["speechify/simba-3.2"], false, noAliases, used);
    expect(result.verdict).toBe("auto");
    expect(result.matchedRef).toBe("speechify/simba-3.2");
  });

  test("a display name substring-matches a longer catalog id", () => {
    const row: AaRow = { id: "u2", name: "Gemini 3.1 Flash TTS" };
    const result = classifyRow(
      "text-to-speech",
      row,
      ["google/gemini-3.1-flash-tts-preview"],
      false,
      noAliases,
      used,
    );
    expect(result.verdict).toBe("auto");
  });

  test("short probes never substring-match", () => {
    const row: AaRow = { id: "u3", name: "V2" };
    const result = classifyRow("text-to-image", row, ["acme/model-v2-ultra"], false, noAliases, used);
    expect(result.verdict).toBe("triage");
  });

  test("chat is exact-only: substring hits do not count", () => {
    const row: AaRow = { id: "u4", name: "GPT-5.2 Mini High" };
    const result = classifyRow("language", row, ["openai/gpt-5.2"], true, noAliases, used);
    expect(result.verdict).toBe("triage");
  });

  test("an alias wins over auto-matching and records its use", () => {
    const usedHere = new Set<string>();
    const row: AaRow = { id: "u5", name: "Sonic 3.6" };
    const result = classifyRow(
      "text-to-speech",
      row,
      ["cartesia/sonic-3.5"],
      false,
      realAliases,
      usedHere,
    );
    expect(result.verdict).toBe("aliased");
    expect(result.alias?.status).toBe("covered");
    expect(usedHere.has("text-to-speech/sonic-3-6")).toBe(true);
  });
});

describe("the coverage sweep", () => {
  test("finds the provider fleet and the categories the packs serve", async () => {
    const coverage = await sweepCoverage();
    const categories = [...coverage.byCategory.keys()];
    for (const category of ["image", "imageEdit", "video", "tts", "stt", "music", "chat"]) {
      expect(categories, `category ${category} missing from the sweep`).toContain(category);
    }
    const providers = new Set(
      [...coverage.byCategory.entries()]
        .filter(([category]) => category !== "chat")
        .flatMap(([, refs]) => refs.map((ref) => ref.slice(0, ref.indexOf("/")))),
    );
    expect(providers.size).toBeGreaterThanOrEqual(40);
    expect(coverage.byCategory.get("tts")).toContain("stepfun/stepaudio-2.5-tts");
    expect(coverage.byCategory.get("music")).toContain("mureka/mureka-9.5");
  }, 30_000);
});

describe("end to end over fixtures", () => {
  test("classifies, reports and attributes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aa-fixtures-"));
    const anyChatRef = Object.entries(catalog).flatMap(([provider, entry]) =>
      Object.keys(entry.models).map((model) => ({ provider, model })),
    )[0]!;

    const fixtures: Record<string, AaRow[]> = {
      "text-to-image": [
        { id: "i1", name: "GPT Image 2 (high)", slug: "openai-gpt_image-2", creator: "OpenAI" },
        { id: "i2", name: "Totally New Imagegen 9", slug: "newco-imagegen-9", creator: "NewCo" },
      ],
      "image-editing": [],
      "text-to-video": [{ id: "v1", name: "Wan 3.0", creator: "Alibaba" }],
      "image-to-video": [],
      "text-to-video-audio": [],
      "image-to-video-audio": [],
      "text-to-speech": [
        { id: "t1", name: "Sonic 3.6", creator: "Cartesia" },
        { id: "t2", name: "Luna TTS", creator: "VUI Labs" },
      ],
      "speech-to-text": [{ id: "s1", name: "Whisper Ultra Nine", creator: "Someone" }],
      "music/instrumental": [],
      "music/with-vocals": [
        { id: "m1", name: "Suno V5.5", creator: "Suno" },
        { id: "m2", name: "Mureka V9", creator: "Mureka" },
      ],
      "speech-to-speech": [{ id: "ss1", name: "Voice Morph 1", creator: "Someone" }],
      language: [
        {
          id: "l1",
          name: anyChatRef.model,
          slug: anyChatRef.model,
          creator: anyChatRef.provider,
        },
        { id: "l2", name: "Extremely Future LLM", slug: "future-llm-99" },
      ],
    };
    for (const endpoint of AA_ENDPOINTS) {
      writeFileSync(
        join(dir, fixtureFileName(endpoint.key)),
        JSON.stringify({ tier: "free", data: fixtures[endpoint.key] ?? [] }),
      );
    }

    const data = readFixtureData(dir);
    const coverage = await sweepCoverage();
    const result = audit(data, coverage, realAliases);
    const byKey = new Map(result.endpoints.map((entry) => [entry.key, entry]));

    // GPT Image 2 (high) auto-matches; the invented model needs triage.
    expect(byKey.get("text-to-image")!.auto.map((c) => c.row.id)).toEqual(["i1"]);
    expect(byKey.get("text-to-image")!.triage.map((c) => c.row.id)).toEqual(["i2"]);
    // Alias hits: Wan 3.0 covered, Sonic 3.6 covered, Luna excluded, Suno excluded, Mureka covered.
    expect(byKey.get("text-to-video")!.aliased.map((c) => c.row.id)).toEqual(["v1"]);
    expect(byKey.get("text-to-speech")!.aliased.map((c) => c.row.id).sort()).toEqual(["t1", "t2"]);
    expect(byKey.get("music/with-vocals")!.aliased.map((c) => c.row.id).sort()).toEqual(["m1", "m2"]);
    // Slug-less STT row with no counterpart lands in triage, not a crash.
    expect(byKey.get("speech-to-text")!.triage.map((c) => c.row.id)).toEqual(["s1"]);
    // Chat: the real catalog id matches exactly; the future one does not.
    expect(byKey.get("language")!.auto.map((c) => c.row.id)).toEqual(["l1"]);
    expect(byKey.get("language")!.triage.map((c) => c.row.id)).toEqual(["l2"]);
    // Speech-to-speech is a category note, not a per-model gap list.
    expect(result.notServed).toEqual([{ key: "speech-to-speech", total: 1 }]);
    // Seeded aliases that matched nothing in these fixtures surface as stale.
    expect(result.staleAliases).toContain("text-to-video/magi-2-preview");

    const report = renderReport(result);
    expect(report).toContain("Totally New Imagegen 9");
    expect(report).toContain("Needs triage:");
    expect(report).toContain("unmodel has no unified surface");
    expect(report).toContain("Data: [Artificial Analysis](https://artificialanalysis.ai)");
  }, 30_000);

  test("a dangling covered ref is reported", async () => {
    const coverage = await sweepCoverage();
    const aliases = parseAliases({
      $comment: "test",
      entries: {
        "text-to-image/ghost": {
          name: "Ghost",
          status: "covered",
          refs: ["nowhere/nothing"],
          verified: "2026-08-25",
        },
      },
    });
    const data = new Map(AA_ENDPOINTS.map((endpoint) => [endpoint.key, []]));
    const result = audit(data, coverage, aliases);
    expect(result.danglingRefs).toEqual([{ key: "text-to-image/ghost", ref: "nowhere/nothing" }]);
    expect(result.staleAliases).toEqual(["text-to-image/ghost"]);
  }, 30_000);
});
