import { expect, test } from "bun:test";
import { chat, chatProfiles } from "../../src/chat";
import { chat as openaiChat, checkChat } from "../../src/providers/openai";
import { chat as alibabaChat, type AlibabaChatUserMessage } from "../../src/providers/alibaba";
import { chat as googleChat } from "../../src/providers/google";
import { createGoogleVertex } from "../../src/providers/google-vertex";
import { video as bytePlusVideo } from "../../src/providers/bytedance";
import { createAzure, toMaiEditFormData } from "../../src/providers/azure";
import { image as falImage, video as falVideo } from "../../src/providers/fal";
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
  expect(checkChat({
    model,
    usage: { prompt_tokens: 300_000, completion_tokens: 1_000 },
  }).costUSD).toBeCloseTo(long, 8);
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
  expect(result.warnings).toEqual([]);
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
  expect(typical.ok && typical.estimate.costUSD).toBe(0.75);
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
