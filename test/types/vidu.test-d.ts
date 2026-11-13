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
  // @ts-expect-error 4K is viduq4-preview's tier on img2video / reference2video; no text2video arm offers it
  video({ model: "viduq3-pro", prompt: "hi", resolution: "4K" });
  // @ts-expect-error `auto` is a reference2video ratio; text2video lists the five fixed ones
  video({ model: "viduq3-pro", prompt: "hi", aspect_ratio: "auto" });

  videoFromImage({ model: "vidu2.0", images: ["https://e.com/a.png"], resolution: "360p", duration: 4 });
  videoFromImage({ model: "viduq3-pro", images: ["https://e.com/a.png"], resolution: "1080p" });
  videoFromImage({ model: "viduq4-preview", images: ["https://e.com/a.png"], resolution: "4K", duration: 16 });
  // @ts-expect-error the q4 tiers are uppercase on the wire ("4K")
  videoFromImage({ model: "viduq4-preview", images: ["https://e.com/a.png"], resolution: "4k" });
  // @ts-expect-error banana is not a resolution (was a bare `string`)
  videoFromImage({ model: "viduq3-pro", images: ["https://e.com/a.png"], resolution: "banana" });

  videoFromReference({ model: "viduq3", prompt: "hi", images: ["https://e.com/a.png"], resolution: "720p" });
  videoFromReference({ model: "vidu2.0", prompt: "hi", images: ["https://e.com/a.png"], resolution: "360p" });
  videoFromReference({
    model: "viduq4-preview",
    prompt: "hi",
    images: ["https://e.com/a.png"],
    sounds: ["https://e.com/a.mp3"],
    resolution: "2K",
  });
  videoFromReference({ model: "viduq3-drama", prompt: "hi", images: ["https://e.com/a.png"], aspect_ratio: "auto" });
  // @ts-expect-error `sounds` is a list of audio references, not one
  videoFromReference({ model: "viduq3-mix", prompt: "hi", images: ["https://e.com/a.png"], sounds: "https://e.com/a.mp3" });
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
