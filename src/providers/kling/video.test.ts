import { describe, expect, test } from "bun:test";
import { video, TEXT2VIDEO_MODELS, TEXT2VIDEO_URL } from "./video";
import { videoFromImage, IMAGE2VIDEO_MODELS, IMAGE2VIDEO_URL } from "./video-from-image";
// The unified adapter derives its `/v1/videos/*` rows from the same
// `V1_MODEL_RULES` these validators narrow their bodies from; the drift suite
// at the end of this file is what asserts that stays true — for those and for
// the path-addressed rows beside them.
import { video as unifiedVideo } from "./unified-video";
import { V1_MODE_TIERS, V1_MODEL_RULES, type V1ModelRules } from "./v1-routes";
import { MODE_RESOLUTION } from "./pricing";
import { KLING_VIDEO_FAL_OVERLAP, KLING_VIDEO_FAL_REFUSALS } from "./fal-target";
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

  test("an omitted model_name checks and prices nothing model-dependent", () => {
    // The reference marks it required while its prose says an empty one calls
    // a retired model, so no default is guessed: no rule row, no estimate.
    const r = video.safe({ prompt: "hi", mode: "4k", duration: "12" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings).toEqual([]);
      expect(r.estimate.costUSD).toBeUndefined();
    }
    const i2v = videoFromImage.safe({ image: "https://example.com/a.png", prompt: "hi" });
    expect(i2v.ok).toBe(true);
    if (i2v.ok) expect(i2v.estimate.costUSD).toBeUndefined();
  });

  test("the route's enum is the three ids the reference names", () => {
    // https://kling.ai/document-api/api/video/3-0-omni/text-to-video/legacy and
    // /image-to-video/legacy (2026-11-12): enum ["kling-v2-5-turbo","kling-v2-6","kling-v3"].
    expect([...TEXT2VIDEO_MODELS].sort()).toEqual(["kling-v2-5-turbo", "kling-v2-6", "kling-v3"]);
    expect([...IMAGE2VIDEO_MODELS].sort()).toEqual([...TEXT2VIDEO_MODELS].sort());
    // Each has a fal row, so there is no refusal left to record.
    expect(Object.keys(KLING_VIDEO_FAL_OVERLAP).sort()).toEqual([...TEXT2VIDEO_MODELS].sort());
    expect(Object.keys(KLING_VIDEO_FAL_REFUSALS)).toEqual([]);
  });

  test("path-segment model ids are unknown on the /v1 route", () => {
    const r = video.safe({ model_name: "kling-3.0", prompt: "hi" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
  });
});

describe("kling.video capability gates", () => {
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

});

describe("kling.videoFromImage", () => {
  test("wire-pure body with a start frame", () => {
    const v = videoFromImage({
      model_name: "kling-v2-5-turbo",
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
    // kling-v2-5-turbo at 1080P: $0.07/s × 5.
    const r = videoFromImage.safe({
      model_name: "kling-v2-5-turbo",
      image: "https://example.com/frame.png",
      prompt: "hi",
      mode: "pro",
      duration: "5",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.35, 10);
  });

  test("needs a start or end frame", () => {
    const r = videoFromImage.safe({ model_name: "kling-v2-6", prompt: "hi" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.path[0])).toContain("image");
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
// `./unified-video.ts` derives its `kling-v*` rows from; the assertions
// below tie every unified row to its rule tables in BOTH directions,
// so a value added to either side alone fails here. (The compile-time half
// lives in test/types/kling.test-d.ts, and the completion lists in
// test/unified/completions.test.ts.)
//
// The path-addressed rows are asserted but NOT derived: their rule tables
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
  durations?: readonly number[];
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
    expect(v1Ids.length).toBe(3);
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
    // multi-shot brings its two companions with it: `shot_type` and
    // `multi_prompt` do nothing without it.
    for (const key of ["multi_shot", "shot_type", "multi_prompt"]) {
      expect(declared(key), `${id} ${key}`).toBe(rules.multiShot === true);
    }
    // …and nothing else: an extra with no rule behind it would be a third
    // opinion about the same models.
    expect(sorted(Object.keys(extras)).length).toBe(
      1 + (rules.sound === true ? 1 : 0) + (rules.multiShot === true ? 3 : 0),
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
    expect(pathIds.length).toBe(8);
    expect(sorted(Object.keys(ROWS))).toEqual(
      sorted([...Object.keys(V1_MODEL_RULES), ...pathIds]),
    );
  });

  test.each(pathIds)("%s: durations, resolutions and ratios are the rule row's", (id) => {
    const rules = pathRules[id]!;
    const durations = ROWS[id]?.durations;
    if (durations === undefined) {
      // An absent list means a range (`VideoModelParams.durations`): every
      // integer from the first to the last, which is what the rule row spells.
      const first = rules.durations[0]!;
      expect(rules.durations).toEqual(
        Array.from({ length: rules.durations.length }, (_, i) => first + i),
      );
      expect(rules.durations.length).toBeGreaterThan(15);
    } else {
      expect(durations).toEqual(rules.durations);
    }
    expect(ROWS[id]?.resolutions).toEqual(rules.resolutions);
    // `adaptive` is omni's "read it off the inputs", not a shape.
    expect(ROWS[id]?.ratios).toEqual(rules.aspectRatios?.filter((r) => r !== "adaptive"));
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
