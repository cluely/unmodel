import { describe, expect, test } from "bun:test";
import { REVANA_PRICING_CAVEAT, revanaCostUSD } from "./pricing";
import type { RevanaListedPrice, RevanaModelShape } from "./shape-types";

/**
 * The listed-price resolver, against hand-written rows shaped like the five
 * kinds of rate Revana publishes. `oracle.test.ts` holds it to the real rows
 * and the quotes the API actually answered.
 */

const VIDEO: RevanaModelShape = {
  kind: "video",
  tasks: ["text_to_video"],
  media: [],
  resolutions: ["720p", "1080p", "4K"],
  audio: true,
};
const IMAGE: RevanaModelShape = { kind: "image", tasks: ["text_to_image"], media: [], resolutions: ["1K", "2K"] };
const SPEECH: RevanaModelShape = { kind: "audio", tasks: ["text_to_speech"], media: [] };

describe("revanaCostUSD", () => {
  test("a per-second rate keyed by resolution needs the resolution and the duration", () => {
    const price: RevanaListedPrice = { unit: "per_second", usd: { "720p": 0.2, "1080p": 0.3 } };
    const shape: RevanaModelShape = { ...VIDEO, audio: undefined };
    expect(revanaCostUSD(price, shape, { resolution: "1080p", duration: 8 })).toBe(2.4);
    // Matched the way the API matches a setting: ignoring case.
    expect(revanaCostUSD(price, shape, { resolution: "1080P", duration: 8 })).toBe(2.4);
    expect(revanaCostUSD(price, shape, { duration: 8 })).toBeUndefined();
    expect(revanaCostUSD(price, shape, { resolution: "1080p" })).toBeUndefined();
  });

  test("an `+audio` variant is priced only when the toggle is stated — no default is published", () => {
    const price: RevanaListedPrice = {
      unit: "per_second",
      usd: { "720p": 0.2, "720p+audio": 0.4, "4K": 0.4, "4K+audio": 0.58 },
    };
    expect(revanaCostUSD(price, VIDEO, { resolution: "720p", duration: 4, audio: true })).toBe(1.6);
    expect(revanaCostUSD(price, VIDEO, { resolution: "720p", duration: 4, audio: false })).toBe(0.8);
    expect(revanaCostUSD(price, VIDEO, { resolution: "720p", duration: 4 })).toBeUndefined();
  });

  test("a rate that depends on a linked clip's length is not priced", () => {
    const price: RevanaListedPrice = {
      unit: "per_second",
      usd: { "720p": 0.21, "720p+video_input": 0.15 },
    };
    const shape: RevanaModelShape = { ...VIDEO, audio: undefined };
    expect(revanaCostUSD(price, shape, { resolution: "720p", duration: 5 })).toBe(1.05);
    expect(
      revanaCostUSD(price, shape, { resolution: "720p", duration: 5, video_url: "https://example.com/a.mp4" }),
    ).toBeUndefined();
    const nemesis: RevanaListedPrice = { unit: "per_second", usd: { "720p": 0.17 }, billed: "input_and_output_seconds" };
    expect(revanaCostUSD(nemesis, shape, { resolution: "720p", duration: 5 })).toBeUndefined();
  });

  test("a per-job fee is added once", () => {
    const price: RevanaListedPrice = {
      unit: "per_second",
      usd: { "720p": 0.03 },
      feeUsd: { "720p": 0.18 },
    };
    const shape: RevanaModelShape = { ...VIDEO, resolutions: ["720p"], audio: undefined };
    expect(revanaCostUSD(price, shape, { resolution: "720p", duration: 6 })).toBe(0.36);
  });

  test("a flat per-second model with no resolutions is priced from the duration alone", () => {
    const price: RevanaListedPrice = { unit: "per_second", usd: { standard: 0.1 } };
    const shape: RevanaModelShape = { kind: "video", tasks: ["text_to_video"], media: [] };
    expect(revanaCostUSD(price, shape, { duration: 5 })).toBe(0.5);
    expect(revanaCostUSD({ unit: "per_second", usd: 0.05 }, shape, { duration: 10 })).toBe(0.5);
  });

  test("`generate_audio` picks the `+audio` rate exactly as `audio` does", () => {
    const price: RevanaListedPrice = { unit: "per_second", usd: { "720p": 0.2, "720p+audio": 0.4 } };
    const shape: RevanaModelShape = { ...VIDEO, resolutions: ["720p"] };
    expect(revanaCostUSD(price, shape, { resolution: "720p", duration: 8, generate_audio: true })).toBe(3.2);
    expect(revanaCostUSD(price, shape, { resolution: "720p", duration: 8, generate_audio: false })).toBe(1.6);
    expect(revanaCostUSD(price, shape, { resolution: "720p", duration: 8 })).toBeUndefined();
  });

  test("pictures are priced per picture, `num_images` and `n` alike", () => {
    expect(revanaCostUSD({ unit: "per_image", usd: 0.05 }, IMAGE, {})).toBe(0.05);
    expect(revanaCostUSD({ unit: "per_image", usd: 0.05 }, IMAGE, { num_images: 3 })).toBe(0.15);
    expect(revanaCostUSD({ unit: "per_image", usd: 0.05 }, IMAGE, { n: 2 })).toBe(0.1);
    const keyed: RevanaListedPrice = { unit: "per_image", usd: { "1K": 0.04, "2K": 0.08 } };
    expect(revanaCostUSD(keyed, IMAGE, { resolution: "2k", num_images: 2 })).toBe(0.16);
    expect(revanaCostUSD(keyed, IMAGE, {})).toBeUndefined();
  });

  test("a quality-keyed rate falls back to the published default quality", () => {
    const shape: RevanaModelShape = { ...IMAGE, resolutions: undefined, qualities: ["balanced", "quality", "turbo"], defaultQuality: "balanced" };
    const price: RevanaListedPrice = { unit: "per_image", usd: { balanced: 0.06, quality: 0.09, turbo: 0.03 } };
    expect(revanaCostUSD(price, shape, {})).toBe(0.06);
    expect(revanaCostUSD(price, shape, { quality: "TURBO" })).toBe(0.03);
  });

  test("a shape-and-quality rate needs the shape; the quality has a default", () => {
    const shape: RevanaModelShape = { ...IMAGE, resolutions: undefined, qualities: ["high", "low", "medium"], defaultQuality: "medium" };
    const price: RevanaListedPrice = { unit: "per_image", usd: { "1:1-high": 0.14, "1:1-medium": 0.04, "3:2-medium": 0.06 } };
    expect(revanaCostUSD(price, shape, { aspect_ratio: "1:1" })).toBe(0.04);
    expect(revanaCostUSD(price, shape, { aspect_ratio: "1:1", quality: "high" })).toBe(0.14);
    expect(revanaCostUSD(price, shape, {})).toBeUndefined();
  });

  test("speech is priced per 1,000 characters and rounds UP to the cent", () => {
    const price: RevanaListedPrice = { unit: "per_1k_chars", usd: 0.12 };
    // Eleven characters is $0.00132 — "a whole number of credits, rounded up".
    expect(revanaCostUSD(price, SPEECH, { text: "hello there" })).toBe(0.01);
    expect(revanaCostUSD(price, SPEECH, { text: "a".repeat(5000) })).toBe(0.6);
    expect(revanaCostUSD(price, SPEECH, { prompt: "hello there" })).toBe(0.01);
    expect(revanaCostUSD(price, SPEECH, { dialogue: [{ text: "a".repeat(600) }, { text: "b".repeat(400) }] })).toBe(0.12);
    expect(revanaCostUSD(price, SPEECH, {})).toBeUndefined();
  });

  test("music is flat per job", () => {
    const shape: RevanaModelShape = { kind: "audio", tasks: ["text_to_music"], media: [] };
    expect(revanaCostUSD({ unit: "per_job", usd: 0.08 }, shape, { style: "folk" })).toBe(0.08);
  });

  test("float noise never rounds a clean total up a cent", () => {
    // 0.2 * 4 is 0.8000000000000002 in binary floating point.
    const shape: RevanaModelShape = { ...VIDEO, audio: undefined };
    expect(revanaCostUSD({ unit: "per_second", usd: { "720p": 0.2 } }, shape, { resolution: "720p", duration: 4 })).toBe(0.8);
  });

  test("no row, no price", () => {
    expect(revanaCostUSD(undefined, VIDEO, { duration: 4 })).toBeUndefined();
    expect(revanaCostUSD({ unit: "per_image", usd: 1 }, undefined, {})).toBeUndefined();
  });

  test("the caveat says what the figure is", () => {
    expect(REVANA_PRICING_CAVEAT).toContain("listed price");
    expect(REVANA_PRICING_CAVEAT).toContain("/v1/generations/quote");
  });
});
