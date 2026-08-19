/**
 * Type-level tests for the vidu provider. NOT run by `bun test` — this file is
 * only type-checked (`bun run check` / tsc --noEmit). Vidu ships no
 * first-party SDK, so these tests exercise the curated preset unions on the
 * wire params: `resolution` on the video routes is autocomplete over every
 * documented tier (each route's support table narrows it per model at
 * runtime), and imageFromReference has its OWN, differently-spelled spaces.
 */
import { video, videoFromImage, videoFromReference, imageFromReference } from "../../src/providers/vidu";
import { expectAssignable } from "./helpers";

function videoResolutionTypeTests(): void {
  const v = video({ model: "viduq3-pro", prompt: "hi", resolution: "1080p", duration: 8 });
  expectAssignable<{ prompt: string }>(v);
  expectAssignable<string>(v.request.url);
  video({ model: "viduq3-pro", prompt: "hi", resolution: "540p" });
  // @ts-expect-error "" is not a resolution (was a bare `string`)
  video({ model: "viduq3-pro", prompt: "hi", resolution: "" });
  // @ts-expect-error 4K is the imageFromReference spelling, not a video tier
  video({ model: "viduq3-pro", prompt: "hi", resolution: "4K" });

  videoFromImage({ model: "vidu2.0", images: ["https://e.com/a.png"], resolution: "360p", duration: 4 });
  videoFromImage({ model: "viduq3-pro", images: ["https://e.com/a.png"], resolution: "1080p" });
  // @ts-expect-error banana is not a resolution (was a bare `string`)
  videoFromImage({ model: "viduq3-pro", images: ["https://e.com/a.png"], resolution: "banana" });

  videoFromReference({ model: "viduq3", prompt: "hi", images: ["https://e.com/a.png"], resolution: "720p" });
  videoFromReference({ model: "vidu2.0", prompt: "hi", images: ["https://e.com/a.png"], resolution: "360p" });
  // @ts-expect-error "" is not a resolution (was a bare `string`)
  videoFromReference({ model: "viduq3", prompt: "hi", images: ["https://e.com/a.png"], resolution: "" });

  // Model ids keep their escape hatch: unknown ids stay legal and warn at runtime.
  video({ model: "viduq9", prompt: "hi", resolution: "720p" });
}

function referenceImageTypeTests(): void {
  const v = imageFromReference({ model: "viduq2", prompt: "hi", aspect_ratio: "21:9", resolution: "4K" });
  expectAssignable<{ prompt: string }>(v);
  imageFromReference({ model: "viduq2", prompt: "hi", aspect_ratio: "auto", resolution: "1080p" });
  // @ts-expect-error banana is not an aspect ratio (was a bare `string`)
  imageFromReference({ model: "viduq2", prompt: "hi", aspect_ratio: "banana" });
  // @ts-expect-error 16x9 is the wrong wire shape for a ratio field
  imageFromReference({ model: "viduq2", prompt: "hi", aspect_ratio: "16x9" });
  // @ts-expect-error "" is not a resolution (was a bare `string`)
  imageFromReference({ model: "viduq2", prompt: "hi", resolution: "" });
  // @ts-expect-error this route spells its tiers with an uppercase K ("2K")
  imageFromReference({ model: "viduq2", prompt: "hi", resolution: "2k" });
  // @ts-expect-error the video routes' 720p tier has no arm on the image route
  imageFromReference({ model: "viduq2", prompt: "hi", resolution: "720p" });
}

export { videoResolutionTypeTests, referenceImageTypeTests };
