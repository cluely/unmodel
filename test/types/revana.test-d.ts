/**
 * Type-level tests for the revana provider. NOT run by `bun test` — this file
 * is only type-checked (`bun run check` / tsc --noEmit). Revana ships no SDK,
 * so these exercise the per-model narrowing, which is this provider's whole
 * compile-time story: one `{ model, input }` body for 138 media models, with
 * `input` typed from each model's own catalog row.
 *
 * Catalog-coupled on purpose. A refresh that changes one of these rows has to
 * surface here as a diff a human reads, not as a silent change in a caller's
 * code.
 */
import {
  avatar,
  chat,
  image,
  imageEdit,
  imageQueue,
  lipsync,
  music,
  musicQueue,
  tts,
  ttsQueue,
  upscale,
  video,
  videoQueue,
  type GenerationRequest,
  type InputFor,
  type RevanaMediaUrl,
} from "../../src/providers/revana";
import type {
  ImageBody,
  ImageQueueBody,
  QueueEnvelope,
  QueueResult,
  TtsBody,
  VideoBody,
  VideoQueueBody,
} from "../../src/providers/revana/types";
import { expectAssignable } from "./helpers";

const IMG = "https://example.com/a.png";
const VID = "https://example.com/a.mp4";
const AUD = "https://example.com/a.mp3";

function videoTypeTests(): void {
  // A model's own lists: resolution, ratio, a duration LIST, the audio toggle.
  const v = video({
    model: "veo-3.1",
    input: { prompt: "a fox", resolution: "4K", aspect_ratio: "9:16", duration: 8, audio: true },
    max_cost_usd: 5,
    max_wait_s: 600,
  });
  expectAssignable<string>(v.request.url);
  expectAssignable<GenerationRequest<"veo-3.1">>(v.toSdk("revana"));

  // @ts-expect-error — veo-3.1 lists 720p / 1080p / 4K.
  video({ model: "veo-3.1", input: { prompt: "a", resolution: "480p" } });
  // @ts-expect-error — its durations are 4, 6 and 8.
  video({ model: "veo-3.1", input: { prompt: "a", duration: 5 } });
  // @ts-expect-error — veo-3.1 has no reference-to-video and no clip input.
  video({ model: "veo-3.1", input: { prompt: "a", video_url: VID } });
  // @ts-expect-error — one clip per request: only a count of one is taken.
  video({ model: "veo-3.1", input: { prompt: "a", num_images: 2 } });
  video({ model: "veo-3.1", input: { prompt: "a", num_images: 1 } });
  // `audio` under its second name, with the same per-model type.
  video({ model: "veo-3.1", input: { prompt: "a", generate_audio: true } });
  // @ts-expect-error — kling-2.5-turbo-pro makes no sound, under either name.
  video({ model: "kling-2.5-turbo-pro", input: { prompt: "a", generate_audio: true } });
  // @ts-expect-error — a speech field on a video model.
  video({ model: "veo-3.1", input: { prompt: "a", voice: "EkK5I93UQWFDigLMpZcX" } });
  // @ts-expect-error — a typo inside `input` is caught, not only at the top level.
  video({ model: "veo-3.1", input: { promt: "a" } });
  // @ts-expect-error — and at the top level.
  video({ model: "veo-3.1", input: { prompt: "a" }, max_cost: 5 });
  // @ts-expect-error — references are https URLs.
  video({ model: "veo-3.1", input: { prompt: "a", image_url: "http://example.com/a.png" } });

  // A duration RANGE is any number; the bounds are the runtime's.
  video({ model: "kling-3.0", input: { prompt: "a", duration: 7, resolution: "1080p" } });
  // A model that lists no aspect ratios takes one free-form.
  video({ model: "kling-3.0", input: { prompt: "a", aspect_ratio: "16:9" } });

  // A model with no `resolutions` takes no `resolution`.
  // @ts-expect-error
  video({ model: "kling-2.1-master", input: { prompt: "a", resolution: "720p" } });
  // A model with no `durations` sets its own length.
  // @ts-expect-error
  video({ model: "wan-2.2-turbo", input: { prompt: "a", duration: 5 } });
  // A model that makes no sound takes only `audio: false`.
  video({ model: "hailuo-02", input: { prompt: "a", audio: false } });
  // @ts-expect-error
  video({ model: "hailuo-02", input: { prompt: "a", audio: true } });

  // A lower-ranking picture rides along with a clip: the character picture of
  // a motion-control model, which its tasks alone would not suggest.
  video({ model: "kling-3.0-motion-control", input: { video_url: VID, image_url: IMG } });

  // `task`, at the top or inside `input`.
  video({ model: "wan-2.7", input: { prompt: "a", video_url: VID }, task: "video_edit" });
  // @ts-expect-error
  video({ model: "wan-2.7", input: { prompt: "a", video_url: VID }, task: "video_trim" });

  // An image model's id is not a video model's.
  // @ts-expect-error
  video({ model: "nano-banana-pro", input: { prompt: "a" } });

  // An id unmodel has no row for takes the loose arm.
  video({ model: "some-model-added-yesterday", input: { prompt: "a", brand_new_field: 1 } });
}

function seedanceAndNemesisTypeTests(): void {
  video({
    model: "seedance-2.5",
    input: { prompt: "a", resolution: "1080p", aspect_ratio: "adaptive", duration: 12, audio_urls: [AUD] },
  });
  // @ts-expect-error — SeedanceInput requires a prompt.
  video({ model: "seedance-2.5", input: { image_url: IMG } });
  // @ts-expect-error — and has no seed.
  video({ model: "seedance-2.5", input: { prompt: "a", seed: 1 } });
  // @ts-expect-error — `audio_url` is ModelInput's; Seedance 2.5 takes `audio_urls`.
  video({ model: "seedance-2.5", input: { prompt: "a", audio_url: AUD } });

  video({
    model: "nemesis",
    input: { video_url: VID, image_urls: [IMG, IMG], roles: ["person", "product"], sound: "original" },
  });
  // @ts-expect-error — NemesisInput requires the clip and the references.
  video({ model: "nemesis-lite", input: { image_urls: [IMG] } });
  // @ts-expect-error — the result keeps the clip's length.
  video({ model: "nemesis", input: { video_url: VID, image_urls: [IMG], duration: 5 } });
}

function imageTypeTests(): void {
  image({
    model: "nano-banana-pro",
    input: { prompt: "a fox", resolution: "2K", aspect_ratio: "21:9", num_images: 2, image_urls: [IMG] },
  });
  image({ model: "gpt-image-1", input: { prompt: "a", quality: "high", aspect_ratio: "3:2", n: 2 } });
  // @ts-expect-error — gpt-image-1's qualities are high / low / medium.
  image({ model: "gpt-image-1", input: { prompt: "a", quality: "ultra" } });
  // @ts-expect-error — imagen-4 is text-to-image only.
  image({ model: "imagen-4", input: { prompt: "a", image_url: IMG } });
  // @ts-expect-error — a picture has no duration.
  image({ model: "nano-banana-pro", input: { prompt: "a", duration: 5 } });
  // @ts-expect-error — and makes no sound.
  image({ model: "nano-banana-pro", input: { prompt: "a", audio: true } });

  // The same id, as an edit — and the narrower views.
  imageEdit({ model: "flux-kontext-pro", input: { prompt: "red jacket", image_url: IMG } });
  // @ts-expect-error — imagen-4 does not edit.
  imageEdit({ model: "imagen-4", input: { prompt: "a" } });
  upscale({ model: "recraft-crisp-upscale", input: { image_url: IMG } });
  // @ts-expect-error — only the upscalers.
  upscale({ model: "nano-banana-pro", input: { prompt: "a", image_url: IMG } });
}

function avatarAndLipsyncTypeTests(): void {
  avatar({ model: "omnihuman-2.0", input: { prompt: "she speaks", image_url: IMG, audio_url: AUD } });
  lipsync({ model: "bytedance-lipsync", input: { video_url: VID, audio_url: AUD } });
  // @ts-expect-error — an ordinary video model is not an avatar model.
  avatar({ model: "veo-3.1", input: { prompt: "a", image_url: IMG } });
  // @ts-expect-error — and only the sound-driven models take `audio_url`.
  video({ model: "veo-3.1", input: { prompt: "a", audio_url: AUD } });
}

function audioTypeTests(): void {
  tts({ model: "elevenlabs-v3", input: { text: "[whispers] hi", voice: "EkK5I93UQWFDigLMpZcX", language_code: "en" } });
  tts({
    model: "elevenlabs-v3",
    input: { dialogue: [{ text: "hi", voice: "EkK5I93UQWFDigLMpZcX" }, { text: "hello" }] },
  });
  tts({ model: "elevenlabs-v4", input: { text: "hi", speed: 1.1, similarity_boost: 0.5 } });
  // @ts-expect-error — not one of the model's voice ids.
  tts({ model: "elevenlabs-v3", input: { text: "hi", voice: "alloy" } });
  // @ts-expect-error — elevenlabs-v3 takes no `speed`.
  tts({ model: "elevenlabs-v3", input: { text: "hi", speed: 1 } });
  // @ts-expect-error — only elevenlabs-v3 takes `dialogue`.
  tts({ model: "elevenlabs-v4", input: { dialogue: [{ text: "hi" }] } });
  // @ts-expect-error — elevenlabs-v4 "picks the language from the text".
  tts({ model: "elevenlabs-v4", input: { text: "hi", language_code: "en" } });
  // elevenlabs-turbo-2.5 lists no languages, so any code is typed.
  tts({ model: "elevenlabs-turbo-2.5", input: { text: "hi", language_code: "pt" } });
  // @ts-expect-error — a speech model takes no seed.
  tts({ model: "elevenlabs-v3", input: { text: "hi", seed: 1 } });

  music({ model: "suno-v6", input: { prompt: "first snow", style: "indie folk", instrumental: true } });
  // @ts-expect-error — music has no duration.
  music({ model: "suno-v6", input: { style: "folk", duration: 30 } });
}

function chatTypeTests(): void {
  const c = chat({ model: "claude-sonnet-5-5", messages: [{ role: "user", content: "hi" }] });
  expectAssignable<string>(c.request.url);
  expectAssignable<"claude-sonnet-5-5">(c.model);
}

/**
 * The queue route: the same per-model narrowing, on a body with no wrapper.
 */
function queueTypeTests(): void {
  const v = videoQueue({
    model: "veo-3.1",
    prompt: "a fox",
    resolution: "1080p",
    duration: 8,
    audio: true,
    max_cost_usd: 4,
    fal_webhook: "https://your-app.example/revana",
  });
  expectAssignable<string>(v.request.url);
  // What comes back is the BODY: the input fields and the limits.
  expectAssignable<VideoQueueBody<"veo-3.1">>(v);
  expectAssignable<VideoQueueBody<"veo-3.1">>(v.toSdk("revana"));
  // @ts-expect-error — `model` went into the URL; it is not on the body.
  void v.model.length;

  // fal's spellings: a string duration, from the model's own seconds.
  videoQueue({ model: "veo-3.1", prompt: "a", duration: "8" });
  videoQueue({ model: "veo-3.1", prompt: "a", duration: "8s", generate_audio: true });
  // @ts-expect-error — veo-3.1's durations are 4, 6 and 8, as a string too.
  videoQueue({ model: "veo-3.1", prompt: "a", duration: "5s" });
  // @ts-expect-error — the same per-model lists as `revana.video`.
  videoQueue({ model: "veo-3.1", prompt: "a", resolution: "480p" });
  // @ts-expect-error — the wrapper is the generation route's.
  videoQueue({ model: "veo-3.1", input: { prompt: "a" } });
  // @ts-expect-error — a typo is caught on the flat body too.
  videoQueue({ model: "veo-3.1", promt: "a" });
  // @ts-expect-error — a picture model belongs to `revana.imageQueue`.
  videoQueue({ model: "z-image", prompt: "a" });

  // `num_images` is taken only as 1 here, on a model that makes four elsewhere.
  imageQueue({ model: "seedream-4.5", prompt: "a", num_images: 1 });
  // @ts-expect-error — "Only num_images: 1 is supported".
  imageQueue({ model: "seedream-4.5", prompt: "a", num_images: 4 });
  image({ model: "seedream-4.5", input: { prompt: "a", num_images: 4 } });
  // @ts-expect-error — a picture has no duration, as a string or otherwise.
  imageQueue({ model: "z-image", prompt: "a", duration: "5" });

  // SeedanceInput and NemesisInput keep their own shapes.
  videoQueue({ model: "seedance-2.5", prompt: "a", duration: "5", video_urls: [VID] });
  // @ts-expect-error — SeedanceInput requires `prompt`.
  videoQueue({ model: "seedance-2.5", duration: 5 });
  videoQueue({ model: "nemesis", video_url: VID, image_urls: [IMG], roles: ["person"] });
  // @ts-expect-error — NemesisInput has no duration.
  videoQueue({ model: "nemesis", video_url: VID, image_urls: [IMG], duration: "5" });

  ttsQueue({ model: "elevenlabs-v4", text: "hi", fal_webhook: "https://your-app.example/revana" });
  // @ts-expect-error — a video field on a speech model.
  ttsQueue({ model: "elevenlabs-v4", text: "hi", resolution: "720p" });
  musicQueue({ model: "suno-v6", prompt: "first snow", style: "indie folk" });

  // An id the catalog has no row for takes the loose body.
  videoQueue({ model: "some-model-from-next-week", prompt: "a", duration: "5s", anything: true });

  expectAssignable<ImageQueueBody<"z-image">>({ prompt: "a", max_cost_usd: 0.05 });
  const envelope = { status: "IN_QUEUE", request_id: "gen_1", response_url: "u", status_url: "u" } satisfies QueueEnvelope;
  expectAssignable<QueueEnvelope["status"]>(envelope.status);
  const result = { images: [{ url: "u" }] } as QueueResult;
  if ("images" in result) expectAssignable<string | undefined>(result.images[0]?.url);
}

function typesEntryTypeTests(): void {
  const body = {
    model: "veo-3.1",
    input: { prompt: "a fox", resolution: "1080p", duration: 8 },
  } satisfies VideoBody<"veo-3.1">;
  expectAssignable<VideoBody>(body);
  expectAssignable<ImageBody<"imagen-4">>({ model: "imagen-4", input: { prompt: "a" } });
  expectAssignable<TtsBody<"elevenlabs-v4">>({ model: "elevenlabs-v4", input: { text: "hi" } });
  expectAssignable<RevanaMediaUrl>("https://example.com/a.png");
  expectAssignable<InputFor<"suno-v6">>({ style: "folk" });
}

void videoTypeTests;
void seedanceAndNemesisTypeTests;
void imageTypeTests;
void avatarAndLipsyncTypeTests;
void audioTypeTests;
void chatTypeTests;
void queueTypeTests;
void typesEntryTypeTests;
