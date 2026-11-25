import { expect, test } from "bun:test";
import { chat, chatProfiles } from "../../src/chat";
import { chat as openaiChat, checkChat } from "../../src/providers/openai";
import { chat as alibabaChat, type AlibabaChatUserMessage } from "../../src/providers/alibaba";
import { chat as routerChat, checkChat as checkRouterChat } from "../../src/providers/openrouter";
import { chat as googleChat } from "../../src/providers/google";
import { createGoogleVertex } from "../../src/providers/google-vertex";
import { video as bytePlusVideo } from "../../src/providers/bytedance";
import { createAzure, toMaiEditFormData, type MaiImagesEditsBody } from "../../src/providers/azure";
import { image as falImage, imageEdit as falImageEdit, video as falVideo } from "../../src/providers/fal";
import { image } from "../../src/unified/image";
import { imageEdit } from "../../src/unified/image-edit";
import { video } from "../../src/unified/video";

const messages = [{ role: "user", content: "Describe a kite." }] as const;
const contents = [{ role: "user" as const, parts: [{ text: messages[0].content }] }];
const imageUrl = "https://example.com/kite.png";

test.each([
  ["gpt-6.2-astra", 2.216, 4.86],
  ["gpt-6.2-sol", 0.554, 1.215],
] as const)("%s checks Chat Completions capabilities and the whole-request price tier", (model, base, long) => {
  const request = chat({ model: `openai/${model}`, messages: [...messages] });
  expect(request.warnings ?? []).toEqual([]);
  expect(chatProfiles.openai?.[model]?.cost?.longContext?.aboveInputTokens).toBe(272_000);
  const tools = openaiChat.safe({
    model,
    messages: [...messages],
    tools: [{ type: "function", function: { name: "lookup" } }],
  });
  expect(tools.ok).toBe(false);
  if (!tools.ok) expect(tools.errors[0]?.message).toContain("/v1/responses");
  expect(openaiChat.safe({ model, messages: [...messages], reasoning_effort: "none" }).ok).toBe(false);

  expect(checkChat({
    model,
    usage: { prompt_tokens: 272_000, completion_tokens: 1_000 },
  }).costUSD).toBeCloseTo(base, 8);
  const usage = { prompt_tokens: 300_000, completion_tokens: 1_000 };
  expect(checkChat({ model, usage }).costUSD).toBeCloseTo(long, 8);
  expect(checkRouterChat({ model: `openai/${model}`, usage }).costUSD).toBeCloseTo(long, 8);
  expect(checkChat({
    model,
    usage: { ...usage, prompt_tokens_details: { cache_write_tokens: 50_000 } },
  }).costUSD).toBeCloseTo(model === "gpt-6.2-astra" ? 5.06 : 1.265, 8);
  expect(openaiChat.safe({ model, messages: [...messages], service_tier: "flex" }).ok).toBe(false);
  expect(openaiChat.safe({ model, messages: [...messages], service_tier: "default" }).ok).toBe(true);
});

test("Gemini 4 Neon supports XHIGH and long decode on Gemini and Vertex", () => {
  const params = {
    model: "gemini-4-neon" as const,
    contents,
    generationConfig: { thinkingConfig: { thinkingLevel: "XHIGH" as const }, maxOutputTokens: 100_000 },
  };
  const request = chat({
    model: "google/gemini-4-neon",
    messages: [...messages],
    reasoning: { effort: "xhigh" },
  });
  expect(request.warnings ?? []).toEqual([]);
  const vertex = createGoogleVertex({ project: "example", location: "global" });
  const vertexRequest = vertex.chat.safe(params);
  const googleRequest = googleChat.safe(params);
  for (const result of [vertexRequest, googleRequest]) {
    expect(result.ok).toBe(true);
    expect(result.warnings.map((issue) => issue.code)).not.toContain("invalid_enum_value");
  }
  for (const result of [
    vertex.chat.safe({
      ...params,
      generationConfig: { thinkingConfig: { thinkingLevel: "MINIMAL" } },
    }),
    googleChat.safe({
      ...params,
      generationConfig: { thinkingConfig: { thinkingLevel: "MINIMAL" } },
    }),
  ]) expect(result.ok).toBe(false);
});

test("Qwen4-Max is discoverable and accepts Alibaba's video wire shapes", () => {
  const model = "qwen4-max";
  expect(chat({ model: "alibaba/qwen4-max", messages: [...messages] }).warnings).toEqual([]);
  expect(chat({ model: "openrouter/qwen/qwen4-max", messages: [...messages] }).warnings).toEqual([]);
  const videoMessage = {
    role: "user",
    content: [
      { type: "video_url", video_url: { url: "https://example.com/kite.mp4" }, fps: 2 },
      { type: "video", video: [imageUrl, imageUrl, imageUrl, imageUrl] },
      { type: "text", text: "Describe this clip." },
    ],
  } satisfies AlibabaChatUserMessage;
  const params = { model, messages: [videoMessage], thinking_budget: 4_096 };
  const result = alibabaChat.safe(params);
  expect(result.ok).toBe(true);
  if (result.ok) expect(JSON.stringify(result.params)).toBe(JSON.stringify(params));
  expect(result.warnings.map((issue) => issue.code)).toEqual(["unsupported_param"]);
  if (result.ok) expect(result.estimate.costUSD).toBeUndefined();
  expect(alibabaChat.safe(params, { maxCostUSD: 0.01 }).ok).toBe(false);
  expect(alibabaChat.safe({ ...params, reasoning_effort: "high" }).ok).toBe(false);
  expect(alibabaChat.safe({ ...params, model: "qwen-plus" }).ok).toBe(false);
});

test("BytePlus Seedance 2.5 Flash reaches the shared video entry with its documented limits", () => {
  const model = "dreamina-seedance-2-5-flash-261115";
  const request = video({
    model: `bytedance/${model}` as const,
    prompt: "A kite",
    resolution: "720p",
    duration: 30,
  });
  expect(request.request.url).toContain("/contents/generations/tasks");
  expect(request.warnings ?? []).toEqual([]);
  const content = [{ type: "text", text: "A kite" }] as const;
  const typical = bytePlusVideo.safe({ model, content: [...content], ratio: "16:9", duration: 5 });
  const adaptive = bytePlusVideo.safe({ model, content: [...content], duration: 5 });
  expect(typical.ok && typical.estimate.costUSD).toBeCloseTo(0.756, 8);
  expect(bytePlusVideo.safe({ model, content: [...content], ratio: "16:9", duration: 5 }, { maxCostUSD: 0.755 }).ok).toBe(false);
  expect(adaptive.ok && adaptive.estimate.costUSD).toBeUndefined();
  const unchecked = bytePlusVideo.safe as (params: unknown) => { ok: boolean };
  for (const fields of [{ draft: true }, { resolution: "1080p" }, { duration: 31 }]) {
    expect(unchecked({ model, content, ...fields }).ok).toBe(false);
  }
  const images = Array.from({ length: 11 }, () => ({
    type: "image_url",
    image_url: { url: imageUrl },
    role: "reference_image",
  } as const));
  expect(bytePlusVideo.safe({ model, content: [...content, ...images.slice(0, 10)] }).ok).toBe(true);
  expect(bytePlusVideo.safe({ model, content: [...content, ...images] }).ok).toBe(false);
});

test("fal Seedance 2.5 Flash sends requests to the three public routes", () => {
  const prefix = "bytedance/seedance-2.5/flash";
  const calls = [
    falVideo.safe({ endpoint: `${prefix}/text-to-video`, prompt: "A kite" }),
    falVideo.safe({ endpoint: `${prefix}/image-to-video`, image_url: imageUrl }),
    falVideo.safe({ endpoint: `${prefix}/reference-to-video`, image_urls: [imageUrl] }),
  ];
  expect(calls.map((result) => result.ok ? result.params.request.url : undefined)).toEqual(
    ["text-to-video", "image-to-video", "reference-to-video"].map((route) => `https://queue.fal.run/${prefix}/${route}`),
  );
  for (const result of calls) expect(result.warnings).toEqual([]);
});

test.each(["", "flash/"] as const)("fal MAI Image 2.7 %s reaches both unified image entries", (tier) => {
  const endpoint = `microsoft/mai-image-2.7/${tier}` as const;
  const generated = image({ model: `fal/${endpoint}text-to-image` as const, prompt: "A kite" });
  const edited = imageEdit({
    operation: "edit",
    model: `fal/${endpoint}edit` as const,
    prompt: "A blue kite",
    image: { kind: "url", url: imageUrl },
  });
  expect(generated.request.url).toBe(`https://queue.fal.run/${endpoint}text-to-image`);
  expect(edited.request.url).toBe(`https://queue.fal.run/${endpoint}edit`);
  expect(edited.warnings).toEqual([]);
  expect(falImage.safe({
    endpoint: `${endpoint}text-to-image` as const,
    prompt: "A kite",
    image_size: { width: 2048, height: 2064 },
  }).ok).toBe(false);
  expect(falImage.safe({
    endpoint: `${endpoint}text-to-image` as const,
    prompt: "A kite",
    background: "transparent",
    output_format: "jpeg",
  }).ok).toBe(false);
});

test.each(["MAI-Image-2.7", "MAI-Image-2.7-Flash"] as const)("Azure %s supports 2K and multipart references", (model) => {
  const azure = createAzure({ endpoint: "https://example.services.ai.azure.com" });
  const deployment = `${model}-production`;
  const generated = azure.image.safe({ model: deployment, prompt: "A kite", width: 2048, height: 2048 });
  expect(generated.ok).toBe(true);
  expect(generated.warnings).toEqual([]);
  expect(azure.image.safe({ model: deployment, prompt: "A kite", width: 2048, height: 2049 }).ok).toBe(false);

  const png = new Blob(["kite"], { type: "image/png" });
  const jpeg = new Blob(["sky"], { type: "image/jpeg" });
  const edit = azure.imageEdit.safe({ model: deployment, prompt: "Merge the references", image: [png, jpeg] });
  expect(edit.ok).toBe(true);
  expect(edit.warnings).toEqual([]);
  if (edit.ok) expect(toMaiEditFormData(edit.params).getAll("image")).toHaveLength(2);
  expect(azure.imageEdit.safe({ model: deployment, prompt: "A kite", image: Array(6).fill(png) }).ok).toBe(false);
});

test("Neon validates provider restrictions and prices continuation input", () => {
  const params = { model: "gemini-4-neon" as const, contents };
  const vertex = createGoogleVertex({ project: "example", location: "global" });
  for (const generationConfig of [{ topP: 2 }, { topK: -5 }]) {
    expect(googleChat.safe({ ...params, generationConfig }).ok).toBe(false);
  }
  for (const generationConfig of [{ candidateCount: 2 }, { frequencyPenalty: 1 }, { presencePenalty: 1 }]) {
    expect(vertex.chat.safe({ ...params, generationConfig }).ok).toBe(false);
  }
  const prefill = { role: "model" as const, parts: [{ text: "It is a" }] };
  expect(vertex.chat.safe({ ...params, contents: [...contents, prefill] }).ok).toBe(false);
  expect(vertex.chat.safe({ ...params, contents: [...contents, prefill, ...contents] }).ok).toBe(true);
  const cache = vertex.chat.safe({ ...params, cachedContent: "projects/example/locations/global/cachedContents/1" });
  expect(cache.warnings.map((issue) => issue.path)).toContainEqual(["cachedContent"]);
  const long = { ...params, generationConfig: { maxOutputTokens: 200_000 } };
  const tokenizer = { count: () => 996 };
  const estimate = googleChat.safe(long, { tokenizer });
  expect(estimate.ok && estimate.estimate.inputTokens).toBe(1_000);
  expect(estimate.ok && estimate.estimate.costUSD).toBeCloseTo(4.191648, 8);
  expect(googleChat.safe(long, { tokenizer, maxCostUSD: 3.01 }).ok).toBe(false);
  expect(vertex.chat.safe(long, { tokenizer, maxCostUSD: 3.01 }).ok).toBe(false);
  expect(chat.safe({ model: "openrouter/google/gemini-4-neon", messages: [...messages], maxOutputTokens: 100_000 }).ok).toBe(true);
});

test("Qwen video validation respects each host's wire format", () => {
  const videoUrl = "https://example.com/kite.mp4";
  const file = { type: "video_url", video_url: { url: videoUrl } } as const;
  const model = "qwen4-max";
  function params<Part extends typeof file | { type: "video"; video: string[] }>(part: Part) {
    return { model, messages: [{ role: "user" as const, content: [part] }] };
  }
  expect(alibabaChat.safe(params({ type: "video", video: [imageUrl] })).ok).toBe(false);
  for (const part of [
    { ...file, min_pixels: 100 },
    { ...file, max_pixels: 99_999_999 },
    { ...file, min_pixels: 10_000, max_pixels: 5_000 },
    { ...file, total_pixels: 999_999_999 },
  ]) {
    expect(alibabaChat.safe(params(part)).ok).toBe(false);
  }
  const frames = alibabaChat(params({ type: "video", video: Array(4).fill(imageUrl) }));
  expect(frames.toApiSafe("openrouter").ok).toBe(false);
  const routed = alibabaChat(params(file)).toApi("openrouter");
  expect(routerChat.safe({ ...routed, model: "qwen/qwen4-max" }).ok).toBe(true);
  const direct = routerChat.safe({ ...params(file), model: "qwen/qwen4-max" });
  expect(direct.ok && direct.params.messages[0]?.content).toEqual([file]);

  const compatible = alibabaChat.safe({
    model: "qwen3.8-max", messages: [...messages],
    thinking_budget: null, enable_thinking: null, preserve_thinking: null,
  });
  expect(compatible.ok).toBe(true);
});

test("fal Seedance requires a source for edits and compiles a URL into video_urls", () => {
  const endpoint = "bytedance/seedance-2.5/flash/reference-to-video";
  const url = "https://example.com/kite.mp4";
  for (const task of ["editing", "extension"] as const) {
    expect(falVideo.safe({ endpoint, prompt: "A kite", task }).ok).toBe(false);
    expect(falVideo.safe({ endpoint, prompt: "A kite", task, video_urls: [] }).ok).toBe(false);
    expect(falVideo.safe({ endpoint, prompt: "A kite", task, video_urls: [url] }).ok).toBe(true);
  }
  const compiled = video({
    model: `fal/${endpoint}`, prompt: "A kite", video: { kind: "url", url },
  });
  expect(JSON.parse(JSON.stringify(compiled)).video_urls).toEqual([url]);
});

test.each(["", "flash/"] as const)("MAI Image 2.7 %s solves ratios above its minimum side", (tier) => {
  const endpoint = `microsoft/mai-image-2.7/${tier}` as const;
  const model = `fal/${endpoint}text-to-image` as const;
  const prompt = "A kite";
  for (const [aspectRatio, width, height] of [
    ["21:9", 1792, 768], ["9:21", 768, 1792], ["2:1", 1536, 768], ["1:2", 768, 1536],
  ] as const) {
    const generated = image({ model, prompt, aspectRatio });
    const edited = imageEdit({
      model: `fal/${endpoint}edit`, operation: "edit", prompt,
      image: { kind: "url", url: imageUrl }, aspectRatio,
    });
    expect(JSON.parse(JSON.stringify(generated)).image_size).toEqual({ width, height });
    expect(JSON.parse(JSON.stringify(edited)).image_size).toEqual({ width, height });
  }
  expect(falImage.safe({ endpoint: `${endpoint}text-to-image`, prompt, image_size: { width: 640 } }).ok).toBe(false);
  expect(falImageEdit.safe({ endpoint: `${endpoint}edit`, prompt, image_urls: [imageUrl], image_size: {} }).ok).toBe(false);
  expect(image.safe({ model, prompt, dimensions: { width: 1024, height: 1024 }, resolution: "2k" }).ok).toBe(false);
  const unchecked = image.safe as (params: unknown) => { ok: boolean };
  expect(unchecked({ model, prompt, size: "1024x1024", resolution: "2k" }).ok).toBe(false);
  expect(image.safe({ model, prompt, size: "square_hd", resolution: "2k" }).ok).toBe(true);
});

test("Azure keeps the single-image body type and flags unsupported backgrounds", () => {
  const azure = createAzure({ endpoint: "https://example.services.ai.azure.com" });
  const png = new Blob(["kite"], { type: "image/png" });
  const body: MaiImagesEditsBody = { model: "MAI-Image-2.5", prompt: "A kite", image: png };
  expect(body.image.size).toBe(4);
  expect(azure.imageEdit(body).image).toBe(png);
  expect(azure.image.safe({ model: body.model, prompt: body.prompt, background: "transparent" }).warnings
    .map((issue) => issue.path)).toContainEqual(["background"]);
});
