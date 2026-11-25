import { describe, expect, test } from "bun:test";
import { checkRequestStatus } from "./check";
import { HIGGSFIELD_REQUEST_STATUSES, HIGGSFIELD_TERMINAL_STATUSES } from "./statuses";

/**
 * Every body below is a DOCUMENTATION SAMPLE, copied from the page named above
 * it on 2026-11-24. None is a recorded response: unmodel holds no Higgsfield
 * credential, which is why these live here and not under `test/fixtures/`.
 */

// https://docs.higgsfield.ai/docs/concepts/requests.md
const ACCEPTED = {
  status: "queued",
  request_id: "d7e6c0f3-6699-4f6c-bb45-2ad7fd9158ff",
  status_url: "https://api.higgsfield.ai/requests/d7e6c0f3-6699-4f6c-bb45-2ad7fd9158ff/status",
  cancel_url: "https://api.higgsfield.ai/requests/d7e6c0f3-6699-4f6c-bb45-2ad7fd9158ff/cancel",
  expires_after: 604800,
};
const COMPLETED_IMAGES = {
  status: "completed",
  request_id: "d7e6c0f3-6699-4f6c-bb45-2ad7fd9158ff",
  expires_at: "2026-10-31T12:05:12.481Z",
  images: [{ url: "https://cdn.example.com/image-1.jpg" }, { url: "https://cdn.example.com/image-2.jpg" }],
};
const COMPLETED_VIDEO = {
  status: "completed",
  request_id: "d7e6c0f3-6699-4f6c-bb45-2ad7fd9158ff",
  video: { url: "https://cdn.example.com/video.mp4" },
};
const COMPLETED_AUDIO = {
  status: "completed",
  request_id: "d7e6c0f3-6699-4f6c-bb45-2ad7fd9158ff",
  audio: { url: "https://cdn.example.com/audio.mp3" },
  audios: [{ url: "https://cdn.example.com/audio.mp3" }],
};
// https://docs.higgsfield.ai/docs/concepts/errors.md
const FAILED = { status: "failed", request_id: "d7e6c0f3-6699-4f6c-bb45-2ad7fd9158ff", error: "Generation failed" };
const INVALID_CREDENTIALS = { detail: "Invalid credentials" };
// https://docs.higgsfield.ai/docs/models/ads-studio/generate.md
const ADS_STUDIO = {
  request_id: "REQUEST_ID",
  status_url: "https://api.higgsfield.ai/requests/REQUEST_ID/status",
  cancel_url: "https://api.higgsfield.ai/requests/REQUEST_ID/cancel",
  status: "completed",
  images: [
    { index: 0, url: "https://example.com/ad-1.png" },
    { index: 1, url: "https://example.com/ad-2.png" },
  ],
  errors: [],
};
// https://docs.higgsfield.ai/docs/concepts/rate-limits.md
const QUEUE_FULL = {
  detail: {
    code: "account_queue_full",
    message: "Too many queued generations for this account",
    retryable: true,
    limit: 40,
    retry_after_seconds: 30,
  },
};

describe("higgsfield.checkRequestStatus", () => {
  test("a submit response reports `queued` and nothing else", () => {
    expect(checkRequestStatus(ACCEPTED)).toEqual({ warnings: [], finishReason: "queued", usage: {} });
  });

  test("a completed request with output is clean, whichever kind of file it carries", () => {
    for (const sample of [COMPLETED_IMAGES, COMPLETED_VIDEO, COMPLETED_AUDIO, ADS_STUDIO]) {
      expect(checkRequestStatus(sample)).toEqual({ warnings: [], finishReason: "completed", usage: {} });
    }
  });

  test("`finishReason` is the status verbatim, for every published value and for one it does not know", () => {
    for (const status of [...HIGGSFIELD_REQUEST_STATUSES, "paused"]) {
      expect(checkRequestStatus({ status, images: [{ url: "https://cdn.example.com/a.jpg" }] }).finishReason).toBe(status);
    }
  });

  test("no response states a charge, so `costUSD` is never present", () => {
    for (const sample of [ACCEPTED, COMPLETED_IMAGES, FAILED]) expect("costUSD" in checkRequestStatus(sample)).toBe(false);
  });

  test("`failed` carries the API's error and says it is not charged", () => {
    const report = checkRequestStatus(FAILED);
    expect(report.finishReason).toBe("failed");
    expect(report.warnings).toEqual([
      {
        severity: "warning",
        code: "invalid_shape",
        path: ["error"],
        message: "The request failed: Generation failed. Failed requests are not charged; any reserved amount is refunded.",
        meta: { kind: "generation_failed", error: "Generation failed" },
      },
    ]);
  });

  test("`failed` with no error still reports", () => {
    expect(checkRequestStatus({ status: "failed", error: null }).warnings[0]?.meta).toEqual({ kind: "generation_failed" });
  });

  test("`nsfw` is moderation, with no error to read", () => {
    const report = checkRequestStatus({ status: "nsfw", request_id: "d7e6c0f3-6699-4f6c-bb45-2ad7fd9158ff" });
    expect(report.finishReason).toBe("nsfw");
    expect(report.warnings).toHaveLength(1);
    expect(report.warnings[0]?.meta).toEqual({ kind: "content_moderated" });
    expect(report.warnings[0]?.message).toContain("Higgsfield sends no `error` with this status");
  });

  test("`canceled` is its own outcome", () => {
    expect(checkRequestStatus({ status: "canceled" }).warnings[0]?.meta).toEqual({ kind: "canceled" });
  });

  test("the three other terminals each warn, and no warning is an error", () => {
    for (const status of HIGGSFIELD_TERMINAL_STATUSES) {
      const { warnings } = checkRequestStatus({ status });
      expect(warnings).toHaveLength(1);
      expect(warnings.every((issue) => issue.severity === "warning")).toBe(true);
    }
  });

  test("`completed` with no file is `empty_output`", () => {
    const report = checkRequestStatus({ status: "completed", request_id: "REQUEST_ID", images: [] });
    expect(report.warnings).toEqual([
      {
        severity: "warning",
        code: "invalid_shape",
        path: ["status"],
        message: "The request is `completed` but carries no output: none of `images`, `audios`, `video`, `audio`, `zip`, `mov`, `jsx`, `fbx` or `ply`.",
        meta: { kind: "empty_output" },
      },
    ]);
  });

  test("an artifact alone is an output: `zip`, `mov`, `jsx`, `fbx` and `ply` are not `empty_output`", () => {
    for (const key of ["zip", "mov", "jsx", "fbx", "ply"] as const) {
      expect(checkRequestStatus({ status: "completed", request_id: "REQUEST_ID", [key]: { url: "https://example.com/out" } }).warnings).toEqual([]);
    }
  });

  test("`completed` with failed batch slots is `partial_batch`, carrying the errors and the delivered slots", () => {
    const report = checkRequestStatus({ ...ADS_STUDIO, images: [{ index: 1, url: "https://example.com/ad-2.png" }], errors: ["slot 0 failed"] });
    expect(report.finishReason).toBe("completed");
    expect(report.warnings).toEqual([
      {
        severity: "warning",
        code: "invalid_shape",
        path: ["errors"],
        message: "The request is `completed` and 1 of its batch slots failed: 1 image was delivered. Each image's `index` is its slot.",
        meta: { kind: "partial_batch", errors: ["slot 0 failed"], delivered: [1] },
      },
    ]);
  });

  test("a batch in which every slot failed is `partial_batch`, not `empty_output`", () => {
    const report = checkRequestStatus({ status: "completed", images: [], errors: [{ index: 0 }, { index: 1 }] });
    expect(report.warnings.map((issue) => issue.meta?.["kind"])).toEqual(["partial_batch"]);
  });

  test("an error body is not a request: a string `detail`", () => {
    const report = checkRequestStatus(INVALID_CREDENTIALS);
    expect(report.finishReason).toBeUndefined();
    expect(report.warnings).toEqual([
      {
        severity: "warning",
        code: "invalid_shape",
        path: ["detail"],
        message: "This is an error response, not a request: Invalid credentials",
        meta: { kind: "error_response" },
      },
    ]);
  });

  test("an error body: the admission object carries its code and retry advice", () => {
    expect(checkRequestStatus(QUEUE_FULL).warnings[0]).toEqual({
      severity: "warning",
      code: "invalid_shape",
      path: ["detail"],
      message: "This is an error response (account_queue_full), not a request: Too many queued generations for this account",
      meta: { kind: "error_response", code: "account_queue_full", retryable: true, retryAfterSeconds: 30 },
    });
  });

  test("an error body: a validation list", () => {
    const detail = [{ loc: ["body", "prompt"], msg: "Field required", type: "missing" }];
    const issue = checkRequestStatus({ detail }).warnings[0];
    expect(issue?.message).toBe("This is a validation error response, not a request: `detail` lists 1 fault.");
    expect(issue?.meta).toEqual({ kind: "error_response", detail });
  });

  test("an empty object is neither", () => {
    expect(checkRequestStatus({})).toEqual({ warnings: [], usage: {} });
  });

  test("a webhook delivery's output under `payload` is an output", () => {
    // https://docs.higgsfield.ai/docs/how-to/webhooks.md
    const delivery = {
      request_id: "9417a243-e457-4075-895b-b68f3cda5303",
      status: "completed",
      error: null,
      expires_at: "2026-10-31T12:05:12.481Z",
      payload: { images: [{ url: "https://cdn.example.com/generated-image.jpg", content_type: "image/jpeg" }] },
    } as const;
    expect(checkRequestStatus(delivery)).toEqual({ warnings: [], finishReason: "completed", usage: {} });
    const video = { ...delivery, payload: { video: { url: "https://cdn.example.com/generated-video.mp4", content_type: "video/mp4" } } };
    expect(checkRequestStatus(video).warnings).toEqual([]);
    expect(checkRequestStatus({ ...delivery, payload: {} }).warnings.map((issue) => issue.meta?.["kind"])).toEqual(["empty_output"]);
  });

  test("it does not throw: a value that is not an object, and a null image, are reported", () => {
    for (const [value, got] of [[null, "null"], ["oops", "string"], [[], "an array"]] as const) {
      const report = checkRequestStatus(value as never);
      expect(report.warnings.map((issue) => [issue.meta?.["kind"], issue.message])).toEqual([
        ["not_a_status", `This is not a Higgsfield status document: got ${got}.`],
      ]);
    }
    const partial = checkRequestStatus({ status: "completed", images: [null, { index: 1 }], errors: ["x"] } as never);
    expect(partial.warnings[0]?.meta).toMatchObject({ kind: "partial_batch", delivered: [1] });
  });
});
