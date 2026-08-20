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
