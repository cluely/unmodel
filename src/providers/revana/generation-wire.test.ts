import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { generationContentUrl } from "./urls";
import type { Generation, RevanaErrorBody } from "./generation-wire";

/**
 * The response types in `./generation-wire.ts`, held against documents the API actually
 * answered (`test/fixtures/revana/`, recorded 2026-11-12).
 *
 * Types cannot be asserted at runtime, so each test states one thing the type
 * claims and checks the recorded document agrees — including the two places
 * where the type follows the API rather than the OpenAPI document: `progress`,
 * which the document omits, and `cost_usd`, which is `null` until the
 * generation finishes.
 */

function fixture<Body>(name: string): { status: number; body: Body } {
  return JSON.parse(readFileSync(join(import.meta.dir, "../../../test/fixtures/revana", name), "utf8"));
}

/** Every key any arm of the union declares — `keyof` alone is only the keys all three share. */
type KeyOfAnyArm<T> = T extends unknown ? keyof T : never;

const DECLARED_KEYS: readonly KeyOfAnyArm<Generation>[] = [
  "id",
  "object",
  "model",
  "status",
  "message",
  "output",
  "quoted_usd",
  "reserved_usd",
  "cost_usd",
  "attempts",
  "progress",
  "error",
  "created_at",
  "completed_at",
];

describe("Generation, as recorded", () => {
  const created = fixture<Generation>("generation.image.created.json");
  const running = fixture<Generation>("generation.image.running.json").body;
  const succeeded = fixture<Generation>("generation.image.succeeded.json").body;
  const speech = fixture<Generation>("generation.tts.succeeded.json").body;

  test("a create answers 202 with a queued generation and no output", () => {
    expect(created.status).toBe(202);
    expect(created.body.status).toBe("queued");
    expect(created.body.output).toBeNull();
    expect(created.body.cost_usd).toBeNull();
    expect(created.body.id).toMatch(/^gen_[0-9a-f]{20}$/);
  });

  test("every key the API sent is one the type declares", () => {
    for (const generation of [created.body, running, succeeded, speech]) {
      for (const key of Object.keys(generation)) expect(DECLARED_KEYS).toContain(key as keyof Generation);
    }
  });

  test("`progress` rides on every state, though the OpenAPI document has no such field", () => {
    expect(Object.keys(running.progress ?? {}).sort()).toEqual([
      "estimated_finish_at",
      "estimated_seconds_left",
      "slower_than_usual",
      "stage",
      "typical_seconds",
    ]);
    expect(created.body.progress?.stage).toBe("queued");
    expect(succeeded.progress?.stage).toBe("succeeded");
  });

  test("a finished picture: its files, its size, and the charge", () => {
    expect(succeeded.status).toBe("succeeded");
    expect(succeeded.output?.urls).toEqual([generationContentUrl(succeeded.id)]);
    expect(succeeded.output?.width).toBe(1024);
    expect(succeeded.cost_usd).toBe(succeeded.quoted_usd);
    expect(succeeded.error).toBeNull();
  });

  test("a finished sound: a length per file, and a charge below what was reserved", () => {
    expect(speech.output?.durations_s).toEqual([speech.output?.duration_s ?? null]);
    expect(speech.cost_usd).toBe(0.01);
    expect(speech.reserved_usd).toBe(0.04);
  });
});

describe("the union on `status`, as recorded", () => {
  const documents = [
    "generation.image.created.json",
    "generation.image.running.json",
    "generation.image.succeeded.json",
    "generation.tts.succeeded.json",
    "generation.upscale.created.json",
    "generation.upscale.failed.json",
  ].map((name) => fixture<Generation>(name).body);

  test("every recorded generation is the arm its status names", () => {
    expect(documents.map((generation) => generation.status).sort()).toEqual([
      "failed",
      "queued",
      "queued",
      "running",
      "succeeded",
      "succeeded",
    ]);
    for (const generation of documents) {
      for (const key of Object.keys(generation)) expect(DECLARED_KEYS).toContain(key as KeyOfAnyArm<Generation>);
      if (generation.status === "succeeded") {
        expect(generation.output.urls.length).toBeGreaterThan(0);
        expect(typeof generation.cost_usd).toBe("number");
        expect(generation.error).toBeNull();
        expect(typeof generation.completed_at).toBe("string");
      } else if (generation.status === "failed") {
        expect(generation.output).toBeNull();
        expect(generation.cost_usd).toBe(0);
        expect(typeof generation.error.message).toBe("string");
        expect(typeof generation.completed_at).toBe("string");
      } else {
        expect(generation.output).toBeNull();
        expect(generation.cost_usd).toBeNull();
        expect(generation.error).toBeNull();
        expect(generation.completed_at).toBeNull();
      }
    }
  });

  test("a failed generation: a code, a sentence for the person who asked, and whether to retry", () => {
    const failed = fixture<Generation>("generation.upscale.failed.json").body;
    if (failed.status !== "failed") throw new Error("the fixture is the failed one");
    expect(failed.error).toEqual({
      code: "invalid_input",
      message:
        "A reference image could not be used (is not in a supported format). Host it at a direct public link to the file and send the request again. You were not charged.",
      retryable: false,
    });
    expect(failed.progress?.stage).toBe("failed");
  });
});

describe("the error body, as recorded", () => {
  test("a `max_wait_s` no route can meet is refused at the door: 503 `model_unavailable`, nothing created", () => {
    const refused = fixture<RevanaErrorBody>("generation.error.model_unavailable.json");
    expect(refused.status).toBe(503);
    expect(refused.body.error.code).toBe("model_unavailable");
    expect(refused.body.error.message).toBe("z-image has no route that can answer within max_wait_s right now.");
  });

  test("a refused create is 422 with a code, a sentence and a request id", () => {
    const refused = fixture<RevanaErrorBody>("generation.error.invalid_input.json");
    expect(refused.status).toBe(422);
    expect(refused.body.error.code).toBe("invalid_input");
    expect(refused.body.error.message).toBe("input.resolution must be one of 720p, 1080p, 4K for veo-3.1.");
    expect(refused.body.error.request_id).toMatch(/^req_[0-9a-f]{20}$/);
  });

  test("an unknown generation is 404 `not_found`", () => {
    const missing = fixture<RevanaErrorBody>("generation.error.not_found.json");
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe("not_found");
  });
});
