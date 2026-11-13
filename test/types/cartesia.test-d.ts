/**
 * Type-level tests for the cartesia provider (TTS + STT).
 * NOT run by `bun test` — this file is only type-checked (`bun run check` /
 * tsc --noEmit).
 *
 * What is pinned here is one rule, applied to five fields:
 *
 *   `| (string & {})` is legitimate exactly where an off-enum value is reported
 *   at *warning* severity, and illegitimate where it is reported at *error*
 *   severity.
 *
 * `model_id` / `model` keep their tails: a cataloged dated snapshot
 * (`sonic-3.5-2026-05-04`, `ink-whisper-2026-01-01`) is off-enum yet valid, and
 * `checkTtsModelKind` / `checkBatchModel` say so with a warning. `language` (on
 * an id whose list is documented) and `generation_config.emotion` have no
 * tails: `checkEnums` / `checkLanguage` refuse an off-enum value at
 * `invalid_enum_value`'s default *error* severity, so every value a tail
 * admitted at compile time was a value the validator would refuse at run time
 * — the editor was silent about a call unmodel itself rejects. Where the check
 * only warns — an alias whose backing model no page names, an uncataloged id,
 * the realtime STT socket's `language` — the tail is back.
 *
 * The two headline cases below are the ones a caller actually types: `"pt-BR"`
 * (BCP-47 muscle memory on a field that takes bare ISO-639-1) and `"smug"` (an
 * emotion that sounds like it should be in a 58-label list and is not).
 */
import { tts, ttsWebsocket, stt, sttWebsocket } from "../../src/providers/cartesia";
import type {
  CartesiaEmotion,
  CartesiaTtsLanguage,
  CartesiaTtsLanguageFor,
  CartesiaTtsLocale,
  CartesiaSttLanguage,
  CartesiaSttWebsocketLanguage,
} from "../../src/providers/cartesia";
import { expectAssignable } from "./helpers";

const VOICE = { mode: "id", id: "694f9389-aac1-45b6-b726-9d9369183238" } as const;
const OUTPUT = { container: "wav", encoding: "pcm_s16le", sample_rate: 44100 } as const;
const BYTES_BASE = {
  model_id: "sonic-3.5",
  transcript: "Hello from Cartesia.",
  voice: VOICE,
  output_format: OUTPUT,
} as const;

/** POST /tts/bytes — the 42-code `language` and the 58-label `emotion`. */
function ttsEnumTypeTests(): void {
  // LEGAL: members of the two published enums.
  tts({ ...BYTES_BASE, language: "pt" });
  tts({ ...BYTES_BASE, language: "pa" });
  tts({ ...BYTES_BASE, generation_config: { emotion: "determined" } });
  tts({ ...BYTES_BASE, generation_config: { emotion: "nostalgic", speed: 1.2 } });
  expectAssignable<CartesiaTtsLanguage>("en");
  expectAssignable<CartesiaEmotion>("neutral");

  // ILLEGAL: the regional subtag. This is the headline case — `tts.safe`
  // already returned `invalid_enum_value @language` for it at error severity,
  // and tsc used to say nothing at all.
  tts({
    ...BYTES_BASE,
    // @ts-expect-error "pt-BR" is BCP-47; this field is the bare 42-code enum
    language: "pt-BR",
  });
  tts({
    ...BYTES_BASE,
    // @ts-expect-error "en-US" — same mistake, the other direction
    language: "en-US",
  });
  tts({
    ...BYTES_BASE,
    // @ts-expect-error "" compiled through the old (string & {}) tail
    language: "",
  });

  // ILLEGAL: an emotion that is not one of the 58 labels.
  tts({
    ...BYTES_BASE,
    // @ts-expect-error "smug" is not in CARTESIA_EMOTIONS
    generation_config: { emotion: "smug" },
  });
  tts({
    ...BYTES_BASE,
    // @ts-expect-error "Happy" — the labels are lower-case
    generation_config: { emotion: "Happy" },
  });

  // THE DOCUMENTED BREAKING CHANGE: a `string`-typed variable no longer
  // assigns. Narrow it (or assert it) at the boundary where it enters.
  const fromConfig: string = "en";
  tts({
    ...BYTES_BASE,
    // @ts-expect-error a bare `string` is no longer assignable — narrow first
    language: fromConfig,
  });

  // UNCHANGED: `model_id` keeps its tail, because an off-enum cataloged id is a
  // warning, not an error. No @ts-expect-error case exists here by design.
  tts({ ...BYTES_BASE, model_id: "sonic-3.5-2026-05-04" });
  tts({ ...BYTES_BASE, model_id: "sonic-9-future" });
}

/**
 * `language` / `locale` are closed PER MODEL: the same field takes a different
 * list once `model_id` names a Sonic 3.6 id (`CartesiaTtsLanguageFor<M>`),
 * which is what the per-model `checkLanguageFields` enforces at run time.
 */
function ttsPerModelLanguageTypeTests(): void {
  const sonic36 = { ...BYTES_BASE, model_id: "sonic-3.6" } as const;

  // LEGAL on Sonic 3.6: Odia, Urdu, and the regional locales, in either slot.
  tts({ ...sonic36, language: "or" });
  tts({ ...sonic36, language: "ur" });
  tts({ ...sonic36, language: "pt-BR" });
  tts({ ...sonic36, locale: "en-GB" });
  tts({ ...BYTES_BASE, model_id: "sonic-3.6-2026-08-27", locale: "hi-IN" });
  expectAssignable<CartesiaTtsLocale>("en-IN");
  expectAssignable<CartesiaTtsLanguageFor<"sonic-3.6">>("ur-IN");

  // ILLEGAL on Sonic 3.6: off its list, and locale codes are case-sensitive.
  tts({
    ...sonic36,
    // @ts-expect-error "en-gb" — "Locale codes are case-sensitive."
    locale: "en-gb",
  });
  tts({
    ...sonic36,
    // @ts-expect-error "cy" is not one of Sonic 3.6's 44 languages
    language: "cy",
  });
  tts({
    ...sonic36,
    // @ts-expect-error "cy-GB" — a region on a base Sonic 3.6 does not speak
    locale: "cy-GB",
  });

  // LEGAL on Sonic 3.6: an unlisted regional code on one of its bases — the
  // table lists 56 locales, the changelog counts 61, so this is a warning.
  tts({ ...sonic36, locale: "ar-SA" });
  tts({ ...sonic36, language: "es-419" });

  // LEGAL: the aliases whose backing model no page names, and an uncataloged
  // id, take every documented value (the check only warns on them).
  tts({ ...BYTES_BASE, model_id: "sonic-preview", locale: "en-GB" });
  tts({ ...BYTES_BASE, model_id: "sonic-latest", language: "ur" });
  tts({ ...BYTES_BASE, model_id: "sonic-3.7", language: "ur" });

  // ILLEGAL on an earlier model: the 3.6 additions are not in its 42.
  tts({
    ...BYTES_BASE,
    // @ts-expect-error "or" is new in Sonic 3.6; sonic-3.5 takes the 42 codes
    language: "or",
  });
  tts({
    ...BYTES_BASE,
    // @ts-expect-error a regional locale needs Sonic 3.6 or later
    locale: "en-GB",
  });
  // @ts-expect-error "ur" is not a sonic-3.5 language
  expectAssignable<CartesiaTtsLanguageFor<"sonic-3.5">>("ur");

  // DEGRADED ARM: a `string`-typed id names no model, so every model's values
  // compile and the run-time check holds the real id to its own list.
  const runtimeId: string = "sonic-3.6";
  tts({ ...BYTES_BASE, model_id: runtimeId, language: "or" });
}

/**
 * `normalization` is one model-independent union: `auto`, `off`, every base
 * code and locale. A locale code on an earlier model is a run-time warning, so
 * it compiles; only a value off the union is refused.
 */
function ttsNormalizationTypeTests(): void {
  tts({ ...BYTES_BASE, normalization: "off" });
  tts({ ...BYTES_BASE, normalization: "auto" });
  tts({ ...BYTES_BASE, normalization: null });
  tts({ ...BYTES_BASE, normalization: "en" });
  tts({ ...BYTES_BASE, normalization: "en-IN" });
  tts({ ...BYTES_BASE, model_id: "sonic-3.6", locale: "en-GB", normalization: "en-US" });
  tts({
    ...BYTES_BASE,
    // @ts-expect-error "shouty" is not auto, off or a language/locale code
    normalization: "shouty",
  });
}

/** The socket message carries the same two enums as POST /tts/bytes. */
function ttsWebsocketEnumTypeTests(): void {
  const base = {
    model_id: "sonic-3.5",
    transcript: "Hello, world! ",
    voice: VOICE,
    output_format: { container: "raw", encoding: "pcm_s16le", sample_rate: 8000 },
    context_id: "ab977222-f9e0-4563-a1c0-5a934ae8fdd6",
  } as const;

  ttsWebsocket({ ...base, language: "ja" });
  ttsWebsocket({ ...base, generation_config: { emotion: "curious" } });

  ttsWebsocket({
    ...base,
    // @ts-expect-error same closed 42-code enum as the REST body
    language: "pt-BR",
  });
  // …and the same per-model widening on a Sonic 3.6 id and the aliases.
  ttsWebsocket({ ...base, model_id: "sonic-3.6", language: "pt-BR" });
  ttsWebsocket({ ...base, model_id: "sonic-3.6", locale: "ur-IN" });
  ttsWebsocket({ ...base, model_id: "sonic-preview", locale: "en-GB" });
  ttsWebsocket({ ...base, model_id: "sonic-3.7", language: "ur" });
  ttsWebsocket({ ...base, normalization: "off" });
  ttsWebsocket({
    ...base,
    // @ts-expect-error same normalization union as the REST body
    normalization: "shouty",
  });
  ttsWebsocket({
    ...base,
    // @ts-expect-error same closed 58-label enum as the REST body
    generation_config: { emotion: "smug" },
  });

  // The socket's model id stays open for the same reason the REST one does.
  ttsWebsocket({ ...base, model_id: "sonic-3.5-2026-05-04" });
}

/** POST /stt — the 100-code `language`, a different (larger) enum. */
function sttEnumTypeTests(): void {
  const file = new Blob([new Uint8Array([0, 1, 2, 3])], { type: "audio/wav" });

  stt({ file, model: "ink-whisper", language: "en" });
  // Whisper's long tail is in this enum and not in the TTS one.
  stt({ file, model: "ink-whisper", language: "yue" });
  stt({ file, model: "ink-whisper", language: "haw" });
  expectAssignable<CartesiaSttLanguage>("cy");

  stt({
    file,
    model: "ink-whisper",
    // @ts-expect-error the STT enum is bare ISO-639-1 too — no regional subtag
    language: "pt-BR",
  });
  stt({
    file,
    model: "ink-whisper",
    // @ts-expect-error not one of the 100 documented codes
    language: "klingon",
  });

  // `language` is closed but NOT the TTS list: these two enums are different
  // sets, and a code from one is not automatically a code from the other.
  // @ts-expect-error "haw" is an STT code; POST /tts/bytes publishes 42 codes
  expectAssignable<CartesiaTtsLanguage>("haw");

  // UNCHANGED: `model` keeps its tail — `checkBatchModel` accepts every
  // `ink-whisper-` prefixed id, which is a set no published enum spells out.
  stt({ file, model: "ink-whisper-2026-01-01" });
}

/**
 * The realtime STT socket's `language` is open: the 2026-03-01 enum is `en`
 * alone, but every other source says the socket takes more, so an off-list
 * code is a run-time warning — and, by the open-tail rule, compiles.
 */
function sttWebsocketLanguageTypeTests(): void {
  sttWebsocket({ model: "ink-whisper", encoding: "pcm_s16le", sample_rate: 16000, language: "en" });
  expectAssignable<CartesiaSttWebsocketLanguage>("en");
  expectAssignable<CartesiaSttWebsocketLanguage>("yue");
  sttWebsocket({ model: "ink-whisper", encoding: "pcm_s16le", sample_rate: 16000, language: "es" });
  sttWebsocket({ model: "ink-2", encoding: "pcm_s16le", sample_rate: 16000, language: "fr" });
  // Open model id, open language.
  sttWebsocket({ model: "ink-whisper-2026-01-01", encoding: "pcm_s16le", sample_rate: 16000 });
}

export {
  ttsEnumTypeTests,
  ttsPerModelLanguageTypeTests,
  ttsNormalizationTypeTests,
  ttsWebsocketEnumTypeTests,
  sttEnumTypeTests,
  sttWebsocketLanguageTypeTests,
};
