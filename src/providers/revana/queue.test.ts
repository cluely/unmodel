import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { image } from "./image";
import { imageQueue } from "./image-queue";
import { musicQueue } from "./music-queue";
import { ttsQueue } from "./tts-queue";
import { video } from "./video";
import { videoQueue } from "./video-queue";
import { REVANA_IMAGE_MODELS, REVANA_MUSIC_MODELS, REVANA_TTS_MODELS, REVANA_VIDEO_MODELS } from "./gen/ids.gen";
import { queueResultUrl, queueStatusUrl, queueUrl } from "./urls";
import type { QueueEnvelope, QueueErrorBody, QueueImageResult } from "./queue-wire";
import type { ValidateResult } from "../../core/result";

/**
 * The queue addresses — `POST /v1/queue/revana/{model_id}`.
 *
 * Three things are pinned here: what leaves the validator (the body and the
 * URL, since two params live in the URL), the rules that are the queue's own
 * (`fal_webhook`, `num_images`, a string `duration`), and that everything else
 * is the generation route's battery — by replaying what the API itself
 * answered on this route (`test/fixtures/revana/queue-oracle.json`).
 */

type Loose = (params: unknown) => ValidateResult<Record<string, unknown> & { request: { url: string } }>;

const FIXTURES = join(import.meta.dir, "../../../test/fixtures/revana");

function fixture<T>(name: string): { status: number; body: T } {
  return JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as { status: number; body: T };
}

function queueFor(model: string): Loose {
  const has = (ids: readonly string[]): boolean => ids.includes(model);
  const validator = has(REVANA_VIDEO_MODELS)
    ? videoQueue
    : has(REVANA_IMAGE_MODELS)
      ? imageQueue
      : has(REVANA_TTS_MODELS)
        ? ttsQueue
        : has(REVANA_MUSIC_MODELS)
          ? musicQueue
          : undefined;
  if (validator === undefined) throw new Error(`"${model}" is no longer in the Revana catalog — re-record its rows`);
  return validator.safe as unknown as Loose;
}

/** `code@path` of each error. */
function errors(params: Record<string, unknown> & { model: string }): string[] {
  const result = queueFor(params.model)(params);
  return result.ok ? [] : result.errors.map((issue) => `${issue.code}@${issue.path.join(".")}`);
}

const HOOK = "https://your-app.example/revana";

describe("what is sent", () => {
  test("the body is the input fields and the limits; `model` and `fal_webhook` are in the URL", () => {
    const body = videoQueue({
      model: "veo-3.1",
      prompt: "A fox walks through snow",
      resolution: "1080p",
      duration: 8,
      audio: true,
      max_cost_usd: 4,
      max_wait_s: 600,
      fal_webhook: `${HOOK}?job=1&kind=video`,
    });
    expect(JSON.parse(JSON.stringify(body))).toEqual({
      prompt: "A fox walks through snow",
      resolution: "1080p",
      duration: 8,
      audio: true,
      max_cost_usd: 4,
      max_wait_s: 600,
    });
    expect(body.request).toEqual({
      url: "https://api.revana.si/v1/queue/revana/veo-3.1?fal_webhook=https%3A%2F%2Fyour-app.example%2Frevana%3Fjob%3D1%26kind%3Dvideo",
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    expect(body.toSdk("revana")).toEqual(JSON.parse(JSON.stringify(body)));
  });

  test("without a webhook the URL is the model's path and nothing else", () => {
    const body = imageQueue({ model: "z-image", prompt: "A red paper kite over a grey sea" });
    expect(body.request.url).toBe("https://api.revana.si/v1/queue/revana/z-image");
    expect(Object.keys(body)).toEqual(["prompt"]);
  });

  test("nothing is rewritten: fal's spellings go out as the caller wrote them", () => {
    const body = videoQueue({ model: "veo-3.1", prompt: "a", duration: "8s", generate_audio: true, num_images: 1 });
    expect(JSON.parse(JSON.stringify(body))).toEqual({ prompt: "a", duration: "8s", generate_audio: true, num_images: 1 });
  });

  test("an id the catalog lacks still gets its own path, percent-encoded", () => {
    const result = (videoQueue.safe as unknown as Loose)({ model: "new model/v2", prompt: "a" });
    expect(result.ok && result.params.request.url).toBe("https://api.revana.si/v1/queue/revana/new%20model%2Fv2");
  });

  test("the URL builders agree with the URLs the API hands back", () => {
    const { body } = fixture<QueueEnvelope>("queue.image.submitted.json");
    expect(body.response_url).toBe(queueResultUrl("z-image", body.request_id));
    expect(body.status_url).toBe(queueStatusUrl("z-image", body.request_id));
    expect(queueUrl("z-image", HOOK)).toBe(`https://api.revana.si/v1/queue/revana/z-image?fal_webhook=${encodeURIComponent(HOOK)}`);
  });
});

describe("the wrapper is the generation route's", () => {
  test("a `{ model, input }` body is refused, and pointed at the address that takes it", () => {
    const result = (videoQueue.safe as unknown as Loose)({ model: "veo-3.1", input: { prompt: "a" } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const wrapped = result.errors.find((issue) => issue.path.join(".") === "input");
    expect(wrapped?.message).toContain("`revana.video`");
    // …and the same body is what `revana.video` accepts.
    expect(video.safe({ model: "veo-3.1", input: { prompt: "a" } }).ok).toBe(true);
  });

  test("findings point at the flat field and never say `input.`", () => {
    const result = (videoQueue.safe as unknown as Loose)({
      model: "veo-3.1",
      prompt: "a",
      resolution: "480p",
      duration: 5,
      image_urls: ["http://example.com/a.png"],
      negative_prompt: "blur",
      foo: 1,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const all = [...result.errors, ...result.warnings];
    expect(all.map((issue) => issue.path[0])).not.toContain("input");
    expect(all.filter((issue) => issue.message.includes("input.")).map((issue) => issue.message)).toEqual([]);
    expect(result.errors.map((issue) => issue.path.join(".")).sort()).toEqual([
      "duration",
      "image_urls",
      "image_urls.0",
      "resolution",
    ]);
    expect(result.warnings.map((issue) => issue.path.join(".")).sort()).toEqual(["foo", "negative_prompt"]);
  });

  test("a foreign id is pointed at the QUEUE address that types it", () => {
    const result = (videoQueue.safe as unknown as Loose)({ model: "z-image", prompt: "a" });
    expect(result.ok).toBe(true);
    expect(result.warnings.map((issue) => issue.message).join(" ")).toContain("`revana.imageQueue`");
  });
});

describe("`fal_webhook`", () => {
  const base = { model: "z-image", prompt: "a" };

  test.each([
    ["https://your-app.example/revana"],
    ["https://your-app.example:443/revana"],
    ["https://your-app.example/revana?job=1&kind=image"],
    ["https://1.1.1.1/hook"],
  ])("%s is taken", (hook) => {
    expect(errors({ ...base, fal_webhook: hook })).toEqual([]);
  });

  // Each of these answered "Webhook must be a reachable public HTTPS URL on
  // port 443 without credentials or fragments." on 2026-11-12, before the body
  // was looked at and before anything was created.
  test.each([
    ["http://your-app.example/revana", "`https:`"],
    ["https://user:pass@your-app.example/revana", "credentials"],
    ["https://your-app.example/revana#done", "fragment"],
    ["https://your-app.example:8443/revana", "port 443"],
    ["https://[2606:4700:4700::1111]/revana", "IPv6"],
    ["https://10.0.0.1/revana", "public"],
    ["https://localhost/revana", "public"],
    ["not a url", "not a URL"],
    ["", "not a URL"],
  ])("%s is refused", (hook, why) => {
    const result = queueFor("z-image")({ ...base, fal_webhook: hook });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((issue) => issue.path.join("."))).toEqual(["fal_webhook"]);
    expect(result.errors[0]?.message).toContain(why);
  });

  test("the generation route has no such field: there it is an unknown key", () => {
    const result = (image.safe as unknown as Loose)({ model: "z-image", input: { prompt: "a" }, fal_webhook: HOOK });
    expect(result.warnings.map((issue) => issue.code)).toContain("unknown_param");
  });
});

describe("the two fields the queue reads its own way", () => {
  test("`num_images` is taken only as 1 — on a model that makes four per request elsewhere", () => {
    expect(errors({ model: "seedream-4.5", prompt: "a", num_images: 1 })).toEqual([]);
    expect(errors({ model: "seedream-4.5", prompt: "a", num_images: 4 })).toEqual(["unsupported_param@num_images"]);
    expect(image.safe({ model: "seedream-4.5", input: { prompt: "a", num_images: 4 } }).ok).toBe(true);
  });

  test("…and is then dropped, so it rides beside `n` and on a schema that has no such key", () => {
    expect(errors({ model: "z-image", prompt: "a", num_images: 1, n: 2 })).toEqual([]);
    expect(errors({ model: "seedance-2.5", prompt: "a", num_images: 1 })).toEqual([]);
    expect(errors({ model: "seedance-2.5", prompt: "a", n: 1 })).toEqual(["unsupported_param@n"]);
  });

  test("a string `duration` is seconds, held to the model's own list", () => {
    expect(errors({ model: "veo-3.1", prompt: "a", duration: "8" })).toEqual([]);
    expect(errors({ model: "veo-3.1", prompt: "a", duration: "8s" })).toEqual([]);
    expect(errors({ model: "veo-3.1", prompt: "a", duration: "7" })).toEqual(["invalid_enum_value@duration"]);
    expect(errors({ model: "veo-3.1", prompt: "a", duration: "8.0s" })).toEqual(["invalid_shape@duration"]);
    expect(errors({ model: "z-image", prompt: "a", duration: "5" })).toEqual(["unsupported_param@duration"]);
    // The generation route takes a number and nothing else.
    expect((video.safe as unknown as Loose)({ model: "veo-3.1", input: { prompt: "a", duration: "8" } }).ok).toBe(false);
  });

  test("the estimate reads the body the way the route does", () => {
    const priced = (params: Record<string, unknown> & { model: string }): number | undefined => {
      const result = queueFor(params.model)(params);
      return result.ok ? result.estimate.costUSD : undefined;
    };
    const veo = { model: "veo-3.1", prompt: "a", resolution: "720p" };
    expect(priced({ ...veo, duration: "8s", generate_audio: true })).toBe(priced({ ...veo, duration: 8, audio: true }));
    expect(priced({ ...veo, duration: 8, audio: true })).toBe(3.2);
    expect(priced({ model: "z-image", prompt: "a", num_images: 1, n: 2 })).toBe(0.02);
  });
});

interface OracleRow {
  model: string;
  case: string;
  input: Record<string, unknown>;
  status: number;
  passes: boolean;
  level?: "model" | "route";
  message?: string;
}

describe("the recorded queue oracle", () => {
  const rows = JSON.parse(readFileSync(join(FIXTURES, "queue-oracle.json"), "utf8")) as OracleRow[];
  const label = (row: OracleRow): string => `${row.model} [${row.case}] ${JSON.stringify(row.input)}`;
  const ok = (row: OracleRow): boolean => queueFor(row.model)({ model: row.model, ...row.input }).ok;

  test("is the sample the README describes", () => {
    expect(rows.length).toBe(176);
    expect(new Set(rows.map((row) => row.model)).size).toBe(24);
    expect(rows.every((row) => row.status === 422)).toBe(true);
  });

  test("unmodel never refuses a body the queue route accepted", () => {
    expect(rows.filter((row) => row.passes && !ok(row)).map(label)).toEqual([]);
  });

  test("unmodel refuses every body the queue route refused at model level", () => {
    // An unknown key is the one refusal unmodel reports as a WARNING, here as
    // everywhere: Revana adds fields faster than a snapshot tracks them.
    const refusals = rows.filter((row) => row.level === "model" && row.case !== "unknown-key");
    expect(refusals.filter(ok).map((row) => `${label(row)} — API: ${row.message}`)).toEqual([]);

    const unknown = queueFor("veo-3.1")({ model: "veo-3.1", prompt: "a fox", foo: 1 });
    expect(unknown.warnings.map((issue) => `${issue.code}@${issue.path.join(".")}`)).toContain("unknown_param@foo");
  });

  test("the queue answers the generation route's own sentences", () => {
    const quote = JSON.parse(readFileSync(join(FIXTURES, "quote-oracle.json"), "utf8")) as OracleRow[];
    const sentence = new Map(quote.map((row) => [`${row.model}|${JSON.stringify(row.input)}`, row.message]));
    const shared = rows.filter(
      (row) => !row.passes && !/^(count|dur-string)/.test(row.case) && sentence.has(`${row.model}|${JSON.stringify(row.input)}`),
    );
    expect(shared.length).toBeGreaterThan(10);
    for (const row of shared) {
      expect(row.message).toBe(sentence.get(`${row.model}|${JSON.stringify(row.input)}`));
    }
  });
});

describe("the recorded responses", () => {
  test("a submit answers fal's envelope, and a replay the same request", () => {
    const submitted = fixture<QueueEnvelope>("queue.image.submitted.json");
    const replayed = fixture<QueueEnvelope>("queue.image.replayed.json");
    expect(submitted.status).toBe(202);
    expect(submitted.body.status).toBe("IN_QUEUE");
    expect(replayed.status).toBe(200);
    expect(replayed.body.request_id).toBe(submitted.body.request_id);
    // The request id is a generation id.
    expect(submitted.body.request_id).toMatch(/^gen_[0-9a-f]{20}$/);
  });

  test("the result is keyed by kind and states no cost", () => {
    const { body } = fixture<QueueImageResult>("queue.image.result.json");
    expect(body.images).toHaveLength(1);
    expect(body.images[0]?.content_type).toBe("image/png");
    expect(JSON.stringify(body)).not.toContain("cost");
  });

  test("not ready is a 409, cancelling a 405, and both carry `detail` beside `error`", () => {
    const early = fixture<QueueErrorBody>("queue.image.result.not_ready.json");
    const cancel = fixture<QueueErrorBody>("queue.image.cancel.json");
    expect([early.status, early.body.error.code]).toEqual([409, "not_ready"]);
    expect([cancel.status, cancel.body.error.code]).toEqual([405, "cancellation_not_supported"]);
    expect(early.body.detail).toBe(early.body.error.message);
  });
});
