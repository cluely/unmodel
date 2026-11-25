import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type OpenAI from "openai";
import { toRequestInit } from "../../src/index";
import { chat } from "../../src/chat/index";
import { image } from "../../src/unified/image";
import { imageEdit } from "../../src/unified/image-edit";
import { upscale } from "../../src/unified/upscale";
import { video } from "../../src/unified/video";
import { lipsync } from "../../src/unified/lipsync";
import { avatar } from "../../src/unified/avatar";
import { threeD } from "../../src/unified/3d";
import { tts } from "../../src/unified/tts";
import { stt } from "../../src/unified/stt";
import { sts } from "../../src/unified/sts";
import { voiceClone } from "../../src/unified/voice-clone";
import { voiceDesign } from "../../src/unified/voice-design";
import { music } from "../../src/unified/music";
import { sfx } from "../../src/unified/sfx";
import { chat as anthropicChat } from "../../src/providers/anthropic/index";
import { image as openaiImage, checkChat as openaiCheckChat } from "../../src/providers/openai/index";
import { TTS_MODEL_PARAMS } from "../../src/providers/openai/values";
import { video as klingVideo } from "../../src/providers/kling/index";
import { image as falImage, FAL_ENDPOINTS } from "../../src/providers/fal/index";
import { videoQueue as revanaVideoQueue } from "../../src/providers/revana/index";
import { models as atlasModels } from "../../src/providers/atlascloud/index";
import { models as elevenModels } from "../../src/providers/elevenlabs/index";
import { getModel } from "../../src/catalog/index";
import { CHAT_PROVIDERS } from "../../src/values/index";

/**
 * Keeps README.md's examples, ❌/✅ compile-time assertions, surface counts,
 * and provider directory provably aligned with the live codebase.
 */

const ROOT = resolve(import.meta.dir, "..", "..");
const readme = readFileSync(join(ROOT, "README.md"), "utf8");

describe("README.md runtime examples", () => {
  test("hero: gpt-image-2.6-sunburst accepts output_format: gif", () => {
    const req = openaiImage({ model: "gpt-image-2.6-sunburst", prompt: "a lighthouse", output_format: "gif" });
    expect(req.model).toBe("gpt-image-2.6-sunburst");
    expect(req.output_format).toBe("gif");
  });

  test("quick start: unified chat compiles to OpenAI wire body + toRequestInit", () => {
    const request = chat({
      model: "openai/gpt-5.2",
      messages: [{ role: "user", content: "Explain this code in one sentence." }],
      maxOutputTokens: 256,
    });
    expect(JSON.parse(JSON.stringify(request))).toEqual({
      model: "gpt-5.2",
      messages: [{ role: "user", content: "Explain this code in one sentence." }],
      max_completion_tokens: 256,
    });
    const init = toRequestInit(request);
    expect(init.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(init.method).toBe("POST");
    expect(typeof openaiCheckChat).toBe("function");
  });

  test("same weights, four wire formats (Seedance 2.5)", () => {
    const base = { prompt: "rain over a neon alley", duration: 5, aspectRatio: "16:9" } as const;

    const bd = video({ model: "bytedance/dreamina-seedance-2-5-260628", ...base });
    expect(bd.request.url).toBe("https://ark.ap-southeast.bytepluses.com/api/v3/contents/generations/tasks");
    expect(JSON.parse(JSON.stringify(bd))).toEqual({
      model: "dreamina-seedance-2-5-260628",
      content: [{ type: "text", text: "rain over a neon alley" }],
      duration: 5,
      ratio: "16:9",
    });
    expect(bd.warnings).toEqual([]);

    const onFal = video({ model: "fal/bytedance/seedance-2.5/text-to-video", ...base });
    expect(onFal.request.url).toBe("https://queue.fal.run/bytedance/seedance-2.5/text-to-video");
    expect(JSON.parse(JSON.stringify(onFal))).toEqual({
      prompt: "rain over a neon alley",
      duration: "5",
      aspect_ratio: "16:9",
    });
    expect(onFal.warnings).toEqual([]);

    const onRevana = video({ model: "revana/seedance-2.5", ...base });
    expect(onRevana.request.url).toBe("https://api.revana.si/v1/generations");
    expect(JSON.parse(JSON.stringify(onRevana))).toEqual({
      model: "seedance-2.5",
      input: { prompt: "rain over a neon alley", duration: 5, aspect_ratio: "16:9" },
    });
    expect(onRevana.warnings).toEqual([]);

    const onAtlas = video({ model: "atlascloud/bytedance/seedance-2.5/text-to-video", ...base });
    expect(onAtlas.request.url).toBe("https://api.atlascloud.ai/api/v1/model/generateVideo");
    expect(JSON.parse(JSON.stringify(onAtlas))).toEqual({
      model: "bytedance/seedance-2.5/text-to-video",
      prompt: "rain over a neon alley",
      duration: 5,
      ratio: "16:9",
    });
    expect(onAtlas.warnings).toEqual([]);
  });

  test("narrowing examples: image, stt, sfx", () => {
    const img = image({
      model: "openai/gpt-image-2",
      prompt: "a lighthouse in fog",
      aspectRatio: "16:9",
      resolution: "1k",
    });
    expect(JSON.parse(JSON.stringify(img))).toEqual({
      model: "gpt-image-2",
      prompt: "a lighthouse in fog",
      size: "1360x768",
    });

    const elSfx = sfx({
      model: "elevenlabs/eleven_text_to_sound_v2",
      prompt: "a door creaking open",
      durationSeconds: 4,
    });
    expect(elSfx.warnings).toEqual([]);

    const sonilo = sfx({
      model: "fal/sonilo/v1.1/text-to-sound-effects",
      prompt: "rain on a tin roof",
    });
    expect(sonilo.warnings.map((w) => w.code)).toContain("approximated_param");
  });

  test("validation & cost gates: chat.safe + tts maxCostUSD", () => {
    const ok = chat.safe({
      model: "openai/gpt-5.2",
      messages: [{ role: "user", content: "Hello!" }],
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.params.model).toBe("gpt-5.2");
      expect(ok.estimate).toBeDefined();
    }

    const within = tts.safe(
      { model: "elevenlabs/eleven_multilingual_v2", text: "The lighthouse is ready.", voice: "21m00Tcm4TlvDq8ikWAM" },
      { maxCostUSD: 0.01 },
    );
    expect(within.ok).toBe(true);
    if (within.ok) {
      expect(within.estimate.costUSD).toBeCloseTo(0.00192, 6);
    }

    const blocked = tts.safe(
      { model: "elevenlabs/eleven_multilingual_v2", text: "a".repeat(200), voice: "21m00Tcm4TlvDq8ikWAM" },
      { maxCostUSD: 0.01 },
    );
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.errors[0]?.code).toBe("over_budget");
    }
  });

  test("retargeting: chat (anthropic -> openrouter) and media (kling -> fal)", () => {
    const req = anthropicChat({
      model: "claude-opus-5",
      max_tokens: 4096,
      thinking: { type: "adaptive" },
      messages: [{ role: "user", content: "Explain retargeting." }],
    });
    const moved = req.toApi("openrouter");
    expect(moved.model).toBe("anthropic/claude-opus-5");
    expect(moved.request.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(moved.warnings.map((w) => w.code)).toEqual(["id_respelled", "dropped_param"]);

    const klingReq = klingVideo({
      model_name: "kling-v2-5-turbo",
      prompt: "A slow push-in through a rainy neon alley",
      mode: "pro",
      duration: "10",
    });
    const onFal = klingReq.toApi("fal");
    expect(onFal.request.url).toBe("https://queue.fal.run/fal-ai/kling-video/v2.5-turbo/pro/text-to-video");
    expect(JSON.parse(JSON.stringify(onFal))).toEqual({
      prompt: "A slow push-in through a rainy neon alley",
      negative_prompt: "",
      duration: "10",
    });
    expect(onFal.warnings).toEqual([]);
  });

  test("values, catalog, fal, and revana queue snippets", () => {
    expect(TTS_MODEL_PARAMS["gpt-4o-mini-tts"].voices.length).toBeGreaterThan(0);
    expect(getModel("openai", "gpt-5.2")?.cost).toBeDefined();
    expect(elevenModels["eleven_multilingual_v2"].cost).toBeDefined();

    const onFal = falImage({ endpoint: "fal-ai/flux/dev", prompt: "a cat", image_size: "landscape_4_3" });
    expect(onFal.request.url).toBe("https://queue.fal.run/fal-ai/flux/dev");
    expect(JSON.parse(JSON.stringify(onFal))).toEqual({
      prompt: "a cat",
      image_size: "landscape_4_3",
    });

    const onRevana = revanaVideoQueue({
      model: "veo-3.1",
      fal_webhook: "https://example.com/hook",
      prompt: "rain on glass",
      duration: 8,
    });
    expect(onRevana.request.url).toBe("https://api.revana.si/v1/queue/revana/veo-3.1?fal_webhook=https%3A%2F%2Fexample.com%2Fhook");
    expect(JSON.parse(JSON.stringify(onRevana))).toEqual({
      prompt: "rain on glass",
      duration: 8,
    });
  });
});

describe("README.md provider directory & surface counts", () => {
  test("every provider directory in src/providers/ is named in README.md", () => {
    const providerDirs = readdirSync(join(ROOT, "src", "providers"))
      .filter((d) => statSync(join(ROOT, "src", "providers", d)).isDirectory())
      .sort();

    for (const dir of providerDirs) {
      const hasSubpath = readme.includes(`\`unmodel/${dir}\``) || readme.includes(`\`${dir}\``);
      expect(hasSubpath, `README.md is missing provider "${dir}"`).toBe(true);
    }
    expect(providerDirs.length - 1).toBe(81); // 81 providers + openai-compatible factory
  });

  test("headline surface and aggregator counts match live registries", () => {
    expect(CHAT_PROVIDERS.length).toBe(33);
    expect(image.providers.length).toBe(19);
    expect(imageEdit.providers.length).toBe(9);
    expect(upscale.providers.length).toBe(3);
    expect(video.providers.length).toBe(16);
    expect(lipsync.providers.length).toBe(5);
    expect(avatar.providers.length).toBe(5);
    expect(threeD.providers.length).toBe(2);
    expect(tts.providers.length).toBe(20);
    expect(stt.providers.length).toBe(13);
    expect(sts.providers.length).toBe(2);
    expect(voiceClone.providers.length).toBe(6);
    expect(voiceDesign.providers.length).toBe(4);
    expect(music.providers.length).toBe(6);
    expect(sfx.providers.length).toBe(2);
    expect(FAL_ENDPOINTS.length).toBe(186);
    expect(Object.keys(atlasModels).length).toBe(27);
  });
});

/**
 * Compile-time assertions for every ❌/✅ snippet in README.md.
 * Type-checked by `bun run check` (`tsc --noEmit`).
 */
export function readmeCompileTimeClaims(openai: OpenAI): void {
  const prompt = "a lighthouse";

  // Hero: openai@7.4.0 compiles quality: "hd" on gpt-image-2 and refuses gif on 2.6
  void (() => {
    openai.images.generate({ model: "gpt-image-2", prompt, quality: "hd" });
    // @ts-expect-error — openai@7.4.0 omits "gif" from output_format
    openai.images.generate({ model: "gpt-image-2.6-sunburst", prompt, output_format: "gif" });
  });

  // Hero: unmodel/openai enforces exact per-model types in both directions
  // @ts-expect-error — gpt-image-2 does not accept dall-e-3's "hd" quality
  openaiImage({ model: "gpt-image-2", prompt, quality: "hd" });
  openaiImage({ model: "gpt-image-2.6-sunburst", prompt, output_format: "gif" });

  // Anthropic manual extended thinking removed on Claude 4.7+
  const messages = [{ role: "user" as const, content: "Hello!" }];
  anthropicChat({ model: "claude-opus-4-6", max_tokens: 4096, thinking: { type: "enabled", budget_tokens: 2048 }, messages });
  anthropicChat({
    model: "claude-opus-5",
    max_tokens: 4096,
    // @ts-expect-error — Claude 4.7+ removed manual extended thinking ("enabled")
    thinking: { type: "enabled", budget_tokens: 2048 },
    messages,
  });

  // Unified video resolution narrowing
  video({ model: "openai/sora-2-pro", prompt: "…", resolution: "1080p", duration: 16 });
  // @ts-expect-error — sora-2 renders 720p only
  video({ model: "openai/sora-2", prompt: "…", resolution: "1080p" });

  // STT audio input shape narrowing
  const url = "https://example.com/clip.wav";
  const file = new Blob();
  stt({ model: "assemblyai/universal-2", audio: { url } });
  // @ts-expect-error — assemblyai takes URLs, not multipart Blobs
  stt({ model: "assemblyai/universal-2", audio: { file } });
  stt({ model: "cartesia/ink-whisper", audio: { file } });
  // @ts-expect-error — cartesia takes multipart Blobs, not URLs
  stt({ model: "cartesia/ink-whisper", audio: { url } });

  // SFX required durationSeconds per model
  sfx({ model: "fal/sonilo/v1.1/text-to-sound-effects", prompt: "rain on a tin roof" });
  // @ts-expect-error — durationSeconds is required on cassetteai/sound-effects-generator
  sfx({ model: "fal/cassetteai/sound-effects-generator", prompt: "rain on a tin roof" });

  // Retargeting compile-time guards
  const anth = anthropicChat({
    model: "claude-opus-5",
    max_tokens: 4096,
    thinking: { type: "adaptive" },
    messages: [{ role: "user", content: "Explain retargeting." }],
  });
  // @ts-expect-error — OpenAI does not serve Claude
  anth.toApi("openai");

  const fromConfig: string = "kling-v2-5-turbo";
  // @ts-expect-error — dynamic model string has no verified fal mapping
  klingVideo({ model_name: fromConfig, prompt: "…" }).toApi("fal");
}
