/**
 * Type-level tests for the minimax provider's video routes. NOT run by
 * `bun test` — this file is only type-checked (`bun run check` / tsc
 * --noEmit). MiniMax ships no official JS SDK for these routes, so the tests
 * exercise the closed enum unions on the raw wire params.
 */
import { video, videoV2 } from "../../src/providers/minimax";
import { expectAssignable } from "./helpers";

function videoGenerationTypeTests(): void {
  // VIDEO_RESOLUTIONS is the complete documented set; per-model narrowing
  // (which resolution pairs with which duration) happens at runtime.
  const v = video({
    model: "MiniMax-Hailuo-2.3",
    prompt: "a neon-lit street",
    resolution: "1080P",
    duration: 6,
  });
  expectAssignable<string>(JSON.stringify(v));
  video({ model: "MiniMax-Hailuo-02", first_frame_image: "https://x/a.jpg", resolution: "512P" });

  // @ts-expect-error — MiniMax documents no 4K tier on this route
  video({ model: "MiniMax-Hailuo-2.3", prompt: "hi", resolution: "banana" });
  // @ts-expect-error — the empty string used to compile through `(string & {})`
  video({ model: "MiniMax-Hailuo-2.3", prompt: "hi", resolution: "" });

  // `duration` stays a bare number on this route: the legal values are a
  // per-model x per-resolution map, not one flat documented list.
  video({ model: "MiniMax-Hailuo-2.3", prompt: "hi", duration: 10 });
}

function videoGenerationV2TypeTests(): void {
  const v = videoV2({
    model: "MiniMax-H3",
    content: [{ type: "text", text: "a neon-lit street" }],
    resolution: "768P",
    duration: 6,
    ratio: "16:9",
  });
  expectAssignable<string>(JSON.stringify(v));
  videoV2({
    model: "MiniMax-H3",
    content: [{ type: "text", text: "hi" }],
    resolution: "2K",
    duration: 15,
    ratio: "21:9",
  });

  videoV2({
    model: "MiniMax-H3",
    content: [{ type: "text", text: "hi" }],
    // @ts-expect-error — 768P and 2K are the whole documented set on this route
    resolution: "1080P",
    duration: 6,
    ratio: "16:9",
  });
  videoV2({
    model: "MiniMax-H3",
    content: [{ type: "text", text: "hi" }],
    resolution: "768P",
    // @ts-expect-error — durations are the documented integers 4–15
    duration: 16,
    ratio: "16:9",
  });
  videoV2({
    model: "MiniMax-H3",
    content: [{ type: "text", text: "hi" }],
    resolution: "768P",
    duration: 6,
    // @ts-expect-error — junk ratios used to compile through `(string & {})`
    ratio: "banana",
  });
  videoV2({
    model: "MiniMax-H3",
    content: [{ type: "text", text: "hi" }],
    resolution: "768P",
    duration: 6,
    // @ts-expect-error — the empty string is not a documented ratio either
    ratio: "",
  });
}

export { videoGenerationTypeTests, videoGenerationV2TypeTests };
