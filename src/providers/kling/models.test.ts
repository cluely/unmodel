import { describe, expect, test } from "bun:test";
import type { ModelInfo } from "../../core/catalog-types";
import {
  imageModels,
  models,
  omniImageModels,
  pathVideoModels,
  v1VideoModels,
  videoModels,
} from "./models";
import { videoCostUSD } from "./pricing";

/** Ids that name a video model AND a different image model. */
const SHADOWED = ["kling-v3"] as const;

describe("kling catalog shape", () => {
  test("the per-kind maps are unambiguous", () => {
    const video: Record<string, ModelInfo> = videoModels;
    for (const [id, info] of Object.entries(video)) {
      expect(info.cost?.perImage, `${id} is a video row`).toBeUndefined();
      expect(info.modalities.output).toContain("video");
    }
    const image: Record<string, ModelInfo> = { ...imageModels, ...omniImageModels };
    for (const [id, info] of Object.entries(image)) {
      expect(info.cost?.perVideoSecond, `${id} is an image row`).toBeUndefined();
      expect(info.modalities.output).toEqual(["image"]);
    }
  });

  test("videoModels covers both id spaces and they do not collide", () => {
    // Object.hasOwn, not toHaveProperty: ids like "kling-3.0" contain a dot,
    // which toHaveProperty would read as a nested path.
    for (const id of Object.keys(v1VideoModels)) expect(Object.hasOwn(videoModels, id)).toBe(true);
    for (const id of Object.keys(pathVideoModels)) {
      expect(Object.hasOwn(videoModels, id)).toBe(true);
    }
    const overlap = Object.keys(v1VideoModels).filter((id) => id in pathVideoModels);
    expect(overlap).toEqual([]);
  });

  test("the Kling 4.0 rows carry their default configuration's rate", () => {
    // 1080p is 4.0's default and 720p Flash's only tier; no video input.
    for (const id of ["kling-4.0", "kling-4.0-flash"] as const) {
      expect(pathVideoModels[id].cost.perVideoSecond, id).toBeCloseTo(
        videoCostUSD({ model: id, duration: 1 })!,
        10,
      );
    }
  });
});

describe("kling shadowed ids", () => {
  test("every shadowed id really is claimed by both kinds", () => {
    for (const id of SHADOWED) {
      expect(Object.hasOwn(v1VideoModels, id)).toBe(true);
      expect(Object.hasOwn(imageModels, id)).toBe(true);
    }
  });

  test("models[id] never hands a video-only row to an image lookup", () => {
    for (const id of SHADOWED) {
      const merged = models[id];
      // The bug this pins: a plain spread let the video row win, so
      // `models["kling-v3"].cost.perImage` was undefined and a caller reading
      // `perVideoSecond` for an image job was off by 3x.
      expect(merged.cost.perImage, `${id} keeps its per-image rate`).toBe(
        imageModels[id].cost.perImage,
      );
      expect(merged.cost.perVideoSecond, `${id} keeps its per-second rate`).toBe(
        v1VideoModels[id].cost.perVideoSecond,
      );
      expect(merged.modalities.output).toEqual(["video", "image"]);
    }
  });

  test("non-shadowed image ids survive the merge with an image rate", () => {
    // `kling-v2-1` names an image model only.
    expect(models["kling-v2-1"]).toBe(imageModels["kling-v2-1"]);
    expect(models["kling-v2-1"].cost.perImage).toBe(0.014);
    expect(models["kling-image-o1"]).toBe(omniImageModels["kling-image-o1"]);
  });

  test("the catalogs carry each route's documented enum, and nothing else", () => {
    // https://kling.ai/document-api/api/image/3-0-omni/image-generation
    // (2026-11-12): enum ["kling-v2-1","kling-v3"]; the /v1/videos/* legacy
    // pages: enum ["kling-v2-5-turbo","kling-v2-6","kling-v3"].
    expect(Object.keys(imageModels).sort()).toEqual(["kling-v2-1", "kling-v3"]);
    expect(Object.keys(v1VideoModels).sort()).toEqual([
      "kling-v2-5-turbo",
      "kling-v2-6",
      "kling-v3",
    ]);
  });

  test("every id in every per-kind map is reachable from `models`", () => {
    const all = [
      ...Object.keys(videoModels),
      ...Object.keys(imageModels),
      ...Object.keys(omniImageModels),
    ];
    for (const id of all) expect(Object.hasOwn(models, id), `${id} in models`).toBe(true);
    expect(Object.keys(models).length).toBe(new Set(all).size);
  });
});
