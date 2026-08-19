/**
 * Type-level tests for the kling provider. NOT run by `bun test` — this file
 * is only type-checked (`bun run check` / tsc --noEmit). Kling ships no
 * official JS SDK, so these tests exercise the curated preset unions on the
 * wire params: each one is autocomplete over the documented value space that
 * the per-model rule tables (`V1_MODEL_RULES`, the route `RouteRules`) narrow
 * further at runtime.
 */
import {
  textToVideo,
  imageToVideo,
  textToVideoV3,
  imageToVideoV3,
  omniVideo,
  imageGenerations,
  omniImage,
} from "../../src/providers/kling";
import { expectAssignable } from "./helpers";

function v1DurationTypeTests(): void {
  // `duration` is seconds as a STRING on /v1/videos/*; the union is the widest
  // documented range (kling-v3's 3–15s).
  const v = textToVideo({ model_name: "kling-v3", prompt: "hi", duration: "5" });
  expectAssignable<{ prompt?: string }>(v);
  textToVideo({ model_name: "kling-v3", prompt: "hi", duration: "12" });
  // @ts-expect-error "" is not a documented duration (was a bare `string`)
  textToVideo({ model_name: "kling-v3", prompt: "hi", duration: "" });
  // @ts-expect-error 3–15 is the documented range; "16" is off the end
  textToVideo({ model_name: "kling-v3", prompt: "hi", duration: "16" });
  // @ts-expect-error this route takes seconds as a string, not a number
  textToVideo({ model_name: "kling-v3", prompt: "hi", duration: 5 });

  imageToVideo({ model_name: "kling-v3", image: "https://e.com/a.png", duration: "3" });
  imageToVideo({ model_name: "kling-v3", image: "https://e.com/a.png", duration: "15" });
  // @ts-expect-error banana is not a duration (was a bare `string`)
  imageToVideo({ model_name: "kling-v3", image: "https://e.com/a.png", duration: "banana" });

  // Model ids keep their escape hatch: unknown ids stay legal and warn at runtime.
  textToVideo({ model_name: "kling-v9", prompt: "hi", duration: "5" });
}

function pathRouteSettingsTypeTests(): void {
  // resolution / duration / audio are unions over the documented spaces; the
  // route rule tables reject what a given model does not offer at runtime.
  const v = textToVideoV3({
    model: "kling-3.0",
    prompt: "hi",
    settings: { resolution: "1080p", duration: 10, audio: "native", aspect_ratio: "16:9" },
  });
  expectAssignable<{ prompt: string }>(v);
  textToVideoV3({ model: "kling-3.0", prompt: "hi", settings: { resolution: "4k", duration: 15 } });
  // @ts-expect-error "" is not a resolution (was a bare `string`)
  textToVideoV3({ model: "kling-3.0", prompt: "hi", settings: { resolution: "" } });
  // @ts-expect-error 2k is not a Kling video tier — the tiers are 720p/1080p/4k
  textToVideoV3({ model: "kling-3.0", prompt: "hi", settings: { resolution: "2k" } });
  // @ts-expect-error banana is not an audio mode (was a bare `string`)
  textToVideoV3({ model: "kling-3.0", prompt: "hi", settings: { audio: "banana" } });
  // @ts-expect-error 3–15 seconds is the documented range
  textToVideoV3({ model: "kling-3.0", prompt: "hi", settings: { duration: 20 } });

  const frame = { type: "first_frame", url: "https://e.com/a.png" } as const;
  imageToVideoV3({ model: "kling-3.0", contents: [frame], settings: { resolution: "720p" } });
  imageToVideoV3({ model: "kling-2.6", contents: [frame], settings: { audio: "off", duration: 10 } });
  // @ts-expect-error "" is not a resolution (was a bare `string`)
  imageToVideoV3({ model: "kling-3.0", contents: [frame], settings: { resolution: "" } });
  // @ts-expect-error banana is not an audio mode (was a bare `string`)
  imageToVideoV3({ model: "kling-3.0", contents: [frame], settings: { audio: "banana" } });

  const prompt = { type: "prompt", text: "hi" } as const;
  // "original" — keep the input video's audio — exists only on this route.
  omniVideo({ model: "kling-3.0-omni", contents: [prompt], settings: { audio: "original" } });
  omniVideo({ model: "kling-o1", contents: [prompt], settings: { resolution: "1080p", duration: 8 } });
  // @ts-expect-error banana is not an audio mode (was a bare `string`)
  omniVideo({ model: "kling-3.0-omni", contents: [prompt], settings: { audio: "banana" } });
  // @ts-expect-error "" is not a resolution (was a bare `string`)
  omniVideo({ model: "kling-3.0-omni", contents: [prompt], settings: { resolution: "" } });
  // @ts-expect-error 3–15 seconds is the documented range
  omniVideo({ model: "kling-3.0-omni", contents: [prompt], settings: { duration: 0 } });
}

function imageRouteTypeTests(): void {
  const v = imageGenerations({ model_name: "kling-v2-1", prompt: "hi", resolution: "1k" });
  expectAssignable<{ prompt: string }>(v);
  imageGenerations({ model_name: "kling-v2-1", prompt: "hi", resolution: "2k" });
  // @ts-expect-error "" is not a resolution (was a bare `string`)
  imageGenerations({ model_name: "kling-v2-1", prompt: "hi", resolution: "" });
  // @ts-expect-error the 4K tier belongs to the omni-image route
  imageGenerations({ model_name: "kling-v2-1", prompt: "hi", resolution: "4k" });

  omniImage({ prompt: "hi", resolution: "2k" });
  omniImage({ model_name: "kling-v3-omni", prompt: "hi", resolution: "4k" });
  // @ts-expect-error banana is not a resolution (was a bare `string`)
  omniImage({ prompt: "hi", resolution: "banana" });
}

export { v1DurationTypeTests, pathRouteSettingsTypeTests, imageRouteTypeTests };
