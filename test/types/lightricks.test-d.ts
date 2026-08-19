/**
 * Type-level tests for the lightricks (LTX) provider. NOT run by `bun test` —
 * this file is only type-checked (`bun run check` / tsc --noEmit). LTX ships no
 * first-party JS SDK and its OpenAPI schema types `resolution` as a bare string
 * and `duration`/`fps` as bare integers; the real value space lives in the
 * published support matrices, so these cases pin what the preset unions
 * autocomplete and what they still (deliberately) let through.
 */
import { textToVideo, imageToVideo } from "../../src/providers/lightricks";
import type { LtxDuration, LtxFps, LtxResolution } from "../../src/providers/lightricks";
import { expectAssignable } from "./helpers";

const IMG = "https://example.com/first.png";

function textToVideoTypeTests(): void {
  const v = textToVideo({
    model: "ltx-2-3-pro",
    prompt: "a lighthouse beam sweeps across the water",
    resolution: "1920x1080",
    duration: 8,
    fps: 25,
  });
  expectAssignable<string>(v.request.url);
  expectAssignable<string>(JSON.stringify(v));

  // The resolution presets autocomplete every documented tier, both
  // orientations.
  textToVideo({ model: "ltx-2-3-pro", prompt: "hi", resolution: "1280x720", duration: 6 });
  textToVideo({ model: "ltx-2-3-pro", prompt: "hi", resolution: "2160x3840", duration: 6 });
  // Undocumented sizes stay legal — models absent from SUPPORT_MATRIX (the
  // deprecated ltx-2-fast / ltx-2-pro) are not matrix-checked, so the union
  // keeps a `${number}x${number}` tail rather than over-narrowing them.
  textToVideo({ model: "ltx-2-pro", prompt: "hi", resolution: "1920x816", duration: 6 });
  // @ts-expect-error the empty string is not a "WIDTHxHEIGHT" (was a bare `string`)
  textToVideo({ model: "ltx-2-3-pro", prompt: "hi", resolution: "", duration: 6 });
  // @ts-expect-error tier names are not the wire shape — resolutions are "WIDTHxHEIGHT"
  textToVideo({ model: "ltx-2-3-pro", prompt: "hi", resolution: "1080p", duration: 6 });

  // Duration presets: the long-form values the fast variants publish.
  textToVideo({ model: "ltx-2-3-fast", prompt: "hi", resolution: "1280x720", duration: 20 });
  textToVideo({ model: "ltx-2-3-fast", prompt: "hi", resolution: "1280x720", duration: 14 });
  // `null` is LTX-2.5's automatic duration (checked at runtime, not compile time).
  textToVideo({ model: "ltx-2-5-fast", prompt: "hi", resolution: "1280x720", duration: null });
  // No `@ts-expect-error` case for duration: the union keeps a `(number & {})`
  // tail so the un-matrixed deprecated models stay callable, which means an
  // off-matrix number still compiles and is caught at runtime by
  // checkSupportMatrix instead.
  textToVideo({ model: "ltx-2-pro", prompt: "hi", resolution: "1280x720", duration: 7 });

  // fps presets: the four values the matrices publish.
  textToVideo({ model: "ltx-2-3-pro", prompt: "hi", resolution: "1280x720", duration: 6, fps: 48 });
  textToVideo({ model: "ltx-2-3-pro", prompt: "hi", resolution: "1280x720", duration: 6, fps: 50 });
  // Same `(number & {})` reasoning as duration — no `@ts-expect-error` case.
  textToVideo({ model: "ltx-2-pro", prompt: "hi", resolution: "1280x720", duration: 6, fps: 30 });

  // @ts-expect-error ExactKeys rejects typo'd keys
  textToVideo({ model: "ltx-2-3-pro", prompt: "hi", resolution: "1280x720", duration: 6, fsp: 24 });

  // Model ids keep their `(string & {})` escape hatch.
  textToVideo({ model: "ltx-3", prompt: "hi", resolution: "1280x720", duration: 6 });
}

function imageToVideoTypeTests(): void {
  const v = imageToVideo({
    model: "ltx-2-3-fast",
    image_uri: IMG,
    prompt: "the camera pushes in as the waves roll",
    resolution: "1280x720",
    duration: 6,
  });
  expectAssignable<string>(v.request.url);

  // The same three unions ride this route.
  imageToVideo({
    model: "ltx-2-3-pro",
    image_uri: IMG,
    prompt: "hi",
    resolution: "3840x2160",
    duration: 10,
    fps: 25,
  });
  imageToVideo({
    model: "ltx-2-5-fast",
    image_uri: IMG,
    prompt: "hi",
    resolution: "1440x2560",
    duration: null,
  });
  // @ts-expect-error "banana" is not a "WIDTHxHEIGHT" (was a bare `string`)
  imageToVideo({ model: "ltx-2-3-pro", image_uri: IMG, prompt: "hi", resolution: "banana", duration: 6 });

  const resolution: LtxResolution = "1920x1080";
  const duration: LtxDuration = 8;
  const fps: LtxFps = 24;
  imageToVideo({ model: "ltx-2-3-pro", image_uri: IMG, prompt: "hi", resolution, duration, fps });
}

export { textToVideoTypeTests, imageToVideoTypeTests };
