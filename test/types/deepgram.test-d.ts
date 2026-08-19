/**
 * Type-level tests for the deepgram provider (SPEECH-TO-TEXT modality).
 * NOT run by `bun test` — this file is only type-checked (`bun run check` /
 * tsc --noEmit). These tests pin the `ExactKeys` public-cast contract of
 * `deepgram.listen`: the excess-key compile error, the `safe<T>` overload
 * carrying the same guard, and the most aggressive strip in the repo — the
 * cast is `Validated<Pick<T, "url" & keyof T>, ListenSdkTargets<Omit<T, "url">>>`,
 * so the wire body is ONLY `{url}` (or `{}`) while every transcription option
 * moves into the `.request.url` query string and into the
 * `.toSdk("deepgram")` options object. It also pins the parameterized
 * `toSdk`: the zero-arg form is gone, and an unknown target id is a compile
 * error rather than a runtime throw.
 */
import {
  listen,
  speech,
  listenLive,
  listenFlux,
  fluxConfigure,
  speakLive,
} from "../../src/providers/deepgram";
import type {
  DeepgramSpeakContainer,
  DeepgramSpeakSampleRate,
} from "../../src/providers/deepgram";
import type { EndpointConstraints } from "../../src/core/constraint-types";
import { expectAssignable, expectTrue, type IsNever, type KeyIn } from "./helpers";

function listenTypeTests(): void {
  const v = listen({
    url: "https://example.com/audio.wav",
    model: "nova-3",
    language: "multi",
    smart_format: true,
    punctuate: true,
    diarize_model: "v2",
    keyterm: ["unmodel", "deepgram"],
    redact: ["pci"],
    utt_split: 0.8,
    callback_method: "POST",
  });

  // KEPT on the wire body: `url` and nothing else.
  expectAssignable<string>(v.url);
  expectAssignable<{ url: string }>(v);

  // STRIPPED: every query param is absent from the body type. These are the
  // assertions that go red if the Pick<> drops out of the public cast.
  expectTrue<IsNever<KeyIn<typeof v, "model">>>();
  expectTrue<IsNever<KeyIn<typeof v, "smart_format">>>();
  expectTrue<IsNever<KeyIn<typeof v, "keyterm">>>();
  // @ts-expect-error model is a query param — stripped from the wire body
  v.model;
  // @ts-expect-error smart_format is a query param — stripped from the wire body
  v.smart_format;

  // `.request` and `.toSdk("deepgram")` stay typed. toSdk is the mirror image
  // of the body: it carries the options and drops `url`.
  expectAssignable<string>(v.request.url);
  expectAssignable<"POST">(v.request.method);
  expectAssignable<Record<string, string>>(v.request.headers);
  expectAssignable<"nova-3">(v.toSdk("deepgram").model);
  expectAssignable<boolean>(v.toSdk("deepgram").smart_format);
  expectTrue<IsNever<KeyIn<ReturnType<typeof v.toSdk<"deepgram">>, "url">>>();

  // Local-file case: no `url` param, so `Pick<T, "url" & keyof T>` collapses
  // to an empty body and you POST raw audio bytes to `.request.url` yourself.
  const local = listen({ model: "nova-3", language: "en", multichannel: true });
  expectTrue<IsNever<KeyIn<typeof local, "url">>>();
  expectAssignable<string>(local.request.url);
  expectAssignable<"nova-3">(local.toSdk("deepgram").model);

  // Unknown model ids stay assignable through the (string & {}) escape.
  listen({ url: "https://example.com/a.wav", model: "nova-9-future" });

  // safe() narrows to the same split shape.
  const result = listen.safe({ url: "https://example.com/a.wav", model: "nova-3" });
  if (result.ok) {
    expectAssignable<string>(result.params.url);
    expectTrue<IsNever<KeyIn<typeof result.params, "model">>>();
    expectAssignable<"nova-3">(result.params.toSdk("deepgram").model);
  }

  // The SDK target vocabulary is closed: only "deepgram" is declared here.
  // @ts-expect-error "openai" is not an SDK target for deepgram.listen
  v.toSdk("openai");
  // @ts-expect-error the zero-arg .toSdk() form was removed
  v.toSdk();

  expectAssignable<EndpointConstraints[]>(listen.constraintsFor("nova-3"));

  // @ts-expect-error diarize_model is a closed enum
  listen({ url: "https://example.com/a.wav", diarize_model: "v3" });
  // @ts-expect-error callback_method is a closed enum
  listen({ url: "https://example.com/a.wav", callback_method: "GET" });

  // ExactKeys: a typo'd/excess top-level key is a COMPILE error, not a
  // silent unknown_param warning — which matters more here than anywhere,
  // because an unrecognised key would otherwise be URL-encoded into the
  // query string and silently ignored by Deepgram.
  listen({
    url: "https://example.com/a.wav",
    // @ts-expect-error excess (typo'd) top-level key — the ExactKeys guard
    smart_fomat: true,
  });

  // The same guard is wired into the safe() overload.
  listen.safe({
    url: "https://example.com/a.wav",
    // @ts-expect-error excess (typo'd) top-level key — ExactKeys on safe()
    punctuation: true,
  });
}

/**
 * The audio-format surface of `deepgram.speech`, which is driven end to end by
 * the documented "Audio Format Combinations" table (AUDIO_FORMATS). Every
 * field the table closes is closed in the type as well, so a combination the
 * API rejects with `invalid_enum_value` is a red squiggle first.
 */
function speechAudioFormatTypeTests(): void {
  // --- encoding: SPEAK_ENCODINGS is the whole space (and AUDIO_FORMATS' key)
  speech({ text: "hi", encoding: "linear16" });
  speech({ text: "hi", encoding: "opus" });
  // @ts-expect-error the (string & {}) tail is gone — vorbis is not an encoding
  speech({ text: "hi", encoding: "vorbis" });
  // @ts-expect-error the empty string compiled through the old tail
  speech({ text: "hi", encoding: "" });

  // --- container: the union of every `containers` entry in AUDIO_FORMATS ---
  speech({ text: "hi", encoding: "linear16", container: "wav" });
  speech({ text: "hi", encoding: "opus", container: "ogg" });
  // @ts-expect-error "mp4" is not one of wav / ogg / none
  speech({ text: "hi", encoding: "linear16", container: "mp4" });
  // @ts-expect-error the empty string compiled through the old tail
  speech({ text: "hi", encoding: "linear16", container: "" });
  expectAssignable<DeepgramSpeakContainer>("none");

  // --- sample_rate: the union of every `sampleRates` entry in AUDIO_FORMATS
  speech({ text: "hi", encoding: "linear16", sample_rate: 24000 });
  speech({ text: "hi", encoding: "flac", sample_rate: 22050 });
  // @ts-expect-error 99 was silently accepted while the field was `number`
  speech({ text: "hi", encoding: "linear16", sample_rate: 99 });
  // @ts-expect-error 44100 appears in no AUDIO_FORMATS row, for any encoding
  speech({ text: "hi", encoding: "linear16", sample_rate: 44100 });
  expectAssignable<DeepgramSpeakSampleRate>(48000);

  // --- bit_rate: DELIBERATELY still `number` --------------------------------
  // No @ts-expect-error case exists here: the documented space is mixed, so no
  // union describes it. mp3 publishes a discrete list ([32000, 48000]) but
  // opus (4000–650000) and aac (4000–192000) publish continuous ranges, and
  // narrowing to the mp3 list would reject the legal opus values below.
  speech({ text: "hi", encoding: "opus", bit_rate: 128000 });
  speech({ text: "hi", encoding: "aac", bit_rate: 96000 });

  // Voice/model ids keep their (string & {}) escape.
  speech({ text: "hi", model: "aura-9-future-en" });
}

/**
 * `redact` KEEPS its `(string & {})` tail, unlike every other narrowing in
 * this pass — so there is deliberately NO @ts-expect-error case below. The
 * five named groups are autocomplete, not an exhaustive space: Deepgram also
 * accepts arbitrary entity types (`redact=email_address`) for which no closed
 * list is published, and `redact` accordingly has no entry in listen.ts's
 * QUERY_ENUMS. Rejecting an unlisted string here would be a compile error on
 * a request the API fulfils.
 */
function listenRedactTypeTests(): void {
  // A named group — this is what autocomplete now offers.
  listen({ url: "https://example.com/a.wav", redact: "pci" });
  listen({ url: "https://example.com/a.wav", redact: ["pii", "phi"] });
  // An arbitrary entity type — legal on the wire, so it must still compile.
  listen({ url: "https://example.com/a.wav", redact: "email_address" });
  listen({ url: "https://example.com/a.wav", redact: ["ssn", "aggressive_numbers"] });
  // The boolean arm ("redact everything") is untouched.
  listen({ url: "https://example.com/a.wav", redact: true });
}

/**
 * The three WebSocket CONFIG surfaces. Two contracts are pinned here that no
 * REST endpoint can pin: `.request.method` is `"GET"` (a socket handshake is
 * an upgrade, so `ValidatedSocket` carries `SocketMeta`, not `RequestMeta`),
 * and — unlike `listen`, which strips every query param out of its body — the
 * whole config STAYS on the body, because for a socket the config object is
 * the deliverable and the URL is just where it is encoded.
 */
function realtimeSocketTypeTests(): void {
  const live = listenLive({
    model: "nova-3",
    encoding: "linear32",
    sample_rate: 16000,
    interim_results: true,
    utterance_end_ms: 1000,
    endpointing: false,
  });

  expectAssignable<"GET">(live.request.method);
  expectAssignable<string>(live.request.url);
  // The config is the body — nothing is stripped into the query string.
  expectAssignable<"nova-3">(live.model);
  expectAssignable<boolean>(live.interim_results);
  expectAssignable<"nova-3">(live.toSdk("deepgram").model);
  // @ts-expect-error "openai" is not an SDK target for deepgram.listenLive
  live.toSdk("openai");
  // @ts-expect-error linear32/alaw/ogg-opus are live-only, mp3 is neither
  listenLive({ encoding: "mp3" });
  // @ts-expect-error diarize_model v2 is documented for pre-recorded only
  listenLive({ diarize_model: "v2" });
  // "DELETE" is a live-only callback method (the REST route takes POST/PUT).
  listenLive({ callback: "https://cb.example", callback_method: "DELETE" });
  listenLive({
    model: "nova-3",
    // @ts-expect-error excess (typo'd) top-level key — the ExactKeys guard
    interim_reslts: true,
  });
  // Pre-recorded-only intelligence params are absent from the live shape.
  // @ts-expect-error `summarize` is not a live streaming param
  listenLive({ model: "nova-3", summarize: true });

  const flux = listenFlux({ model: "flux-general-multi", language_hint: ["en", "es"] });
  expectAssignable<"GET">(flux.request.method);
  expectAssignable<"flux-general-multi">(flux.model);
  // @ts-expect-error `model` is required on /v2/listen
  listenFlux({ eot_threshold: 0.7 });
  // @ts-expect-error flac is a /v1 encoding; Flux does not document it
  listenFlux({ model: "flux-general-en", encoding: "flac" });
  // @ts-expect-error redact on Flux is the closed numbers/aggressive_numbers pair
  listenFlux({ model: "flux-general-en", redact: "pci" });
  // Unknown (new) flux ids stay assignable through the (string & {}) escape.
  listenFlux({ model: "flux-general-de" });

  const configure = fluxConfigure({
    type: "Configure",
    thresholds: { eot_threshold: 0.8, eager_eot_threshold: 0.4 },
    keyterms: ["unmodel"],
  });
  expectAssignable<"Configure">(configure.type);
  // @ts-expect-error the message type is the literal "Configure"
  fluxConfigure({ type: "configure" });
  // @ts-expect-error the connection takes `keyterm`; the message takes `keyterms`
  fluxConfigure({ type: "Configure", keyterm: ["unmodel"] });

  const tts = speakLive({ model: "aura-2-thalia-en", encoding: "mulaw", sample_rate: 8000 });
  expectAssignable<"GET">(tts.request.method);
  expectAssignable<"aura-2-thalia-en">(tts.toSdk("deepgram").model);
  // @ts-expect-error mp3/opus/flac/aac are REST-only codecs
  speakLive({ encoding: "mp3" });
  // @ts-expect-error 22050 appears in no streaming sample-rate row
  speakLive({ sample_rate: 22050 });
  // @ts-expect-error `text` is sent as a Speak message, never as config
  speakLive({ text: "hello" });
}

export {
  listenTypeTests,
  speechAudioFormatTypeTests,
  listenRedactTypeTests,
  realtimeSocketTypeTests,
};
