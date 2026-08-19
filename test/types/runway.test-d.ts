/**
 * Type-level tests for the runway provider (VIDEO GENERATION modality).
 * NOT run by `bun test` — this file is only type-checked (`bun run check` /
 * tsc --noEmit). Runway has no bundled SDK types here, so these tests pin the
 * `ExactKeys` public-cast contract of `runway.video`: the excess-key
 * compile error, the `safe<T>` overload carrying the same guard, and the fact
 * that this endpoint strips NOTHING (the wire body keeps `model`).
 */
import { video, videoFromImage, videoFromVideo, image } from "../../src/providers/runway";
import type { EndpointConstraints } from "../../src/core/constraint-types";
import { expectAssignable, expectTrue, type IsNever, type KeyIn } from "./helpers";

function textToVideoTypeTests(): void {
  const v = video({
    model: "gen4.5",
    promptText: "A slow dolly shot through a neon-lit alley in the rain",
    ratio: "1280:720",
    duration: 5,
    seed: 42,
    contentModeration: { publicFigureThreshold: "low" },
    outputFormat: "prores",
    proresProfile: "422 HQ",
  });

  // This route strips nothing: the whole params object IS the wire body, so
  // every key survives on the validated value with its literal type intact.
  expectAssignable<"gen4.5">(v.model);
  expectAssignable<string>(v.promptText);
  expectAssignable<number>(v.duration);
  expectAssignable<"prores">(v.outputFormat);
  expectTrue<IsNever<KeyIn<typeof v, "notAParam">>>();
  expectAssignable<string>(JSON.stringify(v));

  // `.request` and `.toSdk("runway")` stay typed (X-Runway-Version rides in
  // headers). Video endpoints declare their own SDK target only — the AI
  // SDK's video primitive is still experimental, so no "ai-sdk" target.
  expectAssignable<string>(v.request.url);
  expectAssignable<"POST">(v.request.method);
  expectAssignable<Record<string, string>>(v.request.headers);
  expectAssignable<{ model: string; promptText: string }>(v.toSdk("runway"));

  // @ts-expect-error — "runway" is this endpoint's only SDK target
  v.toSdk("ai-sdk");
  // @ts-expect-error — `.toSdk()` now requires a target
  v.toSdk();

  // Reference arrays and the veo/seedance-only knobs type-check.
  video({
    model: "hailuo3",
    promptText: "hi",
    references: [{ uri: "https://example.com/a.png" }],
    referenceVideos: [{ type: "video", uri: "https://example.com/a.mp4" }],
    referenceAudio: [{ type: "audio", uri: "https://example.com/a.mp3" }],
    resolution: "1080p",
  });
  video({ model: "veo3.1_fast", promptText: "hi", audio: true, negativePrompt: "rain" });

  // Unknown model ids stay assignable through the (string & {}) escape.
  video({ model: "gen9-unreleased", promptText: "hi" });

  // safe() narrows to the same Validated shape and carries the same guard.
  const result = video.safe({ model: "gen4.5", promptText: "hi" });
  if (result.ok) {
    expectAssignable<"gen4.5">(result.params.model);
    expectAssignable<string>(result.params.request.url);
  }

  expectAssignable<EndpointConstraints[]>(video.constraintsFor("gen4.5"));

  // gen4_turbo (image_to_video-only) is dropped from the autocomplete union
  // but still type-checks via (string & {}); the route gate is a runtime
  // check (unsupported_capability), not a compile error.
  video({ model: "gen4_turbo", promptText: "hi" });

  // @ts-expect-error outputFormat is a closed enum
  video({ model: "gen4.5", promptText: "hi", outputFormat: "webm" });

  // ExactKeys: a typo'd/excess top-level key is a COMPILE error, not a
  // silent unknown_param warning. Runway is camelCase, so the snake_case
  // spelling is the realistic typo.
  video({
    model: "veo3.1",
    promptText: "hi",
    // @ts-expect-error excess (typo'd) top-level key — the ExactKeys guard
    negative_prompt: "rain",
  });

  // The same guard is wired into the safe() overload.
  video.safe({
    model: "gen4.5",
    promptText: "hi",
    // @ts-expect-error excess (typo'd) top-level key — ExactKeys on safe()
    promptTxt: "hi",
  });
}

function sizingTypeTests(): void {
  // `ratio` / `resolution` / `quality` / `outputFormat` used to be bare
  // `string`s: no autocomplete, and junk compiled. They now carry the
  // documented per-model value space (narrowed further at runtime).
  video({ model: "seedance2", promptText: "hi", ratio: "3840:2160" });
  video({ model: "hailuo3", promptText: "hi", ratio: "adaptive", resolution: "2K" });
  // Pixel-pair ratios stay open for models unmodel has no arm for yet.
  video({ model: "gen9-unreleased", promptText: "hi", ratio: "1234:567" });
  // @ts-expect-error non-ratio strings no longer compile
  video({ model: "seedance2", promptText: "hi", ratio: "banana" });
  // @ts-expect-error resolution is a closed keyword enum
  video({ model: "hailuo3", promptText: "hi", resolution: "" });

  videoFromImage({ model: "veo3.1", promptImage: "https://x/a.png", ratio: "1920:1080" });
  // @ts-expect-error "WIDTHxHEIGHT" is the wrong wire shape — Runway ratios are "W:H"
  videoFromImage({ model: "veo3.1", promptImage: "https://x/a.png", ratio: "1920x1080" });

  videoFromVideo({ model: "aleph2", videoUri: "https://x/a.mp4", targetAspectRatio: "21:9" });
  // @ts-expect-error targetAspectRatio is aleph2's closed 8-value enum
  videoFromVideo({ model: "aleph2", videoUri: "https://x/a.mp4", targetAspectRatio: "5:4" });

  image({ model: "gpt_image_2", promptText: "hi", ratio: "3840:2160", quality: "high" });
  image({ model: "seedream5_pro", promptText: "hi", ratio: "auto_2k", outputFormat: "jpeg" });
  // @ts-expect-error "" is not a ratio
  image({ model: "gen4_image", promptText: "hi", ratio: "" });
  // @ts-expect-error quality is a closed four-step scale
  image({ model: "gpt_image_2", promptText: "hi", ratio: "2560:1440", quality: "ultra" });
  // @ts-expect-error outputFormat is png | jpeg on this route
  image({ model: "seedream5_pro", promptText: "hi", ratio: "auto_1k", outputFormat: "webp" });
}

export { textToVideoTypeTests, sizingTypeTests };
