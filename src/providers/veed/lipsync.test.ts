/**
 * `veed.lipsync` and `veed.avatar` — two URLs, five fields between them, and
 * the two rules that make a provider this small worth validating at all.
 *
 * VEED's whole generation surface is four operations and three input schemas,
 * so there is almost nothing to get wrong — except the two things that ARE easy
 * to get wrong and are both invisible in the shape:
 *
 * 1. Every media field carries the pattern `^[Hh][Tt][Tt][Pp][Ss]?://` and a
 *    8192-character ceiling, and VEED publishes NO upload arm of any kind. So a
 *    `data:` URI, an `s3://` reference and a local path are three 422s that
 *    look like URLs.
 * 2. Every request schema is `additionalProperties: false`, so an undeclared
 *    key is a refused request rather than an ignored field — the opposite of
 *    sync. and Topaz, and the reason `checkKnownParams` reports an error here
 *    where their equivalents report warnings.
 *
 * Plus `fabric-1.0`'s `resolution`, which is `required` with no `default` and
 * is also what the price is conditioned on.
 */

import { describe, expect, test } from "bun:test";
import { lipsync } from "./lipsync";
import { avatar } from "./avatar";
import { models, provider } from "./models";
import {
  FABRIC_URL,
  LIPSYNC_URL,
  MEDIA_URL_MAX_CHARS,
  MEDIA_URL_PATTERN,
  OPENAPI_URL,
  VEED_ERROR_CODES,
  VEED_JOB_ERROR_CODES,
  VEED_JOB_STATUSES,
  VEED_MODELS,
  VEED_PRICING,
  VEED_RESOLUTIONS,
  jobUrl,
  schemaUrl,
} from "./shared";

const CLIP = "https://media.example.com/take-3.mp4";
const VOICE = "https://media.example.com/vo.mp3";
const STILL = "https://media.example.com/headshot.png";

describe("the wire", () => {
  test("the two addresses are two URLs, and the body is the params", () => {
    const clip = lipsync({ video_url: CLIP, audio_url: VOICE });
    expect(clip.request.url).toBe("https://api.veed.io/v1/lipsync-2.0");
    expect(clip.request.method).toBe("POST");
    expect(JSON.parse(JSON.stringify(clip))).toEqual({ video_url: CLIP, audio_url: VOICE });

    const still = avatar({ image_url: STILL, audio_url: VOICE, resolution: "720p" });
    expect(still.request.url).toBe("https://api.veed.io/v1/fabric-1.0");
    expect(still.request.url).not.toBe(clip.request.url);
    expect(JSON.parse(JSON.stringify(still))).toEqual({
      image_url: STILL,
      audio_url: VOICE,
      resolution: "720p",
    });
  });

  test("the model is the PATH, and never a body field", () => {
    // Four providers in this category and four shapes of route selector. Here
    // there is none: `lipsync-2.0` and `fabric-1.0` are path segments, so no
    // request VEED accepts contains the word `model` anywhere.
    const clip = JSON.parse(JSON.stringify(lipsync({ video_url: CLIP, audio_url: VOICE })));
    expect(clip).not.toHaveProperty("model");
    for (const id of VEED_MODELS) expect(LIPSYNC_URL + FABRIC_URL).toContain(id);
  });

  test("the URL constants are the ones the module publishes", () => {
    expect(LIPSYNC_URL).toBe("https://api.veed.io/v1/lipsync-2.0");
    expect(FABRIC_URL).toBe("https://api.veed.io/v1/fabric-1.0");
    // A job id is only readable at ITS OWN model's path; there is no
    // model-agnostic job route in the document.
    expect(jobUrl("fabric-1.0", "123e4567")).toBe("https://api.veed.io/v1/fabric-1.0/123e4567");
    expect(jobUrl("lipsync-2.0", "123e4567")).toBe("https://api.veed.io/v1/lipsync-2.0/123e4567");
    expect(OPENAPI_URL).toBe("https://api.veed.io/openapi.json");
    expect(schemaUrl("FabricInput")).toBe("https://api.veed.io/schemas/FabricInput.json");
  });

  test('`.toSdk("veed")` returns the body unchanged', () => {
    const params = lipsync({ video_url: CLIP, audio_url: VOICE });
    expect(params.toSdk("veed")).toEqual({ video_url: CLIP, audio_url: VOICE });
  });

  test("auth is prose, never a header unmodel writes", () => {
    const params = lipsync({ video_url: CLIP, audio_url: VOICE });
    const headers = Object.keys(params.request.headers).map((key) => key.toLowerCase());
    expect(headers).not.toContain("authorization");
    expect(params.request.headers).toEqual({ "content-type": "application/json" });
    // The env var VEED's own quick-start curl reads on every model page.
    expect(provider.env).toEqual(["VEED_API_KEY"]);
  });
});

describe("every media field is a URL VEED fetches, and only that", () => {
  test("a `data:` URI is refused, and the message says there is no upload arm", () => {
    const result = lipsync.safe({ video_url: "data:video/mp4;base64,AAAA", audio_url: VOICE });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const issue = result.errors.find((error) => error.path.join(".") === "video_url");
    expect(issue?.code).toBe("invalid_shape");
    expect(issue?.message).toContain("no upload arm at all");
    expect(issue?.message).toContain("no multipart, no base64 and no asset ids");
  });

  test("object-store references and bare paths get the other half of the message", () => {
    for (const value of ["s3://bucket/take.mp4", "/var/media/take.mp4", "take.mp4"]) {
      const result = lipsync.safe({ video_url: value, audio_url: VOICE });
      expect(result.ok, value).toBe(false);
      if (result.ok) continue;
      const issue = result.errors.find((error) => error.path.join(".") === "video_url");
      expect(issue?.message, value).toContain("Object-store references");
    }
  });

  test("`http://` is accepted, because VEED's own pattern accepts it", () => {
    // The regex is transcribed verbatim — `^[Hh][Tt][Tt][Pp][Ss]?://` — so what
    // this check refuses is exactly what VEED refuses, no more.
    expect(MEDIA_URL_PATTERN.test("http://example.com/a.mp4")).toBe(true);
    expect(MEDIA_URL_PATTERN.test("HTTPS://EXAMPLE.COM/a.mp4")).toBe(true);
    const result = lipsync.safe({ video_url: "http://example.com/a.mp4", audio_url: VOICE });
    expect(result.ok).toBe(true);
  });

  test("the 8192-character ceiling is a real refusal, not a warning", () => {
    const long = `https://example.com/${"a".repeat(MEDIA_URL_MAX_CHARS)}`;
    const result = lipsync.safe({ video_url: long, audio_url: VOICE });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(
      result.errors.some((error) => error.message.includes("Signed URLs with long query strings")),
    ).toBe(true);
  });
});

describe("`additionalProperties: false` is an ERROR here, not a warning", () => {
  test("an undeclared key is refused, and the message lists the fields", () => {
    const result = lipsync.safe({
      video_url: CLIP,
      audio_url: VOICE,
      sync_mode: "bounce",
    } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const issue = result.errors.find((error) => error.path.join(".") === "sync_mode");
    expect(issue?.code).toBe("unsupported_param");
    expect(issue?.message).toContain("additionalProperties: false");
    expect(issue?.message).toContain("`video_url`, `audio_url`");
  });

  test("`$schema` is NOT undeclared, because VEED declares it", () => {
    // Every input schema carries a read-only `$schema`. A caller round-tripping
    // a response body into a request would otherwise be refused for a field
    // VEED itself wrote.
    const result = lipsync.safe({
      video_url: CLIP,
      audio_url: VOICE,
      $schema: "https://api.veed.io/schemas/Lipsync20Input.json",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toEqual([]);
  });

  test("the fabric route lists its own three fields, not the clip route's", () => {
    const result = avatar.safe({
      image_url: STILL,
      audio_url: VOICE,
      resolution: "720p",
      video_url: CLIP,
    } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const issue = result.errors.find((error) => error.path.join(".") === "video_url");
    expect(issue?.message).toContain("`image_url`, `audio_url`, `resolution`");
  });
});

describe("`resolution` is required, has no default, and sets the price", () => {
  test("both values compile, and the enum is closed", () => {
    for (const resolution of VEED_RESOLUTIONS) {
      const result = avatar.safe({ image_url: STILL, audio_url: VOICE, resolution });
      expect(result.ok, resolution).toBe(true);
    }
    const wrong = avatar.safe({
      image_url: STILL,
      audio_url: VOICE,
      resolution: "1080p",
    } as never);
    expect(wrong.ok).toBe(false);
  });

  test("it is on the constraint table, so a form can draw the choice", () => {
    const [row] = avatar.constraintsFor("fabric-1.0");
    expect(row?.enums?.["resolution"]).toEqual(["480p", "720p"]);
  });

  test("the two values are a 2× price difference, and the table says so", () => {
    expect(VEED_PRICING["fabric-1.0"].perSecondUSD).toEqual({ "480p": 0.08, "720p": 0.15 });
    expect(VEED_PRICING["lipsync-2.0"].perSecondUSD).toBe(0.07);
    // The catalog row carries the TOP of the band, because `ModelCost` holds
    // one number and an upper bound is the right kind of wrong.
    expect(models["fabric-1.0"].cost?.perVideoSecond).toBe(0.15);
    expect(models["lipsync-2.0"].cost?.perVideoSecond).toBe(0.07);
  });
});

describe("what this provider does not do", () => {
  test("neither address estimates, though both rates are exact", () => {
    // The rate is per second of GENERATED video and the generated video's
    // length is the input's, behind a URL unmodel never fetches. VEED publishes
    // no pre-flight quote endpoint either.
    const clip = lipsync.safe({ video_url: CLIP, audio_url: VOICE });
    expect(clip.ok).toBe(true);
    if (!clip.ok) return;
    expect(clip.estimate?.costUSD).toBeUndefined();

    const still = avatar.safe({ image_url: STILL, audio_url: VOICE, resolution: "480p" });
    expect(still.ok).toBe(true);
    if (!still.ok) return;
    expect(still.estimate?.costUSD).toBeUndefined();
  });

  test("the catalog is the two models the spec publishes as generators", () => {
    expect(Object.keys(models).sort()).toEqual(["fabric-1.0", "lipsync-2.0"]);
    expect([...VEED_MODELS].sort()).toEqual(["fabric-1.0", "lipsync-2.0"]);
    // The clip route reads a video, the still route reads an image, and that
    // is the whole split `unmodel/lipsync` and `unmodel/avatar` make.
    expect(models["lipsync-2.0"].modalities?.input).toContain("video");
    expect(models["fabric-1.0"].modalities?.input).toContain("image");
    expect(models["lipsync-2.0"].modalities?.input).not.toContain("image");
  });
});

describe("the failure surface has two channels", () => {
  test("the HTTP codes and the job codes are disjoint vocabularies", () => {
    // A submit rejected at the HTTP layer creates no job and carries a
    // `VEED_ERROR_CODES` code; a job that was ACCEPTED and then failed carries
    // a `VEED_JOB_ERROR_CODES` code and arrives through the GET with a 200.
    // Code that only checks `res.ok` sees half the failures.
    const http = new Set<string>(VEED_ERROR_CODES);
    for (const code of VEED_JOB_ERROR_CODES) expect(http.has(code)).toBe(false);
    expect(VEED_ERROR_CODES).toContain("rate_limited");
    expect(VEED_JOB_ERROR_CODES).toContain("audio_too_long");
  });

  test("`CANCELLED` is in the status union although no cancel route exists", () => {
    // It is in the spec's enum on all three job schemas, so it is in the union;
    // a `switch` that omitted it would fall through the day VEED ships one.
    expect(VEED_JOB_STATUSES).toContain("CANCELLED");
    expect(VEED_JOB_STATUSES).toEqual(["PROCESSING", "COMPLETED", "FAILED", "CANCELLED"]);
  });
});
