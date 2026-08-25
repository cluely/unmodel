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
import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

import { GEMINI_TTS_LANGUAGE_CODES } from "../../src/providers/google/tts-constraints";
import { GEMINI_TTS_VOICES } from "../../src/providers/google/wire";
import { GPT_IMAGE_2_SIZES } from "../../src/providers/openai/images-shared";
import { SUBSTYLES } from "../../src/providers/recraft/image";
import {
  RECRAFT_V2_STYLES,
  RECRAFT_V2_VECTOR_STYLES,
  RECRAFT_V3_STYLES,
  RECRAFT_V3_VECTOR_STYLES,
} from "../../src/providers/recraft/styles";

// The first completion request builds the full program (every provider plus
// the generated catalog); on CI runners that cold start alone can exceed the
// 5s default and lands on whichever test happens to run first.
setDefaultTimeout(30_000);

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

/**
 * The type errors `src` produces, from the same language service — the other
 * half of what an editor shows.
 *
 * Most refusals in this library belong in a `.test-d.ts`, and stay there. This
 * exists for the ones a *completion list cannot express*, of which the
 * transcribe category has the flagship example: `audio`'s legal shapes are
 * narrowed per route by an intersection, and an intersection narrows
 * **assignability** without narrowing the property names offered inside the
 * object literal — so `audio: { ` completes `url` at a Gemini ref that refuses
 * it. The squiggle is the promise; the list is not, and asserting the squiggle
 * next to the list is what keeps that distinction honest rather than a surprise.
 */
function semanticErrorsIn(src: string): string[] {
  probeText = src;
  probeVersion += 1;
  return service
    .getSemanticDiagnostics(PROBE)
    .map((d) => ts.flattenDiagnosticMessageText(d.messageText, " "));
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

/**
 * fal — the probes that matter for a GENERATED provider.
 *
 * Every other entry in this file checks a table someone typed. fal's tables are
 * emitted by `scripts/codegen-fal.ts` from fal's own OpenAPI, and 28 endpoints
 * behind one address is the exact shape that quietly stops completing: a union
 * of 28 arms, or a `Record<string, unknown>` fallback that swallows the roster,
 * both compile fine and both leave an editor with nothing to say.
 *
 * The by-id map (`FalImageArm<Id>` indexing `FalImageBodyById`) is what keeps
 * these green, and it was chosen over a 28-arm union on measurement: at 30 arms
 * the union cost 8,908 instantiations against the map's 3,127, could not
 * express `ExactKeys` per arm (`keyof (A|B)` is the key INTERSECTION), and
 * could not accept a dynamically-typed endpoint id at all. Probes 1 and 6 below
 * are the two halves of that, at the editor.
 */
describe("fal: the generated endpoint tables reach the editor", () => {
  test("probe 1 — `image_size` completes flux/dev's own presets, tail and all", () => {
    const entries = completionsAt(`import { image } from "./src/providers/fal";
image({ endpoint: "fal-ai/flux/dev", prompt: "x", image_size: "¦" });`);
    // The six presets flux/dev publishes, and nothing from a sibling endpoint.
    expect(entries.sort()).toEqual([
      "landscape_16_9",
      "landscape_4_3",
      "portrait_16_9",
      "portrait_4_3",
      "square",
      "square_hd",
    ]);
  });

  test("probe 1b — the same field on a sibling completes a DIFFERENT list", () => {
    // `gpt-image-1.5` sizes by a three-value enum spelled as pixels. If the
    // narrowing had collapsed to the category union, both endpoints would offer
    // the union of every endpoint's presets and neither list would be true.
    const entries = completionsAt(`import { image } from "./src/providers/fal";
image({ endpoint: "fal-ai/gpt-image-1.5", prompt: "x", image_size: "¦" });`);
    expect(entries.sort()).toEqual(["1024x1024", "1024x1536", "1536x1024"]);
  });

  test("probe 2 — nano-banana narrows per model across ONE unified adapter", () => {
    // Three nano-banana endpoints, one `fal` adapter, three different
    // `resolution` vocabularies. This is the case a per-provider (rather than
    // per-model) table would get wrong, and fal is where it is most visible
    // because the three are the same vendor's model at three sizes.
    const two = completionsAt(`import { image } from "./src/providers/fal";
image({ endpoint: "fal-ai/nano-banana-2", prompt: "x", resolution: "¦" });`);
    expect(two.sort()).toEqual(["0.5K", "1K", "2K", "4K"]);

    // The Pro variant drops 0.5K — a real difference, and one the pricing
    // transcription depends on (its rate table has no 0.5K row either).
    const pro = completionsAt(`import { image } from "./src/providers/fal";
image({ endpoint: "fal-ai/nano-banana-pro", prompt: "x", resolution: "¦" });`);
    expect(pro).not.toContain("0.5K");
    expect(pro).toContain("4K");

    // …and through the UNIFIED surface, where the ref carries the endpoint, the
    // canonical `resolution` narrows to the tiers that endpoint can express.
    const unified = completionsAt(`import { image } from "./src/unified/image";
image({ model: "fal/fal-ai/nano-banana-2", prompt: "x", resolution: "¦" });`);
    expect(unified.sort()).toEqual(["1k", "2k", "4k"]);
  });

  test("probe 6 — a typo'd key is still a squiggle at a 28-endpoint table", () => {
    // The failure this guards is silent: widen the params type by one
    // `Record<string, unknown>` and every misspelling on every fal endpoint
    // compiles. At 28 endpoints that is 28 endpoints' worth of typos going to
    // the wire, and `unknown_param` is only a warning.
    const errors = semanticErrorsIn(`import { image } from "./src/providers/fal";
image({ endpoint: "fal-ai/flux/dev", prompt: "x", num_inferene_steps: 4 });`);
    expect(errors.length).toBeGreaterThan(0);
    // `ExactKeys` maps every key the arm does not declare to `never`, so the
    // squiggle reads "not assignable to type 'never'" and lands ON the offending
    // key — the key is identified by the squiggle's POSITION, which is what an
    // editor shows, rather than by its text. Asserting the text would be
    // asserting a TypeScript message format.
    expect(errors.join(" ")).toContain("not assignable to type 'never'");

    // The correctly spelled key compiles, so the assertion above is about the
    // typo and not about the field being unreachable.
    expect(
      semanticErrorsIn(`import { image } from "./src/providers/fal";
image({ endpoint: "fal-ai/flux/dev", prompt: "x", num_inference_steps: 4 });`),
    ).toEqual([]);

    // …and a key that belongs to a SIBLING endpoint is refused just as loudly:
    // `aspect_ratio` is a real `fal.image` parameter, on nine other endpoints.
    const sibling = semanticErrorsIn(`import { image } from "./src/providers/fal";
image({ endpoint: "fal-ai/flux/dev", prompt: "x", aspect_ratio: "16:9" });`);
    expect(sibling.length).toBeGreaterThan(0);
  });

  /**
   * Probe 3 — the video roster, where "one address, thirty endpoints" is under
   * the most pressure.
   *
   * `duration` is FOUR different types across these thirty (kling's `"5"`,
   * veo3.1's `"8s"`, wan's integer `5`, pixverse's free 1..15), so the category
   * schema had to widen it to `unknown` and the completion list is the ONLY
   * place a caller learns which spelling their endpoint wants. If the by-id map
   * ever collapsed, this list would go to `string` and say nothing.
   */
  test("probe 3 — kling-via-fal completes its own duration enum, and refuses a sibling's", () => {
    const kling = completionsAt(`import { video } from "./src/providers/fal";
video({ endpoint: "fal-ai/kling-video/v2.6/pro/text-to-video", prompt: "x", duration: "¦" });`);
    expect(kling.sort()).toEqual(["10", "5"]);

    // The same field one endpoint over: veo3.1 glues the unit on.
    const veo = completionsAt(`import { video } from "./src/providers/fal";
video({ endpoint: "fal-ai/veo3.1/fast", prompt: "x", duration: "¦" });`);
    expect(veo.sort()).toEqual(["4s", "6s", "8s"]);

    // …and kling v3 offers thirteen where v2.6 offers two — the same vendor,
    // one version apart, which is exactly the difference a per-PROVIDER table
    // would erase.
    const klingV3 = completionsAt(`import { video } from "./src/providers/fal";
video({ endpoint: "fal-ai/kling-video/v3/pro/text-to-video", prompt: "x", duration: "¦" });`);
    expect(klingV3).toHaveLength(13);
    expect(klingV3).toContain("15");

    // Through the UNIFIED surface the canonical `duration` is a plain NUMBER,
    // narrowed to that endpoint's own seconds — the whole reason the canonical
    // word is unit-free.
    const unified = semanticErrorsIn(`import { video } from "./src/unified/video";
video({ model: "fal/fal-ai/kling-video/v2.6/pro/text-to-video", prompt: "x", duration: 7 });`);
    expect(unified.length).toBeGreaterThan(0);
    expect(
      semanticErrorsIn(`import { video } from "./src/unified/video";
video({ model: "fal/fal-ai/kling-video/v2.6/pro/text-to-video", prompt: "x", duration: 10 });`),
    ).toEqual([]);
  });

  test("probe 3b — a cross-model extra is an error, not a widened `unknown`", () => {
    // `cfg_scale` is a kling parameter and exists on no veo3.1 route. The
    // failure this guards is the one `ModelExtras` degradation makes tempting:
    // widen the extras to "every name in the build" and every knob compiles at
    // every endpoint, which is a green build and a 422.
    const wrong = semanticErrorsIn(`import { video } from "./src/unified/video";
video({ model: "fal/fal-ai/veo3.1/fast", prompt: "x", cfg_scale: 0.5 });`);
    expect(wrong.length).toBeGreaterThan(0);

    const right = semanticErrorsIn(`import { video } from "./src/unified/video";
video({ model: "fal/fal-ai/kling-video/v3/pro/text-to-video", prompt: "x", cfg_scale: 0.5 });`);
    expect(right).toEqual([]);

    // …and the reverse direction, so the assertion is about the ROW rather
    // than about `cfg_scale` being unreachable: veo3.1's `safety_tolerance`
    // does not exist at kling.
    expect(
      semanticErrorsIn(`import { video } from "./src/unified/video";
video({ model: "fal/fal-ai/kling-video/v3/pro/text-to-video", prompt: "x", safety_tolerance: "4" });`)
        .length,
    ).toBeGreaterThan(0);
  });

  /**
   * Probe 5 — the two youngest categories, and the narrowing they were built
   * for.
   *
   * `unmodel/lipsync` takes a clip and `unmodel/avatar` takes a still, and at
   * the type level `{ url }` is `{ url }` either way — so the check can only
   * bite where the caller says what they have, on the INLINE arm's `mimeType`.
   * That is the squiggle this probe is about, and it is the compile-time half
   * of a split that would otherwise only exist in prose.
   */
  test("probe 5 — a still handed to a clip-only lipsync model is a squiggle", () => {
    const still = semanticErrorsIn(`import { lipsync } from "./src/unified/lipsync";
lipsync({
  model: "fal/fal-ai/sync-lipsync/v3",
  source: { data: "AAAA", mimeType: "image/png" },
  audio: { url: "https://example.com/vo.wav" },
});`);
    expect(still.length).toBeGreaterThan(0);

    // The clip compiles, so the assertion above is about the medium and not
    // about the inline arm being unreachable.
    expect(
      semanticErrorsIn(`import { lipsync } from "./src/unified/lipsync";
lipsync({
  model: "fal/fal-ai/sync-lipsync/v3",
  source: { data: "AAAA", mimeType: "video/mp4" },
  audio: { url: "https://example.com/vo.wav" },
});`),
    ).toEqual([]);

    // …and the same still is exactly right one category over, at the OTHER
    // route of the same vendor's same model.
    expect(
      semanticErrorsIn(`import { avatar } from "./src/unified/avatar";
avatar({
  model: "fal/fal-ai/sync-lipsync/v3/image-to-video",
  image: { data: "AAAA", mimeType: "image/png" },
  audio: { url: "https://example.com/vo.wav" },
});`),
    ).toEqual([]);
  });

  test("probe 5b — `image` is required, forbidden or wide, per avatar model", () => {
    // Required at the six still-driven routes…
    expect(
      semanticErrorsIn(`import { avatar } from "./src/unified/avatar";
avatar({ model: "fal/fal-ai/kling-video/ai-avatar/v2/pro", audio: { url: "https://x/a.wav" } });`)
        .length,
    ).toBeGreaterThan(0);

    // …forbidden at the two whose performer is a catalogued id…
    expect(
      semanticErrorsIn(`import { avatar } from "./src/unified/avatar";
avatar({
  model: "fal/veed/avatars/audio-to-video",
  image: { url: "https://x/face.png" },
  audio: { url: "https://x/a.wav" },
});`).length,
    ).toBeGreaterThan(0);

    // …and omitting it there is exactly right.
    expect(
      semanticErrorsIn(`import { avatar } from "./src/unified/avatar";
avatar({ model: "fal/veed/avatars/audio-to-video", audio: { url: "https://x/a.wav" } });`),
    ).toEqual([]);

    // The presenter enum completes at the HAND surface, exactly — the by-id map
    // types `avatar_id` as VEED's own 28 names on VEED's endpoint and as a
    // compile error anywhere else, which is what makes "reach it through
    // `providerOptions`" a real answer rather than a shrug.
    const performers = completionsAt(`import { avatar } from "./src/providers/fal";
avatar({ endpoint: "veed/avatars/audio-to-video", audio_url: "https://x/a.wav", avatar_id: "¦" });`);
    expect(performers).toContain("emily_primary");
    expect(performers).toContain("marcus_side");
    // Argil's list is a different 28, on a differently-named field.
    const argil = completionsAt(`import { avatar } from "./src/providers/fal";
avatar({ endpoint: "argil/avatars/audio-to-video", audio_url: "https://x/a.wav", avatar: "¦" });`);
    expect(argil).toContain("Emma (UGC)");
    expect(argil).not.toContain("emily_primary");

    // Through `providerOptions` the escape hatch stays OPEN but the list is
    // only as complete as the adapter's `Wire` interface — which declares the
    // three fields it writes and not the per-model extras. That is the
    // documented trade in `core/unified/types.ts`, asserted rather than
    // assumed: the key compiles, and completing it is the hand surface's job.
    expect(
      semanticErrorsIn(`import { avatar } from "./src/unified/avatar";
avatar({
  model: "fal/veed/avatars/audio-to-video",
  audio: { url: "https://x/a.wav" },
  providerOptions: { fal: { avatar_id: "emily_primary" } },
});`),
    ).toEqual([]);
  });

  test("an endpoint id typed as a plain string still compiles", () => {
    // The other half of the map-over-union choice: a caller who builds the id
    // at run time gets the loose arm rather than a type error. A union of
    // literal arms cannot express this at all.
    expect(
      semanticErrorsIn(`import { image } from "./src/providers/fal";
declare const chosen: string;
image({ endpoint: chosen, prompt: "x", whatever: 1 });`),
    ).toEqual([]);
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
    const hume = completionsAt(`import { tts } from "./src/unified/tts";
tts({ model: "hume/octave", text: "x", outputFormat: "¦" });`);
    expect(hume.sort()).toEqual(["mp3", "pcm_s16le"]);

    const openai = completionsAt(`import { tts } from "./src/unified/tts";
tts({ model: "openai/tts-1", text: "x", outputFormat: "¦" });`);
    expect(openai.sort()).toEqual(["aac", "flac", "mp3", "opus", "pcm_s16le"]);

    // Resemble is the only provider in the category with the wider PCM widths.
    const resemble = completionsAt(`import { tts } from "./src/unified/tts";
tts({ model: "resemble/resemble-ultra", text: "x", outputFormat: "¦" });`);
    expect(resemble).toContain("pcm_s24le");
    expect(openai).not.toContain("pcm_s24le");
  });

  test("the object spelling narrows `format` too", () => {
    const entries = completionsAt(`import { tts } from "./src/unified/tts";
tts({ model: "cartesia/sonic-3", text: "x", outputFormat: { format: "¦" } });`);
    expect(entries.sort()).toEqual(["mp3", "pcm_alaw", "pcm_f32le", "pcm_mulaw", "pcm_s16le"]);
  });

  test("language completes the model's list without gating it", () => {
    const entries = completionsAt(`import { tts } from "./src/unified/tts";
tts({ model: "lmnt/blizzard", text: "x", language: "¦" });`);
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
    const two8 = completionsAt(`import { tts } from "./src/unified/tts";
tts({ model: "minimax/speech-2.8-hd", text: "x", language: "¦" });`);
    expect(two8.length).toBe(42);
    expect(two8).toContain("fa");

    const legacy = completionsAt(`import { tts } from "./src/unified/tts";
tts({ model: "minimax/speech-01-hd", text: "x", language: "¦" });`);
    // "The speech-01 and speech-02 series models do not currently support
    // Persian, Filipino, or Tamil" — `fa`, `fil`/`tl` and `ta`.
    expect(legacy.length).toBe(38);
    for (const code of ["fa", "fil", "tl", "ta"]) expect(legacy).not.toContain(code);

    const base = completionsAt(`import { tts } from "./src/unified/tts";
tts({ model: "smallest-ai/lightning_v3.1", text: "x", language: "¦" });`);
    expect(base.length).toBe(20);
    expect(base).not.toContain("ja");

    const pro = completionsAt(`import { tts } from "./src/unified/tts";
tts({ model: "smallest-ai/lightning_v3.1_pro", text: "x", language: "¦" });`);
    expect(pro.length).toBe(31);
    expect(pro).toContain("ja");
  });

  test("voice completes the model's built-in list, and matches the wire layer's", () => {
    // The unified surface used to be strictly WORSE than the wire surface it
    // compiles down to: `voice` was the bare `Voice`, so it completed nothing,
    // while `openai.tts` has hand-catalogued per-model lists.
    const wire1 = completionsAt(`import { tts } from "./src/providers/openai";
tts({ model: "tts-1", input: "x", voice: "¦" });`);
    const unified1 = completionsAt(`import { tts } from "./src/unified/tts";
tts({ model: "openai/tts-1", text: "x", voice: "¦" });`);
    expect(unified1.sort()).toEqual(wire1.sort());
    expect(unified1.length).toBe(9);
    expect(unified1).toContain("alloy");
    // gpt-4o-mini-tts-only voices are not on tts-1's list.
    expect(unified1).not.toContain("marin");

    const wire2 = completionsAt(`import { tts } from "./src/providers/openai";
tts({ model: "gpt-4o-mini-tts", input: "x", voice: "¦" });`);
    const unified2 = completionsAt(`import { tts } from "./src/unified/tts";
tts({ model: "openai/gpt-4o-mini-tts", text: "x", voice: "¦" });`);
    expect(unified2.sort()).toEqual(wire2.sort());
    expect(unified2.length).toBe(13);
    expect(unified2).toContain("marin");

    // A provider that publishes no closed list declares no `voices` row and is
    // unchanged: the wide `Voice` completes nothing, which is the honest answer
    // for a per-account catalog.
    const elevenlabs = completionsAt(`import { tts } from "./src/unified/tts";
tts({ model: "elevenlabs/eleven_v3", text: "x", voice: "¦" });`);
    // (The bare `""` is what the service offers for an unconstrained `string`.)
    expect(elevenlabs.filter((e) => e !== "")).toEqual([]);
  });

  test("property names include the model's extras, and its extras only", () => {
    const entries = completionsAt(`import { tts } from "./src/unified/tts";
tts({ model: "rime/mistv2", text: "x", ¦ });`);
    for (const name of ["outputFormat", "language", "speed", "inlineSpeedAlpha", "noTextNormalization"]) {
      expect(entries).toContain(name);
    }
    // Coda's row is empty and the Mist knobs are not on it.
    const coda = completionsAt(`import { tts } from "./src/unified/tts";
tts({ model: "rime/coda", text: "x", ¦ });`);
    expect(coda).not.toContain("inlineSpeedAlpha");
    expect(coda).not.toContain("noTextNormalization");
  });

  test("an extra's own values complete, per model", () => {
    const two6 = completionsAt(`import { tts } from "./src/unified/tts";
tts({ model: "minimax/speech-2.6-hd", text: "x", emotion: "¦" });`);
    expect(two6).toContain("whisper");
    expect(two6).toContain("fluent");
    const two8 = completionsAt(`import { tts } from "./src/unified/tts";
tts({ model: "minimax/speech-2.8-hd", text: "x", emotion: "¦" });`);
    expect(two8).toContain("fluent");
    expect(two8).not.toContain("whisper");
    const legacy = completionsAt(`import { tts } from "./src/unified/tts";
tts({ model: "minimax/speech-01-hd", text: "x", emotion: "¦" });`);
    expect(legacy).not.toContain("fluent");
    expect(legacy).toContain("calm");
  });

  test("an unknown model degrades to the wide vocabulary", () => {
    const entries = completionsAt(`import { tts } from "./src/unified/tts";
tts({ model: "openai/tts-9", text: "x", outputFormat: "¦" });`);
    for (const codec of ["mp3", "aac", "flac", "opus", "vorbis", "pcm_s24le", "pcm_alaw"]) {
      expect(entries).toContain(codec);
    }
  });
});

// ---------------------------------------------------------------------------
// Gemini: the three surfaces that can name a voice
//
// A Gemini TTS request is reachable three ways — `google.chat` (which keeps
// serving the TTS ids, because generateContent genuinely does), `google.tts`
// (the narrow Tier-A view of the same route) and `tts()` from `unmodel/tts` —
// and a voice name is the one field whose values are unguessable proper nouns.
// Three surfaces is three chances for one of them to quietly widen back to
// `string` and complete nothing, which is precisely the failure no `.test-d.ts`
// can see: a widened union is MORE permissive, so every assignment still checks.
//
// So the parity is asserted against the array itself, not against a number:
// `GEMINI_TTS_VOICES` is declared once in `google/wire.ts` (a wire leaf may not
// import a constraints module, and `voiceName` is typed from it), the wire
// check reads it, and the unified adapter's `voices` row reads it.
// ---------------------------------------------------------------------------

describe("google speech: three surfaces, one list of thirty voices", () => {
  const SPEECH_CONFIG = `
  contents: [{ parts: [{ text: "hi" }] }],
  generationConfig: {
    responseModalities: ["AUDIO"],
    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "¦" } } },
  },
});`;

  test("google.chat, google.tts and unified tts complete the identical thirty", () => {
    const viaChat = completionsAt(`import { chat } from "./src/providers/google";
chat({ model: "gemini-2.5-flash-preview-tts",${SPEECH_CONFIG}`);
    const viaWireTts = completionsAt(`import { tts } from "./src/providers/google";
tts({ model: "gemini-2.5-flash-preview-tts",${SPEECH_CONFIG}`);
    const viaUnified = completionsAt(`import { tts } from "./src/unified/tts";
tts({ model: "google/gemini-2.5-flash-preview-tts", text: "x", voice: "¦" });`);

    // Order included: all three read the same `as const` array, so the same
    // guide order comes out of all three — and a sorted comparison would hide a
    // surface that had rebuilt the list from a Set.
    expect(viaChat).toEqual([...GEMINI_TTS_VOICES]);
    expect(viaWireTts).toEqual(viaChat);
    expect(viaUnified).toEqual(viaChat);
    expect(viaChat).toHaveLength(30);

    // No empty entry anywhere: the wire type is preset-only by construction
    // (`prebuiltVoiceConfig` has no cloned-voice form at all), and the unified
    // `VoiceOf` tail is a `(string & {})` that completes the presets without
    // adding a blank row.
    for (const list of [viaChat, viaWireTts, viaUnified]) expect(list).not.toContain("");
  });

  test("the unified list completes without gating — a cloned voice still compiles", () => {
    // `VoiceOf` keeps the `(string & {})` tail and both object spellings, so a
    // voice this snapshot has never heard of is a working request rather than a
    // false compile error. It is the wire check's job to refuse it, with a
    // message naming all thirty.
    expect(
      semanticErrorsIn(`import { tts } from "./src/unified/tts";
tts({ model: "google/gemini-2.5-flash-preview-tts", text: "x", voice: "Some-Cloned-Voice" });`),
    ).toEqual([]);
  });

  test("language completes the guide's 78-row table, and gates nothing", () => {
    const entries = completionsAt(`import { tts } from "./src/unified/tts";
tts({ model: "google/gemini-2.5-flash-preview-tts", text: "x", language: "¦" });`);
    // Pinned by count as well as membership: the table is the kind of data that
    // grows silently, and a widened source array is the "green build, dead
    // narrowing" failure this whole file exists for.
    expect(entries).toHaveLength(78);
    expect(entries).toHaveLength(GEMINI_TTS_LANGUAGE_CODES.length);
    // The five three-letter codes ISO 639-1 has no member for — which is why
    // the list is transcribed from the guide rather than derived from a table.
    for (const code of ["ceb", "cmn", "fil", "kok", "mai"]) expect(entries).toContain(code);
    // Google spells Mandarin "cmn", so "zh" is genuinely absent…
    expect(entries).not.toContain("zh");
    // …and still compiles, because `LanguageOf` is open and the wire check for
    // an off-table code is a WARNING: the table lists the languages the models
    // speak, not the values the field accepts.
    expect(
      semanticErrorsIn(`import { tts } from "./src/unified/tts";
tts({ model: "google/gemini-2.5-flash-preview-tts", text: "x", language: "zh" });`),
    ).toEqual([]);
  });

  test("outputFormat completes the five codecs `responseFormat.audio` spells", () => {
    const entries = completionsAt(`import { tts } from "./src/unified/tts";
tts({ model: "google/gemini-2.5-flash-preview-tts", text: "x", outputFormat: "¦" });`);
    expect(entries.sort()).toEqual(["mp3", "opus", "pcm_alaw", "pcm_mulaw", "pcm_s16le"]);
    // AUDIO_WAV is not a sixth codec — it is `pcm_s16le` in a container, and
    // the two are told apart by `outputFormat.container` rather than by a name
    // the caller has to know.
    const containers = completionsAt(`import { tts } from "./src/unified/tts";
tts({ model: "google/gemini-2.5-flash-preview-tts", text: "x",
  outputFormat: { format: "pcm_s16le", container: "¦" } });`);
    expect(containers).toContain("wav");
    expect(containers).toContain("raw");
  });

  test("thinkingConfig is offered on 3.1 alone — the one per-model split", () => {
    const flash31 = completionsAt(`import { tts } from "./src/unified/tts";
tts({ model: "google/gemini-3.1-flash-tts-preview", text: "x", ¦ });`);
    for (const name of ["voice", "language", "outputFormat", "speed", "temperature",
      "maxOutputTokens", "multiSpeakerVoiceConfig", "thinkingConfig"]) {
      expect(flash31).toContain(name);
    }

    // The two 2.5 models are not reasoning models, so `ttsModels`' own
    // `reasoning: false` flag takes the key off their row — the same fact
    // `./tts.ts` states as `thinkingConfig?: never` on their wire arms.
    const pro25 = completionsAt(`import { tts } from "./src/unified/tts";
tts({ model: "google/gemini-2.5-pro-preview-tts", text: "x", ¦ });`);
    expect(pro25).toContain("multiSpeakerVoiceConfig");
    expect(pro25).not.toContain("thinkingConfig");
    expect(
      semanticErrorsIn(`import { tts } from "./src/unified/tts";
tts({ model: "google/gemini-2.5-pro-preview-tts", text: "x",
  thinkingConfig: { thinkingBudget: 1 } });`).length,
    ).toBeGreaterThan(0);
  });

  test("`speed` is offered and refused at run time, which is the declared gap", () => {
    // Declared in `unsupported`, not typed away: the vocabulary is one shape
    // for everyone, so the key completes and the kernel reports it before
    // compile with a message naming where the control actually is.
    expect(
      semanticErrorsIn(`import { tts } from "./src/unified/tts";
tts({ model: "google/gemini-2.5-flash-preview-tts", text: "x", speed: 1.2 });`),
    ).toEqual([]);
  });
});

describe("unified transcribe: per-model narrowing reaches the editor", () => {
  test("timestamps completes the granularities the route reports", () => {
    const whisper = completionsAt(`import { stt } from "./src/unified/stt";
stt({ model: "openai/whisper-1", audio: { file: new Blob([]) }, timestamps: "¦" });`);
    expect(whisper.sort()).toEqual(["none", "segment", "word"]);

    const gpt4o = completionsAt(`import { stt } from "./src/unified/stt";
stt({ model: "openai/gpt-4o-transcribe", audio: { file: new Blob([]) }, timestamps: "¦" });`);
    expect(gpt4o.sort()).toEqual(["none"]);

    const scribe = completionsAt(`import { stt } from "./src/unified/stt";
stt({ model: "elevenlabs/scribe_v1", audio: { url: "https://e.com/a.wav" }, timestamps: "¦" });`);
    expect(scribe.sort()).toEqual(["character", "none", "word"]);

    // No `"none"` where the route has no switch to turn timings off.
    const deepgram = completionsAt(`import { stt } from "./src/unified/stt";
stt({ model: "deepgram/nova-3", audio: { url: "https://e.com/a.wav" }, timestamps: "¦" });`);
    expect(deepgram.sort()).toEqual(["segment", "word"]);

    const assembly = completionsAt(`import { stt } from "./src/unified/stt";
stt({ model: "assemblyai/universal-2", audio: { url: "https://e.com/a.wav" }, timestamps: "¦" });`);
    expect(assembly.sort()).toEqual(["word"]);
  });

  test("language completes a closed list where the wire has one", () => {
    const solaria3 = completionsAt(`import { stt } from "./src/unified/stt";
stt({ model: "gladia/solaria-3", audio: { url: "https://e.com/a.wav" }, language: "¦" });`);
    for (const code of ["en", "fr", "de", "es", "it"]) expect(solaria3).toContain(code);
    expect(solaria3).not.toContain("pt");

    // Melia 1's whole list is one magic value.
    const melia = completionsAt(`import { stt } from "./src/unified/stt";
stt({ model: "speechmatics/melia-1", audio: { url: "https://e.com/a.wav" }, language: "¦" });`);
    expect(melia).toContain("multi");
  });

  test("property names include the model's extras, and its extras only", () => {
    const nova3 = completionsAt(`import { stt } from "./src/unified/stt";
stt({ model: "deepgram/nova-3", audio: { url: "https://e.com/a.wav" }, ¦ });`);
    for (const name of ["timestamps", "diarization", "keyterm", "keywords", "smart_format"]) {
      expect(nova3).toContain(name);
    }
    const nova2 = completionsAt(`import { stt } from "./src/unified/stt";
stt({ model: "deepgram/nova-2", audio: { url: "https://e.com/a.wav" }, ¦ });`);
    expect(nova2).toContain("keywords");
    expect(nova2).not.toContain("keyterm");

    // Rev AI's two gated blocks, from one adapter.
    const human = completionsAt(`import { stt } from "./src/unified/stt";
stt({ model: "revai/human", audio: { url: "https://e.com/a.wav" }, ¦ });`);
    expect(human).toContain("rush");
    expect(human).not.toContain("remove_disfluencies");
    const machine = completionsAt(`import { stt } from "./src/unified/stt";
stt({ model: "revai/machine", audio: { url: "https://e.com/a.wav" }, ¦ });`);
    expect(machine).toContain("remove_disfluencies");
    expect(machine).not.toContain("rush");
  });

  test("an unknown model degrades to the wide vocabulary", () => {
    const entries = completionsAt(`import { stt } from "./src/unified/stt";
stt({ model: "openai/whisper-9", audio: { file: new Blob([]) }, timestamps: "¦" });`);
    expect(entries.sort()).toEqual(["character", "none", "segment", "word"]);
  });

  test("google: timestamps completes the two granularities the ASR config has", () => {
    const entries = completionsAt(`import { stt } from "./src/unified/stt";
stt({ model: "google/gemini-2.5-flash", audio: { data: "QUJD" }, timestamps: "¦" });`);
    // `wordTimestamp` is a bare boolean: there is no segment grouping and no
    // character alignment anywhere in `AudioTranscriptionConfig`, and `"none"`
    // IS expressible (omitting the field returns a plain transcript), which is
    // why it is on the list rather than refused like Deepgram's.
    expect(entries.sort()).toEqual(["none", "word"]);
  });

  test("google: property names are its own ASR and generation knobs", () => {
    const entries = completionsAt(`import { stt } from "./src/unified/stt";
stt({ model: "google/gemini-2.5-flash", audio: { data: "QUJD" }, ¦ });`);
    // The four probe-backed canonical cells…
    for (const name of ["language", "languages", "timestamps", "diarization", "prompt"]) {
      expect(entries).toContain(name);
    }
    // …and the extras the wire types justify, including the one that nests a
    // level deeper than the rest.
    for (const name of ["customVocabulary", "temperature", "maxOutputTokens",
      "mediaResolution", "responseMimeType", "responseSchema", "thinkingConfig",
      "systemInstruction"]) {
      expect(entries).toContain(name);
    }
    // A neighbour's extra is not on this row.
    expect(entries).not.toContain("keyterm");
    expect(entries).not.toContain("speaker_labels");
  });

  /**
   * The `"data"` kind, at the type level — and the one place in this file where
   * the completion list is deliberately NOT the assertion.
   *
   * `audio`'s narrowing is an intersection (`AudioNarrowing`), which decides
   * **assignability** and not the property names offered inside an object
   * literal — so `audio: { ` completes `url`, `file`, `fileId`, `data` and
   * `mimeType` at every provider in the pack, including the two that refuse
   * three of them. That is a known and accepted shape of the narrowing (see
   * `SttParamsBase.audio`, which stays in the base for exactly this reason),
   * so what is pinned here is the squiggle: the promise the category makes is
   * that a shape the route cannot take is an error at the call site.
   */
  test("google and inworld take base64 audio, and refuse the shapes they have no field for", () => {
    const ok = (src: string) => expect(semanticErrorsIn(src)).toEqual([]);
    const refused = (src: string) =>
      expect(semanticErrorsIn(src).join(" ").length, src).toBeGreaterThan(0);

    // google: `["data", "fileId"]`.
    ok(`import { stt } from "./src/unified/stt";
stt({ model: "google/gemini-2.5-flash", audio: { data: "QUJD", mimeType: "audio/wav" } });`);
    ok(`import { stt } from "./src/unified/stt";
stt({ model: "google/gemini-2.5-flash", audio: { fileId: "abc123" } });`);
    // `fileData.fileUri` is a Files API name, not an arbitrary URL — Gemini
    // does not fetch third-party hosts, so there is nothing to compile a `url`
    // into.
    refused(`import { stt } from "./src/unified/stt";
stt({ model: "google/gemini-2.5-flash", audio: { url: "https://e.com/a.wav" } });`);
    // …and a Blob cannot be base64-encoded without awaiting.
    refused(`import { stt } from "./src/unified/stt";
stt({ model: "google/gemini-2.5-flash", audio: { file: new Blob([]) } });`);

    // inworld: `["data"]` — the adapter the `"data"` kind un-gapped. Before it,
    // `audioInputs` was `[]`, `audio` typed as `never`, and NO canonical
    // request reached this provider at all.
    ok(`import { stt } from "./src/unified/stt";
stt({ model: "inworld/inworld/inworld-stt-1", audio: { data: "QUJD" } });`);
    refused(`import { stt } from "./src/unified/stt";
stt({ model: "inworld/inworld/inworld-stt-1", audio: { url: "https://e.com/a.wav" } });`);

    // And the kind is genuinely narrowed rather than added to everyone: the
    // multipart-only route still refuses it.
    refused(`import { stt } from "./src/unified/stt";
stt({ model: "openai/whisper-1", audio: { data: "QUJD" } });`);
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
    // The 32 `unmodel/chat` serves, plus the five it knows but cannot send to,
    // whose buckets are inert and silent on purpose (a portable request carries
    // several providers' settings). `test/chat/provider-options.test.ts` pins
    // that set against the runtime's own tolerated set in both directions.
    expect(entries.length).toBe(37);
    expect(entries).toContain("openai");
    // Ids with a hyphen come back quoted, since that is what the editor has to
    // insert for them to be a valid key.
    expect(entries).toContain('"fireworks-ai"');
    expect(entries).toContain('"amazon-bedrock"');
    expect(entries).toContain("cohere");
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

/**
 * cartesia's closed wire enums.
 *
 * `language` and `generation_config.emotion` used to carry `| (string & {})`
 * tails. The tails did not break the completion list — the labels were offered
 * either way — so the *list* is not what these tests are really pinning: it is
 * that the list is now the WHOLE space. `not.toContain` is doing the work.
 * With a tail present, `emotion: "smug"` and `language: "pt-BR"` type-checked
 * silently while `tts.safe` refused both at `invalid_enum_value` *error*
 * severity; the editor was quiet about a call unmodel itself rejects.
 *
 * The counts (58 / 42 / 100) are the documented sizes, pinned again beside
 * their enums in the provider's own tests. `model_id` keeps its tail on
 * purpose — an off-enum cataloged id is a *warning* — which is why there is no
 * exact-count assertion for it anywhere.
 */
describe("cartesia: the closed wire enums complete exactly their members", () => {
  const BYTES = `import { tts } from "./src/providers/cartesia";
tts({ model_id: "sonic-3.5", transcript: "x", voice: { mode: "id", id: "v" },
  output_format: { container: "wav" }, `;

  test("generation_config.emotion offers the 58 labels and nothing else", () => {
    const entries = completionsAt(`${BYTES}generation_config: { emotion: "¦" } });`);
    expect(entries.length).toBe(58);
    expect(entries).toContain("neutral");
    expect(entries).toContain("nostalgic");
    expect(entries).toContain("determined");
    // The headline case: plausible, not documented, and refused at run time.
    expect(entries).not.toContain("smug");
  });

  test("language offers the 42 codes and nothing else", () => {
    const entries = completionsAt(`${BYTES}language: "¦" });`);
    expect(entries.length).toBe(42);
    expect(entries).toContain("en");
    expect(entries).toContain("pt");
    expect(entries).toContain("pa");
    // BCP-47 muscle memory on a bare-ISO-639-1 field — the most likely typo on
    // the whole call, and now a red squiggle rather than a 422.
    expect(entries).not.toContain("pt-BR");
    expect(entries).not.toContain("en-US");
  });

  test("the socket message publishes the same two lists", () => {
    const SOCKET = `import { ttsWebsocket } from "./src/providers/cartesia";
ttsWebsocket({ model_id: "sonic-3.5", transcript: "x", voice: { mode: "id", id: "v" },
  output_format: { container: "raw", encoding: "pcm_s16le", sample_rate: 8000 },
  context_id: "c", `;
    const emotions = completionsAt(`${SOCKET}generation_config: { emotion: "¦" } });`);
    expect(emotions.length).toBe(58);
    expect(emotions).not.toContain("smug");
    const languages = completionsAt(`${SOCKET}language: "¦" });`);
    expect(languages.length).toBe(42);
    expect(languages).not.toContain("pt-BR");
  });

  test("batch STT completes its own, larger 100-code list", () => {
    const entries = completionsAt(`import { stt } from "./src/providers/cartesia";
stt({ file: new Blob([]), model: "ink-whisper", language: "¦" });`);
    expect(entries.length).toBe(100);
    // Whisper's long tail — in this enum, and deliberately not in the TTS one.
    expect(entries).toContain("yue");
    expect(entries).toContain("haw");
    expect(entries).not.toContain("klingon");
  });

  test("model_id keeps its open tail: the enum is offered, not enforced", () => {
    const entries = completionsAt(`${BYTES.replace('model_id: "sonic-3.5", ', 'model_id: "¦", ')}});`);
    // The four ids the endpoint's `model_id` enum publishes...
    for (const id of ["sonic-3.5", "sonic-3", "sonic-preview", "sonic-latest"]) {
      expect(entries).toContain(id);
    }
    // ...plus the three cataloged sonic ids that are OFF that enum and still
    // valid — the dated snapshot and the two "older models". Those three are
    // the whole justification for the tail: `checkTtsModelKind` reports them at
    // *warning* severity, so refusing them at compile time would be wrong.
    for (const id of ["sonic-3.5-2026-05-04", "sonic-2", "sonic-turbo"]) {
      expect(entries).toContain(id);
    }
    expect(entries.length).toBe(7);
    // A completion list cannot show the tail itself; that a *fourth* off-enum
    // id like "sonic-9-future" still compiles is pinned in
    // test/types/cartesia.test-d.ts, where this field alone has no
    // `@ts-expect-error` case.
  });

  test("the unified layer still takes BCP-47: closing the wire changed nothing here", () => {
    const entries = completionsAt(`import { tts } from "./src/unified/tts";
tts({ model: "cartesia/sonic-3.5", text: "x", language: "¦" });`);
    // The row's `languages` is CARTESIA_TTS_LANGUAGES by reference, so the
    // editor offers the same 42 codes one layer up — while `toPrimaryLanguage`
    // keeps normalizing "pt-BR" to "pt" for callers who type the regional tag.
    expect(entries).toContain("pt");
    expect(entries).toContain("en");
  });
});

describe("recraft: `style` completes the model's own curated list, not all 111", () => {
  // `STYLE_NAMES_BY_MODEL` carried a `Readonly<Record<string, readonly
  // string[]>>` ANNOTATION, which erased the key union and the value literals,
  // so `style` could only be typed as the POOLED `RecraftStyleName` union of
  // all four lists. Measured before the fix: every model completed 111 names,
  // and the 45 that recraftv3 does not accept — 7 of them real V2-only names
  // like "3D render" — compiled with zero diagnostics and were then refused by
  // `checkStyleForModel` with `invalid_enum_value`. `as const satisfies` plus
  // `StyleFor<M>` makes the type say what the runtime check already enforced.
  //
  // The counts are asserted EXACTLY, not just "contains": the failure mode this
  // guards is the completion list quietly re-pooling (or collapsing) while
  // assignability stays green, which no `.test-d.ts` can see.
  const recraftStyle = (model: string) =>
    completionsAt(`import { image } from "./src/providers/recraft";
image({ prompt: "x", model: ${JSON.stringify(model)}, style: "¦" });`);

  test("recraftv3 completes exactly its 66 styles", () => {
    const entries = recraftStyle("recraftv3");
    expect(entries.length).toBe(RECRAFT_V3_STYLES.length);
    expect(entries.length).toBe(66);
    expect(entries.sort()).toEqual([...RECRAFT_V3_STYLES].sort());
    // The V2-only name that used to compile and then fail validation.
    expect(entries).not.toContain("3D render");
    // ...and a V3 Vector name, which is a different model's list again.
    expect(entries).not.toContain("Vector art");
  });

  test("recraftv2 keeps the V2-only names recraftv3 must not offer", () => {
    const entries = recraftStyle("recraftv2");
    expect(entries.length).toBe(RECRAFT_V2_STYLES.length);
    expect(entries.length).toBe(27);
    expect(entries).toContain("3D render");
  });

  test("recraftv2_vector completes exactly 21", () => {
    const entries = recraftStyle("recraftv2_vector");
    expect(entries.length).toBe(RECRAFT_V2_VECTOR_STYLES.length);
    expect(entries.length).toBe(21);
    expect(entries.sort()).toEqual([...RECRAFT_V2_VECTOR_STYLES].sort());
  });

  test("recraftv3_vector completes exactly 23", () => {
    const entries = recraftStyle("recraftv3_vector");
    expect(entries.length).toBe(RECRAFT_V3_VECTOR_STYLES.length);
    expect(entries.length).toBe(23);
    expect(entries).toContain("Vector art");
    expect(entries).not.toContain("Photorealism");
  });

  test("the degraded arms keep the pooled 111 with their open tail", () => {
    const pooled = new Set([
      ...RECRAFT_V3_STYLES,
      ...RECRAFT_V3_VECTOR_STYLES,
      ...RECRAFT_V2_STYLES,
      ...RECRAFT_V2_VECTOR_STYLES,
    ]);
    expect(pooled.size).toBe(111);

    // `model` omitted — the wire defaults it server-side, so unmodel cannot
    // narrow and must not pretend to.
    const omitted = completionsAt(`import { image } from "./src/providers/recraft";
image({ prompt: "x", style: "¦" });`);
    expect(omitted.length).toBe(111);

    // A runtime-built id: the whole point of keeping the open tail.
    const runtime = completionsAt(`import { image } from "./src/providers/recraft";
declare const m: string;
image({ prompt: "x", model: m, style: "¦" });`);
    expect(runtime.length).toBe(111);
    expect(runtime).toContain("3D render");

    // A model with no style table at all (the V4 line; `style` is denied there
    // by the family rule, not by this union).
    expect(recraftStyle("recraftv4_1").length).toBe(111);
  });

  test("narrowing `style` did not disturb `model` or `size`", () => {
    // `M`'s constraint has to carry the model literals, and the callable must
    // not re-state `model` as an extra intersection arm — either mistake
    // silently drops `model` from 17 completions to 1.
    const models = completionsAt(`import { image } from "./src/providers/recraft";
image({ prompt: "x", model: "¦" });`);
    expect(models.length).toBe(17);
    expect(models).toContain("recraftv3");

    const sizes = completionsAt(`import { image } from "./src/providers/recraft";
image({ prompt: "x", model: "recraftv3", size: "¦" });`);
    expect(sizes.length).toBe(56);

    // `substyle` has no published per-style pairing, so it stays globally open.
    const substyles = completionsAt(`import { image } from "./src/providers/recraft";
image({ prompt: "x", model: "recraftv3", substyle: "¦" });`);
    expect(substyles.length).toBe(SUBSTYLES.length);
  });

  test("the editing routes narrow `style` the same way", () => {
    // image-edit.ts carried the identical pooled union; fixing only the
    // generations route would have moved the asymmetry rather than closed it.
    const inpaintV3 = completionsAt(`import { imageEditInpaint } from "./src/providers/recraft";
declare const b: Blob;
imageEditInpaint({ image: b, mask: b, prompt: "x", model: "recraftv3", style: "¦" });`);
    expect(inpaintV3.length).toBe(66);
    expect(inpaintV3).not.toContain("3D render");

    const inpaintVector = completionsAt(`import { imageEditInpaint } from "./src/providers/recraft";
declare const b: Blob;
imageEditInpaint({ image: b, mask: b, prompt: "x", model: "recraftv3_vector", style: "¦" });`);
    expect(inpaintVector.length).toBe(23);
    expect(inpaintVector).toContain("Vector art");

    const editOmitted = completionsAt(`import { imageEdit } from "./src/providers/recraft";
declare const b: Blob;
imageEdit({ image: b, prompt: "x", strength: 0.2, style: "¦" });`);
    expect(editOmitted.length).toBe(111);
  });
});

// ---------------------------------------------------------------------------
// `unmodel/chat`: the two fields that used to complete nothing at all
// ---------------------------------------------------------------------------

describe("chat serviceTier: the union of every dialect's tier vocabulary", () => {
  test("completes all three dialects' tiers, not the intersection", () => {
    const entries = completionsAt(`import { chat } from "./src/chat/index";
chat({ model: "openai/gpt-5.2", messages: [], serviceTier: "¦" });`);
    // openai-chat's six, anthropic's `standard_only`, gemini's four — the tail
    // must not have eaten any of them.
    for (const tier of [
      "auto",
      "default",
      "flex",
      "scale",
      "priority",
      "fast",
      "standard_only",
      "unspecified",
      "standard",
    ]) {
      expect(entries).toContain(tier);
    }
  });

  test("the anthropic and gemini arms are read off the dialect bodies themselves", () => {
    // Not hand-copied literals: `ChatServiceTierFor` indexes `DialectBody`, so
    // a wire-side change to either enum shows up here.
    const wire = completionsAt(`import { chat } from "./src/providers/anthropic";
chat({ model: "claude-opus-5", max_tokens: 8, messages: [], service_tier: "¦" });`);
    const unified = completionsAt(`import { chat } from "./src/chat/index";
chat({ model: "openai/gpt-5.2", messages: [], serviceTier: "¦" });`);
    for (const tier of wire) expect(unified).toContain(tier);
  });
});

describe("chat providerOptions: buckets are typed, not bags", () => {
  test("a bucket's interior completes that provider's own dialect body", () => {
    const anthropic = completionsAt(`import { chat } from "./src/chat/index";
chat({ model: "openai/gpt-5.2", messages: [], providerOptions: { anthropic: { ¦ } } });`);
    // Was the global keyword soup (`AbortController`, `abstract`, …).
    expect(anthropic).toContain("service_tier");
    expect(anthropic).toContain("thinking");
    expect(anthropic).not.toContain("AbortController");

    const openai = completionsAt(`import { chat } from "./src/chat/index";
chat({ model: "openai/gpt-5.2", messages: [], providerOptions: { openai: { ¦ } } });`);
    expect(openai).toContain("logprobs");
    expect(openai).toContain("response_format");
    // A bucket completes its DIALECT's shared body, which is what the compiler
    // merges into. Endpoint-only extras — openai's `store`, the field doc's own
    // example — live on `ChatCompletionsBody` in the provider module and so do
    // not complete; they still COMPILE, through the open arm every level of the
    // bucket carries. That is the honest boundary, and it is asserted here so
    // it cannot be mistaken for a completion the type forgot.
    expect(openai).not.toContain("store");
  });

  test("values complete too, and nest", () => {
    const tiers = completionsAt(`import { chat } from "./src/chat/index";
chat({ model: "openai/gpt-5.2", messages: [], providerOptions: { anthropic: { service_tier: "¦" } } });`);
    expect(tiers).toContain("auto");
    expect(tiers).toContain("standard_only");

    const nested = completionsAt(`import { chat } from "./src/chat/index";
chat({ model: "google/gemini-2.5-flash", messages: [], providerOptions: { google: { generationConfig: { ¦ } } } });`);
    expect(nested).toContain("thinkingConfig");
    expect(nested).toContain("temperature");
  });
});

describe("chat: the two provider-keyed fields inside `messages`/`nativeTools`", () => {
  test("a file part's provider completes the ids whose files can be reached", () => {
    const entries = completionsAt(`import { chat } from "./src/chat/index";
chat({ model: "openai/gpt-5.2", messages: [{ role: "user", content: [{ type: "file", data: { fileId: "f", provider: "¦" } }] }] });`);
    // Was zero — a bare `string`, on a field where a typo silently deletes the
    // attachment (`dropped_content`). The set is `ChatProviderId`: the four
    // factory-configured providers are absent because `unmodel/chat` cannot
    // target them by ref at all.
    expect(entries.length).toBe(32);
    expect(entries).toContain("openai");
    expect(entries).toContain("anthropic");
    expect(entries).not.toContain("google-vertex");
  });

  test("a native tool's provider completes, and its definition completes per dialect", () => {
    const providers = completionsAt(`import { chat } from "./src/chat/index";
chat({ model: "google/gemini-2.5-flash", messages: [], nativeTools: [{ provider: "¦", definition: {} }] });`);
    expect(providers).toContain("google");
    expect(providers).toContain("anthropic");
    // The three dialect aliases a tool can legitimately be filed under, and the
    // two it cannot (their tools could only ever be discarded).
    expect(providers).toContain("google-vertex");
    expect(providers).not.toContain("cohere");
    expect(providers).not.toContain("amazon-bedrock");

    const google = completionsAt(`import { chat } from "./src/chat/index";
chat({ model: "google/gemini-2.5-flash", messages: [], nativeTools: [{ provider: "google", definition: { ¦ } }] });`);
    // Was the global-scope fallback: `definition` was `unknown`.
    expect(google).toContain("googleSearch");
    expect(google).toContain("codeExecution");
    expect(google).toContain("urlContext");
    expect(google).toContain("googleMaps");
    // `functionDeclarations` is what `tools` compiles to; filing it by hand
    // would be a second way to say one thing.
    expect(google).not.toContain("functionDeclarations");
    expect(google).not.toContain("AbortController");

    const anthropic = completionsAt(`import { chat } from "./src/chat/index";
chat({ model: "anthropic/claude-opus-5", messages: [], nativeTools: [{ provider: "anthropic", definition: { ¦ } }] });`);
    expect(anthropic).toContain("type");
    expect(anthropic).toContain("name");

    const grammar = completionsAt(`import { chat } from "./src/chat/index";
chat({ model: "openai/gpt-5.2", messages: [], nativeTools: [{ provider: "openai", definition: { type: "custom", custom: { name: "g", format: { type: "grammar", grammar: { definition: "x", syntax: "¦" } } } } }] });`);
    expect(grammar.sort()).toEqual(["lark", "regex"]);
  });
});

describe("unmodel/catalog/typed: the 113 providers with no subpath get completions", () => {
  test("getModelTyped completes a provider's model ids; getModel still does not", () => {
    const typed = completionsAt(`import { getModelTyped } from "./src/catalog/typed.gen";
getModelTyped("anthropic", "¦");`);
    expect(typed).toContain("claude-opus-5");
    expect(typed).toContain("claude-fable-5");
    expect(typed.length).toBe(13);

    // The cheap entry is deliberately unchanged: its `catalog` is annotated,
    // which is what keeps `dist/catalog/index.d.ts` at ~4 KiB instead of
    // ~3.6 MB. test/bundle-budget.test.ts pins both halves of that trade.
    const loose = completionsAt(`import { getModel } from "./src/catalog/index";
getModel("anthropic", "¦");`);
    expect(loose.filter((e) => e !== "")).toEqual([]);
  });

  test("a provider with no subpath is where this actually pays", () => {
    // `unmodel/cerebras` has no model-id type of its own; these three symbols
    // are the only typed access to its catalog anywhere in the package.
    const entries = completionsAt(`import { getModelTyped } from "./src/catalog/typed.gen";
getModelTyped("cerebras", "¦");`);
    expect(entries.length).toBeGreaterThan(0);
  });

  test("both entries complete the same provider ids", () => {
    const typed = completionsAt(`import { getProviderTyped } from "./src/catalog/typed.gen";
getProviderTyped("¦");`);
    const loose = completionsAt(`import { getProvider } from "./src/catalog/index";
getProvider("¦");`);
    expect(typed.sort()).toEqual(loose.sort());
    expect(typed).toContain("anthropic");
  });
});

describe("openai.realtimeSession: the transcription arms do not kill completions", () => {
  /**
   * The regression this case exists to prevent, measured on the way in: with
   * `TM extends string` — the obvious spelling — `transcription: { model: "¦" }`
   * completed **nothing at all**, 8 entries down to 0, while tsc stayed green.
   * `TM extends RealtimeTranscriptionModelId | (string & {})` brings them back.
   */
  test("the transcription model ids still complete", () => {
    const entries = completionsAt(`import { realtimeSession } from "./src/providers/openai";
realtimeSession({ type: "realtime", audio: { input: { transcription: { model: "¦" } } } });`);
    expect(entries.sort()).toEqual([
      "gpt-4o-mini-transcribe",
      "gpt-4o-mini-transcribe-2025-12-15",
      "gpt-4o-transcribe",
      "gpt-4o-transcribe-diarize",
      "gpt-live-transcribe",
      "gpt-realtime-whisper",
      "gpt-transcribe",
      "whisper-1",
    ]);
  });

  test("the arm's own field values still complete on the model that takes them", () => {
    const entries = completionsAt(`import { realtimeSession } from "./src/providers/openai";
realtimeSession({ type: "realtime", audio: { input: { transcription: { model: "gpt-realtime-whisper", delay: "¦" } } } });`);
    expect(entries.sort()).toEqual(["high", "low", "medium", "minimal", "xhigh"]);
  });

  test("the honest ceiling: a refused key is still SUGGESTED, then red-squiggled", () => {
    // Worth pinning rather than glossing: `?: never` gives an error on any
    // value, not a hidden key — the editor offers `delay` on gpt-transcribe and
    // then refuses every value for it. Omitting the key instead would break the
    // spread idiom, so this is the right trade, accurately described.
    const entries = completionsAt(`import { realtimeSession } from "./src/providers/openai";
realtimeSession({ type: "realtime", audio: { input: { transcription: { model: "gpt-transcribe", ¦ } } } });`);
    expect(entries).toContain("delay");
    expect(entries).toContain("prompt");
    expect(entries).toContain("keywords");
  });
});

describe("anthropic.chat: per-model narrowing reaches the editor", () => {
  test("thinking drops `disabled` on the model that always thinks", () => {
    const fable = completionsAt(`import { chat } from "./src/providers/anthropic";
chat({ model: "claude-fable-5", max_tokens: 16, messages: [], thinking: { type: "¦" } });`);
    expect(fable.sort()).toEqual(["adaptive", "enabled"]);

    const opus45 = completionsAt(`import { chat } from "./src/providers/anthropic";
chat({ model: "claude-opus-4-5", max_tokens: 16, messages: [], thinking: { type: "¦" } });`);
    expect(opus45.sort()).toEqual(["adaptive", "disabled", "enabled"]);
  });

  test("the narrowed keys still complete — `never` refuses values, not names", () => {
    // Accurate rather than flattering: `top_k?: never` keeps `top_k` in the
    // key list on claude-opus-5. Omitting it instead would break the
    // `{ ...base, model }` spread idiom, so `never` is the right choice — the
    // gain is an error on any value, not a hidden key.
    const entries = completionsAt(`import { chat } from "./src/providers/anthropic";
chat({ model: "claude-opus-5", max_tokens: 16, messages: [], ¦ });`);
    expect(entries).toContain("top_k");
    expect(entries).toContain("temperature");
    expect(entries).toContain("top_p");
  });

  test("model ids still complete — the arm must not eat the ref union", () => {
    const entries = completionsAt(`import { chat } from "./src/providers/anthropic";
chat({ model: "¦", max_tokens: 16, messages: [] });`);
    expect(entries).toContain("claude-opus-5");
    expect(entries).toContain("claude-sonnet-4-5");
    expect(entries.length).toBeGreaterThan(5);
  });
});

describe("cohere: the SDK handoff completes", () => {
  test("toSdk('cohere') is the camelCase V2ChatRequest, not a bag", () => {
    const entries = completionsAt(`import { chat } from "./src/providers/cohere";
chat({ model: "command-a-03-2025", messages: [] }).toSdk("cohere").¦`);
    // Was zero: the only `toSdk` target in the library that returned
    // `Record<string, unknown>`.
    for (const key of [
      "citationOptions",
      "documents",
      "frequencyPenalty",
      "logprobs",
      "maxTokens",
      "messages",
      "model",
      "presencePenalty",
      "responseFormat",
      "safetyMode",
      "stopSequences",
      "strictTools",
      "thinking",
      "toolChoice",
      "tools",
    ]) {
      expect(entries).toContain(key);
    }
    // `stream` is absent on purpose — the SDK splits it into two methods.
    expect(entries).not.toContain("stream");
    // …and the wire spellings are gone, which is the whole point of the shape.
    expect(entries).not.toContain("max_tokens");
    expect(entries).not.toContain("stop_sequences");
  });
});

describe("translation warnings: meta completes once you narrow on code", () => {
  test("each code's own payload keys are suggested", () => {
    const dropped = completionsAt(`import type { TranslationWarning } from "./src/core/translate/warnings";
declare const w: TranslationWarning;
if (w.code === "dropped_tool") { w.meta?.¦ }`);
    // Was zero — `meta` was `Record<string, unknown>`, so the editor had
    // nothing to say about the deliverable of the whole translation layer.
    expect(dropped.sort()).toEqual(["dialect", "provider", "tool"]);

    const param = completionsAt(`import type { TranslationWarning } from "./src/core/translate/warnings";
declare const w: TranslationWarning;
if (w.code === "dropped_param") { w.meta?.¦ }`);
    expect(param.sort()).toEqual(["detail", "dialect", "n", "param", "provider", "top_k"]);

    const narrowed = completionsAt(`import type { TranslationWarning } from "./src/core/translate/warnings";
declare const w: TranslationWarning;
if (w.code === "capability_narrowed") { w.meta?.¦ }`);
    expect(narrowed.sort()).toEqual(["context", "drops"]);

    // The one code that stays an open bag still completes its three recurring
    // keys — `Record<string, unknown>` in an intersection does not eat them.
    const approximated = completionsAt(`import type { TranslationWarning } from "./src/core/translate/warnings";
declare const w: TranslationWarning;
if (w.code === "approximated_param") { w.meta?.¦ }`);
    expect(approximated).toContain("requested");
    expect(approximated).toContain("achieved");
    expect(approximated).toContain("source");
  });
});

// ---------------------------------------------------------------------------
// Adapter-author surface: `ctx.from(wirePath, canonical)`
// ---------------------------------------------------------------------------

describe("CanonicalField completes the vocabulary, dotted paths included", () => {
  test("the nested paths the tail permitted but could not suggest now complete", () => {
    const entries = completionsAt(`import type { CanonicalField } from "./src/core/unified/types";
import type { SttParams } from "./src/core/unified/vocabulary/stt";
declare const from: (wirePath: Array<string | number>, canonical: CanonicalField<SttParams>) => void;
from(["speaker_options", "max_speakers_expected"], "¦");`);
    // Flat fields still complete…
    expect(entries).toContain("audio");
    expect(entries).toContain("language");
    // …and so do the four `diarization.*` paths adapters actually pass, which a
    // `(string & {})` tail can never suggest.
    expect(entries).toContain("diarization.enabled");
    expect(entries).toContain("diarization.speakers");
    expect(entries).toContain("diarization.minSpeakers");
    expect(entries).toContain("diarization.maxSpeakers");
    // An index is not a field name: array-valued fields contribute no paths.
    expect(entries.filter((e) => e.startsWith("diarization.")).sort()).toEqual([
      "diarization.enabled",
      "diarization.maxSpeakers",
      "diarization.minSpeakers",
      "diarization.speakers",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Media packs: `providerOptions` buckets and unservable refs
// ---------------------------------------------------------------------------

describe("media providerOptions: a bucket is the adapter's own wire body", () => {
  test("a bucket's interior completes real wire params", () => {
    const stability = completionsAt(`import { image } from "./src/unified/image";
image({ model: "openai/gpt-image-2", prompt: "x", providerOptions: { stability: { ¦ } } });`);
    // Was the global keyword soup; now Stability's own params.
    expect(stability).toContain("cfg_scale");
    expect(stability).toContain("style_preset");
    expect(stability).toContain("negative_prompt");
    expect(stability).not.toContain("AbortController");
  });

  test("the openai bucket completes that adapter's declared wire fields", () => {
    const openai = completionsAt(`import { image } from "./src/unified/image";
image({ model: "openai/gpt-image-2", prompt: "x", providerOptions: { openai: { ¦ } } });`);
    expect(openai).toContain("response_format");
    expect(openai).not.toContain("AbortController");
    // Honest boundary: the list is only as complete as the adapter's own `Wire`
    // interface, which here declares six fields plus an index signature for an
    // endpoint that takes more. Tightening those interfaces is a separate pass;
    // typed-but-incomplete still beats a bag, and every undeclared key compiles.
    expect(openai.length).toBeLessThan(20);
  });

  test("the escape hatch survives at every depth", () => {
    const nested = completionsAt(`import { image } from "./src/unified/image";
image({ model: "google/imagen-4.0-generate-001", prompt: "x", providerOptions: { google: { ¦ } } });`);
    expect(nested.length).toBeGreaterThan(0);
    expect(nested).not.toContain("AbortController");
  });
});

// ---------------------------------------------------------------------------
// Response reports: `report.finishReason`
// ---------------------------------------------------------------------------

describe("checkChat's report: finishReason completes the provider's own reasons", () => {
  // `finishReason` is the one value every caller branches on (`tool_use` vs
  // `end_turn`), and it was a bare `string` on all 17 checkers — measured at
  // ZERO completions on every provider below. `ResponseReport<Reason>` plus a
  // per-provider union alias is what buys these lists. No `.test-d.ts` can
  // stand in: assignability is unaffected by widening `Reason` back to
  // `string`, only the completion list dies.

  test("an anthropic report completes anthropic's seven stop reasons", () => {
    const entries = completionsAt(`import { checkChat } from "./src/providers/anthropic";
const report = checkChat({});
if (report.finishReason === "¦") {}`);
    expect(entries.sort()).toEqual([
      "end_turn",
      "max_tokens",
      "model_context_window_exceeded",
      "pause_turn",
      "refusal",
      "stop_sequence",
      "tool_use",
    ]);
  });

  test("a groq report completes the Chat Completions five — through the FACTORY", () => {
    // This is the fleet assertion. groq's `checkChat` comes from
    // `createOpenAICompatible`, whose `OpenAICompatibleProvider.checkChat`
    // member re-annotates the return type. Widening THAT one line back to a
    // bare `ResponseReport` type-checks fine and takes this list to 0 for all
    // ~30 openai-compatible overlays at once — narrowing check.ts alone is
    // dead on arrival.
    const entries = completionsAt(`import { checkChat } from "./src/providers/groq";
const report = checkChat({});
switch (report.finishReason) { case "¦": }`);
    expect(entries.sort()).toEqual([
      "content_filter",
      "function_call",
      "length",
      "stop",
      "tool_calls",
    ]);
  });

  test("openai's own checkChat gets the same five", () => {
    // Same alias, different entry point: openai calls `createCheckChat`
    // directly rather than through the factory, so this passes even when the
    // groq case above fails. Both are asserted precisely because they can
    // diverge.
    const entries = completionsAt(`import { checkChat } from "./src/providers/openai";
const report = checkChat({});
if (report.finishReason === "¦") {}`);
    expect(entries.sort()).toEqual([
      "content_filter",
      "function_call",
      "length",
      "stop",
      "tool_calls",
    ]);
  });

  test("a google report completes the Gemini finish reasons", () => {
    // The nine literals that exist in google/check.ts (MAX_TOKENS plus the
    // eight in FILTERED_FINISH_REASONS), plus STOP — the success value the
    // checker does not branch on but every caller compares against.
    const entries = completionsAt(`import { checkChat } from "./src/providers/google";
const report = checkChat({});
if (report.finishReason === "¦") {}`);
    expect(entries.sort()).toEqual([
      "BLOCKLIST",
      "IMAGE_PROHIBITED_CONTENT",
      "IMAGE_RECITATION",
      "IMAGE_SAFETY",
      "MAX_TOKENS",
      "PROHIBITED_CONTENT",
      "RECITATION",
      "SAFETY",
      "SPII",
      "STOP",
    ]);
  });

  test("an assemblyai report completes the four job statuses", () => {
    // The job-status checkers keep their `(string & {})` tail: they TOLERATE
    // an unrecognized status (no warning, passed straight through) rather than
    // refusing it, and their `*Like.status` inputs are `string`, so a closed
    // union could only be reached by a cast. See the tail decision recorded on
    // `AssemblyaiTranscriptStatus`. The tail does not eat the four presets.
    const entries = completionsAt(`import { checkTranscript } from "./src/providers/assemblyai";
const report = checkTranscript({});
if (report.finishReason === "¦") {}`);
    expect(entries.sort()).toEqual(["completed", "error", "processing", "queued"]);
  });

  test("the narrowing survives a bare-ResponseReport annotation on the way out", () => {
    // Backward compatibility has a completions cost, and it is bounded: a
    // caller who re-annotates as the wide `ResponseReport` gets the old
    // behavior (0), which is correct — that is what the default `string`
    // means. What must not happen is the LIBRARY doing that on the caller's
    // behalf, which is what the groq case above guards.
    const wide = completionsAt(`import { checkChat } from "./src/providers/anthropic";
import type { ResponseReport } from "./src/core/report";
const report: ResponseReport = checkChat({});
if (report.finishReason === "¦") {}`);
    expect(wide).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// google.chat: the 30 prebuilt Gemini TTS voices
//
// `voiceName` was typed `string` while `checkVoiceName` reported
// `invalid_enum_value` naming all 30 for anything off the list: the editor
// offered NOTHING for the one field of a TTS request whose values are
// unguessable proper nouns ("Zubenelgenubi", "Laomedeia"). Measured 0 entries
// before, 30 after — and 0 is what an accidental re-widening looks like, which
// no `.test-d.ts` can see.
// ---------------------------------------------------------------------------

const GEMINI_TTS_PROBE = `import { chat } from "./src/providers/google";
`;

describe("google TTS: voiceName completes exactly the 30 preset voices", () => {
  test("single-speaker voiceConfig", () => {
    const entries = completionsAt(`${GEMINI_TTS_PROBE}chat({
  model: "gemini-3.1-flash-tts-preview",
  contents: [{ parts: [{ text: "hi" }] }],
  generationConfig: {
    responseModalities: ["AUDIO"],
    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "¦" } } },
  },
});`);
    expect(entries.length).toBe(30);
    // The guide's own order, first and last, plus the two the docs' samples use.
    expect(entries[0]).toBe("Zephyr");
    expect(entries.at(-1)).toBe("Sulafat");
    for (const voice of ["Kore", "Puck", "Charon", "Zubenelgenubi"]) {
      expect(entries).toContain(voice);
    }
    // No `(string & {})` tail: a tail would put an empty entry here and gate
    // nothing, and `prebuiltVoiceConfig` is preset-only by construction.
    expect(entries).not.toContain("");
  });

  test("every speaker of a multi-speaker request completes the same 30", () => {
    const entries = completionsAt(`${GEMINI_TTS_PROBE}chat({
  model: "gemini-3.1-flash-tts-preview",
  contents: [{ parts: [{ text: "Joe: hi" }] }],
  generationConfig: {
    responseModalities: ["AUDIO"],
    speechConfig: {
      multiSpeakerVoiceConfig: {
        speakerVoiceConfigs: [
          { speaker: "Joe", voiceConfig: { prebuiltVoiceConfig: { voiceName: "¦" } } },
        ],
      },
    },
  },
});`);
    expect(entries.length).toBe(30);
    expect(entries).toContain("Sadaltager");
  });
});

// ---------------------------------------------------------------------------
// google.chat generationConfig: the model's OWN vocabulary, not the union
//
// `GEMINI_IMAGE_MODEL_RULES` and the two enum-name maps are `as const
// satisfies`, so their rows are literal tuples — and `GenerateContentArm<M>`
// now spends those literals. The numbers this block used to pin (28 ratios and
// 8 sizes on every model, "a number for the next pass to move") are the BEFORE
// column: every model offered every documented value, including the sizes its
// own table has no column for.
//
// Both spellings survive per model: the runtime `allowedSpellings` expands each
// allowed value to its proto-JSON enum name, and the arm does the same, so the
// two layers agree value for value.
// ---------------------------------------------------------------------------

describe("google image config: per-model narrowing reaches the editor", () => {
  test("aspectRatio is the model's own row, in both spellings", () => {
    // 3.1 Flash Image is the model whose table lists all 14 ratios: 14 × 2.
    const all = completionsAt(`import { chat } from "./src/providers/google";
chat({
  model: "gemini-3.1-flash-image",
  contents: [{ parts: [{ text: "hi" }] }],
  generationConfig: { imageConfig: { aspectRatio: "¦" } },
});`);
    expect(all.length).toBe(28);
    expect(all).toContain("16:9");
    expect(all).toContain("ASPECT_RATIO_SIXTEEN_BY_NINE");

    // Nano Banana's table lists the 10 core ratios — the 1:4/4:1/1:8/8:1
    // extremes are absent, and `invalid_enum_value` is what asking for one
    // used to cost.
    const core = completionsAt(`import { chat } from "./src/providers/google";
chat({
  model: "gemini-2.5-flash-image",
  contents: [{ parts: [{ text: "hi" }] }],
  generationConfig: { imageConfig: { aspectRatio: "¦" } },
});`);
    expect(core.length).toBe(20);
    expect(core).toContain("16:9");
    expect(core).not.toContain("1:8");
    expect(core).not.toContain("ASPECT_RATIO_ONE_BY_EIGHT");
  });

  test("imageSize is the model's own row, and absent where the model is fixed", () => {
    // Pro: 1K / 2K / 4K — no 512 column. Was 8 (every documented size).
    const pro = completionsAt(`import { chat } from "./src/providers/google";
chat({
  model: "gemini-3-pro-image",
  contents: [{ parts: [{ text: "hi" }] }],
  generationConfig: { imageConfig: { imageSize: "¦" } },
});`);
    expect(pro.length).toBe(6);
    expect(pro).toContain("2K");
    expect(pro).toContain("IMAGE_SIZE_TWO_K");
    expect(pro).not.toContain("512");

    // Flash Lite: 512 / 1K only.
    const lite = completionsAt(`import { chat } from "./src/providers/google";
chat({
  model: "gemini-3.1-flash-lite-image",
  contents: [{ parts: [{ text: "hi" }] }],
  generationConfig: { imageConfig: { imageSize: "¦" } },
});`);
    expect(lite.length).toBe(4);
    expect(lite).toContain("512");
    expect(lite).not.toContain("4K");
  });

  test("responseModalities is the model's own output modalities", () => {
    // A text-only model used to be offered IMAGE and AUDIO. `MODALITY_UNSPECIFIED`
    // stays on every arm because the runtime check passes it — refusing it here
    // would be an error the validator does not raise.
    const text = completionsAt(`import { chat } from "./src/providers/google";
chat({
  model: "gemini-2.5-flash",
  contents: [{ parts: [{ text: "hi" }] }],
  generationConfig: { responseModalities: ["¦"] },
});`);
    expect(text.sort()).toEqual(["MODALITY_UNSPECIFIED", "TEXT", "Text"]);

    const image = completionsAt(`import { chat } from "./src/providers/google";
chat({
  model: "gemini-3.1-flash-image",
  contents: [{ parts: [{ text: "hi" }] }],
  generationConfig: { responseModalities: ["¦"] },
});`);
    expect(image.sort()).toEqual(["IMAGE", "Image", "MODALITY_UNSPECIFIED", "TEXT", "Text"]);

    const tts = completionsAt(`import { chat } from "./src/providers/google";
chat({
  model: "gemini-3.1-flash-tts-preview",
  contents: [{ parts: [{ text: "hi" }] }],
  generationConfig: { responseModalities: ["¦"] },
});`);
    expect(tts.sort()).toEqual(["AUDIO", "Audio", "MODALITY_UNSPECIFIED"]);
  });

  test("the generationConfig key list is unchanged — no discharge, no regression", () => {
    const entries = completionsAt(`import { chat } from "./src/providers/google";
chat({
  model: "gemini-3.1-flash-image",
  contents: [{ parts: [{ text: "hi" }] }],
  generationConfig: { ¦ },
});`);
    // Replacing five fields must not drop the other nineteen.
    expect(entries.length).toBe(24);
    for (const key of ["temperature", "thinkingConfig", "responseModalities", "imageConfig", "speechConfig"]) {
      expect(entries).toContain(key);
    }
  });

  test("model ids still complete — the arm must not eat the ref union", () => {
    const entries = completionsAt(`import { chat } from "./src/providers/google";
chat({ model: "¦", contents: [] });`);
    expect(entries).toContain("gemini-2.5-flash");
    expect(entries).toContain("gemini-3.1-flash-image");
    expect(entries.length).toBeGreaterThan(10);
  });
});

// ---------------------------------------------------------------------------
// google.video: the wire surface completes the model's OWN parameters
//
// This is the completion half of the drift invariant in
// src/providers/google/video.test.ts. Before the per-model arm, every model
// completed the same three resolutions and the same three person policies —
// including Veo 2, which has no `resolution` parameter at all, and Omni, which
// only ever produces 720p. Measured per model: resolution 3/3/3/3 before →
// 3 / 2 / 0 / 1 after; personGeneration 3/3 before → 2 / 3 after.
// ---------------------------------------------------------------------------

const VIDEO_PROBE = `import { video } from "./src/providers/google";
`;

/** One `parameters` completion list for a model literal. */
function veoParam(model: string, field: string, cursor = `"¦"`): string[] {
  return completionsAt(
    `${VIDEO_PROBE}video({ model: "${model}", instances: [{ prompt: "x" }], parameters: { ${field}: ${cursor} } });`,
  );
}

describe("google.video: per-model parameter completions", () => {
  test("resolution is the model's own tier list", () => {
    expect(veoParam("veo-3.1-generate-preview", "resolution")).toEqual(["720p", "1080p", "4k"]);
    expect(veoParam("veo-3.1-lite-generate-preview", "resolution")).toEqual(["720p", "1080p"]);
    expect(veoParam("gemini-omni-flash-preview", "resolution")).toEqual(["720p"]);
    // Veo 2 has no `resolution` parameter: the field types `never`, so there is
    // nothing to complete — the type states the deny the runtime reports.
    expect(veoParam("veo-2.0-generate-001", "resolution")).toEqual([]);
  });

  test("durationSeconds is the model's own closed enum", () => {
    // Numeric literals complete alongside the global scope; filter to the ones
    // that are numbers, which is the union the arm states.
    const numbers = (model: string): string[] =>
      veoParam(model, "durationSeconds", "¦").filter((entry) => /^\d+$/.test(entry));
    expect(numbers("veo-3.1-generate-preview")).toEqual(["4", "6", "8"]);
    expect(numbers("veo-2.0-generate-001")).toEqual(["5", "6", "7", "8"]);
    expect(numbers("gemini-omni-flash-preview")).toEqual(["3", "4", "5", "6", "7", "8", "9", "10"]);
  });

  test("personGeneration narrows only where Google publishes a list", () => {
    expect(veoParam("veo-3.1-generate-preview", "personGeneration")).toEqual([
      "allow_all",
      "allow_adult",
    ]);
    // Veo 2 is the only family with `dont_allow`…
    expect(veoParam("veo-2.0-generate-001", "personGeneration")).toEqual([
      "allow_all",
      "allow_adult",
      "dont_allow",
    ]);
    // …and Omni publishes nothing, so the wire keeps its documented union
    // rather than inventing a narrower one or widening to `string`.
    expect(veoParam("gemini-omni-flash-preview", "personGeneration")).toEqual([
      "allow_all",
      "allow_adult",
      "dont_allow",
    ]);
  });

  test("a run-time model id keeps the wide arm — completion, not gating", () => {
    const entries = completionsAt(`${VIDEO_PROBE}declare const model: string;
video({ model, instances: [{ prompt: "x" }], parameters: { resolution: "¦" } });`);
    expect(entries).toEqual(["720p", "1080p", "4k"]);
  });
});

// ---------------------------------------------------------------------------
// `.toSdk(target)` on a retargeted result, and the two branded refusals
// ---------------------------------------------------------------------------

describe("retargeted toSdk completes the target's own params", () => {
  test("the gemini arm offers the SDK's three keys, not `unknown`", () => {
    const entries = completionsAt(`import { chat } from "./src/providers/openrouter";
const r = chat({ model: "google/gemini-2.5-flash", messages: [{ role: "user", content: "hi" }] });
r.toApi("google").toSdk("google").¦`);
    // Was 0 entries + "Object is of type 'unknown'".
    expect(entries).toContain("model");
    expect(entries).toContain("contents");
    expect(entries).toContain("config");
  });

  test("the identity arms offer the wire body", () => {
    const entries = completionsAt(`import { chat } from "./src/providers/groq";
const r = chat({ model: "openai/gpt-oss-120b", messages: [{ role: "user", content: "hi" }] });
r.toApi("cerebras").toSdk("openai").¦`);
    expect(entries).toContain("messages");
    expect(entries).toContain("model");
    expect(entries).toContain("temperature");
  });
});

describe("a ref this build cannot serve completes nothing to call", () => {
  test("chat: a provider typo hands back a brand, not a request", () => {
    const entries = completionsAt(`import { chat } from "./src/chat/index";
chat({ model: "opnai/gpt-5.2", messages: [] }).¦`);
    // The meta half survives; the request half is gone, so the mistake shows up
    // as a missing member at the call site instead of a runtime throw.
    expect(entries).toContain("target");
    expect(entries).toContain("warnings");
    expect(entries).not.toContain("request");
    expect(entries).not.toContain("toSdk");
    // The brand names the remedy `classifyRef` computes.
    expect(entries).toContain("__unmodel_refProblem");
  });

  test("media: an unregistered provider hands back a brand too", () => {
    const entries = completionsAt(`import { createImage } from "./src/unified/image";
import { image as openai } from "./src/providers/openai/unified-image";
const image = createImage([openai]);
image({ model: "google/imagen-4.0-generate-001", prompt: "x" }).¦`);
    expect(entries).not.toContain("request");
    expect(entries).not.toContain("warnings");
    expect(entries).toContain("__unmodel_unregisteredUnifiedProvider");

    // …while a registered provider's result is untouched.
    const ok = completionsAt(`import { createImage } from "./src/unified/image";
import { image as openai } from "./src/providers/openai/unified-image";
const image = createImage([openai]);
image({ model: "openai/gpt-image-2", prompt: "x" }).¦`);
    expect(ok).toContain("request");
    expect(ok).toContain("warnings");
  });
});

// ---------------------------------------------------------------------------
// kling.video / kling.videoFromImage: the wire surface completes the model's
// OWN parameters
//
// The completion half of the drift invariant in
// src/providers/kling/video.test.ts. Before the per-model arm, every one of
// the nine `/v1/videos/*` models completed the same three modes, the same
// thirteen durations and the same two `sound` values — including
// `kling-v2-master`, which is 1080P-only, and `kling-v2-5-turbo`, which runs 5
// or 10 seconds and has no native audio at all. Measured per model:
//   mode        3/3/3/3/3 before → 3 / 2 / 2 / 1 / 2 after
//               (v3 / v2-6 / v2-5-turbo / v2-master / v1)
//   duration   13/13/13/13/13 before → 13 / 8 / 2 / 2 / 2 after
//   sound       2/2/2/2/2 before → 2 / 2 / 1 / 1 / 1 after
// `aspect_ratio` is 3 before and 3 after on every model, deliberately: no
// source bounds it per `model_name`, so it is the field this change does NOT
// narrow.
// ---------------------------------------------------------------------------

const KLING_VIDEO_PROBE = `import { video, videoFromImage } from "./src/providers/kling";
`;

/** One body-field completion list for a `model_name` literal on text2video. */
function klingParam(model: string, field: string, cursor = `"¦"`): string[] {
  return completionsAt(
    `${KLING_VIDEO_PROBE}video({ model_name: "${model}", prompt: "x", ${field}: ${cursor} });`,
  );
}

describe("kling.video: per-model parameter completions", () => {
  test("mode is the model's own list (std = 720P, pro = 1080P, 4k = 4K)", () => {
    expect(klingParam("kling-v3", "mode")).toEqual(["std", "pro", "4k"]);
    expect(klingParam("kling-v2-6", "mode")).toEqual(["std", "pro"]);
    expect(klingParam("kling-v1", "mode")).toEqual(["std", "pro"]);
    // The master models are 1080P-only on the capability map — one entry, and
    // it is the compile-time half of the `allowed: ["pro"]` the runtime reports.
    expect(klingParam("kling-v2-master", "mode")).toEqual(["pro"]);
    expect(klingParam("kling-v2-1-master", "mode")).toEqual(["pro"]);
  });

  test("duration is the model's own closed enum — seconds as strings", () => {
    expect(klingParam("kling-v3", "duration")).toEqual([
      "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15",
    ]);
    expect(klingParam("kling-v2-6", "duration")).toEqual([
      "3", "4", "5", "6", "7", "8", "9", "10",
    ]);
    expect(klingParam("kling-v2-5-turbo", "duration")).toEqual(["5", "10"]);
    expect(klingParam("kling-v1", "duration")).toEqual(["5", "10"]);
  });

  test("sound offers \"on\" only where the model has native audio", () => {
    expect(klingParam("kling-v3", "sound")).toEqual(["on", "off"]);
    expect(klingParam("kling-v2-6", "sound")).toEqual(["on", "off"]);
    // Not a denied key: `sound: "off"` is legal on every model and the run-time
    // check only refuses switching it ON, so the type offers exactly "off".
    expect(klingParam("kling-v2-5-turbo", "sound")).toEqual(["off"]);
    expect(klingParam("kling-v1", "sound")).toEqual(["off"]);
  });

  test("aspect_ratio is NOT narrowed — the same three on every model", () => {
    for (const model of ["kling-v3", "kling-v2-master", "kling-v1"]) {
      expect(klingParam(model, "aspect_ratio")).toEqual(["16:9", "9:16", "1:1"]);
    }
  });

  test("camera_control's shape completes on kling-v1 and nowhere else", () => {
    // `never` off kling-v1, so the object literal has no contextual type and
    // the field's own keys are not offered.
    expect(klingParam("kling-v1", "camera_control", "{ ¦ }")).toEqual(["config", "type"]);
    expect(klingParam("kling-v1-6", "camera_control", "{ ¦ }")).not.toContain("config");
    expect(klingParam("kling-v2-6", "camera_control", "{ ¦ }")).not.toContain("config");
  });

  test("the image route narrows the same fields, over its two extra ids", () => {
    const i2v = (model: string, field: string): string[] =>
      completionsAt(
        `${KLING_VIDEO_PROBE}videoFromImage({ model_name: "${model}", image: "u", prompt: "x", ${field}: "¦" });`,
      );
    expect(i2v("kling-v3", "duration")).toEqual([
      "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15",
    ]);
    // The two image-to-video-only ids — absent from text2video entirely.
    expect(i2v("kling-v2-1", "duration")).toEqual(["5", "10"]);
    expect(i2v("kling-v1-5", "mode")).toEqual(["std", "pro"]);
  });

  test("the degraded arms keep every documented value", () => {
    // `model_name` is optional on this route, so an omitted one is a real
    // caller shape — and nothing in the request names a model, so nothing is
    // narrowed (the server default is kling-v1, but the request does not say so).
    expect(completionsAt(`${KLING_VIDEO_PROBE}video({ prompt: "x", duration: "¦" });`)).toEqual([
      "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15",
    ]);
    expect(completionsAt(`${KLING_VIDEO_PROBE}video({ prompt: "x", mode: "¦" });`)).toEqual([
      "std", "pro", "4k",
    ]);
    // A run-time model id.
    expect(
      completionsAt(`${KLING_VIDEO_PROBE}declare const model: string;
video({ model_name: model, prompt: "x", duration: "¦" });`),
    ).toEqual(["3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15"]);
    // A post-snapshot id: no rule row, so no narrowing — completion, not gating.
    expect(
      completionsAt(`${KLING_VIDEO_PROBE}video({ model_name: "kling-v9", prompt: "x", sound: "¦" });`),
    ).toEqual(["on", "off"]);
  });
});

describe("unified voice creation: narrowing reaches the editor", () => {
  test("the clone ref union completes the synthetic and real ids alike", () => {
    const refs = completionsAt(`import { voiceClone } from "./src/unified/voice-clone";
voiceClone({ model: "¦", operation: "clone", name: "n", samples: [] });`);
    expect(refs).toContain("elevenlabs/ivc");
    expect(refs).toContain("fish-audio/fast");
    expect(refs).toContain("minimax/voice-clone");
    expect(refs).toContain("cartesia/voice-clone");
  });

  test("clone language completes Cartesia's 44 without gating them", () => {
    const entries = completionsAt(`import { voiceClone } from "./src/unified/voice-clone";
voiceClone({ model: "cartesia/voice-clone", operation: "clone", name: "n", samples: [], language: "¦" });`);
    // The 44 the clone route requires one of; the `(string & {})` tail has
    // not eaten the literals.
    expect(entries).toContain("tl");
    expect(entries).toContain("ur");
    expect(entries.length).toBe(44);
  });

  test("design extras narrow per model: the ttv_v3-only pair", () => {
    const v3 = completionsAt(`import { voiceDesign } from "./src/unified/voice-design";
voiceDesign({ model: "elevenlabs/eleven_ttv_v3", operation: "design", prompt: "p", ¦ });`);
    expect(v3).toContain("prompt_strength");
    expect(v3).toContain("reference_audio_base64");

    const v2 = completionsAt(`import { voiceDesign } from "./src/unified/voice-design";
voiceDesign({ model: "elevenlabs/eleven_multilingual_ttv_v2", operation: "design", prompt: "p", ¦ });`);
    expect(v2).toContain("loudness");
    expect(v2).not.toContain("prompt_strength");
  });
});
