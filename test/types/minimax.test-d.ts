/**
 * Type-level tests for the minimax provider's video routes. NOT run by
 * `bun test` — this file is only type-checked (`bun run check` / tsc
 * --noEmit). MiniMax ships no official JS SDK for these routes, so the tests
 * exercise the closed enum unions on the raw wire params.
 */
import { video, videoV2, checkTts, MINIMAX_BASE_RESP_INFO } from "../../src/providers/minimax";
import type { MinimaxBaseRespInfo } from "../../src/providers/minimax";
import type { MinimaxV2ContentType, MinimaxV2Role } from "../../src/providers/minimax";
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

/**
 * `content[].type` and `content[].role` are the last two closed-by-the-checker
 * vocabularies on this body that used to carry an open tail. `resolution`,
 * `ratio` and `duration` in the same interface were already closed against
 * their own `as const` arrays; these two are protocol vocabulary and strictly
 * more stable than those.
 */
function videoV2ContentVocabularyTypeTests(): void {
  const v = videoV2({
    model: "MiniMax-H3",
    content: [
      { type: "text", text: "a neon-lit street" },
      { type: "image_url", image_url: { url: "https://cdn.example/a.jpg" }, role: "first_frame" },
      { type: "video_url", video_url: { url: "https://cdn.example/a.mp4" }, role: "reference_video" },
      { type: "audio_url", audio_url: { url: "https://cdn.example/a.mp3" }, role: "reference_audio" },
    ],
    resolution: "768P",
    duration: 6,
  });
  expectAssignable<MinimaxV2ContentType>(v.content[0]?.type ?? "text");
  expectAssignable<MinimaxV2Role | undefined>(v.content[1]?.role);

  videoV2({
    model: "MiniMax-H3",
    // @ts-expect-error — `invalid_enum_value` at run time; "pdf_url" is not a content type.
    content: [{ type: "pdf_url", text: "hi" }],
    resolution: "768P",
    duration: 6,
  });
  videoV2({
    model: "MiniMax-H3",
    content: [
      { type: "text", text: "hi" },
      // @ts-expect-error — an unrecognised role is counted as a first frame by
      // `summarize`, so it used to earn a spurious second diagnostic too.
      { type: "image_url", image_url: { url: "https://x/a.jpg" }, role: "middle_frame" },
    ],
    resolution: "768P",
    duration: 6,
  });
}

/**
 * `MINIMAX_BASE_RESP_INFO` serves two reads without a cast, and both are
 * pinned because they pull in opposite directions: the checker's own
 * open-tailed `finishReason` must index the table (the numeric index
 * signature), while an exact key must keep its literal payload (the `as
 * const` table). A `Partial<Record<…>>` declaration would satisfy the first
 * by destroying the second.
 */
function baseRespInfoTypeTests(): void {
  const decoded = undefined as unknown;
  expectAssignable<readonly unknown[]>(checkTts(decoded).warnings);

  const report = checkTts({ base_resp: { status_code: 1002, status_msg: "rate limit exceeded" } });
  if (report.finishReason !== undefined && report.finishReason !== 0) {
    // The adopter's exact line: the checker's output indexes its companion table.
    const info = MINIMAX_BASE_RESP_INFO[report.finishReason];
    expectAssignable<MinimaxBaseRespInfo | undefined>(info);
    // @ts-expect-error — an open-code lookup can miss; `info` is possibly undefined.
    info.statusMsg;
  }
  // Exact keys keep their literal payloads.
  const authRetryable: false = MINIMAX_BASE_RESP_INFO[1004].retryable;
  const timeoutMsg: "timeout" = MINIMAX_BASE_RESP_INFO[1001].statusMsg;
  // @ts-expect-error — `0` (success) carries no `retryable` at all.
  MINIMAX_BASE_RESP_INFO[0].retryable;
  void authRetryable;
  void timeoutMsg;
}

export {
  videoGenerationTypeTests,
  videoGenerationV2TypeTests,
  videoV2ContentVocabularyTypeTests,
  baseRespInfoTypeTests,
};
