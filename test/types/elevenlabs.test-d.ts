/**
 * Type-level tests for the elevenlabs provider (TEXT-TO-SPEECH + MUSIC
 * modalities). NOT run by `bun test` — this file is only type-checked
 * (`bun run check` / tsc --noEmit). These tests pin the `ExactKeys`
 * public-cast contract of `elevenlabs.textToSpeech`: the excess-key compile
 * error, the `safe<T>` overload carrying the same guard, and — the regression
 * this endpoint's cast exists for — that the path param (`voice_id`) and the
 * three QUERY params are STRIPPED from the wire body and live only in
 * `.request.url`. They also pin the CLOSED enum surfaces on both endpoints:
 * a field whose documented value space is finite must reject junk at compile
 * time, not merely at runtime.
 */
import { music, musicUrl, textToSpeech, textToSpeechUrl } from "../../src/providers/elevenlabs";
import type {
  ElevenlabsMusicOutputFormat,
  ElevenlabsOptimizeStreamingLatency,
  ElevenlabsOutputFormat,
  MusicSdkParams,
  TextToSpeechQuery,
  TextToSpeechSdkParams,
} from "../../src/providers/elevenlabs";
import type { EndpointConstraints } from "../../src/core/constraint-types";
import { expectAssignable, expectTrue, type IsNever, type KeyIn } from "./helpers";

function textToSpeechTypeTests(): void {
  const v = textToSpeech({
    voice_id: "JBFqnCBsd6RMkjVDRZzb",
    text: "Hello world",
    model_id: "eleven_flash_v2_5",
    language_code: "en",
    voice_settings: { stability: 0.4, similarity_boost: 0.75, speed: 1.1 },
    pronunciation_dictionary_locators: [{ pronunciation_dictionary_id: "dict_1" }],
    seed: 7,
    previous_text: "before",
    next_text: "after",
    apply_text_normalization: "auto",
    output_format: "mp3_44100_128",
    enable_logging: false,
    optimize_streaming_latency: 2,
  });

  // STRIPPED: the path param and every query param are absent from the body
  // type — they were folded into `.request.url`. These four assertions are
  // the ones that go red if the Omit<> drops out of the public cast.
  expectTrue<IsNever<KeyIn<typeof v, "voice_id">>>();
  expectTrue<IsNever<KeyIn<typeof v, "output_format">>>();
  expectTrue<IsNever<KeyIn<typeof v, "enable_logging">>>();
  expectTrue<IsNever<KeyIn<typeof v, "optimize_streaming_latency">>>();
  // @ts-expect-error voice_id is a path param — stripped from the wire body
  v.voice_id;
  // @ts-expect-error output_format is a query param — stripped from the wire body
  v.output_format;

  // KEPT: everything else is the exact JSON body, literal types intact.
  expectAssignable<string>(v.text);
  expectAssignable<"eleven_flash_v2_5">(v.model_id);
  expectAssignable<"auto">(v.apply_text_normalization);
  expectAssignable<string>(JSON.stringify(v));

  // `.request` and `.toSdk("elevenlabs")` stay typed; the formatter re-shapes
  // to the camelCase { voiceId, request } pair the official SDK takes.
  expectAssignable<string>(v.request.url);
  expectAssignable<"POST">(v.request.method);
  expectAssignable<TextToSpeechSdkParams>(v.toSdk("elevenlabs"));
  expectAssignable<string>(v.toSdk("elevenlabs").voiceId);
  expectAssignable<string | undefined>(v.toSdk("elevenlabs").request.modelId);

  // The SDK target vocabulary is closed to what this endpoint declares.
  // @ts-expect-error "openai" is not an SDK target for elevenlabs.textToSpeech
  v.toSdk("openai");
  // @ts-expect-error the zero-arg .toSdk() form was removed
  v.toSdk();

  // Unknown model ids stay assignable through the (string & {}) escape.
  textToSpeech({ voice_id: "v1", text: "hi", model_id: "eleven_future_v9" });

  // safe() narrows to the same stripped Validated shape.
  const result = textToSpeech.safe({ voice_id: "v1", text: "hi", output_format: "wav_44100" });
  if (result.ok) {
    expectTrue<IsNever<KeyIn<typeof result.params, "voice_id">>>();
    expectTrue<IsNever<KeyIn<typeof result.params, "output_format">>>();
    expectAssignable<TextToSpeechSdkParams>(result.params.toSdk("elevenlabs"));
  }

  expectAssignable<EndpointConstraints[]>(textToSpeech.constraintsFor("eleven_multilingual_v2"));

  // @ts-expect-error output_format is a closed enum
  textToSpeech({ voice_id: "v1", text: "hi", output_format: "mp3_44100" });
  // @ts-expect-error apply_text_normalization is a closed enum
  textToSpeech({ voice_id: "v1", text: "hi", apply_text_normalization: "always" });

  // ExactKeys: a typo'd/excess top-level key is a COMPILE error, not a
  // silent unknown_param warning. `model` is the realistic typo — the wire
  // field is `model_id`.
  textToSpeech({
    voice_id: "v1",
    text: "hi",
    // @ts-expect-error excess (typo'd) top-level key — the ExactKeys guard
    model: "eleven_flash_v2_5",
  });

  // The same guard is wired into the safe() overload.
  textToSpeech.safe({
    voice_id: "v1",
    text: "hi",
    // @ts-expect-error excess (typo'd) top-level key — ExactKeys on safe()
    voice_setings: { speed: 1 },
  });
}

/**
 * CLOSED enum surfaces. Every field below has a finite documented value space
 * that a runtime check already hard-errors on, so the type must reject junk at
 * compile time too — an `invalid_enum_value` you could have had as a red
 * squiggle is a wasted round trip.
 */
function elevenlabsClosedEnumTypeTests(): void {
  // --- optimize_streaming_latency: the integers 0–4, nothing else ---------
  textToSpeech({ voice_id: "v1", text: "hi", optimize_streaming_latency: 0 });
  textToSpeech({ voice_id: "v1", text: "hi", optimize_streaming_latency: 4 });
  // null still selects the provider default.
  textToSpeech({ voice_id: "v1", text: "hi", optimize_streaming_latency: null });
  // @ts-expect-error there is no latency level 5 (schema: .int().min(0).max(4))
  textToSpeech({ voice_id: "v1", text: "hi", optimize_streaming_latency: 5 });
  // @ts-expect-error 99 was silently accepted while the field was `number`
  textToSpeech({ voice_id: "v1", text: "hi", optimize_streaming_latency: 99 });
  expectAssignable<ElevenlabsOptimizeStreamingLatency>(3);

  // --- TextToSpeechQuery: hand-built URLs get the same closed surface -----
  expectAssignable<TextToSpeechQuery>({ output_format: "mp3_44100_128" });
  textToSpeechUrl("v1", { output_format: "wav_48000", optimize_streaming_latency: 2 });
  // @ts-expect-error output_format on the URL helper is a closed enum, not `string`
  textToSpeechUrl("v1", { output_format: "banana" });
  // @ts-expect-error the empty string compiled while the field was `string`
  textToSpeechUrl("v1", { output_format: "" });
  // @ts-expect-error the URL helper's latency param is the 0–4 union too
  textToSpeechUrl("v1", { optimize_streaming_latency: 99 });
  expectAssignable<ElevenlabsOutputFormat | undefined>(
    ({} as TextToSpeechQuery).output_format,
  );

  // --- music output_format: MUSIC_OUTPUT_FORMATS is the whole space -------
  music({ prompt: "x", output_format: "auto" });
  music({ prompt: "x", output_format: "opus_48000_192" });
  // @ts-expect-error the (string & {}) tail is gone — junk is a compile error now
  music({ prompt: "x", output_format: "banana" });
  // @ts-expect-error the empty string compiled through the old tail
  music({ prompt: "x", output_format: "" });
  // The SDK view carries the same closed union, not `string`.
  expectAssignable<ElevenlabsMusicOutputFormat | undefined>(
    music({ prompt: "x", output_format: "mp3_44100_128" }).toSdk("elevenlabs").outputFormat,
  );
  expectAssignable<MusicSdkParams>(music({ prompt: "x" }).toSdk("elevenlabs"));
  // ...and so does the exported URL builder.
  musicUrl("pcm_48000");
  // @ts-expect-error musicUrl takes the closed union, not any string
  musicUrl("banana");

  // Model ids keep their (string & {}) escape — new models must stay usable.
  music({ prompt: "x", model_id: "music_v9_future" });
}

export { textToSpeechTypeTests, elevenlabsClosedEnumTypeTests };
