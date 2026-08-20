/**
 * Type-level tests for `unmodel/transcribe`'s ready-made pack. NOT run by
 * `bun test` — this file is only type-checked (`bun run check` / tsc --noEmit).
 *
 * The category's flagship claim is a **compile-time** one, so this file carries
 * more weight here than its five siblings do: the same word `audio` has three
 * legal shapes, which of them is legal depends on the *route*, and the promise
 * is that a `Blob` handed to a URL-only endpoint is a red squiggle rather than
 * a 400 from a body the route does not parse.
 *
 * Section 1 is that promise, in all four directions:
 *
 * | route | accepts | `{ file }` | `{ url }` | `{ fileId }` |
 * |---|---|---|---|---|
 * | assemblyai, deepgram, gladia, revai, speechmatics | url | error | ok | error |
 * | openai, cartesia | file | ok | error | error |
 * | elevenlabs | file, url | ok | ok | error |
 * | soniox | url, fileId | error | ok | ok |
 * | mistral | all three | ok | ok | ok |
 * | inworld | none — see its module header | error | error | error |
 *
 * Sections 2–5 are the same four properties every category entry has: the ref
 * union, the provider's own result type, `providerOptions` keyed by the pack,
 * and no `.toApi`.
 */
import { transcribe } from "../../src/unified/transcribe";
import { createTranscribe } from "../../src/unified/transcribe";
import { transcribe as assemblyaiTranscribe } from "../../src/providers/assemblyai/unified";
import { transcribe as cartesiaTranscribe } from "../../src/providers/cartesia/unified-transcribe";
import { transcribe as elevenlabsTranscribe } from "../../src/providers/elevenlabs/unified-transcribe";
import { transcribe as mistralTranscribe } from "../../src/providers/mistral/unified";
import { transcribe as openaiTranscribe } from "../../src/providers/openai/unified";
import { transcribe as sonioxTranscribe } from "../../src/providers/soniox/unified";
import type { UnifiedRef } from "../../src/core/unified/types";
import type {
  AudioInputFor,
  TranscribeParams,
} from "../../src/core/unified/vocabulary/transcribe";
import { expectAssignable, expectTrue, type IsNever, type KeyIn } from "./helpers";

declare const file: Blob;
const url = "https://example.com/interview.wav";

// ---------------------------------------------------------------------------
// 1 · `audio` narrows per model, at compile time
// ---------------------------------------------------------------------------

function audioNarrowingTests(): void {
  // --- URL-only routes ------------------------------------------------------
  transcribe({ model: "assemblyai/universal-2", audio: { url } });
  // @ts-expect-error — /v2/transcript has no multipart form; upload first.
  transcribe({ model: "assemblyai/universal-2", audio: { file } });
  // @ts-expect-error — and no file API either.
  transcribe({ model: "assemblyai/universal-2", audio: { fileId: "f_1" } });

  transcribe({ model: "deepgram/nova-3", audio: { url } });
  // @ts-expect-error — /v1/listen takes raw bytes as the HTTP body, not a part.
  transcribe({ model: "deepgram/nova-3", audio: { file } });

  transcribe({ model: "gladia/solaria-1", audio: { url } });
  // @ts-expect-error — bytes go through POST /v2/upload first.
  transcribe({ model: "gladia/solaria-1", audio: { file } });

  transcribe({ model: "revai/machine", audio: { url } });
  // @ts-expect-error — the multipart `media` part is not a field of the job.
  transcribe({ model: "revai/machine", audio: { file } });

  transcribe({ model: "speechmatics/standard", audio: { url } });
  // @ts-expect-error — `data_file` is not a field of the job config.
  transcribe({ model: "speechmatics/standard", audio: { file } });

  // --- Blob-only routes: the inverse ---------------------------------------
  transcribe({ model: "openai/whisper-1", audio: { file } });
  // @ts-expect-error — POST /v1/audio/transcriptions fetches nothing.
  transcribe({ model: "openai/whisper-1", audio: { url } });
  // @ts-expect-error — and /v1/files is the Assistants surface, not this one.
  transcribe({ model: "openai/whisper-1", audio: { fileId: "file-abc" } });

  transcribe({ model: "cartesia/ink-whisper", audio: { file } });
  // @ts-expect-error — POST /stt has no URL field at all.
  transcribe({ model: "cartesia/ink-whisper", audio: { url } });

  // --- The mixed routes -----------------------------------------------------
  transcribe({ model: "elevenlabs/scribe_v2", audio: { file } });
  transcribe({ model: "elevenlabs/scribe_v2", audio: { url } });
  // @ts-expect-error — Scribe has no file-id form.
  transcribe({ model: "elevenlabs/scribe_v2", audio: { fileId: "f_1" } });

  transcribe({ model: "soniox/stt-async-v5", audio: { url } });
  transcribe({ model: "soniox/stt-async-v5", audio: { fileId: "f_1" } });
  // @ts-expect-error — bytes go through POST /v1/files first.
  transcribe({ model: "soniox/stt-async-v5", audio: { file } });

  // Mistral is the only route that takes all three, so nothing narrows.
  transcribe({ model: "mistral/voxtral-mini-latest", audio: { file } });
  transcribe({ model: "mistral/voxtral-mini-latest", audio: { url } });
  transcribe({ model: "mistral/voxtral-mini-latest", audio: { fileId: "file-abc" } });

  // Inworld accepts none: its route takes base64 inline, which a synchronous
  // compile step cannot produce. Both halves of the narrowing say so — the type
  // here, and the declared `unsupported.audio` at runtime.
  // @ts-expect-error — there is no canonical shape this route can be given.
  transcribe({ model: "inworld/inworld/inworld-stt-1", audio: { file } });
  // @ts-expect-error — including the two that are merely absent from the wire.
  transcribe({ model: "inworld/inworld/inworld-stt-1", audio: { url } });

  // --- The degraded case ----------------------------------------------------
  // A ref that is not a literal selects no adapter, so `audio` widens to every
  // shape any adapter in the pack accepts — open at compile time, still checked
  // at runtime. Degrading to a union beats degrading to `any`.
  const runtimeRef: string = "assemblyai/universal-2";
  transcribe({ model: runtimeRef, audio: { url } });
  transcribe({ model: runtimeRef, audio: { file } });

  // `.safe` carries the identical constraint — it is the same params type.
  transcribe.safe({ model: "assemblyai/universal-2", audio: { url } });
  // @ts-expect-error — including the narrowing.
  transcribe.safe({ model: "assemblyai/universal-2", audio: { file } });

  // A hand-built pack narrows to exactly the adapters it was given.
  const pair = createTranscribe([openaiTranscribe, assemblyaiTranscribe]);
  pair({ model: "openai/whisper-1", audio: { file } });
  pair({ model: "assemblyai/universal-2", audio: { url } });
  // @ts-expect-error — the narrowing survives being re-packed.
  pair({ model: "assemblyai/universal-2", audio: { file } });
}

/** The mapping the adapters' `audioInputs` arrays feed, checked directly. */
expectAssignable<AudioInputFor<"url">>({ url });
expectAssignable<AudioInputFor<"file" | "url">>({ file });
expectAssignable<AudioInputFor<"file" | "url">>({ url });
// @ts-expect-error — a kind outside the set has no arm in the union.
expectAssignable<AudioInputFor<"url">>({ file });
// @ts-expect-error — and an empty set has no arms at all.
expectAssignable<AudioInputFor<never>>({ url });

// The adapters declare the arrays the table above is derived from.
expectAssignable<readonly ["url"]>(assemblyaiTranscribe.audioInputs);
expectAssignable<readonly ["file"]>(openaiTranscribe.audioInputs);
expectAssignable<readonly ["file"]>(cartesiaTranscribe.audioInputs);
expectAssignable<readonly ["file", "url"]>(elevenlabsTranscribe.audioInputs);
expectAssignable<readonly ["url", "fileId"]>(sonioxTranscribe.audioInputs);
expectAssignable<readonly ["file", "url", "fileId"]>(mistralTranscribe.audioInputs);

// ---------------------------------------------------------------------------
// 2 · The ref union
// ---------------------------------------------------------------------------

type PackRefs = UnifiedRef<
  | typeof openaiTranscribe
  | typeof assemblyaiTranscribe
  | typeof elevenlabsTranscribe
  | typeof sonioxTranscribe
>;

expectAssignable<PackRefs>("openai/whisper-1");
expectAssignable<PackRefs>("openai/gpt-4o-transcribe-diarize");
expectAssignable<PackRefs>("assemblyai/universal-3-5-pro");
expectAssignable<PackRefs>("elevenlabs/scribe_v2");
expectAssignable<PackRefs>("soniox/stt-async-v5");
// @ts-expect-error — a realtime-only model is not a batch ref…
expectAssignable<PackRefs>("elevenlabs/scribe_v2_realtime");
// @ts-expect-error — …and neither is a model no adapter declares.
expectAssignable<PackRefs>("assemblyai/universal-9");

function refUnionTests(): void {
  // The union drives autocomplete…
  transcribe({ model: "speechmatics/melia-1", audio: { url } });
  // …but does not gate the call: a model newer than this snapshot still works
  // and draws a runtime `unknown_model` warning.
  transcribe({ model: "assemblyai/universal-9", audio: { url } });
  // A provider with no adapter is a runtime structural error, not a type error.
  transcribe({ model: "sarvam/saarika-v2", audio: { url } });

  // @ts-expect-error — `audio` is not optional; there is nothing to transcribe.
  transcribe({ model: "assemblyai/universal-2" });
  // @ts-expect-error — a typo'd canonical field is caught by ExactKeys.
  transcribe({ model: "assemblyai/universal-2", audio: { url }, langauge: "pt" });
  // @ts-expect-error — `"segment"` is a granularity, `"segments"` is a typo.
  transcribe({ model: "assemblyai/universal-2", audio: { url }, timestamps: "segments" });

  // A field the provider does not support is a RUNTIME error (declared on the
  // adapter), never a compile error: the vocabulary is one shape for everyone.
  transcribe({ model: "cartesia/ink-whisper", audio: { file }, diarization: { enabled: true } });
}

// ---------------------------------------------------------------------------
// 3 · The result is the ref'd provider's own
// ---------------------------------------------------------------------------

function resultTypeTests(): void {
  const assemblyai = transcribe({ model: "assemblyai/universal-2", audio: { url } });
  expectAssignable<string>(assemblyai.audio_url);
  expectAssignable<string>(assemblyai.request.url);
  assemblyai.toSdk("assemblyai");
  // @ts-expect-error — "deepgram" is not one of assemblyai.transcribe's targets.
  assemblyai.toSdk("deepgram");
  // @ts-expect-error — nor is the AssemblyAI body a Deepgram one.
  expectAssignable<string>(assemblyai.detect_language);

  const deepgram = transcribe({ model: "deepgram/nova-3", audio: { url } });
  // Deepgram's body is `{url}` alone — every option rides in the query string.
  expectAssignable<string | undefined>(deepgram.url);
  expectTrue<IsNever<KeyIn<typeof deepgram, "model">>>();
  expectAssignable<string>(deepgram.toSdk("deepgram").model as string);

  // Warnings ride on every result, whichever provider answered.
  expectAssignable<readonly { code: string }[]>(assemblyai.warnings);
  expectAssignable<readonly { code: string }[]>(deepgram.warnings);
}

// ---------------------------------------------------------------------------
// 4 · providerOptions is keyed by the pack
// ---------------------------------------------------------------------------

function providerOptionsTests(): void {
  transcribe({
    model: "assemblyai/universal-2",
    audio: { url },
    providerOptions: {
      assemblyai: { auto_highlights: true },
      deepgram: { smart_format: true },
    },
  });
  // @ts-expect-error — but not for a provider this pack does not have.
  transcribe({ model: "assemblyai/universal-2", audio: { url }, providerOptions: { asemblyai: {} } });
  // @ts-expect-error — nor for one that is simply not a transcribe provider.
  transcribe({ model: "assemblyai/universal-2", audio: { url }, providerOptions: { google: {} } });

  const pair = createTranscribe([openaiTranscribe, assemblyaiTranscribe]);
  pair({ model: "openai/whisper-1", audio: { file }, providerOptions: { openai: {} } });
  // @ts-expect-error — deepgram is not in THIS pack, even though it is in the full one.
  pair({ model: "openai/whisper-1", audio: { file }, providerOptions: { deepgram: {} } });
}

// ---------------------------------------------------------------------------
// 5 · No retargeting on a media result
// ---------------------------------------------------------------------------

function noToApiTests(): void {
  const result = transcribe({ model: "assemblyai/universal-2", audio: { url } });
  expectTrue<IsNever<KeyIn<typeof result, "toApi">>>();
  expectTrue<IsNever<KeyIn<typeof result, "toApiSafe">>>();
  expectTrue<KeyIn<typeof result, "toSdk"> extends "toSdk" ? true : false>();
  expectTrue<KeyIn<typeof result, "request"> extends "request" ? true : false>();
}

// ---------------------------------------------------------------------------
// 6 · Per-model narrowing: timestamps, language and the extras
// ---------------------------------------------------------------------------

/**
 * The category's *second* narrowing, and it composes with the first rather than
 * competing: `audioInputs` types `audio` from the **adapter**, `modelParams`
 * types `timestamps` from the **model**, and `TranscribeValidator` intersects
 * both — so a request can be wrong in either way independently.
 */
function timestampNarrowingTests(): void {
  transcribe({ model: "openai/whisper-1", audio: { file }, timestamps: "segment" });
  // @ts-expect-error — "`timestamp_granularities[]` … is only supported for whisper-1".
  transcribe({ model: "openai/gpt-4o-transcribe", audio: { file }, timestamps: "segment" });
  transcribe({ model: "openai/gpt-4o-transcribe", audio: { file }, timestamps: "none" });

  // ElevenLabs is the one route with character-level timings…
  transcribe({ model: "elevenlabs/scribe_v1", audio: { url }, timestamps: "character" });
  // @ts-expect-error — …and the one that has no segment level.
  transcribe({ model: "elevenlabs/scribe_v1", audio: { url }, timestamps: "segment" });

  // Deepgram's `utterances` is the segment switch; word timings are
  // unconditional, so there is no `"none"` to ask for.
  transcribe({ model: "deepgram/nova-3", audio: { url }, timestamps: "segment" });
  // @ts-expect-error — the field would be accepted and the timings arrive anyway.
  transcribe({ model: "deepgram/nova-3", audio: { url }, timestamps: "none" });

  // The four routes with no granularity field at all report word timings only.
  transcribe({ model: "assemblyai/universal-2", audio: { url }, timestamps: "word" });
  // @ts-expect-error — and a segment is not a coarse word.
  transcribe({ model: "assemblyai/universal-2", audio: { url }, timestamps: "segment" });
  // @ts-expect-error — same at Cartesia, whose array's only member is "word".
  transcribe({ model: "cartesia/ink-whisper", audio: { file }, timestamps: "character" });
  transcribe({ model: "cartesia/ink-whisper", audio: { file }, timestamps: "none" });
}

function languageNarrowingTests(): void {
  // Closed lists complete without gating — see `LanguageOf` for why the tail is
  // open: `"en-GB"` is a working request that the adapter sends as `"en"`.
  transcribe({ model: "gladia/solaria-3", audio: { url }, language: "fr" });
  transcribe({ model: "gladia/solaria-3", audio: { url }, language: "fr-CA" });
  transcribe({ model: "speechmatics/melia-1", audio: { url }, language: "multi" });
  // A model with no published enum keeps the plain `string`.
  transcribe({ model: "gladia/solaria-1", audio: { url }, language: "cy" });
  // @ts-expect-error — but it is a tag, not an array; `languages` is the plural.
  transcribe({ model: "gladia/solaria-1", audio: { url }, language: ["cy"] });
}

function extrasNarrowingTests(): void {
  transcribe({ model: "deepgram/nova-3", audio: { url }, keyterm: "unmodel" });
  // @ts-expect-error — keyterm prompting is the Nova-3 models'; others ignore it.
  transcribe({ model: "deepgram/nova-2", audio: { url }, keyterm: "unmodel" });
  transcribe({ model: "deepgram/nova-2", audio: { url }, keywords: "unmodel" });

  // AssemblyAI's two gated blocks point in opposite directions.
  transcribe({ model: "assemblyai/universal-3-5-pro", audio: { url }, temperature: 0.2 });
  // @ts-expect-error — "Supported: Universal-3.5 Pro only".
  transcribe({ model: "assemblyai/universal-2", audio: { url }, temperature: 0.2 });
  transcribe({ model: "assemblyai/universal-2", audio: { url }, summarization: true });
  // @ts-expect-error — "Supported: Universal-2 only".
  transcribe({ model: "assemblyai/universal-3-5-pro", audio: { url }, summarization: true });
  // @ts-expect-error — and `slam-1` is gated away from both.
  transcribe({ model: "assemblyai/slam-1", audio: { url }, auto_chapters: true });

  // Rev AI: human-only one way, machine-only the other, low-cost in between.
  transcribe({ model: "revai/human", audio: { url }, rush: true });
  // @ts-expect-error — `rush` is "only available for `transcriber: "human"`".
  transcribe({ model: "revai/machine", audio: { url }, rush: true });
  transcribe({ model: "revai/machine", audio: { url }, remove_disfluencies: true });
  // @ts-expect-error — …which is "not available for human transcription jobs".
  transcribe({ model: "revai/human", audio: { url }, remove_disfluencies: true });
  transcribe({ model: "revai/fusion", audio: { url }, diarization_type: "premium" });
  // @ts-expect-error — and not "in the low-cost environment".
  transcribe({ model: "revai/low_cost", audio: { url }, diarization_type: "premium" });

  // Speechmatics' Melia 1 "does not yet support" the intelligence add-ons.
  transcribe({ model: "speechmatics/standard", audio: { url }, summarization_config: {} });
  // @ts-expect-error
  transcribe({ model: "speechmatics/melia-1", audio: { url }, language: "multi", summarization_config: {} });
  // @ts-expect-error — `domain: "medical"` "requires `model: "enhanced"`".
  transcribe({ model: "speechmatics/standard", audio: { url }, domain: "medical" });
  transcribe({ model: "speechmatics/enhanced", audio: { url }, domain: "medical" });

  // ElevenLabs' one row difference.
  transcribe({ model: "elevenlabs/scribe_v2", audio: { url }, no_verbatim: true });
  // @ts-expect-error — "Only supported with scribe_v2 model".
  transcribe({ model: "elevenlabs/scribe_v1", audio: { url }, no_verbatim: true });

  // @ts-expect-error — a key no model on the ref'd provider takes is a typo.
  transcribe({ model: "mistral/voxtral-mini-latest", audio: { url }, contextbias: ["x"] });
  transcribe({ model: "mistral/voxtral-mini-latest", audio: { url }, context_bias: ["x"] });
}

/** A dynamic or unknown ref degrades to the wide vocabulary, never to `never`. */
function degradedRefTests(): void {
  const dynamic: string = process.env["MODEL"] ?? "openai/whisper-1";
  transcribe({ model: dynamic, audio: { url }, timestamps: "character", language: "cy" });
  transcribe({ model: "openai/whisper-9", audio: { file }, timestamps: "segment" });
  // Extras degrade to "every name in the build, typed `unknown`"…
  transcribe({ model: "openai/whisper-9", audio: { file }, temperature: 0.2 });
  // @ts-expect-error — …and a typo is still caught by `ExactKeys`.
  transcribe({ model: "openai/whisper-9", audio: { file }, temperatur: 0.2 });
}

// ---------------------------------------------------------------------------
// The adapters satisfy the category contract
// ---------------------------------------------------------------------------

expectAssignable<"transcribe">(assemblyaiTranscribe.category);
expectAssignable<"assemblyai">(assemblyaiTranscribe.provider);
expectAssignable<readonly string[]>(assemblyaiTranscribe.models);
expectAssignable<TranscribeParams["model"]>("assemblyai/universal-2");

export {
  audioNarrowingTests,
  refUnionTests,
  resultTypeTests,
  providerOptionsTests,
  noToApiTests,
  timestampNarrowingTests,
  languageNarrowingTests,
  extrasNarrowingTests,
  degradedRefTests,
};
