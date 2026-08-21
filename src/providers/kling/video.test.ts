import { describe, expect, test } from "bun:test";
import { video, TEXT2VIDEO_MODELS, TEXT2VIDEO_URL } from "./video";
import { videoFromImage, IMAGE2VIDEO_MODELS, IMAGE2VIDEO_URL } from "./video-from-image";
// The unified adapter derives its nine `/v1/videos/*` rows from the same
// `V1_MODEL_RULES` these validators narrow their bodies from; the drift suite
// at the end of this file is what asserts that stays true — for those nine and
// for the six path-addressed rows beside them.
import { video as unifiedVideo } from "./unified-video";
import { V1_MODE_TIERS, V1_MODEL_RULES, type V1ModelRules } from "./v1-routes";
import { MODE_RESOLUTION } from "./pricing";
import { TEXT_TO_VIDEO_V3_RULES } from "./video-v3";
import { IMAGE_TO_VIDEO_V3_RULES } from "./video-v3-from-image";
import { OMNI_VIDEO_RULES } from "./video-omni";
import type { RouteModelRules } from "./shared";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";

type Unchecked = (params: unknown, options?: ValidateOptions) => ValidateResult<Record<string, unknown>>;

const safeUnchecked = video.safe as unknown as Unchecked;
const safeFromImageUnchecked = videoFromImage.safe as unknown as Unchecked;

describe("kling.video happy path", () => {
  test("wire-pure body with URL and method", () => {
    const v = video({
      model_name: "kling-v2-6",
      prompt: "a slow push-in through a rainy neon alley",
      mode: "pro",
      duration: "10",
    });
    expect(Object.keys(v)).toEqual(["model_name", "prompt", "mode", "duration"]);
    expect(v.request.url).toBe(TEXT2VIDEO_URL);
    expect(v.request.method).toBe("POST");
  });

  test("model_name defaults to kling-v1", () => {
    const r = video.safe({ prompt: "hi" });
    expect(r.ok).toBe(true);
    // kling-v1 at 720P/5s: $0.028/s × 5.
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.14, 10);
  });

  test("path-segment model ids are unknown on the /v1 route", () => {
    const r = video.safe({ model_name: "kling-3.0", prompt: "hi" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
  });
});

describe("kling.video capability gates", () => {
  test("kling-v2-1 is image-to-video only", () => {
    const r = video.safe({ model_name: "kling-v2-1", prompt: "hi" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((e) => e.code === "unsupported_capability");
      expect(issue?.path).toEqual(["model_name"]);
      expect(issue?.meta?.supported).not.toContain("kling-v2-1");
    }
  });

  test("camera_control is kling-v1 only", () => {
    expect(
      video.safe({
        model_name: "kling-v1",
        prompt: "hi",
        camera_control: { type: "down_back" },
      }).ok,
    ).toBe(true);

    // The wire arm now types `camera_control` as `never` on every model but
    // kling-v1, so this input is illegal for a TS caller. The runtime path is
    // still reachable (and still what a JS caller hits), which is what this
    // assertion covers — the cast keeps it exercised without weakening the type.
    const r = video.safe({
      model_name: "kling-v1-6",
      prompt: "hi",
      // @ts-expect-error camera_control is kling-v1 only — the compile-time
      // half of the unsupported_capability asserted below.
      camera_control: { type: "down_back" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.find((e) => e.code === "unsupported_capability")?.path).toEqual([
        "camera_control",
      ]);
    }
  });

  test("cfg_scale is not supported on the kling-v2.x models", () => {
    const r = video.safe({
      model_name: "kling-v2-6",
      prompt: "hi",
      // @ts-expect-error `cfg_scale` types as `never` off kling-v1/-v1-5/-v1-6;
      // the runtime path this asserts is the one a JS caller still reaches.
      cfg_scale: 0.7,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["cfg_scale"]);

    expect(video.safe({ model_name: "kling-v1-6", prompt: "hi", cfg_scale: 0.7 }).ok).toBe(
      true,
    );
  });

  test("native audio is kling-v3 / kling-v2-6 only", () => {
    expect(video.safe({ model_name: "kling-v3", prompt: "hi", sound: "on" }).ok).toBe(true);

    const r = video.safe({
      model_name: "kling-v2-5-turbo",
      prompt: "hi",
      // @ts-expect-error `sound` types as `"off"` on a model with no native
      // audio; only switching it ON is refused, at compile time and at run time.
      sound: "on",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["sound"]);
  });

  test("the master models are 1080P-only", () => {
    const r = video.safe({
      model_name: "kling-v2-master",
      prompt: "hi",
      // @ts-expect-error the master models are 1080P-only, so `mode` is `"pro"`
      // on the type as well as in the enum message asserted below.
      mode: "std",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((e) => e.code === "invalid_enum_value");
      expect(issue?.path).toEqual(["mode"]);
      expect(issue?.meta?.allowed).toEqual(["pro"]);
    }
  });

  test("duration is a string on this route and per-model", () => {
    const r = video.safe({
      model_name: "kling-v2-5-turbo",
      prompt: "hi",
      // @ts-expect-error this model offers "5" and "10"; the type says so now,
      // and the runtime message asserted below names the same two.
      duration: "8",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.meta?.allowed).toEqual(["5", "10"]);

    expect(video.safe({ model_name: "kling-v3", prompt: "hi", duration: "8" }).ok).toBe(true);
  });
});

describe("kling.video shape rules", () => {
  test("multi_shot needs a shot_type, and customize needs multi_prompt", () => {
    const noType = video.safe({ model_name: "kling-v3", prompt: "hi", multi_shot: true });
    expect(noType.ok).toBe(false);
    if (!noType.ok) expect(noType.errors.map((e) => e.path[0])).toContain("shot_type");

    const customize = video.safe({
      model_name: "kling-v3",
      prompt: "hi",
      multi_shot: true,
      shot_type: "customize",
    });
    expect(customize.ok).toBe(false);
    if (!customize.ok) expect(customize.errors.map((e) => e.path[0])).toContain("multi_prompt");

    expect(
      video.safe({
        model_name: "kling-v3",
        multi_shot: true,
        shot_type: "customize",
        multi_prompt: [{ index: 1, prompt: "shot one", duration: "5" }],
      }).ok,
    ).toBe(true);
  });

  test("prompt is required when multi_shot is off", () => {
    const r = video.safe({ model_name: "kling-v3" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.path[0])).toContain("prompt");
  });

  test("simple camera control takes exactly one non-zero axis", () => {
    expect(
      video.safe({
        model_name: "kling-v1",
        prompt: "hi",
        camera_control: { type: "simple", config: { pan: 5, tilt: 0 } },
      }).ok,
    ).toBe(true);

    const two = video.safe({
      model_name: "kling-v1",
      prompt: "hi",
      camera_control: { type: "simple", config: { pan: 5, zoom: 2 } },
    });
    expect(two.ok).toBe(false);
    if (!two.ok) expect(two.errors[0]?.path).toEqual(["camera_control", "config"]);

    const preset = video.safe({
      model_name: "kling-v1",
      prompt: "hi",
      camera_control: { type: "forward_up", config: { pan: 1 } },
    });
    expect(preset.ok).toBe(false);
    if (!preset.ok) expect(preset.errors[0]?.code).toBe("unsupported_param");
  });

  test("camera axes are bounded to -10..10", () => {
    const r = safeUnchecked({
      model_name: "kling-v1",
      prompt: "hi",
      camera_control: { type: "simple", config: { pan: 11 } },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("invalid_shape");
  });
});

describe("kling.videoFromImage", () => {
  test("wire-pure body with a start frame", () => {
    const v = videoFromImage({
      model_name: "kling-v2-1",
      image: "https://example.com/frame.png",
      prompt: "she turns to the window",
      mode: "pro",
      duration: "5",
    });
    // `model_name` is a BODY field on this route: nothing is stripped.
    expect(Object.keys(v)).toEqual(["model_name", "image", "prompt", "mode", "duration"]);
    expect(v.request.url).toBe(IMAGE2VIDEO_URL);
    expect(v.request.method).toBe("POST");
    expect(v.request.headers).toEqual({ "content-type": "application/json" });
    // kling-v2-1 at 1080P: $0.098/s × 5.
    const r = videoFromImage.safe({
      model_name: "kling-v2-1",
      image: "https://example.com/frame.png",
      prompt: "hi",
      mode: "pro",
      duration: "5",
    });
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.49, 10);
  });

  test("needs a start or end frame", () => {
    const r = videoFromImage.safe({ model_name: "kling-v1-6", prompt: "hi" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.path[0])).toContain("image");
  });

  test("image_tail, masks and camera_control are mutually exclusive", () => {
    const r = videoFromImage.safe({
      model_name: "kling-v1",
      image: "https://example.com/a.png",
      image_tail: "https://example.com/b.png",
      prompt: "hi",
      camera_control: { type: "down_back" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((e) => e.code === "unsupported_param");
      expect(issue?.meta?.conflicting).toEqual(["image_tail", "camera_control"]);
    }
  });

  test("element_list and voice_list cannot coexist and are capped", () => {
    const both = videoFromImage.safe({
      model_name: "kling-v3",
      image: "https://example.com/a.png",
      prompt: "hi",
      element_list: [{ element_id: 1 }],
      voice_list: [{ voice_id: "v1" }],
    });
    expect(both.ok).toBe(false);
    if (!both.ok) {
      expect(both.errors.find((e) => e.code === "unsupported_param")?.path).toEqual(["voice_list"]);
    }

    const tooMany = videoFromImage.safe({
      model_name: "kling-v3",
      image: "https://example.com/a.png",
      prompt: "hi",
      element_list: [{ element_id: 1 }, { element_id: 2 }, { element_id: 3 }, { element_id: 4 }],
    });
    expect(tooMany.ok).toBe(false);
    if (!tooMany.ok) {
      expect(tooMany.errors.find((e) => e.code === "invalid_shape")?.meta?.max).toBe(3);
    }
  });

  test("every KlingV1Duration preset passes on the model that offers the range", () => {
    // Keep in sync with KlingV1Duration in v1-routes.ts — the union is the
    // widest documented range (THREE_TO_FIFTEEN, kling-v3's 3–15s), so every
    // preset must validate on kling-v3; V1_MODEL_RULES narrows it elsewhere.
    const presets = [
      "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15",
    ] as const;
    for (const duration of presets) {
      const t2v = video.safe({ model_name: "kling-v3", prompt: "hi", duration });
      expect(t2v.ok, `text2video preset ${duration} should validate`).toBe(true);
      if (t2v.ok) expect(t2v.warnings, `text2video preset ${duration}`).toEqual([]);

      const i2v = videoFromImage.safe({
        model_name: "kling-v3",
        image: "https://example.com/a.png",
        prompt: "hi",
        duration,
      });
      expect(i2v.ok, `image2video preset ${duration} should validate`).toBe(true);
      if (i2v.ok) expect(i2v.warnings, `image2video preset ${duration}`).toEqual([]);
    }
  });

  test("kling-v1-5 is accepted here but not on video", () => {
    expect(
      videoFromImage.safe({
        model_name: "kling-v1-5",
        image: "https://example.com/a.png",
        prompt: "hi",
      }).ok,
    ).toBe(true);
    expect(video.safe({ model_name: "kling-v1-5", prompt: "hi" }).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Drift: the wire arms vs the runtime rule tables vs the unified rows.
//
// `kling.video` accepted `duration: "8"` on `kling-v2-5-turbo` at compile time
// for as long as the endpoint existed, while `unmodel/video` — the surface
// that compiles down to this one — refused the same fact, and `V1_MODEL_RULES`
// refused it at run time. Three descriptions of the same models, and nothing
// compared them, which is exactly why it rotted unnoticed. `V1_MODEL_RULES` is
// now the one the `/v1/videos/*` types are built from AND the one
// `./unified-video.ts` derives its nine `kling-v*` rows from; the assertions
// below tie all fifteen unified rows to their rule tables in BOTH directions,
// so a value added to either side alone fails here. (The compile-time half
// lives in test/types/kling.test-d.ts, and the completion lists in
// test/unified/completions.test.ts.)
//
// The six path-addressed rows are asserted but NOT derived: their rule tables
// were recovered from the doc site's JS bundle rather than read off a served
// page, so `kling.videoV3` / `videoV3FromImage` / `videoOmni` keep wide bodies
// on purpose — a compile error a caller cannot work around is the wrong answer
// on a route nobody can verify, and the run-time check already reports it.
// ---------------------------------------------------------------------------

/** Sorted and widened, so a tuple type on one side does not decide the comparison. */
function sorted(values: readonly (string | number)[] = []): Array<string | number> {
  return [...values].sort();
}

/** One unified row, at the interface type the drift suite compares against. */
interface Row {
  durations: readonly number[];
  resolutions: readonly string[];
  ratios?: readonly string[];
  extras?: Readonly<Record<string, unknown>>;
}

const ROWS: Readonly<Record<string, Row>> = unifiedVideo.modelParams;

describe("kling video: the per-model tables agree (wire ↔ runtime ↔ unified)", () => {
  const v1Ids: string[] = Object.keys(V1_MODEL_RULES);
  const rulesOf = (id: string): V1ModelRules => V1_MODEL_RULES[id]!;

  test("mode → tier is one table, not two", () => {
    // `V1_MODE_TIERS` is what the unified rows are derived through and
    // `MODE_RESOLUTION` is what the cost estimate reads; both transcribe the
    // same sentence of the `mode` parameter's documentation.
    const tiers: Record<string, string> = { ...V1_MODE_TIERS };
    expect(tiers).toEqual({ ...MODE_RESOLUTION });
  });

  test("every /v1/videos/* model has a rule row, and every rule row a unified row", () => {
    expect(v1Ids.length).toBe(9);
    for (const id of [...TEXT2VIDEO_MODELS, ...IMAGE2VIDEO_MODELS]) {
      expect(v1Ids, `${id} is on a /v1/videos/* route with no V1_MODEL_RULES row`).toContain(id);
    }
    for (const id of v1Ids) {
      expect(ROWS[id], `${id} has rules but no unified row`).toBeDefined();
      // Neither list may carry a model the other does not: an id with rules is
      // an id one of the two routes serves.
      expect(
        [...TEXT2VIDEO_MODELS, ...IMAGE2VIDEO_MODELS] as readonly string[],
        `${id} has rules but no route`,
      ).toContain(id);
    }
  });

  test.each(v1Ids)("%s: the unified durations are the rule list, in seconds", (id) => {
    expect(ROWS[id]?.durations).toEqual(rulesOf(id).durations.map(Number));
  });

  test.each(v1Ids)("%s: the unified resolutions are the rule list's modes as tiers", (id) => {
    expect(ROWS[id]?.resolutions).toEqual(
      rulesOf(id).modes.map((mode) => V1_MODE_TIERS[mode as keyof typeof V1_MODE_TIERS]),
    );
  });

  test.each(v1Ids)("%s: ratios are the full enum iff the id is on text2video", (id) => {
    const onText = (TEXT2VIDEO_MODELS as readonly string[]).includes(id);
    expect(ROWS[id]?.ratios).toEqual(onText ? ["16:9", "9:16", "1:1"] : []);
  });

  test.each(v1Ids)("%s: each capability extra is declared iff its rule switch is on", (id) => {
    const rules = rulesOf(id);
    const extras = ROWS[id]?.extras ?? {};
    const declared = (key: string): boolean => Object.hasOwn(extras, key);
    // `watermark_info` is a body-root field on every `/v1/videos/*` model and
    // has no switch — it is the one extra the rule table says nothing about.
    expect(declared("watermark_info"), `${id} watermark_info`).toBe(true);
    expect(declared("sound"), `${id} sound`).toBe(rules.sound === true);
    expect(declared("cfg_scale"), `${id} cfg_scale`).toBe(rules.cfgScale === true);
    expect(declared("camera_control"), `${id} camera_control`).toBe(rules.cameraControl === true);
    // multi-shot brings its two companions with it: `shot_type` and
    // `multi_prompt` do nothing without it.
    for (const key of ["multi_shot", "shot_type", "multi_prompt"]) {
      expect(declared(key), `${id} ${key}`).toBe(rules.multiShot === true);
    }
    // …and nothing else: an extra with no rule behind it would be a third
    // opinion about the same nine models.
    expect(sorted(Object.keys(extras)).length).toBe(
      1 +
        (rules.sound === true ? 1 : 0) +
        (rules.cfgScale === true ? 1 : 0) +
        (rules.cameraControl === true ? 1 : 0) +
        (rules.multiShot === true ? 3 : 0),
    );
  });

  test("every mode and duration the wire arm admits is one the runtime accepts", () => {
    for (const id of v1Ids) {
      const rules = rulesOf(id);
      const onText = (TEXT2VIDEO_MODELS as readonly string[]).includes(id);
      for (const mode of rules.modes) {
        if (onText) {
          expect(
            safeUnchecked({ model_name: id, prompt: "hi", mode }).ok,
            `${id} text2video mode ${mode}`,
          ).toBe(true);
        }
        expect(
          safeFromImageUnchecked({
            model_name: id,
            image: "https://example.com/a.png",
            prompt: "hi",
            mode,
          }).ok,
          `${id} image2video mode ${mode}`,
        ).toBe(true);
      }
      for (const duration of rules.durations) {
        if (onText) {
          expect(
            safeUnchecked({ model_name: id, prompt: "hi", duration }).ok,
            `${id} text2video duration ${duration}`,
          ).toBe(true);
        }
        expect(
          safeFromImageUnchecked({
            model_name: id,
            image: "https://example.com/a.png",
            prompt: "hi",
            duration,
          }).ok,
          `${id} image2video duration ${duration}`,
        ).toBe(true);
      }
      // The switches the arm types `never`/`"off"`/`false` off their models:
      // the runtime refuses exactly the same requests.
      const gated: Array<[string, Record<string, unknown>, boolean]> = [
        ["sound", { sound: "on" }, rules.sound === true],
        ["cfg_scale", { cfg_scale: 0.7 }, rules.cfgScale === true],
        ["camera_control", { camera_control: { type: "down_back" } }, rules.cameraControl === true],
      ];
      for (const [label, extra, supported] of gated) {
        const r = safeFromImageUnchecked({
          model_name: id,
          image: "https://example.com/a.png",
          prompt: "hi",
          ...extra,
        });
        expect(r.ok, `${id} ${label} (supported: ${supported})`).toBe(supported);
      }
    }
  });
});

describe("kling video: the path-addressed rows match their route rules", () => {
  /** Every model on the two experimental families, and the rules behind it. */
  const pathRules: Readonly<Record<string, RouteModelRules>> = {
    ...TEXT_TO_VIDEO_V3_RULES,
    ...OMNI_VIDEO_RULES,
  };
  const pathIds: string[] = Object.keys(pathRules);

  test("the unified table is exactly the two families, and nothing else", () => {
    expect(pathIds.length).toBe(6);
    expect(sorted(Object.keys(ROWS))).toEqual(
      sorted([...Object.keys(V1_MODEL_RULES), ...pathIds]),
    );
  });

  test.each(pathIds)("%s: durations, resolutions and ratios are the rule row's", (id) => {
    const rules = pathRules[id]!;
    expect(ROWS[id]?.durations).toEqual(rules.durations);
    expect(ROWS[id]?.resolutions).toEqual(rules.resolutions);
    expect(ROWS[id]?.ratios).toEqual(rules.aspectRatios);
  });

  test.each(pathIds)("%s: the text and image arms agree about the same model", (id) => {
    const text = TEXT_TO_VIDEO_V3_RULES[id];
    const image = IMAGE_TO_VIDEO_V3_RULES[id];
    if (text === undefined || image === undefined) return;
    // The unified row is one row per model, so a model whose two arms differed
    // could not be described by it — this is what makes the row legitimate.
    expect(image.resolutions).toEqual(text.resolutions);
    expect(image.durations).toEqual(text.durations);
    expect(image.audio).toEqual(text.audio);
    expect(image.multiShot).toEqual(text.multiShot);
  });

  test.each(pathIds)("%s: the audio and multi-shot extras are the rule row's", (id) => {
    const rules = pathRules[id]!;
    const extras = ROWS[id]?.extras ?? {};
    expect(Object.hasOwn(extras, "audio"), `${id} audio`).toBe(rules.audio !== undefined);
    expect(Object.hasOwn(extras, "multi_shot"), `${id} multi_shot`).toBe(rules.multiShot === true);
    expect(Object.hasOwn(extras, "watermark_info"), `${id} watermark_info`).toBe(true);
  });
});
