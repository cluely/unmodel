/**
 * `.toApi("fal")` — the media retarget seam, end to end.
 *
 * Three kinds of assertion, and the split matters:
 *
 * 1. **The drift guard.** Every fal endpoint id every overlap table names is
 *    checked against fal's own curated roster. The tables are hand-written
 *    from fal's endpoint pages — there is no models.dev availability data for
 *    media — so nothing else would notice a curation refresh retiring a row.
 *    `fal-ai/veo3` and `fal-ai/whisper` both vanished from fal during the
 *    design of this provider, so this is a live hazard, not a hypothetical.
 * 2. **The mapping goldens.** One exact case per family (the contract: zero
 *    warnings means the mapping was exact), plus each family's approximations
 *    and refusals.
 * 3. **The type-level bar**, in `test/types/media-retarget.test-d.ts`.
 */
import { describe, expect, test } from "bun:test";

import type { ValidateResult } from "../../src/core/result";
import { FAL_ENDPOINTS } from "../../src/providers/fal/gen/endpoints.gen";
import {
  KLING_VIDEO_FAL_OVERLAP,
  KLING_VIDEO_FROM_IMAGE_FAL_OVERLAP,
  video as klingVideo,
  videoFromImage as klingVideoFromImage,
} from "../../src/providers/kling";
import { PIXVERSE_VIDEO_FAL_OVERLAP, video as pixverseVideo } from "../../src/providers/pixverse";
import {
  LIGHTRICKS_VIDEO_FAL_OVERLAP,
  video as lightricksVideo,
} from "../../src/providers/lightricks";
import { ELEVENLABS_TTS_FAL_OVERLAP, tts as elevenlabsTts } from "../../src/providers/elevenlabs";
import { MINIMAX_TTS_FAL_OVERLAP, tts as minimaxTts } from "../../src/providers/minimax";
import {
  BFL_IMAGE_FAL_OVERLAP,
  BFL_IMAGE_FLUX1_FAL_OVERLAP,
  image as bflImage,
  imageFlux1 as bflImageFlux1,
} from "../../src/providers/black-forest-labs";

/**
 * The enumerable half of a result — the exact wire body.
 *
 * A spread keeps the non-enumerable members (`request`, `warnings`, `target`,
 * `toSdk`) in the declared TYPE even though they are gone at run time, so the
 * cast is what lets `toEqual` compare against a plain object literal. That
 * these members are absent from `Object.keys` is asserted separately in
 * `src/core/translate/media-retarget.test.ts`.
 */
const wire = (result: object): Record<string, unknown> => ({ ...result });

/**
 * `.toApiSafe("fal")` on a result whose model has NO overlap row.
 *
 * The member is deliberately absent from those types — that is the type-level
 * bar, held in `test/types/media-retarget.test-d.ts` — so reaching it from a
 * test needs a cast. What is being checked here is the run-time half: a
 * loosely-typed caller gets the recorded REASON rather than "unknown model".
 */
function toApiSafeUntyped(result: object): ValidateResult<object> {
  return (result as { toApiSafe(target: string): ValidateResult<object> }).toApiSafe("fal");
}

// ---------------------------------------------------------------------------
// The roster of shipped families, in one place.
// ---------------------------------------------------------------------------

const OVERLAP_TABLES: Array<{
  endpoint: string;
  category: "video" | "image" | "tts";
  table: Readonly<Record<string, { readonly endpoints: readonly string[] }>>;
}> = [
  { endpoint: "kling.video", category: "video", table: KLING_VIDEO_FAL_OVERLAP },
  {
    endpoint: "kling.videoFromImage",
    category: "video",
    table: KLING_VIDEO_FROM_IMAGE_FAL_OVERLAP,
  },
  { endpoint: "pixverse.video", category: "video", table: PIXVERSE_VIDEO_FAL_OVERLAP },
  { endpoint: "lightricks.video", category: "video", table: LIGHTRICKS_VIDEO_FAL_OVERLAP },
  { endpoint: "elevenlabs.tts", category: "tts", table: ELEVENLABS_TTS_FAL_OVERLAP },
  { endpoint: "minimax.tts", category: "tts", table: MINIMAX_TTS_FAL_OVERLAP },
  { endpoint: "black-forest-labs.image", category: "image", table: BFL_IMAGE_FAL_OVERLAP },
  {
    endpoint: "black-forest-labs.imageFlux1",
    category: "image",
    table: BFL_IMAGE_FLUX1_FAL_OVERLAP,
  },
];

describe("the overlap roster", () => {
  /**
   * The seam is only proven if it crosses categories: a video-only set would
   * demonstrate one family's shape rather than a mechanism. Three categories
   * and six provider families is the bar this wave was held to.
   */
  test("spans video, image and tts across six provider families", () => {
    expect(new Set(OVERLAP_TABLES.map((t) => t.category))).toEqual(
      new Set(["video", "image", "tts"]),
    );
    const providers = new Set(OVERLAP_TABLES.map((t) => t.endpoint.split(".")[0]));
    expect(providers).toEqual(
      new Set(["kling", "pixverse", "lightricks", "elevenlabs", "minimax", "black-forest-labs"]),
    );
    // A vacuous sweep below would be worse than no sweep.
    const rows = OVERLAP_TABLES.reduce((n, t) => n + Object.keys(t.table).length, 0);
    expect(rows).toBe(19);
  });

  /**
   * THE drift guard.
   *
   * fal's curated roster is generated from fal's own Platform API; the overlap
   * tables are hand-transcribed from its endpoint pages. This is the only
   * thing that notices when the two stop agreeing — a retired endpoint would
   * otherwise surface as a 404 in a caller's fetch.
   */
  test.each(OVERLAP_TABLES)(
    "$endpoint names only endpoints in fal's curated roster",
    ({ table }) => {
      const curated = new Set<string>(FAL_ENDPOINTS);
      for (const [modelId, row] of Object.entries(table)) {
        expect(row.endpoints.length).toBeGreaterThan(0);
        for (const endpoint of row.endpoints) {
          expect(
            curated.has(endpoint),
            `${modelId} → "${endpoint}" is not in FAL_ENDPOINTS. Either fal retired it (check ` +
              "`bun run codegen:fal:audit`) or the id is mistyped; unmodel must not address a URL " +
              "fal does not serve.",
          ).toBe(true);
        }
      }
    },
  );

  test.each(OVERLAP_TABLES)("$endpoint declares its routes as literal ids", ({ table }) => {
    for (const row of Object.values(table)) {
      for (const endpoint of row.endpoints) {
        // The endpoint id IS the URL path at fal, so a leading or trailing
        // slash silently produces a different address.
        expect(endpoint).not.toStartWith("/");
        expect(endpoint).not.toEndWith("/");
        expect(endpoint).not.toContain("//");
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Mapping goldens — video
// ---------------------------------------------------------------------------

describe("kling.video → fal", () => {
  test("exact: the v2.5-turbo pro tier, zero warnings", () => {
    const out = klingVideo({
      model_name: "kling-v2-5-turbo",
      prompt: "A slow push-in through a rainy neon alley",
      mode: "pro",
      duration: "10",
      aspect_ratio: "16:9",
    }).toApi("fal");

    expect(wire(out)).toEqual({
      prompt: "A slow push-in through a rainy neon alley",
      // Written out because fal's default is "blur, distort, and low quality".
      negative_prompt: "",
      duration: "10",
      aspect_ratio: "16:9",
    });
    expect(out.request.url).toBe(
      "https://queue.fal.run/fal-ai/kling-video/v2.5-turbo/pro/text-to-video",
    );
    expect(out.warnings).toEqual([]);
    expect(out.target).toBe("fal");
  });

  test("exact: kling-v3 routes on `mode`, and `sound` is written out either way", () => {
    const std = klingVideo({ model_name: "kling-v3", prompt: "dunes", duration: "12" }).toApi("fal");
    expect(std.request.url).toBe(
      "https://queue.fal.run/fal-ai/kling-video/v3/standard/text-to-video",
    );
    // Kling defaults `sound` to "off", fal defaults `generate_audio` to true.
    expect(wire(std)).toMatchObject({ generate_audio: false });
    expect(std.warnings).toEqual([]);

    const pro = klingVideo({
      model_name: "kling-v3",
      prompt: "dunes",
      mode: "pro",
      sound: "on",
    }).toApi("fal");
    expect(pro.request.url).toBe("https://queue.fal.run/fal-ai/kling-video/v3/pro/text-to-video");
    expect(wire(pro)).toMatchObject({ generate_audio: true });
  });

  test("warned: a storyboard loses its explicit shot index", () => {
    const out = klingVideo({
      model_name: "kling-v3",
      mode: "pro",
      multi_shot: true,
      shot_type: "customize",
      multi_prompt: [
        { index: 2, prompt: "the door closes", duration: "3" },
        { index: 1, prompt: "she steps in", duration: "4" },
      ],
    }).toApi("fal");

    expect(wire(out)).toMatchObject({
      // Sorted by `index`, and the key dropped — fal's shots are positional.
      multi_prompt: [
        { prompt: "she steps in", duration: "4" },
        { prompt: "the door closes", duration: "3" },
      ],
      shot_type: "customize",
    });
    const codes = out.warnings.map((w) => w.code);
    expect(codes).toEqual(["approximated_param", "approximated_param"]);
    expect(out.warnings.map((w) => w.path)).toEqual([["multi_shot"], ["multi_prompt"]]);
  });

  test("warned: the intelligent arm carries multi-shot without a storyboard", () => {
    const out = klingVideo({
      model_name: "kling-v3",
      mode: "pro",
      multi_shot: true,
      shot_type: "intelligence",
      prompt: "a chase through the market",
    }).toApi("fal");
    // Kling spells it "intelligence"; fal spells it "intelligent". A rename is
    // not a loss, so the only warning is the derived `multi_shot`.
    expect(wire(out)).toMatchObject({ shot_type: "intelligent" });
    expect(out.warnings).toHaveLength(1);
    expect(out.warnings[0]?.path).toEqual(["multi_shot"]);
  });

  test("refused: `mode: \"std\"` on a model fal serves pro-only", () => {
    const validated = klingVideo({ model_name: "kling-v2-6", prompt: "x", duration: "5" });
    const result = validated.toApiSafe("fal");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.path).toEqual(["mode"]);
    expect(result.errors[0]?.message).toContain("pro tier only");
  });

  test("refused: a duration Kling serves and fal does not", () => {
    const result = klingVideo({
      model_name: "kling-v2-6",
      prompt: "x",
      mode: "pro",
      duration: "8",
    }).toApiSafe("fal");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.message).toContain('"5" or "10"');
  });

  test("refused: watermark, callback and external task id, each by name", () => {
    for (const [key, params] of [
      ["watermark_info", { watermark_info: { enabled: true } }],
      ["callback_url", { callback_url: "https://example.com/hook" }],
      ["external_task_id", { external_task_id: "job-7" }],
    ] as const) {
      const result = klingVideo({
        model_name: "kling-v2-5-turbo",
        prompt: "x",
        mode: "pro",
        ...params,
      }).toApiSafe("fal");
      expect(result.ok, `${key} must be refused`).toBe(false);
      if (result.ok) continue;
      expect(result.errors[0]?.path).toEqual([key]);
    }
  });

  test("refused: a model fal does not serve names the reason, not 'unknown'", () => {
    const result = toApiSafeUntyped(klingVideo({ model_name: "kling-v1", prompt: "x" }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.message).toContain("serves no v1 endpoint");
    expect(result.errors[0]?.meta).toMatchObject({ structural: true });
  });
});

describe("kling.videoFromImage → fal", () => {
  test("exact: the start frame renames per tier", () => {
    const v25 = klingVideoFromImage({
      model_name: "kling-v2-5-turbo",
      image: "https://example.com/first.png",
      image_tail: "https://example.com/last.png",
      prompt: "she turns to the window",
      mode: "pro",
      duration: "5",
    }).toApi("fal");
    expect(wire(v25)).toEqual({
      prompt: "she turns to the window",
      image_url: "https://example.com/first.png",
      negative_prompt: "",
      duration: "5",
      tail_image_url: "https://example.com/last.png",
    });
    expect(v25.warnings).toEqual([]);

    const v3 = klingVideoFromImage({
      model_name: "kling-v3",
      image: "https://example.com/first.png",
      prompt: "she turns",
      mode: "pro",
    }).toApi("fal");
    expect(wire(v3)).toMatchObject({ start_image_url: "https://example.com/first.png" });
  });

  test("refused: bare base64, an end-frame-only request, and the motion brush", () => {
    const base = { model_name: "kling-v3", prompt: "x", mode: "pro" } as const;
    const cases: ReadonlyArray<[string, Record<string, unknown>]> = [
      ["image", { image: "iVBORw0KGgoAAAANSUhEUg==" }],
      ["image", { image_tail: "https://example.com/last.png" }],
      ["static_mask", { image: "https://example.com/a.png", static_mask: "https://x/m.png" }],
      [
        "element_list",
        { image: "https://example.com/a.png", element_list: [{ element_id: "el_1" }] },
      ],
    ];
    for (const [path, extra] of cases) {
      const result = toApiSafeUntyped(
        klingVideoFromImage({ ...base, ...extra } as never) as object,
      );
      expect(result.ok, `${path} / ${JSON.stringify(extra)}`).toBe(false);
      if (result.ok) continue;
      expect(result.errors.some((issue) => issue.path[0] === path)).toBe(true);
    }
  });
});

describe("pixverse.video → fal", () => {
  test("exact: seven params, and `quality` is the only rename", () => {
    const out = pixverseVideo({
      model: "v6",
      prompt: "a neon-lit alley in the rain",
      aspect_ratio: "21:9",
      quality: "1080p",
      duration: 9,
      seed: 42,
      generate_audio_switch: true,
    }).toApi("fal");

    expect(wire(out)).toEqual({
      prompt: "a neon-lit alley in the rain",
      resolution: "1080p",
      aspect_ratio: "21:9",
      duration: 9,
      seed: 42,
      generate_audio_switch: true,
    });
    expect(out.request.url).toBe("https://queue.fal.run/fal-ai/pixverse/v6/text-to-video");
    expect(out.warnings).toEqual([]);
  });

  test("refused: the byte cap fal documents but does not publish in its schema", () => {
    const result = pixverseVideo({
      model: "v6",
      // 1000 four-byte characters: well inside PixVerse's 5000-CHARACTER cap
      // and well over fal's 2048-BYTE one.
      prompt: "🌊".repeat(1000),
      aspect_ratio: "16:9",
      quality: "720p",
      duration: 5,
    }).toApiSafe("fal");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.message).toContain("4000 UTF-8 bytes");
  });

  test("refused: motion mode, camera movement and template id", () => {
    for (const extra of [
      { motion_mode: "fast" },
      { camera_movement: "zoom_in" },
      { template_id: 302325299692608 },
    ] as const) {
      const result = pixverseVideo({
        model: "v6",
        prompt: "x",
        aspect_ratio: "16:9",
        quality: "720p",
        duration: 5,
        ...extra,
      }).toApiSafe("fal");
      expect(result.ok, JSON.stringify(extra)).toBe(false);
    }
  });
});

describe("lightricks.video → fal", () => {
  test("exact: WIDTHxHEIGHT splits into resolution + aspect ratio", () => {
    const out = lightricksVideo({
      model: "ltx-2-5-pro",
      prompt: "A lighthouse beam sweeps across the water at dusk",
      resolution: "1080x1920",
      duration: 8,
      camera_motion: "jib_up",
    }).toApi("fal");

    expect(wire(out)).toEqual({
      prompt: "A lighthouse beam sweeps across the water at dusk",
      resolution: "1080p",
      aspect_ratio: "9:16",
      duration: 8,
      // Written out because LTX defaults to 24 and fal to 25.
      fps: 24,
      camera_motion: "jib_up",
    });
    expect(out.request.url).toBe(
      "https://queue.fal.run/lightricks/ltx-2.5/text-to-video/pro",
    );
    expect(out.warnings).toEqual([]);
  });

  test("exact: a null duration becomes the literal \"auto\"", () => {
    const out = lightricksVideo({
      model: "ltx-2-5-pro",
      prompt: "x",
      resolution: "1280x720",
      duration: null,
      fps: 50,
    }).toApi("fal");
    expect(wire(out)).toMatchObject({ duration: "auto", fps: 50, resolution: "720p" });
    expect(out.warnings).toEqual([]);
  });

  test("refused: the synchronous route, and a model fal serves under a misleading name", () => {
    const sync = lightricksVideo({
      model: "ltx-2-5-pro",
      prompt: "x",
      resolution: "1280x720",
      duration: 6,
      api_version: "v1",
    }).toApiSafe("fal");
    expect(sync.ok).toBe(false);

    const fast = toApiSafeUntyped(
      lightricksVideo({ model: "ltx-2-5-fast", prompt: "x", resolution: "1280x720", duration: 6 }),
    );
    expect(fast.ok).toBe(false);
    if (fast.ok) return;
    expect(fast.errors[0]?.message).toContain("would swap the model");
  });
});

// ---------------------------------------------------------------------------
// Mapping goldens — tts
// ---------------------------------------------------------------------------

describe("elevenlabs.tts → fal", () => {
  test("mapped: ten fields land, with the two honest caveats recorded", () => {
    const out = elevenlabsTts({
      voice_id: "JBFqnCBsd6RMkjVDRZzb",
      text: "Hello world",
      model_id: "eleven_turbo_v2_5",
      voice_settings: { stability: 0.4, similarity_boost: 0.8, style: 0.2, speed: 1.1 },
      language_code: "en",
      apply_text_normalization: "on",
    }).toApi("fal");

    expect(wire(out)).toEqual({
      text: "Hello world",
      voice: "JBFqnCBsd6RMkjVDRZzb",
      stability: 0.4,
      similarity_boost: 0.8,
      style: 0.2,
      speed: 1.1,
      language_code: "en",
      apply_text_normalization: "on",
    });
    expect(out.request.url).toBe("https://queue.fal.run/fal-ai/elevenlabs/tts/turbo-v2.5");
    // Not exact, and honest about why: the voice namespace and the response
    // shape both change, and neither is expressible as a param.
    expect(out.warnings.map((w) => w.code)).toEqual([
      "approximated_param",
      "approximated_param",
    ]);
    expect(out.warnings[0]?.message).toContain("namespace changes");
    expect(out.warnings[1]?.message).toContain("queue envelope");
  });

  test("an omitted model_id retargets on ElevenLabs' own default", () => {
    const out = elevenlabsTts({ voice_id: "v", text: "hi" }).toApi("fal");
    expect(out.request.url).toBe("https://queue.fal.run/fal-ai/elevenlabs/tts/multilingual-v2");
  });

  test("refused: zero-retention, output format and streaming latency", () => {
    for (const extra of [
      { enable_logging: false },
      { output_format: "pcm_44100" },
      { optimize_streaming_latency: 3 },
    ] as const) {
      const result = elevenlabsTts({ voice_id: "v", text: "hi", ...extra }).toApiSafe("fal");
      expect(result.ok, JSON.stringify(extra)).toBe(false);
    }
    const privacy = elevenlabsTts({
      voice_id: "v",
      text: "hi",
      enable_logging: false,
    }).toApiSafe("fal");
    expect(privacy.ok).toBe(false);
    if (privacy.ok) return;
    expect(privacy.errors[0]?.message).toContain("zero-retention");
  });

  test("refused: the fields Eleven v3's row does not publish", () => {
    const result = elevenlabsTts({
      voice_id: "v",
      text: "hi",
      model_id: "eleven_v3",
      voice_settings: { style: 0.5 },
    }).toApiSafe("fal");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.path).toEqual(["voice_settings", "style"]);
  });

  test("refused: flash v2.5, with the reason it is not turbo v2.5", () => {
    const result = toApiSafeUntyped(
      elevenlabsTts({ voice_id: "v", text: "hi", model_id: "eleven_flash_v2_5" }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.message).toContain("different model id producing different audio");
  });
});

describe("minimax.tts → fal", () => {
  test("mapped: the numeric unions agree exactly; two renames apply", () => {
    const out = minimaxTts({
      model: "speech-2.8-hd",
      text: "Hello world",
      voice_setting: { voice_id: "English_Graceful_Lady", speed: 1.2, vol: 2, pitch: -3 },
      audio_setting: { format: "mp3", sample_rate: 32000, bitrate: 128000, channel: 1 },
      pronunciation_dict: { tone: ["燕少飞/(yan4)(shao3)(fei1)"] },
      language_boost: "English",
      output_format: "url",
    }).toApi("fal");

    expect(wire(out)).toEqual({
      // `text` → `prompt` on the 2.8 rows.
      prompt: "Hello world",
      voice_setting: { voice_id: "English_Graceful_Lady", speed: 1.2, vol: 2, pitch: -3 },
      audio_setting: { sample_rate: 32000, bitrate: 128000, format: "mp3", channel: 1 },
      // `tone` → `tone_list`.
      pronunciation_dict: { tone_list: ["燕少飞/(yan4)(shao3)(fei1)"] },
      language_boost: "English",
      output_format: "url",
    });
    expect(out.request.url).toBe("https://queue.fal.run/fal-ai/minimax/speech-2.8-hd");
    // The one thing no param can express.
    expect(out.warnings).toHaveLength(1);
    expect(out.warnings[0]?.message).toContain("loudness normalization by default");
  });

  test("speech-02-hd keeps `text` and drops voice_modify", () => {
    const out = minimaxTts({
      model: "speech-02-hd",
      text: "hi",
      voice_setting: { voice_id: "English_Graceful_Lady" },
    }).toApi("fal");
    expect(wire(out)).toEqual({
      text: "hi",
      voice_setting: { voice_id: "English_Graceful_Lady" },
    });
    expect(out.warnings).toEqual([]);

    const result = minimaxTts({
      model: "speech-02-hd",
      text: "hi",
      voice_setting: { voice_id: "English_Graceful_Lady" },
      voice_modify: { pitch: 10 },
    }).toApiSafe("fal");
    expect(result.ok).toBe(false);
  });

  test("refused: the emotions, formats and language boosts fal's enums lack", () => {
    const voice = { voice_id: "English_Graceful_Lady" };
    const cases: ReadonlyArray<Record<string, unknown>> = [
      { voice_setting: { ...voice, emotion: "calm" } },
      { audio_setting: { format: "wav" } },
      { language_boost: "Tamil" },
      { timbre_weights: [{ voice_id: "a", weight: 50 }] },
      { subtitle_enable: true },
      { stream: true },
    ];
    for (const extra of cases) {
      const result = toApiSafeUntyped(
        minimaxTts({
          model: "speech-2.8-hd",
          text: "hi",
          voice_setting: voice,
          ...extra,
        } as never) as object,
      );
      expect(result.ok, JSON.stringify(extra)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Mapping goldens — image
// ---------------------------------------------------------------------------

describe("black-forest-labs → fal", () => {
  test("exact: FLUX.2 pixels become fal's image_size object", () => {
    const out = bflImage({
      model: "flux-2-pro",
      prompt: "a tiny cabin in a snowy forest at dusk",
      width: 1024,
      height: 1024,
      seed: 7,
      safety_tolerance: 3,
      output_format: "png",
    }).toApi("fal");

    expect(wire(out)).toEqual({
      prompt: "a tiny cabin in a snowy forest at dusk",
      image_size: { width: 1024, height: 1024 },
      seed: 7,
      // An integer natively, a string enum at fal.
      safety_tolerance: "3",
      output_format: "png",
    });
    expect(out.request.url).toBe("https://queue.fal.run/fal-ai/flux-2-pro");
    expect(out.warnings).toEqual([]);
  });

  test("exact: the ultra route's aspect ratio passes through verbatim", () => {
    const out = bflImageFlux1({
      model: "flux-pro-1.1-ultra",
      prompt: "a lighthouse in a storm",
      aspect_ratio: "21:9",
      raw: true,
      prompt_upsampling: true,
    }).toApi("fal");
    expect(wire(out)).toEqual({
      prompt: "a lighthouse in a storm",
      aspect_ratio: "21:9",
      // A pure rename: both booleans, both defaulting to false.
      enhance_prompt: true,
      raw: true,
    });
    expect(out.warnings).toEqual([]);
  });

  test("exact: flux-dev renames steps and guidance", () => {
    const out = bflImageFlux1({
      model: "flux-dev",
      prompt: "a lighthouse",
      width: 1024,
      height: 768,
      steps: 30,
      guidance: 3.5,
    }).toApi("fal");
    expect(wire(out)).toEqual({
      prompt: "a lighthouse",
      image_size: { width: 1024, height: 768 },
      num_inference_steps: 30,
      guidance_scale: 3.5,
    });
    expect(out.warnings).toEqual([]);
  });

  test("refused: safety_tolerance 0 would LOOSEN moderation", () => {
    const result = bflImage({
      model: "flux-2-pro",
      prompt: "x",
      safety_tolerance: 0,
    }).toApiSafe("fal");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.message).toContain("loosen moderation");
  });

  test("refused: webp, a lone dimension, and the two asymmetric flux-dev fields", () => {
    const webp = bflImage({ model: "flux-2-pro", prompt: "x", output_format: "webp" }).toApiSafe(
      "fal",
    );
    expect(webp.ok).toBe(false);

    const halfSized = bflImage({ model: "flux-2-pro", prompt: "x", width: 1024 }).toApiSafe("fal");
    expect(halfSized.ok).toBe(false);

    // `fal-ai/flux/dev` has neither `enhance_prompt` nor `safety_tolerance`,
    // unlike `fal-ai/flux-pro/v1.1`; the two rows are not symmetric.
    for (const extra of [{ prompt_upsampling: true }, { safety_tolerance: 4 }] as const) {
      const result = bflImageFlux1({ model: "flux-dev", prompt: "x", ...extra }).toApiSafe("fal");
      expect(result.ok, JSON.stringify(extra)).toBe(false);
    }
  });

  test("refused: the checkpoints fal serves under a similar name", () => {
    const flex = toApiSafeUntyped(bflImage({ model: "flux-2-flex", prompt: "x" }));
    expect(flex.ok).toBe(false);
    if (flex.ok) return;
    expect(flex.errors[0]?.message).toContain("FLUX.2 [dev]");
  });
});
