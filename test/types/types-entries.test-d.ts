/**
 * Type-level spot checks for the type-only entries — `unmodel/types` and
 * `unmodel/<provider>/types`. Not executed by `bun test` (the filename avoids
 * the *.test.* pattern); checked by `bun run check` (tsc --noEmit).
 *
 * `test/types-entries.test.ts` proves the entries are complete, packaged and
 * runtime-free by scanning the source and the build. What it cannot prove is
 * that a `<Endpoint>Body` alias points at the *right* type: `export type
 * ChatBody = ChatCompletionsBody` and `export type ChatBody = SpeechBody`
 * are indistinguishable to a regex. That is what this file is for — the
 * aliases are checked against the wire types they claim to be, and the
 * `satisfies` idiom the entries exist for is exercised end to end, including
 * the errors it is supposed to produce.
 */
import type {
  ChatBody as OpenaiChatBody,
  ChatCompletionsBody,
  ImageBody as OpenaiImageBody,
  ImageEditBody as OpenaiImageEditBody,
  ImagesBody,
  RealtimeSessionBody as OpenaiRealtimeSessionBody,
  SttBody as OpenaiSttBody,
  TtsBody as OpenaiTtsBody,
  TranscriptionBody as OpenaiTranscriptionBody,
  SpeechBody as OpenaiSpeechBody,
  VideoBody as OpenaiVideoBody,
  VideosBody,
} from "../../src/providers/openai/types";
import type { ChatBody as AnthropicChatBody, MessagesBody } from "../../src/providers/anthropic/types";
import type {
  ChatBody as GoogleChatBody,
  GenerateContentBody,
  GenerateTtsBody,
  GeminiTtsVoiceName,
  SttBody as GoogleSttBody,
  TtsBody as GoogleTtsBody,
  VideoBody as GoogleVideoBody,
} from "../../src/providers/google/types";
import type { ChatBody as XaiChatBody, XaiTextModelId } from "../../src/providers/xai/types";
import type { ChatBody as CohereChatBody } from "../../src/providers/cohere/types";
import type { TtsBody as SmallestTtsBody, TtsParams as SmallestTtsParams } from "../../src/providers/smallest-ai/types";
import type { TtsBody as HumeTtsBody } from "../../src/providers/hume/types";
import type { ChatBody as BedrockChatBody, ConverseParams } from "../../src/providers/amazon-bedrock/types";
import type { SttBody as DeepgramSttBody, ListenParams } from "../../src/providers/deepgram/types";
import type { MusicBody as StabilityMusicBody } from "../../src/providers/stability/types";
import type {
  ChatModelRef,
  ChatParams,
  ImageParams,
  Issue,
  SttParams,
  TtsParams,
  ValidateResult,
  Voice,
} from "../../src/types";
import {
  expectAssignable,
  expectNotAny,
  expectNotNever,
  expectTrue,
  type HasLiteralMember,
  type IsNever,
  type KeyIn,
} from "./helpers";

/** Two-way assignability — an alias must BE its target, not merely accept it. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

// ---------------------------------------------------------------------------
// The aliases resolve, and resolve to the wire type the validator takes.
// ---------------------------------------------------------------------------

expectTrue<Same<OpenaiChatBody, ChatCompletionsBody>>();
expectTrue<Same<OpenaiImageBody, ImagesBody>>();
expectTrue<Same<OpenaiTtsBody, OpenaiSpeechBody>>();
expectTrue<Same<OpenaiSttBody, OpenaiTranscriptionBody>>();
expectTrue<Same<OpenaiVideoBody, VideosBody>>();
expectTrue<Same<AnthropicChatBody, MessagesBody>>();
expectTrue<Same<GoogleChatBody, GenerateContentBody>>();
expectTrue<Same<GoogleTtsBody, GenerateTtsBody>>();
expectTrue<Same<BedrockChatBody, ConverseParams>>();
expectTrue<Same<DeepgramSttBody, ListenParams>>();

// Nothing collapsed to `any` or `never` on the way through the alias — the two
// failure modes assignability cannot see.
expectNotAny<OpenaiChatBody>();
expectNotNever<OpenaiChatBody>();
expectNotAny<GoogleSttBody>();
expectNotNever<GoogleSttBody>();
expectNotAny<GoogleVideoBody>();
expectNotNever<GoogleVideoBody>();
expectNotAny<StabilityMusicBody>();
expectNotNever<StabilityMusicBody>();

// The collision cases: the category name IS the wire name, re-exported rather
// than aliased. What matters is that the import compiles and resolves.
expectNotAny<CohereChatBody>();
expectNotNever<CohereChatBody>();
expectNotAny<HumeTtsBody>();
expectNotNever<HumeTtsBody>();
expectNotAny<OpenaiImageEditBody>();
expectNotNever<OpenaiImageEditBody>();
expectNotAny<OpenaiRealtimeSessionBody>();
expectNotNever<OpenaiRealtimeSessionBody>();
// smallest-ai's `TtsBody` is the wire BODY; `TtsParams` adds the header param
// that never reaches the JSON. Both are on the entry, and they are different
// types — the alias must not have flattened one onto the other.
expectTrue<IsNever<KeyIn<SmallestTtsBody, "x_expire_content">>>();
expectTrue<Same<KeyIn<SmallestTtsParams, "x_expire_content">, "x_expire_content">>();
expectAssignable<SmallestTtsBody>({ text: "hi", voice_id: "meher" });

// ---------------------------------------------------------------------------
// Generic aliases keep the generic. The fleet's chat body narrows `model` to
// the overlay's own catalog by default; the escape-hatch parameter on the
// per-model unions survives aliasing.
// ---------------------------------------------------------------------------

// The default type argument is the overlay's OWN catalog union, not `string` —
// which is the whole point of the fleet's per-provider entries. `Extract`
// rather than assignability: `string` and an open-tailed union are mutually
// assignable, so only a distributive probe can tell them apart.
expectTrue<HasLiteralMember<XaiChatBody["model"], XaiTextModelId>>();
expectTrue<Same<XaiChatBody<"grok-4">["model"], "grok-4" | (string & {})>>();

// The future-model escape hatch: a known id passed as the parameter does NOT
// opt that model out of its exact arm (the same property openai.test-d.ts pins
// on `ImagesBody` itself, asserted here through the alias).
// @ts-expect-error — gpt-image-2's exact arm still applies, aliased or not
const knownAsFuture: OpenaiImageBody<"gpt-image-2"> = { model: "gpt-image-2", prompt: "x", response_format: "url" };
void knownAsFuture;

// ---------------------------------------------------------------------------
// The `satisfies` idiom the entries exist for.
// ---------------------------------------------------------------------------

// gpt-image-2's size preset union survives the alias, in both spellings the
// documented rule space allows.
const wideImage = {
  model: "gpt-image-2",
  prompt: "a lighthouse at dusk",
  size: "3840x1280",
} satisfies OpenaiImageBody;
// `satisfies` rather than an annotation, so the literal type is preserved.
expectTrue<Same<typeof wideImage.size, "3840x1280">>();

// @ts-expect-error — "2:1" is an aspect ratio; the wire takes "WIDTHxHEIGHT"
const badImage = { model: "gpt-image-2", prompt: "a lighthouse", size: "2:1" } satisfies OpenaiImageBody;
void badImage;

const claude = {
  model: "claude-sonnet-4-5",
  max_tokens: 1024,
  messages: [{ role: "user", content: "hi" }],
} satisfies AnthropicChatBody;
expectAssignable<number>(claude.max_tokens);

// Google's TTS arms: `generationConfig` is narrowed per model, and the voice
// name is the closed Gemini list rather than a bare string.
const narration = {
  model: "gemini-2.5-flash-preview-tts",
  contents: [{ parts: [{ text: "Have a wonderful day!" }] }],
  generationConfig: {
    responseModalities: ["AUDIO"],
    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } },
  },
} satisfies GoogleTtsBody;
expectAssignable<GeminiTtsVoiceName>("Kore");
void narration;

const badVoice = {
  model: "gemini-2.5-flash-preview-tts",
  contents: [{ parts: [{ text: "Have a wonderful day!" }] }],
  generationConfig: {
    responseModalities: ["AUDIO"],
    // @ts-expect-error — "Brian" is not one of the documented Gemini voices
    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Brian" } } },
  },
} satisfies GoogleTtsBody;
void badVoice;

// The fleet overlay: `model` completes the overlay's own catalog and still
// accepts an id models.dev has not caught up with.
const grok = {
  model: "grok-4",
  messages: [{ role: "user", content: "hi" }],
} satisfies XaiChatBody;
void grok;

// ---------------------------------------------------------------------------
// The hub — the canonical vocabulary, and only that.
// ---------------------------------------------------------------------------

expectNotAny<ChatParams>();
expectNotNever<ChatParams>();
expectNotAny<TtsParams>();
expectNotNever<TtsParams>();
expectNotAny<ImageParams>();
expectNotNever<SttParams>();

// The ref union is the generated one, not `string`.
expectTrue<HasLiteralMember<ChatModelRef, "openai/gpt-5.2">>();

const message = {
  model: "anthropic/claude-sonnet-4-5",
  messages: [{ role: "user", content: "Summarise this." }],
  maxOutputTokens: 512,
} satisfies ChatParams;
expectTrue<Same<typeof message.model, "anthropic/claude-sonnet-4-5">>();

const speech = {
  model: "openai/gpt-4o-mini-tts",
  text: "The lighthouse keeper checked the lamp.",
  voice: "alloy",
  speed: 1.1,
} satisfies TtsParams;
expectAssignable<Voice>(speech.voice);

const transcript = {
  model: "openai/whisper-1",
  audio: { url: "https://example.com/a.wav" },
} satisfies SttParams;
void transcript;

// The result vocabulary is on the hub too, so a caller can annotate what a
// validator hands back without importing any runtime.
declare const outcome: ValidateResult<{ model: string }>;
if (!outcome.ok) expectAssignable<readonly Issue[]>(outcome.errors);
