/**
 * Type-level tests for the openai provider. NOT run by `bun test` — this
 * file is only type-checked (`bun run check` / tsc --noEmit). The openai
 * package is a devDependency used exclusively here; src/ never imports it.
 */
import type { ChatCompletionCreateParams } from "openai/resources/chat/completions";
import type { ImageGenerateParams, ImageEditParams } from "openai/resources/images";
import type { SpeechCreateParams } from "openai/resources/audio/speech";
import type { TranscriptionCreateParams } from "openai/resources/audio/transcriptions";
import type { VideoCreateParams } from "openai/resources/videos";
import type { RealtimeSessionCreateRequest } from "openai/resources/realtime/realtime";
import type { ClientSecretCreateParams } from "openai/resources/realtime/client-secrets";
import {
  chat,
  checkChat,
  image,
  imageEdit,
  tts,
  stt,
  video,
  realtimeSession,
  type ChatFinishReason,
  type OpenaiChatModelId,
  type ImagesBody,
  type ImageEditBody,
  type SpeechBody,
  type TranscriptionBody,
  type VideosBody,
} from "../../src/providers/openai";
import type { availability as openaiAvailability } from "../../src/catalog/availability/openai.gen";
import type { ApiTargetsFor } from "../../src/retarget/ids";
import type { ResponseReport } from "../../src/core/report";
import { expectAssignable, expectTrue, type HasLiteralMember, type IsNever } from "./helpers";

/** Exact type equality (invariant both ways), for asserting resolved unions. */
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
  ? true
  : false;

function chatTypeTests(): void {
  const validated = chat({
    model: "gpt-5.2",
    messages: [
      { role: "system", content: "be brief" },
      { role: "developer", content: [{ type: "text", text: "terse" }] },
      {
        role: "user",
        content: [
          { type: "text", text: "what is in this image?" },
          { type: "image_url", image_url: { url: "https://example.com/a.png", detail: "low" } },
        ],
      },
      {
        role: "assistant",
        tool_calls: [{ id: "call_1", type: "function", function: { name: "f", arguments: "{}" } }],
      },
      { role: "tool", content: "result", tool_call_id: "call_1" },
    ],
    max_completion_tokens: 256,
    reasoning_effort: "low",
    response_format: { type: "json_schema", json_schema: { name: "out", schema: {}, strict: true } },
    tools: [{ type: "function", function: { name: "f", parameters: { type: "object" } } }],
    tool_choice: "auto",
    parallel_tool_calls: false,
    service_tier: "priority",
    store: true,
    metadata: { run: "42" },
    web_search_options: { search_context_size: "low" },
  });

  // The validated object itself and its toSdk("openai") are both valid SDK params.
  expectAssignable<ChatCompletionCreateParams>(validated);
  expectAssignable<ChatCompletionCreateParams>(validated.toSdk("openai"));
  // @ts-expect-error the zero-arg .toSdk() form was removed — name the target
  validated.toSdk();
  // @ts-expect-error this endpoint's only SDK target is "openai"
  validated.toSdk("anthropic");

  // Wire body properties stay visible on the validated object.
  expectAssignable<string>(JSON.stringify(validated));
  expectAssignable<string>(validated.request.url);

  // `.toApi(provider)` is typed off the generated availability table. Per that
  // data gpt-5.4 is resold by OpenRouter and the Vercel AI Gateway (plus
  // amazon-bedrock and azure, which the one-arg union excludes because they
  // need a region / resource endpoint this call never received).
  const gpt = chat({ model: "gpt-5.4", messages: [{ role: "user", content: "hi" }] });
  const viaOpenRouter = gpt.toApi("openrouter");
  expectAssignable<"openai/gpt-5.4" | (string & {})>(viaOpenRouter.model);
  expectAssignable<string>(viaOpenRouter.request.url);
  expectAssignable<"openrouter">(viaOpenRouter.target);
  expectAssignable<number>(viaOpenRouter.warnings.length);
  // One hop only.
  // @ts-expect-error a retargeted result has no `.toApi`
  viaOpenRouter.toApi("vercel");
  // @ts-expect-error groq does not serve gpt-5.4
  gpt.toApi("groq");
  // @ts-expect-error amazon-bedrock serves it, but needs a region `.toApi` never got
  gpt.toApi("amazon-bedrock");
  // @ts-expect-error azure serves it, but needs the resource endpoint
  gpt.toApi("azure");
  // @ts-expect-error not a catalog provider id
  gpt.toApi("open-ai");
  const routed = gpt.toApiSafe("vercel");
  if (routed.ok) expectAssignable<"openai/gpt-5.4" | (string & {})>(routed.params.model);

  // The home provider is in the union. `.toApi("openai")` on an OpenAI model
  // is the identity retarget — the same wire body, the same URL — and leaving
  // it out was a bug: `chat({ model: "gpt-5.2" }).toApi(` used to autocomplete
  // "openrouter" | "vercel" only.
  const gpt52 = chat({ model: "gpt-5.2", messages: [{ role: "user", content: "hi" }] });
  const identity = gpt52.toApi("openai");
  expectAssignable<"gpt-5.2" | (string & {})>(identity.model);
  expectAssignable<"openai">(identity.target);
  expectTrue<
    Equals<ApiTargetsFor<typeof openaiAvailability, "gpt-5.2">, "openai" | "openrouter" | "vercel">
  >();

  // A model no other provider serves resolves to exactly its home provider —
  // not to the permissive `StaticApiTargetId` arm, which offers 28 targets
  // that every one fail at runtime.
  const solo = chat({ model: "gpt-5.6", messages: [{ role: "user", content: "hi" }] });
  solo.toApi("openai");
  // @ts-expect-error openrouter does not serve gpt-5.6
  solo.toApi("openrouter");
  expectTrue<Equals<ApiTargetsFor<typeof openaiAvailability, "gpt-5.6">, "openai">>();

  // Model id autocomplete sanity: known catalog ids assign as literals...
  const known = chat({ model: "gpt-5.4-mini", messages: [{ role: "user", content: "hi" }] });
  expectAssignable<"gpt-5.4-mini">(known.model);
  // ...and unknown ids still type-check through the (string & {}) escape.
  chat({ model: "gpt-99-experimental", messages: [{ role: "user", content: "hi" }] });

  // Audio output accepts both built-in voice names and custom voice objects.
  const withVoice = chat({
    model: "gpt-4o",
    messages: [{ role: "user", content: "hi" }],
    modalities: ["text", "audio"],
    audio: { format: "wav", voice: { id: "voice_1234" } },
  });
  expectAssignable<ChatCompletionCreateParams>(withVoice);
  chat({
    model: "gpt-4o",
    messages: [{ role: "user", content: "hi" }],
    audio: { format: "mp3", voice: "alloy" },
  });

  // @ts-expect-error — bogus top-level param that neither wire nor our types allow
  chat({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }], max_output_tokens: 10 });

  // @ts-expect-error — messages is required
  chat({ model: "gpt-4o" });

  // @ts-expect-error — "tool" messages require tool_call_id
  chat({ model: "gpt-4o", messages: [{ role: "tool", content: "x" }] });
}

function chatModelUnionTests(): void {
  // Non-chat catalog families (embeddings, image, realtime) are excluded
  // from the strict chat-model union. A @ts-expect-error call can't observe
  // this — the (string & {}) escape hatch accepts any plain string — so the
  // exclusion is asserted at the type level instead.
  expectTrue<IsNever<Extract<OpenaiChatModelId, `text-embedding-${string}`>>>();
  expectTrue<IsNever<Extract<OpenaiChatModelId, `gpt-image-${string}`>>>();
  expectTrue<IsNever<Extract<OpenaiChatModelId, `chatgpt-image-${string}`>>>();
  expectTrue<IsNever<Extract<OpenaiChatModelId, `dall-e-${string}`>>>();
  expectTrue<IsNever<Extract<OpenaiChatModelId, `gpt-realtime-${string}`>>>();
  // ...specifically the ids the generated union carries today:
  expectTrue<IsNever<Extract<OpenaiChatModelId, "text-embedding-3-small">>>();
  expectTrue<IsNever<Extract<OpenaiChatModelId, "gpt-image-1.5">>>();
  expectTrue<IsNever<Extract<OpenaiChatModelId, "chatgpt-image-latest">>>();
  expectTrue<IsNever<Extract<OpenaiChatModelId, "gpt-realtime-2.1">>>();
  // Chat-capable ids survive the exclusion.
  expectTrue<"gpt-4o" extends OpenaiChatModelId ? true : false>();
  expectTrue<"o3" extends OpenaiChatModelId ? true : false>();
  expectTrue<"gpt-5.6" extends OpenaiChatModelId ? true : false>();
}

function imagesTypeTests(): void {
  const img = image({
    model: "gpt-image-1.5",
    prompt: "a red panda",
    size: "1024x1024",
    quality: "high",
    output_format: "webp",
    output_compression: 80,
    background: "transparent",
    moderation: "low",
  });
  expectAssignable<ImageGenerateParams>(img);
  expectAssignable<ImageGenerateParams>(img.toSdk("openai"));

  // The target vocabulary is closed and the zero-arg form is gone.
  // @ts-expect-error — "openai" is this endpoint's only SDK target
  img.toSdk("ai-sdk");
  // @ts-expect-error — `.toSdk()` now requires a target
  img.toSdk();

  const dalle = image({
    model: "dall-e-3",
    prompt: "a lighthouse",
    n: 1,
    style: "vivid",
    quality: "hd",
    size: "1792x1024",
    response_format: "b64_json",
  });
  expectAssignable<ImageGenerateParams>(dalle);
  expectAssignable<"dall-e-3">(dalle.model);

  // gpt-image-2 takes free-form sizes.
  image({ model: "gpt-image-2", prompt: "x", size: "1536x864" });
  // The preset union autocompletes the documented rule space: 4K, 2:1, 3:1…
  image({ model: "gpt-image-2", prompt: "x", size: "3840x2160" });
  image({ model: "gpt-image-2", prompt: "x", size: "2048x1024" });
  image({ model: "gpt-image-2", prompt: "x", size: "3840x1280" });
  // @ts-expect-error — non-size strings are compile errors (was silently accepted as (string & {}))
  image({ model: "gpt-image-2", prompt: "x", size: "" });
  // @ts-expect-error — aspect-ratio strings are not the wire format; sizes are "WIDTHxHEIGHT"
  image({ model: "gpt-image-2", prompt: "x", size: "2:1" });
  // Unknown models fall back to the loose escape arm.
  image({ model: "gpt-image-9", prompt: "x", some_future_param: true });

  // gpt-image-2 accepts the two non-transparent background values.
  image({ model: "gpt-image-2", prompt: "x", background: "auto" });
  image({ model: "gpt-image-2-2026-04-21", prompt: "x", background: "opaque" });

  // @ts-expect-error — GROUND TRUTH: gpt-image-2 has no transparent background
  image({ model: "gpt-image-2", prompt: "x", background: "transparent" });

  // Aliasing the public body union must not route a known discriminant through
  // its loose future-model arm.
  // @ts-expect-error — gpt-image-2 remains subject to its exact arm after aliasing
  const aliasedInvalid: ImagesBody = {
    model: "gpt-image-2",
    prompt: "x",
    background: "transparent",
  };
  void aliasedInvalid;

  // Future models remain an explicit, usable escape hatch. Supplying a known
  // id as the escape parameter cannot opt it out of its exact arm.
  const future: ImagesBody<"gpt-image-9"> = {
    model: "gpt-image-9",
    prompt: "x",
    some_future_param: true,
  };
  image(future);
  // @ts-expect-error — a known id cannot inhabit the future-model arm
  const knownAsFuture: ImagesBody<"gpt-image-2"> = {
    model: "gpt-image-2",
    prompt: "x",
    background: "transparent",
  };
  void knownAsFuture;

  // @ts-expect-error — the dated gpt-image-2 snapshot rejects `transparent` too
  image({ model: "gpt-image-2-2026-04-21", prompt: "x", background: "transparent" });

  // @ts-expect-error — `style` is dall-e-3 only
  image({ model: "gpt-image-1", prompt: "x", style: "vivid" });

  // @ts-expect-error — `response_format` is dall-e only; GPT image models always return base64
  image({ model: "gpt-image-1.5", prompt: "x", response_format: "url" });

  // @ts-expect-error — `output_format` is for GPT image models, not dall-e-2
  image({ model: "dall-e-2", prompt: "x", output_format: "png" });

  // @ts-expect-error — dall-e-3 only supports n: 1
  image({ model: "dall-e-3", prompt: "x", n: 2 });

  // @ts-expect-error — bogus top-level param on a known arm
  image({ model: "gpt-image-1", prompt: "x", bogus_thing: 1 });

  // @ts-expect-error — size outside the dall-e-2 set
  image({ model: "dall-e-2", prompt: "x", size: "1024x1536" });
}

function videoTypeTests(): void {
  // SDK-known enum values keep the validated body SDK-assignable. (The SDK's
  // seconds/size enums lag the current docs — "16"/"20" and 1080p sizes are
  // documented but absent from openai@7.4.0 — so only overlap is asserted.)
  const clip = video({
    model: "sora-2",
    prompt: "a calico cat pounces through tall grass",
    size: "1280x720",
    seconds: "8",
  });
  expectAssignable<VideoCreateParams>(clip);
  expectAssignable<VideoCreateParams>(clip.toSdk("openai"));
  expectAssignable<"sora-2">(clip.model);

  // Video endpoints deliberately do NOT declare "ai-sdk": the AI SDK's video
  // primitive is still `experimental_generateVideo`.
  // @ts-expect-error — "openai" is this endpoint's only SDK target
  clip.toSdk("ai-sdk");

  // Model omitted defaults to sora-2 → base sizes apply.
  video({ prompt: "x", size: "720x1280" });
  // Pro renders 1024p and 1080p.
  video({ model: "sora-2-pro", prompt: "x", size: "1792x1024" });
  video({ model: "sora-2-pro", prompt: "x", size: "1920x1080" });
  // Unknown models fall back to the loose escape arm.
  video({ model: "sora-3", prompt: "x", some_future_param: true });

  // @ts-expect-error — sora-2 renders 720p only; 1080p needs sora-2-pro
  video({ model: "sora-2", prompt: "x", size: "1920x1080" });

  // @ts-expect-error — aliasing cannot send a known id through the loose arm
  const aliasedInvalid: VideosBody = { model: "sora-2", prompt: "x", size: "1920x1080" };
  void aliasedInvalid;
  const future: VideosBody<"sora-3"> = {
    model: "sora-3",
    prompt: "x",
    future_motion_control: true,
  };
  video(future);

  // @ts-expect-error — model omitted means sora-2, so 1024p is rejected
  video({ prompt: "x", size: "1024x1792" });

  // @ts-expect-error — seconds is a string enum on the wire
  video({ model: "sora-2", prompt: "x", seconds: 8 });

  // @ts-expect-error — bogus top-level param on a known arm
  video({ model: "sora-2-pro", prompt: "x", bogus_thing: 1 });
}

function realtimeSessionTypeTests(): void {
  const session = realtimeSession({
    type: "realtime",
    model: "gpt-realtime-2.1",
    instructions: "You are a concise voice assistant.",
    output_modalities: ["audio"],
    audio: {
      input: {
        format: { type: "audio/pcm", rate: 24000 },
        turn_detection: { type: "semantic_vad", eagerness: "low" },
      },
      output: { voice: "marin", speed: 1.1 },
    },
    tools: [{ type: "function", name: "f", parameters: { type: "object" } }],
    tool_choice: "auto",
    max_output_tokens: "inf",
  });

  // The validated object is the GA session config; toSdk("openai") wraps it
  // for client.realtime.clientSecrets.create().
  expectAssignable<RealtimeSessionCreateRequest>(session);
  expectAssignable<ClientSecretCreateParams>(session.toSdk("openai"));

  // The target vocabulary is closed to what the endpoint declares, and the
  // zero-arg form is gone.
  // @ts-expect-error "ai-sdk" is not a target for openai.realtimeSession
  session.toSdk("ai-sdk");
  // @ts-expect-error the zero-arg .toSdk() form was removed
  session.toSdk();

  // Custom voice objects and plain custom voice ids both type-check.
  realtimeSession({ type: "realtime", audio: { output: { voice: { id: "voice_1234" } } } });
  realtimeSession({ type: "realtime", audio: { output: { voice: "voice_1234" } } });

  // @ts-expect-error — session type must be the literal "realtime"
  realtimeSession({ type: "transcription" });

  // @ts-expect-error — bogus top-level param
  realtimeSession({ type: "realtime", bogus_thing: 1 });
}

/**
 * The two per-transcription-model REFUSALS the GA reference states outright,
 * as compile errors — the arms this module's JSDoc described and nothing
 * enforced.
 *
 * `keywords`/`languages` are deliberately absent from these assertions: the
 * reference makes a POSITIVE statement about two models and says nothing about
 * the other six, so they are a demotable runtime warning rather than an
 * unappealable `never`. src/providers/openai/realtime.test.ts pins that half.
 */
function realtimeTranscriptionArmTypeTests(): void {
  // The documented pairings, all legal.
  realtimeSession({
    type: "realtime",
    audio: { input: { transcription: { model: "gpt-realtime-whisper", delay: "low" } } },
  });
  realtimeSession({
    type: "realtime",
    audio: {
      input: {
        transcription: {
          model: "gpt-transcribe",
          prompt: "medical dictation",
          keywords: ["acme"],
          languages: ["en"],
        },
      },
    },
  });
  realtimeSession({
    type: "realtime",
    audio: { input: { transcription: { model: "whisper-1", prompt: "style", language: "en" } } },
  });

  realtimeSession({
    type: "realtime",
    audio: {
      input: {
        transcription: {
          model: "gpt-transcribe",
          // @ts-expect-error — `delay` is "only supported with
          // gpt-realtime-whisper in GA sessions"; this compiled, and was
          // enforced at neither layer.
          delay: "low",
        },
      },
    },
  });
  realtimeSession({
    type: "realtime",
    audio: {
      input: {
        transcription: {
          model: "gpt-realtime-whisper",
          // @ts-expect-error — `prompt` is "not supported with gpt-realtime-whisper".
          prompt: "style",
        },
      },
    },
  });

  // A future id keeps the whole flat shape — the docs say nothing about a model
  // they do not list, and a `never` there would be a refusal we invented.
  realtimeSession({
    type: "realtime",
    audio: { input: { transcription: { model: "future-stt-1", delay: "low", prompt: "p" } } },
  });
  // …and so does a session that names no transcription model at all.
  realtimeSession({
    type: "realtime",
    audio: { input: { transcription: { language: "en" } } },
  });
  // `null` still means "transcription off".
  realtimeSession({ type: "realtime", audio: { input: { transcription: null } } });

  // Top-level `ExactKeys` survives the nested arm…
  // @ts-expect-error — bogus top-level param, with the arms applied.
  realtimeSession({ type: "realtime", bogus_thing: 1, audio: { input: { transcription: {} } } });
  // …and so does the nested typo check.
  realtimeSession({
    type: "realtime",
    // @ts-expect-error — `transcriptionn` is not a key of `audio.input`.
    audio: { input: { transcriptionn: { model: "whisper-1" } } },
  });

  // The caller's literal survives onto the result.
  const ok = realtimeSession({
    type: "realtime",
    audio: { input: { transcription: { model: "gpt-realtime-whisper", delay: "low" } } },
  });
  expectAssignable<"low" | undefined>(ok.audio?.input?.transcription?.delay);
}

void realtimeTranscriptionArmTypeTests;

function imageEditTypeTests(): void {
  // A File is a Blob, and the SDK's Uploadable accepts it — so the same
  // validated object satisfies both surfaces.
  const file = new File([new Uint8Array(4)], "product.png", { type: "image/png" });

  const edit = imageEdit({
    model: "gpt-image-1.5",
    image: [file, file],
    prompt: "put the product on a marble counter",
    mask: file,
    size: "1536x1024",
    quality: "high",
    input_fidelity: "high",
    output_format: "webp",
  });
  expectAssignable<ImageEditParams>(edit);
  expectAssignable<ImageEditParams>(edit.toSdk("openai"));
  expectAssignable<"gpt-image-1.5">(edit.model);

  // model may be omitted (server default gpt-image-1.5).
  imageEdit({ image: file, prompt: "x", input_fidelity: "low" });
  // chatgpt-image-latest is an edit-only model id.
  imageEdit({ model: "chatgpt-image-latest", image: file, prompt: "x" });
  // gpt-image-2 takes free-form sizes.
  imageEdit({ model: "gpt-image-2", image: file, prompt: "x", size: "1536x864" });
  // Unknown models fall back to the loose escape arm.
  imageEdit({ model: "gpt-image-9", image: file, prompt: "x", some_future_param: true });

  // @ts-expect-error — gpt-image-2 processes inputs at high fidelity; input_fidelity is fixed
  imageEdit({ model: "gpt-image-2", image: file, prompt: "x", input_fidelity: "low" });

  // @ts-expect-error — input_fidelity is unsupported for gpt-image-1-mini
  imageEdit({ model: "gpt-image-1-mini", image: file, prompt: "x", input_fidelity: "high" });

  // @ts-expect-error — gpt-image-2 has no transparent background
  imageEdit({ model: "gpt-image-2", image: file, prompt: "x", background: "transparent" });

  // @ts-expect-error — aliasing cannot send a known id through the loose arm
  const aliasedInvalid: ImageEditBody = {
    model: "gpt-image-2",
    image: file,
    prompt: "x",
    background: "transparent",
  };
  void aliasedInvalid;
  const future: ImageEditBody<"gpt-image-9"> = {
    model: "gpt-image-9",
    image: file,
    prompt: "x",
    future_edit_control: true,
  };
  imageEdit(future);

  // @ts-expect-error — response_format is dall-e-2 only on this endpoint
  imageEdit({ model: "gpt-image-1", image: file, prompt: "x", response_format: "url" });

  // @ts-expect-error — dall-e-2 takes exactly one image
  imageEdit({ model: "dall-e-2", image: [file, file], prompt: "x" });

  // @ts-expect-error — output_format is for the GPT image models
  imageEdit({ model: "dall-e-2", image: file, prompt: "x", output_format: "png" });

  // @ts-expect-error — bogus top-level param on a known arm
  imageEdit({ model: "gpt-image-1.5", image: file, prompt: "x", bogus_thing: 1 });
}

function ttsTypeTests(): void {
  const spoken = tts({
    model: "gpt-4o-mini-tts",
    input: "Today is a wonderful day to build something people love.",
    voice: "marin",
    instructions: "Speak in a cheerful and positive tone.",
    response_format: "wav",
    speed: 1.1,
    stream_format: "sse",
  });
  expectAssignable<SpeechCreateParams>(spoken);
  expectAssignable<SpeechCreateParams>(spoken.toSdk("openai"));
  // @ts-expect-error the zero-arg .toSdk() form was removed
  spoken.toSdk();

  // WIDENED: the docs list 13 built-in voices; the SDK union omits fable,
  // onyx and nova even though its own docstring names them.
  tts({ model: "gpt-4o-mini-tts", input: "x", voice: "fable" });
  tts({ model: "tts-1", input: "x", voice: "onyx" });
  tts({ model: "tts-1-hd", input: "x", voice: "nova" });
  // Custom voices ride as an object on this endpoint.
  tts({ model: "tts-1", input: "x", voice: { id: "voice_1234" } });
  // Unknown models fall back to the loose escape arm.
  tts({ model: "tts-2", input: "x", voice: "whoever", some_future_param: true });

  // @ts-expect-error — instructions does not work with tts-1
  tts({ model: "tts-1", input: "x", voice: "alloy", instructions: "be chirpy" });

  // @ts-expect-error — aliasing cannot send a known id through the loose arm
  const aliasedInvalid: SpeechBody = {
    model: "tts-1",
    input: "x",
    voice: "alloy",
    instructions: "be chirpy",
  };
  void aliasedInvalid;
  const future: SpeechBody<"tts-2"> = {
    model: "tts-2",
    input: "x",
    voice: "future-voice",
    future_prosody: true,
  };
  tts(future);

  // @ts-expect-error — sse streaming is not supported for tts-1-hd
  tts({ model: "tts-1-hd", input: "x", voice: "alloy", stream_format: "sse" });

  // @ts-expect-error — marin is a gpt-4o-mini-tts voice, not a tts-1 voice
  tts({ model: "tts-1", input: "x", voice: "marin" });

  // @ts-expect-error — bogus top-level param on a known arm
  tts({ model: "tts-1", input: "x", voice: "alloy", bogus_thing: 1 });
}

function sttTypeTests(): void {
  const file = new File([new Uint8Array(4)], "speech.mp3", { type: "audio/mpeg" });

  const transcript = stt({
    model: "whisper-1",
    file,
    response_format: "verbose_json",
    timestamp_granularities: ["word", "segment"],
    language: "en",
    temperature: 0,
  });
  expectAssignable<TranscriptionCreateParams>(transcript);
  expectAssignable<TranscriptionCreateParams>(transcript.toSdk("openai"));
  expectAssignable<"whisper-1">(transcript.model);
  // @ts-expect-error the zero-arg .toSdk() form was removed
  transcript.toSdk();

  stt({ model: "gpt-transcribe", file, keywords: ["unmodel"], languages: ["en", "pt"] });
  stt({
    model: "gpt-4o-mini-transcribe",
    file,
    include: ["logprobs"],
    response_format: "json",
    stream: true,
  });
  stt({
    model: "gpt-4o-transcribe-diarize",
    file,
    response_format: "diarized_json",
    chunking_strategy: "auto",
    known_speaker_names: ["agent"],
    known_speaker_references: ["data:audio/wav;base64,AA"],
  });
  // Unknown models fall back to the loose escape arm.
  stt({ model: "whisper-9", file, some_future_param: true });

  // @ts-expect-error — verbose_json is not a gpt-4o-transcribe format
  stt({ model: "gpt-4o-transcribe", file, response_format: "verbose_json" });

  // @ts-expect-error — timestamp_granularities is whisper-1 only
  stt({ model: "gpt-4o-transcribe", file, timestamp_granularities: ["word"] });

  // @ts-expect-error — whisper-1 does not stream
  stt({ model: "whisper-1", file, stream: true });

  // @ts-expect-error — gpt-4o-transcribe-diarize does not support prompts
  stt({ model: "gpt-4o-transcribe-diarize", file, prompt: "hello" });

  // @ts-expect-error — aliasing cannot send a known id through the loose arm
  const aliasedInvalid: TranscriptionBody = {
    model: "gpt-4o-transcribe-diarize",
    file,
    prompt: "hello",
  };
  void aliasedInvalid;
  const future: TranscriptionBody<"whisper-9"> = {
    model: "whisper-9",
    file,
    future_alignment: true,
  };
  stt(future);

  // @ts-expect-error — keywords is a gpt-transcribe param
  stt({ model: "whisper-1", file, keywords: ["unmodel"] });

  // @ts-expect-error — known speakers are diarize-only
  stt({ model: "gpt-transcribe", file, known_speaker_names: ["agent"] });

  // @ts-expect-error — bogus top-level param on a known arm
  stt({ model: "whisper-1", file, bogus_thing: 1 });
}

// ---------------------------------------------------------------------------
// `checkChat`'s report: the shared Chat Completions finish-reason vocabulary
// ---------------------------------------------------------------------------

function chatReportTypeTests(): void {
  const report = checkChat({ choices: [{ finish_reason: "stop" }] });

  expectTrue<HasLiteralMember<typeof report.finishReason, "stop">>();
  expectTrue<HasLiteralMember<typeof report.finishReason, "content_filter">>();
  if (report.finishReason === "length") void 0;
  if (report.finishReason === "content_filter") void 0;
  if (report.finishReason === "function_call") void 0;

  // Backward compatible: the `Reason` parameter defaults to `string`.
  const wide: ResponseReport = report;
  void wide;
  const asString: string | undefined = report.finishReason;
  void asString;

  // `ResponseReport`'s `Reason` parameter is a REAL constraint, not
  // decoration: an UNTAILED instantiation rejects a typo. That diagnostic is
  // exactly what the tailed unions trade away, deliberately — see the tail
  // decision recorded on `AssemblyaiTranscriptStatus` in
  // src/providers/assemblyai/check.ts. If one of those endpoints ever starts
  // REFUSING an off-list value, deleting its `(string & {})` arm is all it
  // takes to turn this diagnostic on for real.
  const closed: ResponseReport<"stop" | "length"> = { warnings: [], usage: {} };
  // @ts-expect-error — "lenght" is not in the closed union; no tail to absorb it.
  void (closed.finishReason === "lenght");
  // The tailed alias, by contrast, absorbs it — asserted so the difference is
  // pinned rather than assumed.
  const tailed: ChatFinishReason = "lenght";
  void tailed;
}

void chatTypeTests;
void chatReportTypeTests;
void chatModelUnionTests;
void imagesTypeTests;
void imageEditTypeTests;
void ttsTypeTests;
void sttTypeTests;
void videoTypeTests;
void realtimeSessionTypeTests;

// ---------------------------------------------------------------------------
// `ValidateOptions.media` paths address THESE params
//
// The path was `Array<string | number>`, so `["mesages", 0, …]` compiled, never
// matched a part, and the declared facts were silently never applied — a
// declared 999 MB attachment on a request reported `{ ok: true, warnings: [] }`.
// The root segment is closed against the params the call actually passed;
// everything below it is the runtime check's job (`media_declaration_dropped`),
// because a recursive path type costs +40% instantiations on a chat body.
// ---------------------------------------------------------------------------

function mediaPathTypeTests(): void {
  chat.safe(
    { model: "gpt-5.2", messages: [{ role: "user", content: "hi" }] },
    { media: [{ path: ["messages", 0, "content", 0], bytes: 1024 }] },
  );

  // The empty path is the params object itself — the socket endpoints' coordinate.
  chat.safe({ model: "gpt-5.2", messages: [] }, { media: [{ path: [], durationSeconds: 60 }] });

  chat.safe(
    { model: "gpt-5.2", messages: [{ role: "user", content: "hi" }] },
    // @ts-expect-error — `"mesages"` is not a key of these params: TS2820 with a
    // "Did you mean 'messages'?" suggestion, where nothing at all used to fire.
    { media: [{ path: ["mesages", 0, "content", 0], bytes: 999_999_999 }] },
  );

  // The other fields were already tight and stay so.
  chat.safe(
    { model: "gpt-5.2", messages: [] },
    // @ts-expect-error — `durationSecs` is not a declaration field.
    { media: [{ path: ["messages"], durationSecs: 30 }] },
  );
}

export { mediaPathTypeTests };
