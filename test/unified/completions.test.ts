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
