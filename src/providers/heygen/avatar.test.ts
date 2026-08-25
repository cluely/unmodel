/**
 * `heygen.avatar` and `heygen.lipsync` — two URLs, two lifecycles, and the
 * seven cross-field rules that are why this provider is validated rather than
 * passed through.
 *
 * HeyGen's spec is the most complete in this wave (98 paths, 300 schemas) and
 * every one of these rules is stated in it and expressible in none of it: they
 * are `description` prose on fields that are all individually optional. Each is
 * a 400 or a silent no-op if broken.
 *
 * - `type` decides which visual source is REQUIRED and which is refused —
 *   HeyGen's own documented example error is exactly that mistake.
 * - Avatar III does not render raw image input.
 * - `expressiveness` is Avatar IV only and `motion_prompt` is not Avatar III;
 *   both are REJECTED rather than ignored.
 * - `script` and the audio fields are mutually exclusive; `voice_id` is
 *   required with a script unless `avatar_id` supplies a default voice; and
 *   `voice_settings` is silently ignored when the audio is uploaded.
 * - `output_format: "webm"` rejects `background`.
 * - `enable_caption` on the lipsync route is deprecated AND ignored.
 */

import { describe, expect, test } from "bun:test";
import { avatar } from "./avatar";
import { lipsync } from "./lipsync";
import { models, provider } from "./models";
import {
  AVATAR_LOOKS_URL,
  HEYGEN_DEFAULT_ENGINE,
  HEYGEN_ENGINES,
  HEYGEN_LIPSYNC_MODELS,
  HEYGEN_LIPSYNC_MODE_BY_MODEL,
  HEYGEN_LIPSYNC_STATUSES,
  HEYGEN_OPENAPI_URL,
  HEYGEN_VIDEO_STATUSES,
  LIPSYNCS_URL,
  VIDEOS_URL,
  lipsyncUrl,
  videoUrl,
} from "./shared";

const STILL = { type: "url", url: "https://media.example.com/headshot.png" } as const;
const VOICE = "https://media.example.com/vo.mp3";
const CLIP = { type: "url", url: "https://media.example.com/take-3.mp4" } as const;
const TRACK = { type: "url", url: "https://media.example.com/vo-french.mp3" } as const;

describe("the wire", () => {
  test("the two addresses are two URLs, and the body is the params", () => {
    const still = avatar({ type: "image", image: STILL, audio_url: VOICE });
    expect(still.request.url).toBe("https://api.heygen.com/v3/videos");
    expect(still.request.method).toBe("POST");
    expect(JSON.parse(JSON.stringify(still))).toEqual({
      type: "image",
      image: STILL,
      audio_url: VOICE,
    });

    const clip = lipsync({ video: CLIP, audio: TRACK });
    expect(clip.request.url).toBe("https://api.heygen.com/v3/lipsyncs");
    expect(clip.request.url).not.toBe(still.request.url);
  });

  test("the URL constants are the ones the module publishes", () => {
    expect(VIDEOS_URL).toBe("https://api.heygen.com/v3/videos");
    expect(videoUrl("v_abc123")).toBe("https://api.heygen.com/v3/videos/v_abc123");
    expect(LIPSYNCS_URL).toBe("https://api.heygen.com/v3/lipsyncs");
    expect(lipsyncUrl("l_abc123")).toBe("https://api.heygen.com/v3/lipsyncs/l_abc123");
    expect(AVATAR_LOOKS_URL).toBe("https://api.heygen.com/v3/avatars/looks");
    // Pinned because the OTHER document HeyGen serves also answers 200 and is a
    // v1/v2 spec with no `/v3/videos` in it at all.
    expect(HEYGEN_OPENAPI_URL).toBe("https://developers.heygen.com/openapi/external-api.json");
  });

  test('`.toSdk("heygen")` returns the body unchanged', () => {
    const params = lipsync({ video: CLIP, audio: TRACK, mode: "precision" });
    expect(params.toSdk("heygen")).toEqual({ video: CLIP, audio: TRACK, mode: "precision" });
  });

  test("auth is prose, never a header unmodel writes", () => {
    const params = lipsync({ video: CLIP, audio: TRACK });
    const headers = Object.keys(params.request.headers).map((key) => key.toLowerCase());
    expect(headers).not.toContain("x-api-key");
    expect(headers).not.toContain("authorization");
    expect(params.request.headers).toEqual({ "content-type": "application/json" });
    expect(provider.env).toEqual(["HEYGEN_API_KEY"]);
  });

  test("the doc URLs are the ones that survived the host migration", () => {
    // docs.heygen.com 301s to developers.heygen.com AND the old slugs 404
    // there, so a substitution rewrite would have produced dead links.
    expect(provider.doc).toBe("https://developers.heygen.com/reference/create-video");
    expect(provider.doc).not.toContain("docs.heygen.com");
    expect(provider.doc).not.toContain("create-an-avatar-video-v2");
  });
});

describe("`type` decides what is required and what is refused", () => {
  test("the avatar arm needs a look and refuses a picture", () => {
    const missing = avatar.safe({ type: "avatar", audio_url: VOICE } as never);
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    const issue = missing.errors.find((error) => error.path.join(".") === "avatar_id");
    expect(issue?.code).toBe("invalid_shape");
    expect(issue?.message).toContain("GET /v3/avatars/looks");

    const crossed = avatar.safe({
      type: "avatar",
      avatar_id: "abc123",
      image: STILL,
      audio_url: VOICE,
    });
    expect(crossed.ok).toBe(false);
    if (crossed.ok) return;
    const wrong = crossed.errors.find((error) => error.path.join(".") === "image");
    expect(wrong?.code).toBe("unsupported_param");
    expect(wrong?.message).toContain("additionalProperties: false");
  });

  test("the image arm needs a picture and refuses a look", () => {
    const missing = avatar.safe({ type: "image", audio_url: VOICE } as never);
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.errors.map((error) => error.path.join("."))).toContain("image");

    const crossed = avatar.safe({
      type: "image",
      image: STILL,
      avatar_id: "abc123",
      audio_url: VOICE,
    });
    expect(crossed.ok).toBe(false);
    if (crossed.ok) return;
    expect(crossed.errors.map((error) => error.path.join("."))).toContain("avatar_id");
  });

  test("all three inline arms of `image` are accepted, because the spec has them", () => {
    for (const image of [
      STILL,
      { type: "asset_id", asset_id: "asset_123" },
      { type: "base64", media_type: "image/png", data: "AAAA" },
    ] as const) {
      const result = avatar.safe({ type: "image", image, audio_url: VOICE });
      expect(result.ok, image.type).toBe(true);
    }
  });
});

describe("the engine is the model, and an omitted one is a price decision", () => {
  test("an omitted `engine` resolves to Avatar IV's catalog row", () => {
    // `modelId` falls back to the documented server-side default rather than to
    // `unknown_model`, so a request that says nothing still gets a rate.
    const result = avatar.safe({ type: "image", image: STILL, audio_url: VOICE });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.some((issue) => issue.code === "unknown_model")).toBe(false);
    expect(HEYGEN_DEFAULT_ENGINE).toBe("avatar_iv");
  });

  test("Avatar III does not render raw image input, and says which engines do", () => {
    const result = avatar.safe({
      type: "image",
      image: STILL,
      audio_url: VOICE,
      engine: { type: "avatar_iii" },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const issue = result.errors.find((error) => error.path.join(".") === "engine.type");
    expect(issue?.code).toBe("unsupported_capability");
    expect(issue?.message).toContain("avatar_iv");
    expect(issue?.message).toContain("avatar_v");
    // …and it is perfectly happy on the catalogued-look arm.
    const ok = avatar.safe({
      type: "avatar",
      avatar_id: "abc123",
      audio_url: VOICE,
      engine: { type: "avatar_iii" },
    });
    expect(ok.ok).toBe(true);
  });

  test("`expressiveness` and `motion_prompt` are REJECTED, not ignored", () => {
    const onV = avatar.safe({
      type: "image",
      image: STILL,
      audio_url: VOICE,
      engine: { type: "avatar_v" },
      expressiveness: "high",
    });
    expect(onV.ok).toBe(false);
    if (onV.ok) return;
    const issue = onV.errors.find((error) => error.path.join(".") === "expressiveness");
    expect(issue?.code).toBe("unsupported_param");
    expect(issue?.message).toContain("REJECTS it rather than ignoring it");

    const onIII = avatar.safe({
      type: "avatar",
      avatar_id: "abc123",
      audio_url: VOICE,
      engine: { type: "avatar_iii" },
      motion_prompt: "gestures while speaking",
    });
    expect(onIII.ok).toBe(false);
    if (onIII.ok) return;
    expect(onIII.errors.map((error) => error.path.join("."))).toContain("motion_prompt");

    // Both are legal where the docs say they are.
    const fine = avatar.safe({
      type: "image",
      image: STILL,
      audio_url: VOICE,
      engine: { type: "avatar_iv" },
      expressiveness: "medium",
      motion_prompt: "gestures while speaking",
    });
    expect(fine.ok).toBe(true);
  });

  test("the three engines are three catalog rows with three rates", () => {
    expect([...HEYGEN_ENGINES]).toEqual(["avatar_iii", "avatar_iv", "avatar_v"]);
    // Avatar III is the cheap one by a factor of four at the low end of its
    // band; the rows carry the TOP of each band because the avatar type is a
    // property of the LOOK rather than of the request.
    expect(models.avatar_iii.cost?.perVideoSecond).toBe(0.0433);
    expect(models.avatar_iv.cost?.perVideoSecond).toBe(0.0667);
    expect(models.avatar_v.cost?.perVideoSecond).toBe(0.0667);
  });
});

describe("the speech is a script OR a track, and never both", () => {
  test("a script and a track together is refused", () => {
    const result = avatar.safe({
      type: "image",
      image: STILL,
      script: "hello there",
      voice_id: "v1",
      audio_url: VOICE,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((error) => error.path.join("."))).toContain("script");
  });

  test("two spellings of the same track is refused too", () => {
    const result = avatar.safe({
      type: "image",
      image: STILL,
      audio_url: VOICE,
      audio_asset_id: "asset_1",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((error) => error.path.join("."))).toContain("audio_url");
  });

  test("`voice_id` is required with a script — unless a look supplies one", () => {
    const raw = avatar.safe({ type: "image", image: STILL, script: "hello there" });
    expect(raw.ok).toBe(false);
    if (raw.ok) return;
    const issue = raw.errors.find((error) => error.path.join(".") === "voice_id");
    expect(issue?.message).toContain("a look carries a default voice and a raw image does not");

    const withLook = avatar.safe({
      type: "avatar",
      avatar_id: "abc123",
      script: "hello there",
    });
    expect(withLook.ok).toBe(true);
  });

  test("`voice_settings` beside uploaded audio is a WARNING, because it is a no-op", () => {
    const result = avatar.safe({
      type: "image",
      image: STILL,
      audio_url: VOICE,
      voice_settings: { speed: 1.2 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const warning = result.warnings.find((issue) => issue.path.join(".") === "voice_settings");
    expect(warning?.code).toBe("unknown_param");
    expect(warning?.message).toContain("bypasses TTS entirely");
  });
});

describe("a transparent render has no background to set", () => {
  test("`output_format: \"webm\"` and `background` together is refused", () => {
    const result = avatar.safe({
      type: "image",
      image: STILL,
      audio_url: VOICE,
      output_format: "webm",
      background: { type: "color", value: "#ff0000" },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const issue = result.errors.find((error) => error.path.join(".") === "background");
    expect(issue?.message).toContain("background removal is applied automatically");
  });

  test("either one alone is fine", () => {
    expect(
      avatar.safe({ type: "image", image: STILL, audio_url: VOICE, output_format: "webm" }).ok,
    ).toBe(true);
    expect(
      avatar.safe({
        type: "image",
        image: STILL,
        audio_url: VOICE,
        background: { type: "color", value: "#ff0000" },
      }).ok,
    ).toBe(true);
  });
});

describe("the lipsync route is its own product with its own lifecycle", () => {
  test("`mode` picks the catalog row, and an omitted one means `speed`", () => {
    const speed = lipsync.safe({ video: CLIP, audio: TRACK });
    expect(speed.ok).toBe(true);
    if (!speed.ok) return;
    expect(speed.warnings.some((issue) => issue.code === "unknown_model")).toBe(false);

    expect(HEYGEN_LIPSYNC_MODE_BY_MODEL["lipsync-speed"]).toBe("speed");
    expect(HEYGEN_LIPSYNC_MODE_BY_MODEL["lipsync-precision"]).toBe("precision");
    expect([...HEYGEN_LIPSYNC_MODELS]).toEqual(["lipsync-speed", "lipsync-precision"]);
    expect(models["lipsync-speed"].cost?.perVideoSecond).toBe(0.0333);
    expect(models["lipsync-precision"].cost?.perVideoSecond).toBe(0.0667);
  });

  test("the media fields have no inline arm here, and one does on the other route", () => {
    const result = lipsync.safe({
      video: { type: "base64", media_type: "video/mp4", data: "AAAA" },
      audio: TRACK,
    } as never);
    expect(result.ok).toBe(false);

    // …and the SAME vendor's video route does accept one, for `image`.
    const bytes = avatar.safe({
      type: "image",
      image: { type: "base64", media_type: "image/png", data: "AAAA" },
      audio_url: VOICE,
    });
    expect(bytes.ok).toBe(true);
  });

  test("a backwards partial-lipsync window is refused", () => {
    const backwards = lipsync.safe({ video: CLIP, audio: TRACK, start_time: 9, end_time: 3 });
    expect(backwards.ok).toBe(false);
    if (backwards.ok) return;
    const issue = backwards.errors.find((error) => error.path.join(".") === "start_time");
    expect(issue?.message).toContain("backwards");

    const empty = lipsync.safe({ video: CLIP, audio: TRACK, start_time: 4, end_time: 4 });
    expect(empty.ok).toBe(false);

    const negative = lipsync.safe({ video: CLIP, audio: TRACK, start_time: -2 });
    expect(negative.ok).toBe(false);

    expect(lipsync.safe({ video: CLIP, audio: TRACK, start_time: 2, end_time: 8 }).ok).toBe(true);
  });

  test("`fps_mode` warns rather than refusing, because the schema is a bare string", () => {
    const result = lipsync.safe({ video: CLIP, audio: TRACK, fps_mode: "vfr2" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const warning = result.warnings.find((issue) => issue.path.join(".") === "fps_mode");
    expect(warning?.code).toBe("unknown_param");
    expect(warning?.message).toContain("may not be exhaustive");
    // The three the description names pass silently.
    for (const mode of ["vfr", "cfr", "passthrough"]) {
      const ok = lipsync.safe({ video: CLIP, audio: TRACK, fps_mode: mode });
      expect(ok.ok, mode).toBe(true);
      if (!ok.ok) continue;
      expect(ok.warnings, mode).toEqual([]);
    }
  });

  test("`enable_caption` is deprecated AND ignored, so it warns", () => {
    const result = lipsync.safe({ video: CLIP, audio: TRACK, enable_caption: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const warning = result.warnings.find((issue) => issue.path.join(".") === "enable_caption");
    expect(warning?.message).toContain("captions are always");
  });

  test("the two routes report over DIFFERENT status enums", () => {
    // `processing` on the video route, `running` on this one. A shared `switch`
    // over them falls through, which is why they are two exported lists.
    expect(HEYGEN_VIDEO_STATUSES).toContain("processing");
    expect(HEYGEN_LIPSYNC_STATUSES).toContain("running");
    expect(HEYGEN_VIDEO_STATUSES).not.toContain("running");
    expect(HEYGEN_LIPSYNC_STATUSES).not.toContain("processing");
  });
});

describe("what this provider does not do", () => {
  test("neither address estimates, though the price table is public USD", () => {
    // Every rate is per second of OUTPUT and the output's length follows the
    // audio's; two of the three engine rates are BANDS keyed by avatar type,
    // which lives on the look rather than in the request.
    const still = avatar.safe({ type: "image", image: STILL, audio_url: VOICE });
    expect(still.ok).toBe(true);
    if (!still.ok) return;
    expect(still.estimate?.costUSD).toBeUndefined();

    const clip = lipsync.safe({ video: CLIP, audio: TRACK, mode: "precision" });
    expect(clip.ok).toBe(true);
    if (!clip.ok) return;
    expect(clip.estimate?.costUSD).toBeUndefined();
  });

  test("the catalog is five rows: three engines and two lipsync modes", () => {
    expect(Object.keys(models).sort()).toEqual([
      "avatar_iii",
      "avatar_iv",
      "avatar_v",
      "lipsync-precision",
      "lipsync-speed",
    ]);
  });
});
