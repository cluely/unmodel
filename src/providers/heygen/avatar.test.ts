/**
 * `heygen.avatar` and `heygen.lipsync` — two URLs, two lifecycles, and the
 * seven cross-field rules that are why this provider is validated rather than
 * passed through.
 *
 * HeyGen's spec is the most complete in this wave (136 paths, 517 schemas) and
 * every one of these rules is stated in it and expressible in none of it: they
 * are `description` prose on fields that are all individually optional. Each is
 * a 400 or a silent no-op if broken.
 *
 * - `type` decides which visual source is REQUIRED and which is refused —
 *   HeyGen's own documented example error is exactly that mistake.
 * - The raw-image arm declares no `engine` (it renders on Avatar IV), so any
 *   `engine` there is a 400.
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
  HEYGEN_ELEVENLABS_MODELS,
  HEYGEN_ENGINES,
  HEYGEN_FISH_MODELS,
  HEYGEN_IMAGE_ENGINES,
  HEYGEN_LIPSYNC_MODELS,
  HEYGEN_LIPSYNC_MODE_BY_MODEL,
  HEYGEN_LIPSYNC_STATUSES,
  HEYGEN_OPENAPI_URL,
  HEYGEN_VIDEO_STATUSES,
  HEYGEN_VOICE_ENGINES,
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

  test("the raw-image arm declares no `engine`, so every value is refused", () => {
    // `CreateVideoFromImage` (https://developers.heygen.com/openapi/external-api.json,
    // 2026-11-13) is `additionalProperties: false` with no `engine` property;
    // https://developers.heygen.com/image-to-video: "| Engine | Avatar IV |".
    expect([...HEYGEN_IMAGE_ENGINES]).toEqual(["avatar_iv"]);
    expect(avatar.safe({ type: "image", image: STILL, audio_url: VOICE }).ok).toBe(true);
    for (const engine of [
      { type: "avatar_iii" },
      { type: "avatar_iv" },
      { type: "avatar_v" },
      null,
    ] as const) {
      const label = JSON.stringify(engine);
      const result = avatar.safe({ type: "image", image: STILL, audio_url: VOICE, engine });
      expect(result.ok, label).toBe(false);
      if (result.ok) continue;
      const issue = result.errors.find((error) => error.path.join(".") === "engine");
      expect(issue?.code, label).toBe("unsupported_param");
      expect(issue?.message, label).toContain("additionalProperties: false");
      expect(issue?.message, label).toContain('type: "avatar", avatar_id');
    }
    // …and all three engines are perfectly happy on the catalogued-look arm.
    for (const type of HEYGEN_ENGINES) {
      const ok = avatar.safe({
        type: "avatar",
        avatar_id: "abc123",
        audio_url: VOICE,
        engine: { type },
      });
      expect(ok.ok, type).toBe(true);
    }
  });

  test("`expressiveness` and `motion_prompt` are REJECTED, not ignored", () => {
    const onV = avatar.safe({
      type: "avatar",
      avatar_id: "abc123",
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
      expressiveness: "medium",
      motion_prompt: "gestures while speaking",
    });
    expect(fine.ok).toBe(true);
  });

  test("the three engines are three catalog rows with three rates", () => {
    expect([...HEYGEN_ENGINES]).toEqual(["avatar_iii", "avatar_iv", "avatar_v"]);
    // Avatar III is the cheap one — $0.01 a second for a Custom Video Avatar
    // against Avatar V's $0.12. Avatar III and IV carry the TOP of their band
    // because the avatar type is a property of the LOOK rather than of the
    // request; Avatar V publishes one tier.
    expect(models.avatar_iii.cost?.perVideoSecond).toBe(0.0165);
    expect(models.avatar_iv.cost?.perVideoSecond).toBe(0.0805);
    expect(models.avatar_v.cost?.perVideoSecond).toBe(0.12);
  });

  test("Avatar V takes `more_blinking` inside its engine config", () => {
    const result = avatar.safe({
      type: "avatar",
      avatar_id: "abc123",
      audio_url: VOICE,
      engine: { type: "avatar_v", more_blinking: true },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toEqual([]);
    expect(JSON.parse(JSON.stringify(result.params))).toHaveProperty("engine.more_blinking", true);

    const wrong = avatar.safe({
      type: "avatar",
      avatar_id: "abc123",
      audio_url: VOICE,
      engine: { type: "avatar_v", more_blinking: "yes" },
    } as never);
    expect(wrong.ok).toBe(false);
  });
});

describe("every optional the spec makes nullable takes `null`", () => {
  test("the video route: null is accepted, and reads as absent", () => {
    const result = avatar.safe({
      type: "avatar",
      avatar_id: "abc123",
      audio_url: VOICE,
      engine: null,
      script: null,
      voice_id: null,
      audio_asset_id: null,
      voice_settings: null,
      title: null,
      folder_id: null,
      resolution: null,
      aspect_ratio: null,
      fit: null,
      background: null,
      remove_background: null,
      callback_url: null,
      callback_id: null,
      output_upload: null,
      watermark: null,
      caption: null,
      brand_glossary_id: null,
      motion_prompt: null,
      expressiveness: null,
    });
    expect(result.ok, JSON.stringify(result.ok ? [] : result.errors)).toBe(true);
    if (!result.ok) return;
    // A null `script` beside a track is not a second speech source, and a
    // null `voice_settings` is not settings that will be ignored.
    expect(result.warnings).toEqual([]);

    // A null `background` is no background, so `webm` has nothing to reject;
    // a null `expressiveness` is no expressiveness, so Avatar V has nothing to
    // reject either.
    expect(
      avatar.safe({ type: "image", image: STILL, audio_url: VOICE, output_format: "webm", background: null })
        .ok,
    ).toBe(true);
    expect(
      avatar.safe({
        type: "avatar",
        avatar_id: "abc123",
        audio_url: VOICE,
        engine: { type: "avatar_v" },
        expressiveness: null,
      }).ok,
    ).toBe(true);
  });

  test("the video route: `output_format` and `type` are not nullable", () => {
    // `output_format` is `$ref VideoOutputFormat` with `"default": "mp4"`, not
    // an `anyOf` with null; `type` is the discriminator.
    expect(
      avatar.safe({ type: "image", image: STILL, audio_url: VOICE, output_format: null } as never).ok,
    ).toBe(false);
    expect(avatar.safe({ type: null, image: STILL, audio_url: VOICE } as never).ok).toBe(false);
  });

  test("the lipsync route: its eight nullable optionals take null", () => {
    const result = lipsync.safe({
      video: CLIP,
      audio: TRACK,
      title: null,
      callback_url: null,
      callback_id: null,
      keep_the_same_format: null,
      start_time: null,
      end_time: null,
      fps_mode: null,
      folder_id: null,
    });
    expect(result.ok, JSON.stringify(result.ok ? [] : result.errors)).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toEqual([]);
    // A null `start_time` opens no window, so there is nothing to run backwards.
    expect(lipsync.safe({ video: CLIP, audio: TRACK, start_time: null, end_time: 3 }).ok).toBe(true);
  });

  test("the lipsync route: `mode` and the booleans with a default are not nullable", () => {
    expect(lipsync.safe({ video: CLIP, audio: TRACK, mode: null } as never).ok).toBe(false);
    expect(lipsync.safe({ video: CLIP, audio: TRACK, enable_watermark: null } as never).ok).toBe(
      false,
    );
  });
});

describe("`output_upload` sends the finished files to your own storage", () => {
  test("a presigned target per file is accepted, with no unknown-key warning", () => {
    const result = avatar.safe({
      type: "image",
      image: STILL,
      audio_url: VOICE,
      output_upload: {
        video: {
          url: "https://bucket.s3.amazonaws.com/out.mp4?X-Amz-Signature=abc",
          headers: { "Content-Type": "video/mp4" },
        },
        captions: null,
        thumbnail: { url: "https://bucket.s3.amazonaws.com/out.jpg?X-Amz-Signature=def" },
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toEqual([]);
  });

  test("`video` is required and a target URL is at most 4096 characters", () => {
    const missing = avatar.safe({
      type: "image",
      image: STILL,
      audio_url: VOICE,
      output_upload: { thumbnail: { url: "https://bucket.example.com/out.jpg" } },
    } as never);
    expect(missing.ok).toBe(false);
    const long = avatar.safe({
      type: "image",
      image: STILL,
      audio_url: VOICE,
      output_upload: { video: { url: `https://bucket.example.com/${"a".repeat(4096)}` } },
    });
    expect(long.ok).toBe(false);
  });
});

describe("voice_settings.engine_settings follows the spec's model enums", () => {
  const SCRIPTED = {
    type: "avatar",
    avatar_id: "abc123",
    script: "hello there",
    voice_id: "v1",
  } as const;

  test("the models the spec still lists are accepted", () => {
    const eleven = avatar.safe({
      ...SCRIPTED,
      voice_settings: { engine_settings: { engine_type: "elevenlabs", model: "eleven_v3" } },
    });
    expect(eleven.ok).toBe(true);
    const fish = avatar.safe({
      ...SCRIPTED,
      voice_settings: { engine_settings: { engine_type: "fish", model: "s2-pro" } },
    });
    expect(fish.ok).toBe(true);
  });

  test("ElevenLabs v4 and Fish s2.1-pro are accepted", () => {
    expect([...HEYGEN_ELEVENLABS_MODELS]).toContain("eleven_v4");
    expect([...HEYGEN_FISH_MODELS]).toEqual(["s2.1-pro", "s2-pro"]);
    const eleven = avatar.safe({
      ...SCRIPTED,
      voice_settings: {
        engine_settings: { engine_type: "elevenlabs", model: "eleven_v4", stability: 0.3 },
      },
    });
    expect(eleven.ok).toBe(true);
    const fish = avatar.safe({
      ...SCRIPTED,
      voice_settings: { engine_settings: { engine_type: "fish", model: "s2.1-pro" } },
    });
    expect(fish.ok).toBe(true);
  });

  test("all seven discriminator values select an arm", () => {
    expect([...HEYGEN_VOICE_ENGINES].sort()).toEqual([
      "cartesia",
      "elevenlabs",
      "fish",
      "heygen_voice",
      "mockingbird",
      "orca",
      "starfish",
    ]);
    const arms = [
      { engine_type: "cartesia", model: "sonic-3.6" },
      { engine_type: "heygen_voice", model: "heygen-voice-1", similarity: "extra_high" },
      // The legacy spelling of the same arm.
      { engine_type: "orca", expressiveness: 0.4, pitch: -1.5, inflection: 1.2 },
      { engine_type: "mockingbird" },
    ] as const;
    for (const engine_settings of arms) {
      const result = avatar.safe({
        ...SCRIPTED,
        voice_settings: { locale: "en-US", engine_settings },
      });
      expect(result.ok, engine_settings.engine_type).toBe(true);
    }
  });

  test("the new arms keep their own bounds", () => {
    // Cartesia's model enum is ["sonic-3.6", "sonic-3.5"]; HeyGen Voice's
    // `pitch` is −4…4 in steps of 0.5 and `similarity` a four-value enum.
    for (const engine_settings of [
      { engine_type: "cartesia", model: "sonic-2" },
      { engine_type: "heygen_voice", pitch: 0.3 },
      { engine_type: "heygen_voice", pitch: 4.5 },
      { engine_type: "orca", similarity: "low" },
      { engine_type: "heygen_voice", inflection: 0.2 },
    ]) {
      const result = avatar.safe({
        ...SCRIPTED,
        voice_settings: { engine_settings },
      } as never);
      expect(result.ok, JSON.stringify(engine_settings)).toBe(false);
    }
  });

  test("the models the spec dropped are refused", () => {
    // `ElevenLabsEngineSettings.model` no longer lists `eleven_flash_v2_5`, and
    // `FishEngineSettings.model` no longer lists `s1`.
    expect(HEYGEN_ELEVENLABS_MODELS as readonly string[]).not.toContain("eleven_flash_v2_5");
    expect(HEYGEN_FISH_MODELS as readonly string[]).not.toContain("s1");
    const eleven = avatar.safe({
      ...SCRIPTED,
      voice_settings: {
        engine_settings: { engine_type: "elevenlabs", model: "eleven_flash_v2_5" },
      },
    } as never);
    expect(eleven.ok).toBe(false);
    const fish = avatar.safe({
      ...SCRIPTED,
      voice_settings: { engine_settings: { engine_type: "fish", model: "s1" } },
    } as never);
    expect(fish.ok).toBe(false);
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
    expect(models["lipsync-speed"].cost?.perVideoSecond).toBe(0.014);
    expect(models["lipsync-precision"].cost?.perVideoSecond).toBe(0.029);
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
  test("neither address estimates, though the rates are published in USD", () => {
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
