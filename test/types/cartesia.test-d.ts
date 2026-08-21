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
 * `checkTtsModelKind` / `checkBatchModel` say so with a warning. `language` and
 * `generation_config.emotion` have no tails: `checkEnums` / `checkLanguage`
 * refuse an off-enum value at `invalid_enum_value`'s default *error* severity,
 * so every value a tail admitted at compile time was a value the validator
 * would refuse at run time — the editor was silent about a call unmodel itself
 * rejects.
 *
 * The two headline cases below are the ones a caller actually types: `"pt-BR"`
 * (BCP-47 muscle memory on a field that takes bare ISO-639-1) and `"smug"` (an
 * emotion that sounds like it should be in a 58-label list and is not).
 */
import { tts, ttsWebsocket, stt, sttWebsocket } from "../../src/providers/cartesia";
import type {
  CartesiaEmotion,
  CartesiaTtsLanguage,
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
 * The precedent this whole item was made consistent with: the realtime STT
 * socket already shipped a closed `language` beside an open `model`.
 */
function sttWebsocketConsistencyTypeTests(): void {
  sttWebsocket({ model: "ink-whisper", encoding: "pcm_s16le", sample_rate: 16000, language: "en" });
  expectAssignable<CartesiaSttWebsocketLanguage>("en");
  sttWebsocket({
    model: "ink-2",
    encoding: "pcm_s16le",
    sample_rate: 16000,
    // @ts-expect-error "en" is the only published value on this socket
    language: "es",
  });
  // Open model id, closed language — the shape every cartesia surface now has.
  sttWebsocket({ model: "ink-whisper-2026-01-01", encoding: "pcm_s16le", sample_rate: 16000 });
}

export {
  ttsEnumTypeTests,
  ttsWebsocketEnumTypeTests,
  sttEnumTypeTests,
  sttWebsocketConsistencyTypeTests,
};
