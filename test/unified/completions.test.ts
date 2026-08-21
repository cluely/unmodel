/**
 * Editor-completion regression suite, driven by the real TypeScript language
 * service — the same code path VS Code runs.
 *
 * ## Why this test exists
 *
 * The per-model `size` unions carry `` (`${number}x${number}` & {}) `` tails,
 * and the `& {}` is the only thing standing between the presets and
 * TypeScript's union subtype reduction: intersect the union with a wide
 * `size?: string` arm and the `& {}` is discharged during normalization, a
 * bare template survives, and every `"WxH"` preset is silently absorbed —
 * type-checking stays green while the editor completes nothing. That exact
 * regression shipped once (`ModelSizing` used to intersect the vocabulary's
 * own arms instead of replacing them; see the `SizingArms` doc in
 * `src/core/unified/vocabulary/model-params.ts`), and no `.test-d.ts` can
 * catch it: assignability is unaffected, only the completion list dies.
 *
 * So this suite asks `getCompletionsAtPosition` directly. If it fails, the
 * autocomplete the library exists to provide is broken, whatever tsc says.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

import { GPT_IMAGE_2_SIZES } from "../../src/providers/openai/images-shared";

const REPO = join(import.meta.dir, "../..");
const PROBE = join(REPO, "__completions_probe__.ts");

const parsed = ts.getParsedCommandLineOfConfigFile(join(REPO, "tsconfig.json"), {}, {
  ...ts.sys,
  onUnRecoverableConfigFileDiagnostic: (d) => {
    throw new Error(ts.flattenDiagnosticMessageText(d.messageText, "\n"));
  },
})!;

let probeText = "";
let probeVersion = 0;

const host: ts.LanguageServiceHost = {
  getScriptFileNames: () => [...parsed.fileNames, PROBE],
  getScriptVersion: (f) => (f === PROBE ? String(probeVersion) : "0"),
  getScriptSnapshot: (f) => {
    if (f === PROBE) return ts.ScriptSnapshot.fromString(probeText);
    if (!existsSync(f)) return undefined;
    return ts.ScriptSnapshot.fromString(readFileSync(f, "utf8"));
  },
  getCurrentDirectory: () => REPO,
  getCompilationSettings: () => parsed.options,
  getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
  fileExists: (f) => f === PROBE || ts.sys.fileExists(f),
  readFile: (f) => (f === PROBE ? probeText : ts.sys.readFile(f)),
  readDirectory: ts.sys.readDirectory,
  directoryExists: ts.sys.directoryExists,
  getDirectories: ts.sys.getDirectories,
};

const service = ts.createLanguageService(host, ts.createDocumentRegistry());

/** Completions at the `¦` cursor in `src`, as entry names. */
function completionsAt(src: string): string[] {
  const cursor = src.indexOf("¦");
  if (cursor < 0) throw new Error("probe source has no ¦ cursor");
  probeText = src.replace("¦", "");
  probeVersion += 1;
  const info = service.getCompletionsAtPosition(PROBE, cursor, {});
  return (info?.entries ?? []).map((e) => e.name);
}

describe("unified image: size completes the model's own presets", () => {
  test("gpt-image-2 (freeform, tailed union) completes every preset", () => {
    const entries = completionsAt(`import { image } from "./src/unified/image";
image({ model: "openai/gpt-image-2", prompt: "x", size: "¦" });`);
    // The union has a template tail, and the tail must not have eaten these.
    for (const preset of GPT_IMAGE_2_SIZES) expect(entries).toContain(preset);
  });

  test("gpt-image-1 (closed enum, no tail) completes exactly its values", () => {
    const entries = completionsAt(`import { image } from "./src/unified/image";
image({ model: "openai/gpt-image-1", prompt: "x", size: "¦" });`);
    expect(entries.sort()).toEqual(["1024x1024", "1024x1536", "1536x1024", "auto"]);
  });

  test("a non-openai freeform model still completes its presets", () => {
    const entries = completionsAt(`import { image } from "./src/unified/image";
image({ model: "bytedance/dola-seedream-5-0-pro-260628", prompt: "x", size: "¦" });`);
    expect(entries.length).toBeGreaterThan(10);
    expect(entries).toContain("1280x720");
  });

  test("unified matches the wire layer's own completion list", () => {
    const wire = completionsAt(`import { image } from "./src/providers/openai";
image({ model: "gpt-image-2", prompt: "x", size: "¦" });`);
    const unified = completionsAt(`import { image } from "./src/unified/image";
image({ model: "openai/gpt-image-2", prompt: "x", size: "¦" });`);
    expect(unified.sort()).toEqual(wire.sort());
  });
});

describe("unified image: per-model narrowing reaches the editor", () => {
  test("aspectRatio narrows to the model's ratios", () => {
    const entries = completionsAt(`import { image } from "./src/unified/image";
image({ model: "stability/stable-image-ultra", prompt: "x", aspectRatio: "¦" });`);
    // Stability's own nine, not the wide canonical union (which has 4:3, not 5:4).
    expect(entries).toContain("5:4");
    expect(entries).not.toContain("4:3");
  });

  test("background on gpt-image-1 offers transparent; gpt-image-2 must not", () => {
    const v1 = completionsAt(`import { image } from "./src/unified/image";
image({ model: "openai/gpt-image-1", prompt: "x", background: "¦" });`);
    expect(v1.sort()).toEqual(["auto", "opaque", "transparent"]);
    const v2 = completionsAt(`import { image } from "./src/unified/image";
image({ model: "openai/gpt-image-2", prompt: "x", background: "¦" });`);
    expect(v2.sort()).toEqual(["auto", "opaque"]);
  });

  test("property names include the model's extras", () => {
    const entries = completionsAt(`import { image } from "./src/unified/image";
image({ model: "openai/gpt-image-2", prompt: "x", ¦ });`);
    for (const name of ["size", "aspectRatio", "background", "quality", "moderation"]) {
      expect(entries).toContain(name);
    }
  });

  test("model refs complete provider-qualified", () => {
    const entries = completionsAt(`import { image } from "./src/unified/image";
image({ model: "¦", prompt: "x" });`);
    expect(entries).toContain("openai/gpt-image-2");
    expect(entries).toContain("black-forest-labs/flux-2-pro");
  });
});

describe("unified imageEdit: same guarantees on the edit surface", () => {
  test("size completes the edit model's presets", () => {
    const entries = completionsAt(`import { imageEdit } from "./src/unified/image-edit";
imageEdit({ model: "openai/gpt-image-2", operation: "edit", prompt: "x", image: { url: "https://e.com/a.png" }, size: "¦" });`);
    expect(entries.length).toBeGreaterThan(10);
    expect(entries).toContain("2048x1024");
  });
});

/**
 * ## `duration` is the first **numeric** union this suite has had to check
 *
 * The measured answer, recorded here because it decides how the assertion is
 * written: TypeScript **does** offer number-literal completions at a
 * `duration:` position. `getCompletionsAtPosition` returns them as entries
 * whose `name` is the digits (`"4"`, `"8"`, …), mixed into the global
 * identifier/keyword list that any expression position carries — unlike a
 * string position, which is filtered to the union alone.
 *
 * So the assertion is a **subset** check rather than the exact-list one the
 * `size`/`aspectRatio` tests use, and it also checks the negative (`7` and `5`
 * are absent) — because "every literal is offered" is trivially satisfied by a
 * list that contains every number. `test/types/unified-video.test-d.ts` holds
 * the other half: `duration: 7` is a compile error on `sora-2` and `8` is not.
 */
describe("unified video: per-model narrowing reaches the editor", () => {
  test("duration completes sora's five lengths, as number literals", () => {
    const entries = completionsAt(`import { video } from "./src/unified/video";
video({ model: "openai/sora-2", prompt: "x", duration: ¦ });`);
    for (const seconds of ["4", "8", "12", "16", "20"]) expect(entries).toContain(seconds);
    // The list is the limit: neither neighbour of 8 is on it.
    expect(entries).not.toContain("7");
    expect(entries).not.toContain("5");
  });

  test("a closed duration enum at another provider completes its own values", () => {
    const entries = completionsAt(`import { video } from "./src/unified/video";
video({ model: "luma/ray-2", prompt: "x", duration: ¦ });`);
    expect(entries).toContain("5");
    expect(entries).toContain("9");
    expect(entries).not.toContain("8");
  });

  test("a model whose lengths are a range keeps the wide number", () => {
    // Seedance's `duration` is `z.number().int()` with per-model bounds, so the
    // row declares no `durations` and there is no literal list to offer.
    const entries = completionsAt(`import { video } from "./src/unified/video";
video({ model: "bytedance/seedance-1-0-pro-250528", prompt: "x", duration: ¦ });`);
    for (const seconds of ["4", "8", "12"]) expect(entries).not.toContain(seconds);
  });

  test("resolution completes 720p on sora-2 and adds 1080p on pro", () => {
    const base = completionsAt(`import { video } from "./src/unified/video";
video({ model: "openai/sora-2", prompt: "x", resolution: "¦" });`);
    expect(base.sort()).toEqual(["720p"]);
    const pro = completionsAt(`import { video } from "./src/unified/video";
video({ model: "openai/sora-2-pro", prompt: "x", resolution: "¦" });`);
    expect(pro.sort()).toEqual(["1080p", "720p"]);
  });

  test("aspectRatio narrows to kling's three, not the canonical nine", () => {
    const entries = completionsAt(`import { video } from "./src/unified/video";
video({ model: "kling/kling-v3", prompt: "x", aspectRatio: "¦" });`);
    // Lexicographic, so `"16:9"` sorts before `"1:1"` (`'6'` < `':'`).
    expect(entries.sort()).toEqual(["16:9", "1:1", "9:16"]);
  });

  test("a shape-less model completes nothing for aspectRatio", () => {
    // `/v1/video_generation` has no aspect-ratio field: `ratios: []` types it
    // as `never`, which is the compile-time half of the run-time refusal.
    const entries = completionsAt(`import { video } from "./src/unified/video";
video({ model: "minimax/MiniMax-Hailuo-02", prompt: "x", aspectRatio: "¦" });`);
    expect(entries).toEqual([]);
  });

  test("property names include the model's extras, and its extras only", () => {
    const entries = completionsAt(`import { video } from "./src/unified/video";
video({ model: "kling/kling-v1", prompt: "x", ¦ });`);
    for (const name of ["duration", "resolution", "aspectRatio", "cfg_scale", "camera_control"]) {
      expect(entries).toContain(name);
    }
    // `sound` is kling-v3's and `audio` the path-addressed family's.
    expect(entries).not.toContain("sound");
    expect(entries).not.toContain("audio");
  });

  test("an extra's own values complete", () => {
    const entries = completionsAt(`import { video } from "./src/unified/video";
video({ model: "kling/kling-v3", prompt: "x", sound: "¦" });`);
    expect(entries.sort()).toEqual(["off", "on"]);
    // The same key does not exist one model over.
    const omni = completionsAt(`import { video } from "./src/unified/video";
video({ model: "kling/kling-3.0-omni", prompt: "x", audio: "¦" });`);
    expect(omni.sort()).toEqual(["native", "off", "original"]);
  });

  test("an unknown model degrades to the wide vocabulary", () => {
    const ratios = completionsAt(`import { video } from "./src/unified/video";
video({ model: "openai/sora-9", prompt: "x", aspectRatio: "¦" });`);
    // The nine canonical presets, and the `& {}` tail has not eaten them.
    for (const preset of ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9", "9:21"]) {
      expect(ratios).toContain(preset);
    }
    const tiers = completionsAt(`import { video } from "./src/unified/video";
video({ model: "openai/sora-9", prompt: "x", resolution: "¦" });`);
    expect(tiers.sort()).toEqual(["1080p", "1440p", "480p", "4k", "720p"]);
  });

  test("model refs complete provider-qualified", () => {
    const entries = completionsAt(`import { video } from "./src/unified/video";
video({ model: "¦", prompt: "x" });`);
    expect(entries).toContain("openai/sora-2");
    expect(entries).toContain("kling/kling-3.0-omni");
    expect(entries).toContain("lightricks/ltx-2-5-fast");
  });
});

/**
 * ## The audio categories add a second *shape* to check, not just a second list
 *
 * `outputFormat` is `AudioFormatCodec | AudioFormat`, so narrowing it means
 * narrowing a union **and** a property inside its object arm. Both are checked
 * below, because only the first is visible from the shorthand position: an
 * `AudioFormatOf` that narrowed the shorthand and left `format` wide would pass
 * a `size`-style test and still complete `"vorbis"` one keystroke later.
 *
 * `language` is the third shape again: a literal union with a `(string & {})`
 * tail, which is the LiteralUnion trick and the reason it must never be
 * intersected with the base's `language?: string` (the brace would discharge,
 * the bare `string` would survive, and subtype reduction would eat all
 * forty-two codes while tsc stayed perfectly happy — the `SizingArms` failure,
 * one category over).
 */
describe("unified speech: per-model narrowing reaches the editor", () => {
  test("outputFormat completes the model's codecs, and not the others'", () => {
    const hume = completionsAt(`import { speech } from "./src/unified/speech";
speech({ model: "hume/octave", text: "x", outputFormat: "¦" });`);
    expect(hume.sort()).toEqual(["mp3", "pcm_s16le"]);

    const openai = completionsAt(`import { speech } from "./src/unified/speech";
speech({ model: "openai/tts-1", text: "x", outputFormat: "¦" });`);
    expect(openai.sort()).toEqual(["aac", "flac", "mp3", "opus", "pcm_s16le"]);

    // Resemble is the only provider in the category with the wider PCM widths.
    const resemble = completionsAt(`import { speech } from "./src/unified/speech";
speech({ model: "resemble/resemble-ultra", text: "x", outputFormat: "¦" });`);
    expect(resemble).toContain("pcm_s24le");
    expect(openai).not.toContain("pcm_s24le");
  });

  test("the object spelling narrows `format` too", () => {
    const entries = completionsAt(`import { speech } from "./src/unified/speech";
speech({ model: "cartesia/sonic-3", text: "x", outputFormat: { format: "¦" } });`);
    expect(entries.sort()).toEqual(["mp3", "pcm_alaw", "pcm_f32le", "pcm_mulaw", "pcm_s16le"]);
  });

  test("language completes the model's list without gating it", () => {
    const entries = completionsAt(`import { speech } from "./src/unified/speech";
speech({ model: "lmnt/blizzard", text: "x", language: "¦" });`);
    // The 31 LMNT serves, and `"auto"` — a wire value the canonical BCP-47
    // `language` cannot spell — is deliberately not among them.
    expect(entries).toContain("ur");
    expect(entries).toContain("as");
    expect(entries).not.toContain("auto");
    // The `(string & {})` tail has not eaten the literals.
    expect(entries.length).toBe(31);
  });

  /**
   * Two regressions this suite caught while the tables were being written, both
   * of the "green build, dead narrowing" kind the file exists for — and both
   * invisible to `.test-d.ts`, because a widened union is *more* permissive and
   * therefore breaks no assignment:
   *
   *  1. **A widened source array.** MiniMax's `language_boost` map was
   *     annotated `Readonly<Record<string, …>>`, so `keyof typeof` was `string`,
   *     so the row's `languages` was `readonly string[]`, so `LanguageOf`
   *     answered the bare `string` and `language:` completed **nothing**.
   *  2. **A `filter` type predicate.** smallest.ai's two pools were derived with
   *     `filter((c): c is Exclude<L, "auto"> => …)`, which answers the same type
   *     for both calls whatever the predicate tests — so the 20-code base pool
   *     typed as all 31 and offered the eleven Pro-only codes its own validator
   *     refuses.
   *
   * The lists are asserted by *count* as well as by membership, because both
   * failures are "the list is a different size than the table says".
   */
  test("a per-model language list is the model's own, not the provider's widest", () => {
    const two8 = completionsAt(`import { speech } from "./src/unified/speech";
speech({ model: "minimax/speech-2.8-hd", text: "x", language: "¦" });`);
    expect(two8.length).toBe(42);
    expect(two8).toContain("fa");

    const legacy = completionsAt(`import { speech } from "./src/unified/speech";
speech({ model: "minimax/speech-01-hd", text: "x", language: "¦" });`);
    // "The speech-01 and speech-02 series models do not currently support
    // Persian, Filipino, or Tamil" — `fa`, `fil`/`tl` and `ta`.
    expect(legacy.length).toBe(38);
    for (const code of ["fa", "fil", "tl", "ta"]) expect(legacy).not.toContain(code);

    const base = completionsAt(`import { speech } from "./src/unified/speech";
speech({ model: "smallest-ai/lightning_v3.1", text: "x", language: "¦" });`);
    expect(base.length).toBe(20);
    expect(base).not.toContain("ja");

    const pro = completionsAt(`import { speech } from "./src/unified/speech";
speech({ model: "smallest-ai/lightning_v3.1_pro", text: "x", language: "¦" });`);
    expect(pro.length).toBe(31);
    expect(pro).toContain("ja");
  });

  test("property names include the model's extras, and its extras only", () => {
    const entries = completionsAt(`import { speech } from "./src/unified/speech";
speech({ model: "rime/mistv2", text: "x", ¦ });`);
    for (const name of ["outputFormat", "language", "speed", "inlineSpeedAlpha", "noTextNormalization"]) {
      expect(entries).toContain(name);
    }
    // Coda's row is empty and the Mist knobs are not on it.
    const coda = completionsAt(`import { speech } from "./src/unified/speech";
speech({ model: "rime/coda", text: "x", ¦ });`);
    expect(coda).not.toContain("inlineSpeedAlpha");
    expect(coda).not.toContain("noTextNormalization");
  });

  test("an extra's own values complete, per model", () => {
    const two6 = completionsAt(`import { speech } from "./src/unified/speech";
speech({ model: "minimax/speech-2.6-hd", text: "x", emotion: "¦" });`);
    expect(two6).toContain("whisper");
    expect(two6).toContain("fluent");
    const two8 = completionsAt(`import { speech } from "./src/unified/speech";
speech({ model: "minimax/speech-2.8-hd", text: "x", emotion: "¦" });`);
    expect(two8).toContain("fluent");
    expect(two8).not.toContain("whisper");
    const legacy = completionsAt(`import { speech } from "./src/unified/speech";
speech({ model: "minimax/speech-01-hd", text: "x", emotion: "¦" });`);
    expect(legacy).not.toContain("fluent");
    expect(legacy).toContain("calm");
  });

  test("an unknown model degrades to the wide vocabulary", () => {
    const entries = completionsAt(`import { speech } from "./src/unified/speech";
speech({ model: "openai/tts-9", text: "x", outputFormat: "¦" });`);
    for (const codec of ["mp3", "aac", "flac", "opus", "vorbis", "pcm_s24le", "pcm_alaw"]) {
      expect(entries).toContain(codec);
    }
  });
});

describe("unified transcribe: per-model narrowing reaches the editor", () => {
  test("timestamps completes the granularities the route reports", () => {
    const whisper = completionsAt(`import { transcribe } from "./src/unified/transcribe";
transcribe({ model: "openai/whisper-1", audio: { file: new Blob([]) }, timestamps: "¦" });`);
    expect(whisper.sort()).toEqual(["none", "segment", "word"]);

    const gpt4o = completionsAt(`import { transcribe } from "./src/unified/transcribe";
transcribe({ model: "openai/gpt-4o-transcribe", audio: { file: new Blob([]) }, timestamps: "¦" });`);
    expect(gpt4o.sort()).toEqual(["none"]);

    const scribe = completionsAt(`import { transcribe } from "./src/unified/transcribe";
transcribe({ model: "elevenlabs/scribe_v1", audio: { url: "https://e.com/a.wav" }, timestamps: "¦" });`);
    expect(scribe.sort()).toEqual(["character", "none", "word"]);

    // No `"none"` where the route has no switch to turn timings off.
    const deepgram = completionsAt(`import { transcribe } from "./src/unified/transcribe";
transcribe({ model: "deepgram/nova-3", audio: { url: "https://e.com/a.wav" }, timestamps: "¦" });`);
    expect(deepgram.sort()).toEqual(["segment", "word"]);

    const assembly = completionsAt(`import { transcribe } from "./src/unified/transcribe";
transcribe({ model: "assemblyai/universal-2", audio: { url: "https://e.com/a.wav" }, timestamps: "¦" });`);
    expect(assembly.sort()).toEqual(["word"]);
  });

  test("language completes a closed list where the wire has one", () => {
    const solaria3 = completionsAt(`import { transcribe } from "./src/unified/transcribe";
transcribe({ model: "gladia/solaria-3", audio: { url: "https://e.com/a.wav" }, language: "¦" });`);
    for (const code of ["en", "fr", "de", "es", "it"]) expect(solaria3).toContain(code);
    expect(solaria3).not.toContain("pt");

    // Melia 1's whole list is one magic value.
    const melia = completionsAt(`import { transcribe } from "./src/unified/transcribe";
transcribe({ model: "speechmatics/melia-1", audio: { url: "https://e.com/a.wav" }, language: "¦" });`);
    expect(melia).toContain("multi");
  });

  test("property names include the model's extras, and its extras only", () => {
    const nova3 = completionsAt(`import { transcribe } from "./src/unified/transcribe";
transcribe({ model: "deepgram/nova-3", audio: { url: "https://e.com/a.wav" }, ¦ });`);
    for (const name of ["timestamps", "diarization", "keyterm", "keywords", "smart_format"]) {
      expect(nova3).toContain(name);
    }
    const nova2 = completionsAt(`import { transcribe } from "./src/unified/transcribe";
transcribe({ model: "deepgram/nova-2", audio: { url: "https://e.com/a.wav" }, ¦ });`);
    expect(nova2).toContain("keywords");
    expect(nova2).not.toContain("keyterm");

    // Rev AI's two gated blocks, from one adapter.
    const human = completionsAt(`import { transcribe } from "./src/unified/transcribe";
transcribe({ model: "revai/human", audio: { url: "https://e.com/a.wav" }, ¦ });`);
    expect(human).toContain("rush");
    expect(human).not.toContain("remove_disfluencies");
    const machine = completionsAt(`import { transcribe } from "./src/unified/transcribe";
transcribe({ model: "revai/machine", audio: { url: "https://e.com/a.wav" }, ¦ });`);
    expect(machine).toContain("remove_disfluencies");
    expect(machine).not.toContain("rush");
  });

  test("an unknown model degrades to the wide vocabulary", () => {
    const entries = completionsAt(`import { transcribe } from "./src/unified/transcribe";
transcribe({ model: "openai/whisper-9", audio: { file: new Blob([]) }, timestamps: "¦" });`);
    expect(entries.sort()).toEqual(["character", "none", "segment", "word"]);
  });
});

describe("unified music: per-model narrowing reaches the editor", () => {
  test("outputFormat completes the provider's codecs", () => {
    const stability = completionsAt(`import { music } from "./src/unified/music";
music({ model: "stability/stable-audio-2", prompt: "x", outputFormat: "¦" });`);
    expect(stability.sort()).toEqual(["mp3", "pcm_s16le"]);

    const elevenlabs = completionsAt(`import { music } from "./src/unified/music";
music({ model: "elevenlabs/music_v1", prompt: "x", outputFormat: "¦" });`);
    expect(elevenlabs.sort()).toEqual(["mp3", "opus", "pcm_alaw", "pcm_mulaw", "pcm_s16le"]);
  });

  test("property names include the model's extras, and its extras only", () => {
    const stability = completionsAt(`import { music } from "./src/unified/music";
music({ model: "stability/stable-audio-2", prompt: "x", ¦ });`);
    expect(stability).toContain("steps");
    expect(stability).toContain("cfg_scale");
    expect(stability).not.toContain("finetune_id");

    const elevenlabs = completionsAt(`import { music } from "./src/unified/music";
music({ model: "elevenlabs/music_v1", prompt: "x", ¦ });`);
    expect(elevenlabs).toContain("finetune_id");
    expect(elevenlabs).not.toContain("steps");
  });

  test("an unknown model degrades to the wide vocabulary", () => {
    const entries = completionsAt(`import { music } from "./src/unified/music";
music({ model: "elevenlabs/music_v9", prompt: "x", outputFormat: "¦" });`);
    for (const codec of ["mp3", "aac", "flac", "opus", "vorbis", "pcm_s24le"]) {
      expect(entries).toContain(codec);
    }
  });
});

describe("unified chat: the ready entry", () => {
  test("model completes the whole ref table", () => {
    const entries = completionsAt(`import { chat } from "./src/chat/index";
chat({ model: "¦" });`);
    // 1,339 refs in the committed snapshot. Pinned as a floor plus three
    // spot checks: an exact count would churn on every catalog refresh, while
    // a collapse to zero — the failure this suite exists for — cannot hide
    // under either assertion.
    expect(entries.length).toBeGreaterThan(1000);
    expect(entries).toContain("anthropic/claude-opus-5");
    expect(entries).toContain("google/gemini-2.5-flash");
    expect(entries).toContain("openrouter/anthropic/claude-opus-5");
  });

  test("property names are the canonical vocabulary, not a dialect's", () => {
    const entries = completionsAt(`import { chat } from "./src/chat/index";
chat({ model: "openai/gpt-5.2", ¦ });`);
    expect(entries).toContain("maxOutputTokens");
    expect(entries).toContain("reasoning");
    expect(entries).toContain("providerOptions");
    // The wire spellings belong to the provider subpath, not here.
    expect(entries).not.toContain("max_completion_tokens");
    expect(entries).not.toContain("reasoning_effort");
  });

  test("reasoning completes the effort ladder", () => {
    const entries = completionsAt(`import { chat } from "./src/chat/index";
chat({ model: "openai/gpt-5.2", messages: [], reasoning: "¦" });`);
    expect(entries.sort()).toEqual(["high", "max", "minimal", "low", "medium", "off", "xhigh"].sort());
  });

  test("providerOptions completes the provider ids", () => {
    const entries = completionsAt(`import { chat } from "./src/chat/index";
chat({ model: "openai/gpt-5.2", messages: [], providerOptions: { ¦ } });`);
    expect(entries.length).toBe(32);
    expect(entries).toContain("openai");
    // Ids with a hyphen come back quoted, since that is what the editor has to
    // insert for them to be a valid key.
    expect(entries).toContain('"fireworks-ai"');
  });

  test("toApi and toSdk complete per dialect, off the result", () => {
    const gptApi = completionsAt(`import { chat } from "./src/chat/index";
chat({ model: "openai/gpt-5.2", messages: [] }).toApi("¦");`);
    expect(gptApi.sort()).toEqual(["openai", "openrouter", "vercel"]);

    const claudeApi = completionsAt(`import { chat } from "./src/chat/index";
chat({ model: "anthropic/claude-opus-5", messages: [], maxOutputTokens: 8 }).toApi("¦");`);
    expect(claudeApi.sort()).toEqual(["anthropic", "openrouter", "vercel"]);

    const gptSdk = completionsAt(`import { chat } from "./src/chat/index";
chat({ model: "openai/gpt-5.2", messages: [] }).toSdk("¦");`);
    expect(gptSdk.sort()).toEqual(["ai-sdk", "openai"]);

    const geminiSdk = completionsAt(`import { chat } from "./src/chat/index";
chat({ model: "google/gemini-2.5-flash", messages: [] }).toSdk("¦");`);
    expect(geminiSdk.sort()).toEqual(["ai-sdk", "google"]);
  });
});

describe("unified chat: the factory entry completes identically", () => {
  /**
   * `createChat({ anthropic, openai })` builds the same surface from two
   * validators instead of thirty-two. The completion lists it produces are the
   * thing a caller notices if the registry's conditional machinery collapses —
   * and a collapse to `never` type-checks fine, which is exactly the class of
   * failure this suite exists to catch and `.test-d.ts` cannot.
   */
  const PACK = `import { createChat } from "./src/chat/factory";
import { chat as anthropic } from "./src/providers/anthropic";
import { chat as openai } from "./src/providers/openai";
const pack = createChat({ anthropic, openai });
`;

  test("property names match the ready entry's", () => {
    const factory = completionsAt(`${PACK}pack({ model: "openai/gpt-5.2", ¦ });`);
    const ready = completionsAt(`import { chat } from "./src/chat/index";
chat({ model: "openai/gpt-5.2", ¦ });`);
    expect(factory.sort()).toEqual(ready.sort());
  });

  test("each registered dialect keeps its own result members", () => {
    const openaiSdk = completionsAt(`${PACK}pack({ model: "openai/gpt-5.2", messages: [] }).toSdk("¦");`);
    expect(openaiSdk.sort()).toEqual(["ai-sdk", "openai"]);

    const anthropicSdk = completionsAt(
      `${PACK}pack({ model: "anthropic/claude-opus-5", messages: [], maxOutputTokens: 8 }).toSdk("¦");`,
    );
    expect(anthropicSdk.sort()).toEqual(["ai-sdk", "anthropic"]);

    // `.toApi` is the provider validator's own surface: registering anthropic
    // buys anthropic's whole availability table, not just anthropic.
    const anthropicApi = completionsAt(
      `${PACK}pack({ model: "anthropic/claude-opus-5", messages: [], maxOutputTokens: 8 }).toApi("¦");`,
    );
    expect(anthropicApi.sort()).toEqual(["anthropic", "openrouter", "vercel"]);
  });

  test("an unregistered provider offers no result members at all", () => {
    // The call can only throw at runtime, so the result type is branded rather
    // than structural — there is nothing to complete, and that is the point.
    const entries = completionsAt(
      `${PACK}pack({ model: "google/gemini-2.5-flash", messages: [] }).¦;`,
    );
    expect(entries).not.toContain("request");
    expect(entries).not.toContain("toSdk");
    expect(entries).toContain("__unmodel_unregisteredChatProvider");
  });
});
