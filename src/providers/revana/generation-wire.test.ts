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

const DECLARED_KEYS: readonly (keyof Generation)[] = [
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

describe("the error body, as recorded", () => {
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
