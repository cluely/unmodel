/**
 * Type-level tests for `unmodel/sts`'s ready-made pack. NOT run by `bun test` —
 * this file is only type-checked (`bun run check` / tsc --noEmit).
 *
 * The four properties every category entry has are here, and then the two that
 * are this category's own:
 *
 * 1. **Three of the five words are REQUIRED** — `model`, `audio` and `voice`.
 *    No other category asks for that much, and it is a fact about the operation
 *    rather than about any one wire: a recording with no target voice is not a
 *    conversion.
 * 2. **`audio` is one shape and one shape only** — `{ file: Blob }`. Both
 *    witnesses take a required binary form part with no URL, base64 or
 *    upload-handle alternative, so there is no `audioInputs`-style per-adapter
 *    narrowing here at all, and no arm of the union to get wrong.
 */
import { createSts, sts } from "../../src/unified/sts";
import { sts as elevenlabsSts } from "../../src/providers/elevenlabs/unified-sts";
import { sts as humeSts } from "../../src/providers/hume/unified-sts";
import type { UnifiedRef } from "../../src/core/unified/types";
import type { StsParams } from "../../src/core/unified/vocabulary/sts";
import type { TtsParams } from "../../src/core/unified/vocabulary/tts";
import { expectAssignable, expectTrue, type IsNever, type KeyIn } from "./helpers";

type PackRefs = UnifiedRef<typeof elevenlabsSts | typeof humeSts>;

expectAssignable<PackRefs>("elevenlabs/eleven_multilingual_sts_v2");
expectAssignable<PackRefs>("elevenlabs/eleven_english_sts_v2");
expectAssignable<PackRefs>("elevenlabs/eleven_english_sts_v1");
expectAssignable<PackRefs>("hume/voice-conversion");
// @ts-expect-error — a TEXT-to-speech id. The two wires are disjoint at this vendor.
expectAssignable<PackRefs>("elevenlabs/eleven_multilingual_v2");
// @ts-expect-error — Hume's TTS rows are `version` values, not this route's.
expectAssignable<PackRefs>("hume/octave-2");
// @ts-expect-error — the vendor's product name, not the catalogued id.
expectAssignable<PackRefs>("elevenlabs/voice-changer");

declare const CLIP: Blob;
const AUDIO = { file: CLIP };
const EL_VOICE = "21m00Tcm4TlvDq8ikWAM";

function refUnionTests(): void {
  sts({ model: "elevenlabs/eleven_multilingual_sts_v2", audio: AUDIO, voice: EL_VOICE });
  sts({ model: "hume/voice-conversion", audio: AUDIO, voice: { name: "Male English Actor" } });
  // A model newer than this snapshot still works, with a runtime warning.
  sts({ model: "elevenlabs/eleven_multilingual_sts_v3", audio: AUDIO, voice: EL_VOICE });
  // A provider with no adapter is a runtime structural error, not a type error.
  sts({ model: "cartesia/voice-changer", audio: AUDIO, voice: EL_VOICE });

  // @ts-expect-error — a typo'd canonical field is caught by ExactKeys.
  sts({ model: "elevenlabs/eleven_english_sts_v2", audio: AUDIO, voce: EL_VOICE });
  // @ts-expect-error — `text` is the neighbouring category's word; there is none here.
  sts({ model: "elevenlabs/eleven_english_sts_v2", audio: AUDIO, voice: EL_VOICE, text: "hi" });
  // @ts-expect-error — nor `speed`: the timing comes from the recording.
  sts({ model: "elevenlabs/eleven_english_sts_v2", audio: AUDIO, voice: EL_VOICE, speed: 1.1 });
  // @ts-expect-error — nor a length: the recording decides that too.
  sts({ model: "hume/voice-conversion", audio: AUDIO, voice: "v", durationSeconds: 4 });
}

/**
 * The requiredness this category is built on — three of five words, and none of
 * them can be dropped at any ref in the pack.
 */
function requirednessTests(): void {
  // @ts-expect-error — no recording to convert.
  sts({ model: "elevenlabs/eleven_english_sts_v2", voice: EL_VOICE });
  // @ts-expect-error — no target voice, which is the whole operation.
  sts({ model: "elevenlabs/eleven_english_sts_v2", audio: AUDIO });
  // @ts-expect-error — …and the same at the provider whose WIRE marks it optional.
  sts({ model: "hume/voice-conversion", audio: AUDIO });
  // @ts-expect-error — and at a ref this build has never heard of.
  sts({ model: "elevenlabs/eleven_multilingual_sts_v3", audio: AUDIO });
}

/**
 * `audio` is `{ file: Blob }` and nothing else — the fact that makes this whole
 * category CLI-unreachable.
 */
function audioShapeTests(): void {
  sts({ model: "elevenlabs/eleven_english_sts_v2", audio: { file: CLIP }, voice: EL_VOICE });
  // @ts-expect-error — no URL arm: neither wire fetches a recording.
  sts({ model: "elevenlabs/eleven_english_sts_v2", audio: { url: "https://x/y.wav" }, voice: EL_VOICE });
  // @ts-expect-error — no base64 arm either.
  sts({ model: "hume/voice-conversion", audio: { data: "AAAA" }, voice: "v" });
  // @ts-expect-error — and a bare Blob is not the shape; the wrapper is the word.
  sts({ model: "hume/voice-conversion", audio: CLIP, voice: "v" });
}

/** `voice` — the one word where the two witnesses genuinely differ. */
function voiceTests(): void {
  // A bare string is "whichever spelling this provider takes" everywhere.
  sts({ model: "elevenlabs/eleven_english_sts_v2", audio: AUDIO, voice: EL_VOICE });
  sts({ model: "hume/voice-conversion", audio: AUDIO, voice: "f898a92e" });

  // Both object arms type-check at both providers, because `voice` is wide:
  // neither vendor publishes an enumerable voice catalog, so there is no
  // `voices` row to narrow from. ElevenLabs REFUSES `{ name }` at run time,
  // with a message naming the id — a check the type deliberately does not
  // duplicate, because a per-account catalog is not a compile-time fact.
  sts({ model: "hume/voice-conversion", audio: AUDIO, voice: { name: "Male English Actor" } });
  sts({ model: "hume/voice-conversion", audio: AUDIO, voice: { id: "f898a92e" } });

  // @ts-expect-error — but the shape is still checked: no third arm exists.
  sts({ model: "hume/voice-conversion", audio: AUDIO, voice: { uuid: "f898a92e" } });
}

/** The `outputFormat` narrowing — both spellings, per model. */
function formatArmTests(): void {
  sts({
    model: "elevenlabs/eleven_multilingual_sts_v2",
    audio: AUDIO,
    voice: EL_VOICE,
    outputFormat: "opus",
  });
  sts({
    model: "elevenlabs/eleven_multilingual_sts_v2",
    audio: AUDIO,
    voice: EL_VOICE,
    outputFormat: { format: "pcm_s16le", sampleRate: 16000 },
  });
  // @ts-expect-error — ElevenLabs' composite has no FLAC arm, in either spelling.
  sts({ model: "elevenlabs/eleven_english_sts_v2", audio: AUDIO, voice: EL_VOICE, outputFormat: "flac" });

  // Hume's `format` is a container NAME, so its codec set is two members wide.
  sts({ model: "hume/voice-conversion", audio: AUDIO, voice: "v", outputFormat: "mp3" });
  sts({
    model: "hume/voice-conversion",
    audio: AUDIO,
    voice: "v",
    outputFormat: { format: "pcm_s16le", container: "wav" },
  });
  // @ts-expect-error — and Opus is not one of them, which the composite side has.
  sts({ model: "hume/voice-conversion", audio: AUDIO, voice: "v", outputFormat: "opus" });
  sts({
    model: "hume/voice-conversion",
    audio: AUDIO,
    voice: "v",
    // @ts-expect-error — …and the object form is narrowed too.
    outputFormat: { format: "opus" },
  });
}

/** The per-model extras — wire-verbatim, and refused where the model has none. */
function extraTests(): void {
  // Every knob on both wires has exactly one witness, so all eight are extras.
  sts({
    model: "elevenlabs/eleven_multilingual_sts_v2",
    audio: AUDIO,
    voice: EL_VOICE,
    remove_background_noise: true,
    seed: 12345,
    voice_settings: { stability: 0.4, speed: 1.1 },
    file_format: "pcm_s16le_16",
    enable_logging: false,
  });
  sts({
    model: "hume/voice-conversion",
    audio: AUDIO,
    voice: "v",
    strip_headers: true,
    context: { generation_id: "gen_1" },
    include_timestamp_types: ["word"],
  });

  // @ts-expect-error — ElevenLabs publishes no strip_headers.
  sts({ model: "elevenlabs/eleven_english_sts_v2", audio: AUDIO, voice: EL_VOICE, strip_headers: true });
  // @ts-expect-error — and Hume publishes no seed.
  sts({ model: "hume/voice-conversion", audio: AUDIO, voice: "v", seed: 7 });
  // @ts-expect-error — an extra takes its wire type, not `unknown`.
  sts({ model: "elevenlabs/eleven_english_sts_v2", audio: AUDIO, voice: EL_VOICE, seed: "12345" });
  sts({
    model: "elevenlabs/eleven_english_sts_v2",
    audio: AUDIO,
    voice: EL_VOICE,
    // @ts-expect-error — …including the nested one, which is ./tts's own interface.
    voice_settings: { stability: "high" },
  });
}

/** `providerOptions` — the escape hatch, typed by provider id. */
function providerOptionsTests(): void {
  sts({
    model: "elevenlabs/eleven_multilingual_sts_v2",
    audio: AUDIO,
    voice: EL_VOICE,
    providerOptions: { elevenlabs: { seed: 7 } },
  });
  sts({
    model: "hume/voice-conversion",
    audio: AUDIO,
    voice: "v",
    // `voice.provider` lives here rather than as an extra — see
    // `src/providers/hume/tts-params.ts` for why the word `provider` stays off
    // the top level.
    providerOptions: { hume: { voice: { id: "f898a92e", provider: "HUME_AI" } } },
  });
}

/** The factory, and the narrowing surviving a one-adapter pack. */
function factoryTests(): void {
  const elevenlabsOnly = createSts([elevenlabsSts]);
  elevenlabsOnly({
    model: "elevenlabs/eleven_multilingual_sts_v2",
    audio: AUDIO,
    voice: EL_VOICE,
    remove_background_noise: true,
  });

  const humeOnly = createSts([humeSts]);
  humeOnly({ model: "hume/voice-conversion", audio: AUDIO, voice: "v", outputFormat: "mp3" });
  // @ts-expect-error — the codec narrowing survives a one-adapter pack.
  humeOnly({ model: "hume/voice-conversion", audio: AUDIO, voice: "v", outputFormat: "opus" });
  // @ts-expect-error — …and so does the requiredness.
  humeOnly({ model: "hume/voice-conversion", audio: AUDIO });
}

/**
 * The vocabulary is closed. Five words, and `voice` is the one it shares with
 * `tts` — which is precisely the word that makes them different categories:
 * there it picks the speaker for text the model reads, here it is the only
 * thing the request says about the result.
 */
type StsWord = "model" | "audio" | "voice" | "outputFormat" | "providerOptions";

expectTrue<IsNever<Exclude<StsWord, KeyIn<StsParams, StsWord>>>>();
expectTrue<IsNever<Exclude<keyof StsParams, StsWord>>>();
// `audio` is this category's own; `tts` has `text` where this has a recording.
expectTrue<IsNever<Exclude<"voice" | "model" | "outputFormat" | "providerOptions", keyof TtsParams>>>();
expectTrue<IsNever<Extract<"audio", keyof TtsParams>>>();

export {
  refUnionTests,
  requirednessTests,
  audioShapeTests,
  voiceTests,
  formatArmTests,
  extraTests,
  providerOptionsTests,
  factoryTests,
};
