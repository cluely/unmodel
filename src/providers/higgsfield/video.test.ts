import { describe, expect, test } from "bun:test";
import { UnmodelValidationError } from "../../core/issues";
import { HIGGSFIELD_VIDEO_ENDPOINTS } from "./gen/endpoints.gen";
import { HIGGSFIELD_VIDEO_SHAPES } from "./gen/video-narrow.gen";
import { video } from "./video";

/** The JSON a validated result serialises to: its enumerable properties, which are the wire body. */
function bodyOf(validated: object): unknown {
  return JSON.parse(JSON.stringify(validated));
}

/**
 * `higgsfield.video` against the REAL generated rows. Catalog-coupled on
 * purpose: these are the published facts a caller relies on, and a refresh
 * that changes one has to surface here. The battery's own behaviours are in
 * `checks.test.ts`, against hand rows.
 */

const SEEDANCE = "bytedance/seedance-2.5/text-to-video";

describe("higgsfield.video — the request it builds", () => {
  test("the route id becomes the path and the body is what was written", () => {
    const params = video({ endpoint: SEEDANCE, prompt: "A fox walks through snow", resolution: "720p", duration: 5 });
    expect(bodyOf(params)).toEqual({ prompt: "A fox walks through snow", resolution: "720p", duration: 5 });
    expect(params.request).toEqual({
      url: "https://api.higgsfield.ai/bytedance/seedance-2.5/text-to-video",
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    expect(JSON.stringify(params)).toBe('{"prompt":"A fox walks through snow","resolution":"720p","duration":5}');
  });

  test("`endpoint` and `hf_webhook` are stripped into the URL, and NOTHING else changes", () => {
    // The idempotency fingerprint counts "omitted fields, explicit `null`
    // values": an explicit default and an explicit null both have to survive.
    const body = {
      prompt: "x",
      duration: 5,
      draft: false,
      generate_audio: true,
      aspect_ratio: "16:9",
      resolution: "720p",
    } as const;
    const result = video.safe({ endpoint: SEEDANCE, hf_webhook: "https://hooks.example.com/hf?job=1", ...body });
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(bodyOf(result.params)).toEqual(body);
    expect(Object.keys(result.params)).toEqual(Object.keys(body));
    expect(result.params.request.url).toBe(
      "https://api.higgsfield.ai/bytedance/seedance-2.5/text-to-video?hf_webhook=https%3A%2F%2Fhooks.example.com%2Fhf%3Fjob%3D1",
    );
    expect(result.warnings).toEqual([]);
  });

  test('`.toSdk("higgsfield")` is the second argument of the client\'s `subscribe`', () => {
    const plain = video({ endpoint: SEEDANCE, prompt: "x" });
    expect(plain.toSdk("higgsfield")).toEqual({ input: { prompt: "x" } });
    const hooked = video({ endpoint: SEEDANCE, prompt: "x", hf_webhook: "https://hooks.example.com/hf" });
    expect(hooked.toSdk("higgsfield")).toEqual({ input: { prompt: "x" }, webhook: { url: "https://hooks.example.com/hf" } });
  });

  test("the estimate is the listed rate, and absent where the route has none", () => {
    const priced = video.safe({ endpoint: SEEDANCE, prompt: "x", resolution: "1080p", duration: 4 });
    expect(priced.ok && priced.estimate).toEqual({ costUSD: 2.6072 });
    const unpriced = video.safe({ endpoint: "higgsfield/cinema-studio/4.0", prompt: "x" });
    expect(unpriced.ok && unpriced.estimate).toEqual({});
  });

  test("a source clip's declared duration prices a route billed on it, and `maxCostUSD` holds", () => {
    const GENJUTSU = "higgsfield/genjutsu/motion-transfer/v1.0";
    const clip = "https://example.com/a.mp4";
    const undeclared = video.safe({ endpoint: GENJUTSU, video_url: clip, image_urls: ["https://example.com/a.png"], resolution: "720p" });
    expect(undeclared.ok && undeclared.estimate).toEqual({});
    const declared = video.safe(
      { endpoint: GENJUTSU, video_url: clip, image_urls: ["https://example.com/a.png"], resolution: "720p" },
      { media: [{ path: ["video_url"], durationSeconds: 12.2 }] },
    );
    expect(declared.ok && declared.estimate).toEqual({ costUSD: 4.4798 });
    const capped = video.safe(
      { endpoint: GENJUTSU, video_url: clip, image_urls: ["https://example.com/a.png"], resolution: "720p" },
      { media: [{ path: ["video_url"], durationSeconds: 12.2 }], maxCostUSD: 1 },
    );
    expect(capped.ok).toBe(false);
    expect(!capped.ok && capped.errors.map((issue) => issue.code)).toEqual(["over_budget"]);
  });

  test("a declared duration that is not a non-negative number prices nothing — it never slips under `maxCostUSD`", () => {
    for (const durationSeconds of [Number.NaN, -5, Number.POSITIVE_INFINITY]) {
      const result = video.safe(
        { endpoint: "higgsfield/genjutsu/motion-transfer/v1.0", video_url: "https://example.com/a.mp4", image_urls: ["https://example.com/a.png"], resolution: "720p" },
        { media: [{ path: ["video_url"], durationSeconds }], maxCostUSD: 1 },
      );
      expect(result.ok && result.estimate).toEqual({});
    }
  });
});

describe("higgsfield.video — a required parameter with a published default", () => {
  test("LTX-2.5 may omit `duration`: Higgsfield fills the default before it validates", () => {
    for (const endpoint of [
      "lightricks/ltx-2.5/text-to-video/fast",
      "lightricks/ltx-2.5/text-to-video/pro",
      "lightricks/ltx-2.5/image-to-video/fast",
      "lightricks/ltx-2.5/image-to-video/pro",
    ] as const) {
      const body = endpoint.includes("image-to-video") ? { prompt: "a fox", image_url: "https://example.com/a.png" } : { prompt: "a fox" };
      const result = video.safe({ endpoint, ...body } as never);
      expect(result.ok && result.warnings).toEqual([]);
    }
  });
});

describe("higgsfield.video — an id that is not its own", () => {
  test("an IMAGE route's id is a warning naming `higgsfield.image`, and the request is still built", () => {
    // `output_format: "png"` is an image route's value; a gate that knew only
    // the video routes' vocabularies would refuse a request the API fulfils.
    const result = video.safe({ endpoint: "recraft/v4.1/text-to-image", prompt: "x", output_format: "png" } as never);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(result.params.request.url).toBe("https://api.higgsfield.ai/recraft/v4.1/text-to-image");
    expect(bodyOf(result.params)).toEqual({ prompt: "x", output_format: "png" });
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatchObject({ severity: "warning", code: "unsupported_capability", path: ["endpoint"] });
    expect(result.warnings[0]?.message).toContain("`higgsfield.image` validates; higgsfield.video did not check the body");
    expect(result.estimate).toEqual({});
  });

  test("the training route's path is pointed at `higgsfield.characterTrain`", () => {
    const result = video.safe({ endpoint: "v1/custom-references", prompt: "x" });
    expect(result.ok && result.warnings.map((issue) => issue.meta?.["address"])).toEqual(["higgsfield.characterTrain"]);
  });

  test("an excluded id is a warning carrying its recorded reason, never an error", () => {
    const result = video.safe({ endpoint: "higgsfiled/genjutsu/motion-transfer/v1.0", video_url: "https://example.com/a.mp4" });
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(result.params.request.url).toBe("https://api.higgsfield.ai/higgsfiled/genjutsu/motion-transfer/v1.0");
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatchObject({ severity: "warning", code: "unknown_model" });
    expect(result.warnings[0]?.message).toStartWith("unmodel deliberately does not type `higgsfiled/genjutsu/motion-transfer/v1.0`: A misspelled legacy path");
  });

  test("an id no row knows is an `unknown_model` warning at `endpoint`, and its body passes through", () => {
    const result = video.safe({ endpoint: "maker/brand-new/text-to-video", prompt: "x", shiny: true });
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(result.warnings.map((issue) => issue.code).sort()).toEqual(["unknown_model", "unknown_param"]);
    expect(bodyOf(result.params)).toEqual({ prompt: "x", shiny: true });
  });

  test("an id newer than the snapshot is not held to today's vocabularies or nested shapes", () => {
    // `sound` is `on | off` and `tier` a fixed list at every route that
    // declares them today; a newer route is free to publish others.
    const body = { prompt: "x", sound: "auto", tier: "pro", trait_variants: { version: "appearance-v3" }, selection: { a: "b" } };
    const result = video.safe({ endpoint: "kling-video/v5.0/text-to-video", ...body } as never);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(result.warnings.map((issue) => [issue.code, issue.path])).toEqual([["unknown_model", ["endpoint"]]]);
    expect(bodyOf(result.params)).toEqual(body);
  });

  test("an id no row knows is not held to today's primitive types or nulls either", () => {
    // Kling's native API takes `duration` as a string; a hosted route may too.
    const body = { prompt: null, duration: "5s", seed: "random", style_id: null };
    const result = video.safe({ endpoint: "brand/new-route", ...body } as never);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(bodyOf(result.params)).toEqual(body);
  });

  test("an excluded id's body is sent as written, as its warning says", () => {
    const result = video.safe({ endpoint: "higgsfiled/genjutsu/object-swap/v1.0", style_id: null, duration: "5" } as never);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(bodyOf(result.params)).toEqual({ style_id: null, duration: "5" });
  });

  test("a pasted URL or a stray slash is refused before it becomes a path Higgsfield does not serve", () => {
    const pasted = video.safe({ endpoint: `https://api.higgsfield.ai/${SEEDANCE}`, prompt: "x" });
    expect(!pasted.ok && pasted.errors.map((issue) => [issue.path, issue.meta?.["suggestion"]])).toEqual([[["endpoint"], SEEDANCE]]);
    expect(video.safe({ endpoint: `/${SEEDANCE}`, prompt: "x" }).ok).toBe(false);
  });
});

describe("higgsfield.video — the published facts of real routes", () => {
  test("every id in the list has a row, and the two agree", () => {
    expect(Object.keys(HIGGSFIELD_VIDEO_SHAPES).sort()).toEqual([...HIGGSFIELD_VIDEO_ENDPOINTS].sort());
    expect(HIGGSFIELD_VIDEO_ENDPOINTS).toHaveLength(87);
  });

  test("a closed route refuses an undeclared key and throws from the bare call", () => {
    expect(() => video({ endpoint: SEEDANCE, prompt: "x", camera: "pan" } as never)).toThrow(UnmodelValidationError);
    const result = video.safe({ endpoint: SEEDANCE, prompt: "x", camera: "pan" } as never);
    expect(!result.ok && result.errors.map((issue) => [issue.code, issue.path])).toEqual([["unsupported_param", ["camera"]]]);
    // A key NO route declares also draws the pipeline's generic warning; the
    // refusal is this route's own.
    expect(!result.ok && result.warnings.map((issue) => issue.code)).toEqual(["unknown_param"]);
    // A key some other route declares draws the refusal alone.
    const sibling = video.safe({ endpoint: SEEDANCE, prompt: "x", negative_prompt: "blur" } as never);
    expect(!sibling.ok && [sibling.errors.map((issue) => issue.code), sibling.warnings]).toEqual([["unsupported_param"], []]);
  });

  test("Seedance 2.5 takes `draft`: the console schema has it and the docs schema does not", () => {
    expect(video.safe({ endpoint: SEEDANCE, prompt: "x", draft: true }).ok).toBe(true);
  });

  test("an open route sends an undeclared key with a warning", () => {
    const result = video.safe({ endpoint: "higgsfield/genjutsu-light/object-swap/v1.0", video_url: "https://example.com/a.mp4", image_urls: ["https://example.com/a.png"], shiny: 1 } as never);
    expect(result.ok).toBe(true);
    expect(result.warnings.map((issue) => issue.code)).toEqual(["unknown_param"]);
  });

  test("a vocabulary is the route's own: 4k exists on Seedance 2.0 and not on 2.5", () => {
    expect(video.safe({ endpoint: "bytedance/seedance-2.0/text-to-video", prompt: "x", resolution: "4k" }).ok).toBe(true);
    const result = video.safe({ endpoint: SEEDANCE, prompt: "x", resolution: "4k" } as never);
    expect(!result.ok && result.errors[0]?.message).toBe('`resolution` must be "480p", "720p" or "1080p" on bytedance/seedance-2.5/text-to-video; got "4k".');
    expect(!result.ok && result.errors[0]?.meta?.["source"]).toBe("https://docs.higgsfield.ai/docs/models/seedance-2-5/text-to-video.md");
  });

  test("Genjutsu Restyle needs a `preset_id`, and it has to be a UUID", () => {
    const base = { endpoint: "higgsfield/genjutsu/restyle/v1.0", video_url: "https://example.com/a.mp4" } as const;
    const missing = video.safe(base as never);
    expect(!missing.ok && missing.errors.map((issue) => issue.message)).toEqual(["`preset_id` is required by higgsfield/genjutsu/restyle/v1.0."]);
    const named = video.safe({ ...base, preset_id: "Anime" });
    expect(!named.ok && named.errors[0]?.message).toStartWith('`preset_id` must be a UUID on higgsfield/genjutsu/restyle/v1.0; got "Anime".');
    expect(video.safe({ ...base, preset_id: "c2143317-f28d-4c3c-a0b8-39bd547e08a7" }).ok).toBe(true);
  });

  test("a reference route needs at least one reference", () => {
    const result = video.safe({ endpoint: "bytedance/seedance-2.5/reference-to-video", prompt: "x" });
    expect(!result.ok && result.errors.map((issue) => issue.message)).toEqual([
      "bytedance/seedance-2.5/reference-to-video needs at least one of `image_urls`, `video_urls`, `audio_urls`; the request sends none.",
    ]);
  });

  test("Kling 4.0: HDR requires a resolution that carries it", () => {
    const id = "kling-video/v4.0/text-to-video";
    const result = video.safe({ endpoint: id, prompt: "x", dynamic_range: "hdr", resolution: "720p" });
    expect(!result.ok && result.errors.map((issue) => issue.message)).toEqual([
      '`resolution` must be "1080p" or "4k" on kling-video/v4.0/text-to-video when `dynamic_range` is "hdr"; got "720p".',
    ]);
    expect(video.safe({ endpoint: id, prompt: "x", dynamic_range: "hdr", resolution: "4k" }).ok).toBe(true);
  });

  test("Kling O3: a request that omits `multi_shots` must satisfy one branch, and still needs its first frame", () => {
    const id = "kling-video/o3/first-last-frame";
    expect(video.safe({ endpoint: id, first_frame_url: "https://example.com/a.png", prompt: "x" } as never).ok).toBe(true);
    expect(video.safe({ endpoint: id, first_frame_url: "https://example.com/a.png", multi_prompt: [{ prompt: "x", duration: 5 }] } as never).ok).toBe(true);
    const neither = video.safe({ endpoint: id, first_frame_url: "https://example.com/a.png" } as never);
    expect(!neither.ok && neither.errors.map((issue) => issue.message)).toEqual([
      "kling-video/o3/first-last-frame omits `multi_shots`, and the request satisfies neither branch its schema takes on that: " +
        "`multi_prompt` is required by kling-video/o3/first-last-frame when `multi_shots` is true; " +
        "or `prompt` is required by kling-video/o3/first-last-frame when `multi_shots` is not true.",
    ]);
    const empty = video.safe({ endpoint: "kling-video/o3/image-reference" } as never);
    expect(!empty.ok && empty.errors.map((issue) => issue.path)).toEqual([["multi_prompt"]]);
    const shots = video.safe({ endpoint: id, first_frame_url: "https://example.com/a.png", multi_shots: true } as never);
    expect(!shots.ok && shots.errors.map((issue) => issue.message)).toEqual(["`multi_prompt` is required by kling-video/o3/first-last-frame when `multi_shots` is true."]);
    const frameless = video.safe({ endpoint: id, prompt: "x" } as never);
    expect(!frameless.ok && frameless.errors.map((issue) => issue.path)).toEqual([["first_frame_url"]]);
  });

  test("Cinema Studio: a prompt token has to index an attached item", () => {
    const id = "higgsfield/cinema-studio/4.0";
    expect(video.safe({ endpoint: id, prompt: "<<<image_1>>> walks", image_urls: ["https://example.com/a.png"] }).ok).toBe(true);
    const result = video.safe({ endpoint: id, prompt: "<<<video_1>>> walks", image_urls: ["https://example.com/a.png"] });
    expect(!result.ok && result.errors[0]?.message).toStartWith("`prompt` names <<<video_1>>>, and `video_urls` has 0 items on this request.");
  });

  test("a webhook that is not public https is refused before anything is sent", () => {
    const result = video.safe({ endpoint: SEEDANCE, prompt: "x", hf_webhook: "http://localhost:3000/hf" });
    expect(!result.ok && result.errors.map((issue) => issue.path)).toEqual([["hf_webhook"]]);
  });

  test("a wrong primitive is refused by the route's row, in a sentence that names the route and cites its page", () => {
    const result = video.safe({ endpoint: SEEDANCE, prompt: "x", duration: "5" } as never);
    if (result.ok) throw new Error("expected a refusal");
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.message).toBe(`\`duration\` must be a whole number on ${SEEDANCE}; got "5".`);
    expect(result.errors[0]?.meta?.["source"]).toStartWith("https://docs.higgsfield.ai/");
    // Published as wrong, so refused — and the caller's to overrule for one call.
    expect(video.safe({ endpoint: SEEDANCE, prompt: "x", duration: "5" } as never, { severity: { invalid_shape: "warning" } }).ok).toBe(true);
    expect(video.safe({ prompt: "x" } as never).ok).toBe(false);
  });

  test("Kling 4.0: HDR without `resolution` is a warning, because the published default is one HDR allows", () => {
    const result = video.safe({ endpoint: "kling-video/v4.0/text-to-video", prompt: "x", dynamic_range: "hdr" });
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(result.warnings.map((issue) => [issue.path, issue.meta?.["default"]])).toEqual([[["resolution"], "1080p"]]);
    expect(result.warnings[0]?.message).toStartWith("kling-video/v4.0/text-to-video's schema requires `resolution` when `dynamic_range` is \"hdr\", and the request omits it.");
    // A stated value the branch does not allow is still refused.
    const sd = video.safe({ endpoint: "kling-video/v4.0/text-to-video", prompt: "x", dynamic_range: "hdr", resolution: "720p" } as never);
    expect(sd.ok).toBe(false);
  });
});
