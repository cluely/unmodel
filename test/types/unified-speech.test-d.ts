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
// The adapters satisfy the category contract
// ---------------------------------------------------------------------------

expectAssignable<"speech">(openaiSpeech.category);
expectAssignable<"openai">(openaiSpeech.provider);
expectAssignable<readonly string[]>(openaiSpeech.models);
expectAssignable<SpeechParams["model"]>("openai/tts-1");

export { refUnionTests, resultTypeTests, providerOptionsTests, noToApiTests };
