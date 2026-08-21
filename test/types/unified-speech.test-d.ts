/**
 * Type-level tests for `unmodel/speech`'s ready-made pack. NOT run by
 * `bun test` — this file is only type-checked (`bun run check` / tsc --noEmit).
 *
 * The runtime suites next door prove what a call *does*; these prove what an
 * editor knows before the call is made:
 *
 *  1. **The ref union comes from the fourteen adapters' `as const` model
 *     arrays.** `"elevenlabs/eleven_v3"` is in it, `"elevenlabs/eleven_v4"` is
 *     not — but an unregistered ref is still *callable*, because a model
 *     released after this snapshot must not need a library upgrade.
 *  2. **The result is the ref'd provider's own `Validated`.** OpenAI's has
 *     `input`, ElevenLabs' has `model_id` and no `voice_id` (it moved into the
 *     URL), and `.toSdk` accepts only that provider's target id.
 *  3. **`providerOptions` is keyed by the providers in the pack.** A typo is a
 *     compile error rather than an override that silently never happens.
 *  4. **There is no `.toApi`.** Retargeting is a chat-dialect feature; a media
 *     result must not advertise one.
 *  5. **`outputFormat`, `language` and the extras narrow to the ref.** A codec
 *     the endpoint has no spelling for is a compile error in *both* spellings —
 *     the shorthand and the fully-spelled object — and an extra one model over
 *     is a compile error naming the models that take it.
 */
import { speech } from "../../src/unified/speech";
import { speech as cartesiaSpeech } from "../../src/providers/cartesia/unified-speech";
import { speech as elevenlabsSpeech } from "../../src/providers/elevenlabs/unified-speech";
import { speech as murfSpeech } from "../../src/providers/murf/unified";
import { speech as openaiSpeech } from "../../src/providers/openai/unified";
import { createSpeech } from "../../src/unified/speech";
import type { UnifiedRef } from "../../src/core/unified/types";
import type { SpeechParams } from "../../src/core/unified/vocabulary/speech";
import { expectAssignable, expectTrue, type IsNever, type KeyIn } from "./helpers";

// ---------------------------------------------------------------------------
// 1 · The ref union
// ---------------------------------------------------------------------------

type PackRefs = UnifiedRef<
  | typeof openaiSpeech
  | typeof elevenlabsSpeech
  | typeof cartesiaSpeech
  | typeof murfSpeech
>;

expectAssignable<PackRefs>("elevenlabs/eleven_v3");
expectAssignable<PackRefs>("elevenlabs/eleven_flash_v2_5");
expectAssignable<PackRefs>("openai/gpt-4o-mini-tts");
expectAssignable<PackRefs>("cartesia/sonic-3.5");
expectAssignable<PackRefs>("murf/falcon-2");
// @ts-expect-error — a model no adapter declares is not in the union…
expectAssignable<PackRefs>("elevenlabs/eleven_v4");
// @ts-expect-error — …and neither is a provider from another category.
expectAssignable<PackRefs>("google/gemini-3-pro");

function refUnionTests(): void {
  // The union drives autocomplete…
  speech({ model: "elevenlabs/eleven_v3", text: "hi", voice: "v1" });
  speech({ model: "deepgram/aura-2-thalia-en", text: "hi" });
  // …but does not gate the call: a model newer than this snapshot still works
  // and draws a runtime `unknown_model` warning.
  speech({ model: "elevenlabs/eleven_v4", text: "hi", voice: "v1" });
  // A provider with no adapter is a runtime structural error, not a type error:
  // the ref tail is `(string & {})`, deliberately.
  speech({ model: "sarvam/bulbul-v2", text: "hi" });

  // @ts-expect-error — `text` is not optional; there is nothing to say.
  speech({ model: "openai/tts-1", voice: "alloy" });
  // @ts-expect-error — a typo'd canonical field is caught by ExactKeys.
  speech({ model: "openai/tts-1", text: "hi", voiceId: "alloy" });
  // @ts-expect-error — `"linear16"` is a provider spelling; the vocabulary uses ffmpeg's.
  speech({ model: "openai/tts-1", text: "hi", outputFormat: "linear16" });

  // A field the provider does not support is a RUNTIME error (declared on the
  // adapter), never a compile error: the vocabulary is one shape for everyone.
  speech({ model: "lmnt/blizzard", text: "hi", voice: "leah", speed: 1.5 });
}

// ---------------------------------------------------------------------------
// 2 · The result is the ref'd provider's own
// ---------------------------------------------------------------------------

function resultTypeTests(): void {
  const openai = speech({ model: "openai/gpt-4o-mini-tts", text: "hi", voice: "marin" });
  expectAssignable<string>(openai.input);
  expectAssignable<string>(openai.request.url);
  openai.toSdk("openai");
  // @ts-expect-error — "elevenlabs" is not one of openai.speech's SDK targets.
  openai.toSdk("elevenlabs");
  // @ts-expect-error — nor is the openai body an ElevenLabs one.
  expectAssignable<string>(openai.model_id);

  const elevenlabs = speech({
    model: "elevenlabs/eleven_flash_v2_5",
    text: "hi",
    voice: { id: "v1" },
  });
  expectAssignable<string | undefined>(elevenlabs.model_id);
  const sdk = elevenlabs.toSdk("elevenlabs");
  expectAssignable<string>(sdk.voiceId);
  // `voice_id` and the query params are STRIPPED from the wire body — they live
  // in `.request.url`, which is the whole reason that endpoint has a cast.
  expectTrue<IsNever<KeyIn<typeof elevenlabs, "voice_id">>>();
  expectTrue<IsNever<KeyIn<typeof elevenlabs, "output_format">>>();

  // Warnings ride on every result, whichever provider answered.
  expectAssignable<readonly { code: string }[]>(openai.warnings);
  expectAssignable<readonly { code: string }[]>(elevenlabs.warnings);
}

// ---------------------------------------------------------------------------
// 3 · providerOptions is keyed by the pack
// ---------------------------------------------------------------------------

function providerOptionsTests(): void {
  // One literal may carry blocks for every provider it might be pointed at.
  speech({
    model: "openai/tts-1",
    text: "hi",
    voice: "alloy",
    providerOptions: {
      openai: { instructions: "Speak briskly." },
      cartesia: { pronunciation_dict_id: "dict_1" },
    },
  });
  // @ts-expect-error — but not for a provider this pack does not have.
  speech({ model: "openai/tts-1", text: "hi", providerOptions: { opneai: { speed: 1 } } });
  // @ts-expect-error — nor for one that is simply not a speech provider.
  speech({ model: "openai/tts-1", text: "hi", providerOptions: { google: { speed: 1 } } });

  // A hand-built pack narrows the key set to exactly its own adapters.
  const pair = createSpeech([openaiSpeech, elevenlabsSpeech]);
  pair({ model: "openai/tts-1", text: "hi", voice: "alloy", providerOptions: { openai: {} } });
  // @ts-expect-error — cartesia is not in THIS pack, even though it is in the full one.
  pair({ model: "openai/tts-1", text: "hi", voice: "alloy", providerOptions: { cartesia: {} } });
}

// ---------------------------------------------------------------------------
// 4 · No retargeting on a media result
// ---------------------------------------------------------------------------

function noToApiTests(): void {
  const result = speech({ model: "openai/tts-1", text: "hi", voice: "alloy" });
  expectTrue<IsNever<KeyIn<typeof result, "toApi">>>();
  expectTrue<IsNever<KeyIn<typeof result, "toApiSafe">>>();
  // The members that DO exist, for contrast.
  expectTrue<KeyIn<typeof result, "toSdk"> extends "toSdk" ? true : false>();
  expectTrue<KeyIn<typeof result, "request"> extends "request" ? true : false>();
}

// ---------------------------------------------------------------------------
// 5 · Per-model narrowing: outputFormat, language and the extras
// ---------------------------------------------------------------------------

/**
 * The half `test/unified/completions.test.ts` cannot assert: a completion list
 * is a suggestion, and only a compile error is a limit.
 */
function codecNarrowingTests(): void {
  speech({ model: "openai/tts-1", text: "hi", voice: "alloy", outputFormat: "flac" });
  // @ts-expect-error — Hume's `format.type` is mp3 / wav / pcm and nothing else.
  speech({ model: "hume/octave", text: "hi", outputFormat: "flac" });
  speech({ model: "hume/octave", text: "hi", outputFormat: "pcm_s16le" });
  // @ts-expect-error — `vorbis` has no spelling at any of the fourteen.
  speech({ model: "openai/tts-1", text: "hi", voice: "alloy", outputFormat: "vorbis" });
  // @ts-expect-error — Resemble's PCM widths are its alone; OpenAI has one.
  speech({ model: "openai/tts-1", text: "hi", voice: "alloy", outputFormat: "pcm_s24le" });
  speech({ model: "resemble/resemble-ultra", text: "hi", voice: "v1", outputFormat: "pcm_s24le" });

  // Both spellings narrow: the object form is the one a caller reaches for
  // precisely when they care about the encoding, so it must not stay wide.
  speech({
    model: "cartesia/sonic-3",
    text: "hi",
    voice: "v1",
    outputFormat: { format: "pcm_f32le", sampleRate: 44100 },
  });
  speech({
    model: "cartesia/sonic-3",
    text: "hi",
    voice: "v1",
    // @ts-expect-error — …and Cartesia has no AAC arm. Note where the error
    // lands: on `format`, naming the five codecs, rather than on `model`.
    outputFormat: { format: "aac", sampleRate: 44100 },
  });

  // `sampleRate` and `bitrate` stay wide on purpose — their legal values depend
  // on the codec chosen beside them, which is run time's job.
  speech({
    model: "elevenlabs/eleven_v3",
    text: "hi",
    voice: "v1",
    outputFormat: { format: "mp3", sampleRate: 44100, bitrate: 128000 },
  });
}

function languageNarrowingTests(): void {
  // A closed list COMPLETES without gating: the canonical `language` is a
  // BCP-47 tag, and `"pt-BR"` is a working request the adapter sends as `"pt"`
  // with an `approximated_param`. A closed union would refuse it, which is the
  // one failure worse than no narrowing at all.
  speech({ model: "cartesia/sonic-3", text: "hi", voice: "v1", language: "pt" });
  speech({ model: "cartesia/sonic-3", text: "hi", voice: "v1", language: "pt-BR" });
  speech({ model: "cartesia/sonic-3", text: "hi", voice: "v1", language: "tlh" });

  // A model with no list keeps the plain `string`, which is the same shape.
  speech({ model: "murf/gen2", text: "hi", voice: "v1", language: "en-US" });

  // @ts-expect-error — but it is still a string, not a locale object.
  speech({ model: "cartesia/sonic-3", text: "hi", voice: "v1", language: { code: "pt" } });
}

function extrasNarrowingTests(): void {
  speech({ model: "openai/gpt-4o-mini-tts", text: "hi", voice: "marin", instructions: "calm" });
  // @ts-expect-error — "Does not work with `tts-1` or `tts-1-hd`".
  speech({ model: "openai/tts-1", text: "hi", voice: "alloy", instructions: "calm" });

  // MiniMax's emotion set grows twice across the catalog.
  speech({ model: "minimax/speech-2.6-hd", text: "hi", voice: "v1", emotion: "whisper" });
  // @ts-expect-error — 2.8 has `fluent` but not `whisper`.
  speech({ model: "minimax/speech-2.8-hd", text: "hi", voice: "v1", emotion: "whisper" });
  speech({ model: "minimax/speech-2.8-hd", text: "hi", voice: "v1", emotion: "fluent" });
  // @ts-expect-error — and the 01/02 series has neither.
  speech({ model: "minimax/speech-01-hd", text: "hi", voice: "v1", emotion: "fluent" });
  speech({ model: "minimax/speech-01-hd", text: "hi", voice: "v1", emotion: "calm" });

  // Rime's Coda denies all four Mist-family knobs, so its row declares none.
  speech({ model: "rime/mistv2", text: "hi", voice: "astra", noTextNormalization: true });
  // @ts-expect-error — `noTextNormalization` is "mist/mistv2 only".
  speech({ model: "rime/mistv3", text: "hi", voice: "astra", noTextNormalization: true });
  speech({ model: "rime/mistv3", text: "hi", voice: "astra", pauseBetweenBrackets: true });
  // @ts-expect-error — …which Coda does not have either.
  speech({ model: "rime/coda", text: "hi", voice: "astra", pauseBetweenBrackets: true });

  // Inworld's two rules cross: `deliveryMode` is TTS-2's, `temperature` is not.
  speech({ model: "inworld/inworld-tts-2", text: "hi", voice: "v1", deliveryMode: "STABLE" });
  // @ts-expect-error — "the request is accepted but sampling is unaffected".
  speech({ model: "inworld/inworld-tts-2", text: "hi", voice: "v1", temperature: 0.5 });
  speech({ model: "inworld/inworld-tts-2-flash", text: "hi", voice: "v1", temperature: 0.5 });
  // @ts-expect-error — and `deliveryMode` is "Only supported by `inworld-tts-2`".
  speech({ model: "inworld/inworld-tts-1", text: "hi", voice: "v1", deliveryMode: "STABLE" });

  // @ts-expect-error — a key no model on the ref'd provider takes is a typo.
  speech({ model: "elevenlabs/eleven_v3", text: "hi", voice: "v1", stabilty: 0.3 });
  speech({ model: "elevenlabs/eleven_v3", text: "hi", voice: "v1", stability: 0.3 });
}

/**
 * A ref the type system cannot resolve — built at run time, or naming a model
 * newer than this snapshot — degrades to the wide vocabulary rather than to
 * `never`. Same trade every model list in this library makes.
 */
function degradedRefTests(): void {
  const dynamic: string = process.env["MODEL"] ?? "openai/tts-1";
  speech({ model: dynamic, text: "hi", outputFormat: "vorbis", language: "tlh" });
  speech({ model: "openai/tts-9", text: "hi", outputFormat: "pcm_s24le" });
  // Extras degrade to "every name in the build, typed `unknown`", so a real
  // extra still compiles…
  speech({ model: "openai/tts-9", text: "hi", instructions: "calm" });
  // @ts-expect-error — …and a typo is still caught by `ExactKeys`.
  speech({ model: "openai/tts-9", text: "hi", instrctions: "calm" });
}

/** Deepgram is the one provider where the voice IS knowable — via the ref. */
function voiceStaysWideTests(): void {
  // Voice catalogs are per-account and thousands long at most providers, so
  // `voice` stays the wide `Voice` wherever no closed list is published;
  // `SpeechModelParams` argues the case in full.
  speech({ model: "elevenlabs/eleven_v3", text: "hi", voice: "any-cloned-voice-id" });
  speech({ model: "murf/gen2", text: "hi", voice: { id: "en-US-natalie" } });
  speech({ model: "hume/octave", text: "hi", voice: { name: "Kore" } });
  // The ref union types Deepgram's, because there the model id is the voice.
  expectAssignable<PackRefs | (string & {})>("deepgram/aura-2-thalia-en");
}

/**
 * …and where a provider DOES publish one, the unified surface offers it — the
 * `languages` model applied to `voice`. OpenAI hand-catalogues nine voices for
 * tts-1 and thirteen for gpt-4o-mini-tts, `checkVoice` refuses an off-list
 * string at the wire, and the unified surface used to be strictly looser than
 * the wire surface it compiles down to.
 *
 * The counts are pinned in `test/unified/completions.test.ts` (against the wire
 * layer's own list); what is pinned here is that the list does not GATE.
 */
function voiceNarrowingTests(): void {
  // (The result is the compiled WIRE body, whose `voice` is the provider's own
  // `string | SpeechCustomVoice` — the narrowing under test is on the input.)
  speech({ model: "openai/tts-1", text: "hi", voice: "alloy" });
  speech({ model: "openai/gpt-4o-mini-tts", text: "hi", voice: "marin" });

  // The open tail, in all three spellings: a custom voice is minted per account
  // and `checkVoice` never enum-checks the object forms, so neither does this.
  speech({ model: "openai/tts-1", text: "hi", voice: "voice_1234" });
  speech({ model: "openai/tts-1", text: "hi", voice: { id: "voice_1234" } });
  speech({ model: "openai/gpt-4o-mini-tts", text: "hi", voice: { name: "my clone" } });

  // A runtime-built ref degrades to the wide vocabulary, unchanged.
  const dynamic: string = process.env["MODEL"] ?? "openai/tts-1";
  speech({ model: dynamic, text: "hi", voice: "anything" });

  // @ts-expect-error — a voice is a name or a handle, never a number.
  speech({ model: "openai/tts-1", text: "hi", voice: 42 });
}

// ---------------------------------------------------------------------------
// The adapters satisfy the category contract
// ---------------------------------------------------------------------------

expectAssignable<"speech">(openaiSpeech.category);
expectAssignable<"openai">(openaiSpeech.provider);
expectAssignable<readonly string[]>(openaiSpeech.models);
expectAssignable<SpeechParams["model"]>("openai/tts-1");

export {
  refUnionTests,
  resultTypeTests,
  providerOptionsTests,
  noToApiTests,
  codecNarrowingTests,
  languageNarrowingTests,
  extrasNarrowingTests,
  degradedRefTests,
  voiceStaysWideTests,
  voiceNarrowingTests,
};
