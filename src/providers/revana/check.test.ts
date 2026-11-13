import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkGeneration, checkQueueStatus, type GenerationLike, type QueueEnvelopeLike } from "./check";

/**
 * The two checkers, against documents the API answered
 * (`test/fixtures/revana/`, recorded 2026-11-12 and 2026-11-13). The failed
 * job on each route is real: an upscale of a link that downloads and is not a
 * picture, which passes admission and fails in the model, for nothing.
 */

function body<Body>(name: string): Body {
  return (JSON.parse(readFileSync(join(import.meta.dir, "../../../test/fixtures/revana", name), "utf8")) as { body: Body }).body;
}

const kinds = (report: { warnings: { meta?: Record<string, unknown> }[] }): unknown[] =>
  report.warnings.map((warning) => warning.meta?.["kind"]);

describe("checkGeneration", () => {
  test("a queued or running generation: its status, no cost yet, nothing to warn about", () => {
    for (const [name, status] of [
      ["generation.image.created.json", "queued"],
      ["generation.image.running.json", "running"],
    ] as const) {
      const report = checkGeneration(body<GenerationLike>(name));
      expect(report).toEqual({ warnings: [], finishReason: status, usage: {} });
      expect("costUSD" in report).toBe(false);
    }
  });

  test("a finished one: `costUSD` is the charge the API states, not a catalog estimate", () => {
    expect(checkGeneration(body<GenerationLike>("generation.image.succeeded.json"))).toEqual({
      warnings: [],
      finishReason: "succeeded",
      usage: {},
      costUSD: 0.01,
    });
    // Reserved at 0.04 and charged 0.01: the charge is what is reported.
    expect(checkGeneration(body<GenerationLike>("generation.tts.succeeded.json")).costUSD).toBe(0.01);
  });

  test("a failed one: the code, whether to retry, and a charge of zero", () => {
    const report = checkGeneration(body<GenerationLike>("generation.upscale.failed.json"));
    expect(report.finishReason).toBe("failed");
    expect(report.costUSD).toBe(0);
    expect(report.warnings).toEqual([
      {
        severity: "warning",
        code: "invalid_shape",
        path: ["error"],
        message:
          "The generation failed (invalid_input): A reference image could not be used (is not in a supported format). " +
          "Host it at a direct public link to the file and send the request again. You were not charged. The request has to change.",
        meta: { kind: "generation_failed", code: "invalid_input", retryable: false },
      },
    ]);
  });

  test("a retryable failure says so, and a content refusal carries its reason", () => {
    const busy = checkGeneration({ status: "failed", cost_usd: 0, error: { code: "model_busy", message: "Busy.", retryable: true } });
    expect(busy.warnings[0]?.message).toBe("The generation failed (model_busy): Busy. The same request can work later.");
    const policy = checkGeneration({
      status: "failed",
      error: { code: "content_policy", message: "Refused.", retryable: false, reason: "real_person" },
    });
    expect(policy.warnings[0]?.meta).toEqual({
      kind: "generation_failed",
      code: "content_policy",
      retryable: false,
      reason: "real_person",
    });
  });

  test("a success that lists no file is said, not passed over", () => {
    expect(kinds(checkGeneration({ status: "succeeded", output: { urls: [] }, cost_usd: 0.01 }))).toEqual(["empty_output"]);
    expect(kinds(checkGeneration({ status: "succeeded", output: null }))).toEqual(["empty_output"]);
  });

  test("an error body is named as one, with its code and request id", () => {
    for (const name of ["generation.error.invalid_input.json", "generation.error.not_found.json", "generation.error.model_unavailable.json"]) {
      const report = checkGeneration(body<GenerationLike>(name));
      expect(kinds(report)).toEqual(["error_response"]);
      expect(report.finishReason).toBeUndefined();
      expect(report.costUSD).toBeUndefined();
    }
    const refused = checkGeneration(body<GenerationLike>("generation.error.invalid_input.json"));
    expect(refused.warnings[0]?.message).toBe(
      "This is an error response (invalid_input), not a job: input.resolution must be one of 720p, 1080p, 4K for veo-3.1.",
    );
    expect(refused.warnings[0]?.meta).toEqual({
      kind: "error_response",
      code: "invalid_input",
      requestId: "req_792e718160e62022801c",
    });
  });

  test("never throws on a document it does not recognise", () => {
    expect(checkGeneration({})).toEqual({ warnings: [], usage: {} });
    expect(checkGeneration({ status: "paused" }).finishReason).toBe("paused");
  });
});

describe("checkQueueStatus", () => {
  test("a submitted, replayed or running request mirrors the envelope's status", () => {
    expect(checkQueueStatus(body<QueueEnvelopeLike>("queue.image.submitted.json"))).toEqual({
      warnings: [],
      finishReason: "IN_QUEUE",
      usage: {},
    });
    expect(checkQueueStatus(body<QueueEnvelopeLike>("queue.image.status.early.json")).finishReason).toBe("IN_PROGRESS");
  });

  test("`COMPLETED` without an error is the request that worked", () => {
    expect(checkQueueStatus(body<QueueEnvelopeLike>("queue.image.status.completed.json"))).toEqual({
      warnings: [],
      finishReason: "COMPLETED",
      usage: {},
    });
  });

  test("`COMPLETED` with an error is reported as `ERROR`, the same wire status notwithstanding", () => {
    const failed = body<QueueEnvelopeLike>("queue.upscale.status.failed.json");
    expect(failed.status).toBe("COMPLETED");
    const report = checkQueueStatus(failed);
    expect(report.finishReason).toBe("ERROR");
    expect(report.warnings).toEqual([
      {
        severity: "warning",
        code: "invalid_shape",
        path: ["error"],
        message:
          "The request is `COMPLETED` and it failed (invalid_input): A reference image could not be used (is not in a supported format). " +
          "Host it at a direct public link to the file and send the request again. You were not charged. " +
          "Its `response_url` answers 422, not a result.",
        meta: { kind: "generation_failed", code: "invalid_input" },
      },
    ]);
  });

  test("no queue document states a cost, so none is reported", () => {
    for (const name of ["queue.image.status.completed.json", "queue.upscale.status.failed.json"]) {
      expect(checkQueueStatus(body<QueueEnvelopeLike>(name)).costUSD).toBeUndefined();
    }
  });

  test("an error body — not ready, failed, not found, refused — is named as one", () => {
    for (const [name, code] of [
      ["queue.image.result.not_ready.json", "not_ready"],
      ["queue.upscale.result.failed.json", "invalid_input"],
      ["queue.error.not_found.json", "not_found"],
      ["queue.error.model_unavailable.json", "model_unavailable"],
      ["queue.image.cancel.json", "cancellation_not_supported"],
    ] as const) {
      const report = checkQueueStatus(body<QueueEnvelopeLike>(name));
      expect(report.finishReason).toBeUndefined();
      expect(report.warnings.map((warning) => warning.meta)).toMatchObject([{ kind: "error_response", code }]);
    }
  });

  test("never throws on a document it does not recognise", () => {
    expect(checkQueueStatus({})).toEqual({ warnings: [], usage: {} });
    expect(checkQueueStatus({ status: "FROZEN" }).finishReason).toBe("FROZEN");
  });
});
