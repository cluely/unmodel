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
};
