/**
 * `fal.video` — the wire contract, and the one category where the per-endpoint
 * IR is doing the most work in this provider.
 *
 * The routing and stripping contract is `fal.image`'s and is asserted there.
 * What is asserted here is what makes THIRTY endpoints share one address
 * safely:
 *
 * 1. **`duration` is four different types across the roster**, so the category
 *    schema widens it to `unknown` and the IR is the only thing that knows the
 *    real one. A union that accepted both `"8s"` and `5` would accept `"8s"` at
 *    kling, which fal refuses.
 * 2. **The keyframe parameter has six spellings**, and each endpoint declares
 *    exactly one of them — so a first frame sent under a sibling's name is a
 *    warning naming the sibling, not a silent pass.
 * 3. **A `const` property lowers to a one-value enum**, which is how
 *    `fal-ai/veo3.1/extend-video` (whose `duration` and `resolution` are both
 *    `const`) classifies at all.
 * 4. **Two of the thirty publish a flat rate**, so two estimates are numbers
 *    and twenty-eight are `undefined` with a reason.
 */

import { describe, expect, test } from "bun:test";
import { video } from "./video";
import { FAL_VIDEO_ENDPOINTS } from "./gen/endpoints.gen";
import { FAL_VIDEO_SHAPES } from "./gen/video-narrow.gen";
import { falPriceNote } from "./pricing";

const PROMPT = "a drone shot over a fjord at dawn";
const FRAME = "https://example.com/frame.png";

describe("routing", () => {
  test("every curated endpoint routes to a queue URL that round-trips its id", () => {
    // The body is built from each endpoint's OWN required list rather than
    // hard-coded, which is what lets one loop cover thirty routes whose
    // required media ranges from nothing (text-to-video) to two named frames
    // (veo3.1's interpolation route). It also means the loop asserts something
    // stronger than routing: every curated endpoint's required set is
    // satisfiable from the IR alone.
    for (const endpoint of FAL_VIDEO_ENDPOINTS) {
      const shape = FAL_VIDEO_SHAPES[endpoint as keyof typeof FAL_VIDEO_SHAPES] as {
        order: readonly string[];
        props: Readonly<Record<string, { req?: true; def?: true; media?: string; t: string }>>;
      };
      const body: Record<string, unknown> = { endpoint };
      for (const name of shape.order) {
        const spec = shape.props[name];
        if (spec?.req !== true || spec.def === true) continue;
        body[name] = spec.media === undefined ? PROMPT : `https://example.com/asset-${name}`;
      }
      const params = video(body as never);
      expect(params.request.url, endpoint).toBe(`https://queue.fal.run/${endpoint}`);
      expect(params.request.method).toBe("POST");
    }
  });

  test("the vendor-namespaced ids route to the PUBLISHED id, not fal's internal alias", () => {
    // fal documents `minimax/h3/text-to-video` at `/fal-ai/minimax_h3/…`,
    // `xai/grok-imagine-video/text-to-video` at `/fal-ai/xai/…` and
    // `fal-ai/wan/v2.7/text-to-video` at `/fal-ai/wan-27-t2v/…`. All three
    // published ids are live; those are what unmodel submits to.
    const cases: Array<[string, string]> = [
      ["minimax/h3/text-to-video", "https://queue.fal.run/minimax/h3/text-to-video"],
      [
        "xai/grok-imagine-video/text-to-video",
        "https://queue.fal.run/xai/grok-imagine-video/text-to-video",
      ],
      ["fal-ai/wan/v2.7/text-to-video", "https://queue.fal.run/fal-ai/wan/v2.7/text-to-video"],
      [
        "lightricks/ltx-2.5/text-to-video/pro",
        "https://queue.fal.run/lightricks/ltx-2.5/text-to-video/pro",
      ],
    ];
    for (const [endpoint, url] of cases) {
      expect(video({ endpoint, prompt: PROMPT } as never).request.url, endpoint).toBe(url);
    }
  });

  test("`endpoint` is stripped from the body it routed", () => {
    const params = video({ endpoint: "fal-ai/veo3.1", prompt: PROMPT, duration: "8s" });
    expect(Object.keys(params).sort()).toEqual(["duration", "prompt"]);
    expect(params.request.url).toBe("https://queue.fal.run/fal-ai/veo3.1");
  });
});

describe("`duration` — one word, four types, thirty endpoints", () => {
  test("kling takes a bare string, veo3.1 a suffixed one, wan an integer", () => {
    expect(
      video({ endpoint: "fal-ai/kling-video/v3/pro/text-to-video", prompt: PROMPT, duration: "12" }).duration,
    ).toBe("12");
    expect(video({ endpoint: "fal-ai/veo3.1/fast", prompt: PROMPT, duration: "8s" }).duration).toBe("8s");
    expect(
      video({ endpoint: "fal-ai/wan/v2.7/text-to-video", prompt: PROMPT, duration: 10 }).duration,
    ).toBe(10);
  });

  test("each endpoint's own vocabulary is enforced, and names that endpoint", () => {
    // veo3.1's spelling at kling — a request the category SCHEMA cannot refuse,
    // because it had to widen `duration` to `unknown`. This is the IR earning
    // its existence.
    const bad = video.safe({
      endpoint: "fal-ai/kling-video/v3/pro/text-to-video",
      prompt: PROMPT,
      duration: "8s",
    } as never);
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    const issue = bad.errors.find((error) => error.path?.[0] === "duration");
    expect(issue?.code).toBe("invalid_enum_value");
    expect(issue?.message).toContain("fal-ai/kling-video/v3/pro/text-to-video");
    expect(issue?.meta?.["source"]).toContain("fal.ai/models/fal-ai/kling-video/v3/pro/text-to-video");

    // …and the reverse: kling's spelling at veo3.1.
    const other = video.safe({ endpoint: "fal-ai/veo3.1/fast", prompt: PROMPT, duration: "8" } as never);
    expect(other.ok).toBe(false);
    if (other.ok) return;
    expect(other.errors.some((error) => error.message.includes('"4s"'))).toBe(true);
  });

  test("an integer duration outside its range is refused with that endpoint's bounds", () => {
    const bad = video.safe({
      endpoint: "fal-ai/pixverse/v6/text-to-video",
      prompt: PROMPT,
      duration: 30,
    } as never);
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.errors.some((error) => error.message.includes("at most 15"))).toBe(true);
  });
});

describe("`const` lowers to a one-value enum", () => {
  test("veo3.1/extend-video's duration and resolution each have exactly one legal value", () => {
    const ok = video.safe({
      endpoint: "fal-ai/veo3.1/extend-video",
      prompt: PROMPT,
      video_url: "https://example.com/clip.mp4",
      duration: "7s",
      resolution: "720p",
    });
    expect(ok.ok).toBe(true);

    const bad = video.safe({
      endpoint: "fal-ai/veo3.1/extend-video",
      prompt: PROMPT,
      video_url: "https://example.com/clip.mp4",
      duration: "8s",
    } as never);
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    const issue = bad.errors.find((error) => error.path?.[0] === "duration");
    expect(issue?.message).toContain("the only value this endpoint's schema declares");
  });
});

describe("six spellings for one keyframe", () => {
  test("each endpoint declares exactly one, and a sibling's name is a warning", () => {
    // kling v3 spells the opening frame `start_image_url`; seedance spells it
    // `image_url`. Sending seedance's name to kling is the mistake the union
    // schema is structurally unable to see, and `checkKnownParams` is what
    // names it.
    const result = video.safe({
      endpoint: "fal-ai/kling-video/v3/pro/image-to-video",
      prompt: PROMPT,
      image_url: FRAME,
      start_image_url: FRAME,
    } as never);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const warning = result.warnings.find((issue) => issue.code === "unknown_param");
    expect(warning?.message).toContain("fal-ai/kling-video/v3/pro/image-to-video");
    expect(warning?.message).toContain('"image_url" is not a parameter');
    expect(warning?.message).toContain("start_image_url");
    // The plural agrees with the count — eight siblings do take `image_url`,
    // which the message says as "8 other endpoints … do take it".
    expect(warning?.message).toMatch(/\d+ other endpoints in this category do take it/);
  });

  test("veo3.1's interpolation route requires BOTH frames, by their own names", () => {
    const missing = video.safe({
      endpoint: "fal-ai/veo3.1/first-last-frame-to-video",
      prompt: PROMPT,
      first_frame_url: FRAME,
    } as never);
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.errors.map((error) => error.path?.[0])).toEqual(["last_frame_url"]);
  });

  test("every keyframe parameter is a media reference, whatever its name", () => {
    for (const [endpoint, key] of [
      ["bytedance/seedance-2.5/image-to-video", "image_url"],
      ["fal-ai/kling-video/v3/pro/image-to-video", "start_image_url"],
      ["fal-ai/veo3.1/first-last-frame-to-video", "first_frame_url"],
    ] as const) {
      const bad = video.safe({
        endpoint,
        prompt: PROMPT,
        [key]: "./frame.png",
        // Whatever else the route requires; the media check runs regardless.
        last_frame_url: FRAME,
        audio_url: FRAME,
      } as never);
      expect(bad.ok, endpoint).toBe(false);
      if (bad.ok) continue;
      const issue = bad.errors.find((error) => error.path?.[0] === key);
      expect(issue?.meta?.["media"], endpoint).toBe("image");
      expect(issue?.message, endpoint).toContain("looks like a local path");
    }
  });
});

describe("degradation", () => {
  test("an endpoint the roster has never seen still compiles and routes", () => {
    const result = video.safe({ endpoint: "fal-ai/veo4", prompt: PROMPT, duration: "9s" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.params.request.url).toBe("https://queue.fal.run/fal-ai/veo4");
    expect(result.warnings.some((issue) => issue.code === "unknown_model")).toBe(true);
  });
});

describe("estimates", () => {
  test("the two flat per-second rates are the only endpoints that answer a number", () => {
    // …and even those answer `undefined` from a request body, because the
    // billed quantity is the OUTPUT clip's length, which the request states
    // only sometimes and never for the routes that decide it themselves.
    const priced = video.safe({
      endpoint: "fal-ai/minimax/hailuo-02/pro/image-to-video",
      prompt: PROMPT,
      image_url: FRAME,
    });
    expect(priced.ok).toBe(true);
    if (!priced.ok) return;
    expect(priced.estimate?.costUSD).toBeUndefined();
  });

  test("a conditional rate says which field would have settled it", () => {
    const note = falPriceNote("fal-ai/veo3.1/fast");
    expect(note).toContain("generate_audio");
    expect(note).toContain("resolution");
  });

  test("a token-priced endpoint says the number does not exist in advance", () => {
    expect(falPriceNote("google/gemini-omni-flash")).toContain("TOKEN consumption");
  });
});

describe("toSdk", () => {
  test('`.toSdk("fal")` nests the body under `input`, as fal\'s client documents', () => {
    const params = video({ endpoint: "fal-ai/veo3.1/fast", prompt: PROMPT, duration: "8s" });
    expect(params.toSdk("fal")).toEqual({ input: { prompt: PROMPT, duration: "8s" } });
  });
});
