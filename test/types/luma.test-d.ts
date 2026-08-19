/**
 * Type-level tests for the luma provider. NOT run by `bun test` — this file is
 * only type-checked (`bun run check` / tsc --noEmit). The Dream Machine spec
 * types `duration` and `resolution` as `anyOf: [enum, string]`, so the point of
 * these cases is that the documented values are autocompleted WITHOUT closing
 * the field: the openness the API documents is preserved by a `(string & {})`
 * tail and enforced at runtime instead (demotable `invalid_enum_value`).
 */
import { video, videoUpscale } from "../../src/providers/luma";
import type { LumaVideoDuration, LumaVideoResolution } from "../../src/providers/luma";
import { expectAssignable } from "./helpers";

function videoTypeTests(): void {
  const v = video({
    model: "ray-2",
    prompt: "a serene lake at sunset",
    aspect_ratio: "16:9",
    duration: "5s",
    resolution: "720p",
    loop: true,
  });
  expectAssignable<string>(v.request.url);
  expectAssignable<string>(JSON.stringify(v));

  // Both documented durations autocomplete.
  video({ model: "ray-2", prompt: "hi", duration: "9s" });
  // Every documented resolution autocompletes, 540p through 4k.
  video({ model: "ray-flash-2", prompt: "hi", resolution: "540p" });
  video({ model: "ray-2", prompt: "hi", resolution: "4k" });

  // No `@ts-expect-error` case exists for duration/resolution: the spec types
  // both as `anyOf: [enum, string]` (the lumaai SDK accepts any string), so the
  // unions keep a `(string & {})` tail and an undocumented value must stay
  // COMPILABLE — it is reported at runtime as an `invalid_enum_value` a caller
  // can demote via `severity` when Luma ships a value before this table
  // catches up. The presets buy autocomplete, not closure.
  video({ model: "ray-2", prompt: "hi", duration: "7s", resolution: "2160p" });

  // The genuinely closed fields still reject junk.
  // @ts-expect-error aspect_ratio is a closed documented enum
  video({ model: "ray-2", prompt: "hi", aspect_ratio: "2:1" });
  // @ts-expect-error ExactKeys rejects typo'd keys
  video({ model: "ray-2", prompt: "hi", resolutionn: "720p" });

  // Model ids keep their `(string & {})` escape hatch.
  video({ model: "ray-3", prompt: "hi" });
}

function videoUpscaleTypeTests(): void {
  const v = videoUpscale({ id: "123e4567-e89b-12d3-a456-426614174000", resolution: "4k" });
  expectAssignable<string>(v.request.url);

  // The upscale route shares the generate route's resolution union.
  videoUpscale({ id: "abc", resolution: "1080p" });
  // Same `(string & {})` tail, same reason — no `@ts-expect-error` here either:
  // an undocumented resolution compiles and is caught by checkOpenEnum.
  videoUpscale({ id: "abc", resolution: "8k" });

  const shared: LumaVideoResolution = "720p";
  videoUpscale({ id: "abc", resolution: shared });
  const duration: LumaVideoDuration = "5s";
  video({ model: "ray-2", prompt: "hi", duration });
}

export { videoTypeTests, videoUpscaleTypeTests };
