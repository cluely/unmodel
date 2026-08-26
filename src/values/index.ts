/**
 * `unmodel/values` — unmodel's **canonical vocabulary**, as runtime arrays.
 *
 * The mirror of `unmodel/types`. That entry is the words at compile time and
 * emits an empty JavaScript module; this one is the same words at run time, for
 * the half of a client-side app a type cannot reach: the `<select>` a user
 * picks a ratio from, the guard that checks a codec string arrived from a form,
 * the label table a settings screen renders.
 *
 * ```ts
 * import { ASPECT_RATIO_PRESETS, AUDIO_FORMAT_CODECS } from "unmodel/values";
 *
 * const options = ASPECT_RATIO_PRESETS.map((ratio) => ({ value: ratio, label: ratio }));
 * const isCodec = (value: string): value is (typeof AUDIO_FORMAT_CODECS)[number] =>
 *   (AUDIO_FORMAT_CODECS as readonly string[]).includes(value);
 * ```
 *
 * ## What is here
 *
 * The **closed** unions, one array each — the words every provider's adapter
 * translates *into*: {@link ASPECT_RATIO_PRESETS}, {@link RESOLUTION_TIERS},
 * {@link VIDEO_RESOLUTIONS}, {@link IMAGE_OUTPUT_FORMATS},
 * {@link OUTPUT_DELIVERIES}, {@link AUDIO_FORMAT_CODECS},
 * {@link AUDIO_CONTAINERS}, {@link TIMESTAMP_GRANULARITIES},
 * {@link AUDIO_INPUT_KINDS} and {@link TTS_DELIVERY_KINDS} (the five ways a
 * speech endpoint answers; which one a provider uses is its own `TTS_DELIVERY`
 * at `unmodel/<provider>/values`) — plus {@link CANONICAL_KEY_LISTS} (the exact
 * params each category accepts, which is the list the kernel's envelope check
 * enforces) and {@link CHAT_PROVIDERS} — plus {@link CHAT_AUTH}, which names
 * the header each of those providers wants its credential in (a header name,
 * never a key), because that is the one thing a retarget changes that the
 * request object cannot carry.
 *
 * ## What is NOT here
 *
 * **Per-provider values.** Which of the nine ratios `black-forest-labs/flux-2`
 * takes, which voices `openai/gpt-4o-mini-tts` has, which durations
 * `kling/kling-v2-5-turbo-pro` allows — those are per *model*, there are ~600
 * of them, and they live at `unmodel/<provider>/values`, one entry each:
 *
 * ```ts
 * import { TTS_MODEL_PARAMS, TTS_MODELS } from "unmodel/openai/values";
 *
 * const voices = TTS_MODEL_PARAMS["gpt-4o-mini-tts"].voices;
 * ```
 *
 * Those tables are the **same objects** the adapters compile with, so a picker
 * and the request it builds cannot disagree.
 *
 * **The 1,330 chat refs.** `CHAT_MODEL_REFS` — the runtime twin of
 * `ChatModelRef` — is 45 KiB of strings and sits on its own subpath,
 * `unmodel/values/chat-refs`, so that the arrays above stay a rounding error.
 * See that module for the measurement.
 */

// ---------------------------------------------------------------------------
// The canonical unions, as arrays
//
// Declared in `src/core/unified/values.ts`, which imports nothing at run time —
// that is what makes one array cost one array. The unions themselves stay in
// `vocabulary/`, which is types-only by law; the two are proved equal, in both
// directions, in `test/types/values-hub.test-d.ts`.
// ---------------------------------------------------------------------------

export {
  ASPECT_RATIO_PRESETS,
  AUDIO_CONTAINERS,
  AUDIO_FORMAT_CODECS,
  AUDIO_INPUT_KINDS,
  IMAGE_OUTPUT_FORMATS,
  OUTPUT_DELIVERIES,
  RESOLUTION_TIERS,
  TIMESTAMP_GRANULARITIES,
  TTS_DELIVERY_KINDS,
  VIDEO_RESOLUTIONS,
  VOICE_SAMPLE_KINDS,
  VOICE_VISIBILITIES,
} from "../core/unified/values";

/**
 * The exact top-level params each of the eight categories accepts, keyed by
 * category.
 *
 * This is not documentation of the vocabulary — it *is* the vocabulary: the
 * kernel builds its envelope check from this very object, so a key that is not
 * in the list here is a key `image()`, `tts()` and their six siblings reject
 * with `unsupported_param` before compile. Reading it client-side is how a form
 * knows which fields to render, and `test/types/canonical-keys.test-d.ts` pins
 * it against the `*Params` types in both directions.
 *
 * The one thing it cannot say is which *extras* a model takes — those are
 * per-model and per-provider, and they are the `extras` key of that provider's
 * `<CATEGORY>_MODEL_PARAMS` row at `unmodel/<provider>/values`.
 */
export { CANONICAL_KEY_LISTS } from "../core/unified/values";

/**
 * The 32 provider ids `chat()` accepts.
 *
 * Re-exported from `unmodel/chat`'s own ref module rather than from
 * `unmodel/chat`, which is the ready 32-provider pack and ~1.7 MB: the array
 * is 32 strings and reaching it through the pack would be the most expensive
 * import in the library. The two are the same array — `src/chat/refs.ts` is
 * where it is declared, and `unmodel/chat` re-exports it from there too.
 */
export { CHAT_PROVIDERS } from "../chat/refs";

/**
 * Provider id → `{ header, scheme? }`: where that provider's API key goes.
 *
 * ```ts
 * const { header, scheme } = CHAT_AUTH[provider];
 * headers[header] = scheme === undefined ? key : `${scheme} ${key}`;
 * ```
 *
 * Header **names** only. unmodel never sees a credential, and this table is the
 * same class of data as the `env` array on a provider's catalog entry, which
 * already names the variable the key is read from.
 *
 * The rows mirror the auth column of the endpoint table the retarget layer
 * resolves against — restated rather than imported so this entry stays a
 * rounding error, and pinned row by row against that table in
 * `test/chat/providers.test.ts`, so the header a picker renders and the header
 * the compiled `.request.url` expects cannot disagree.
 */
export { CHAT_AUTH } from "../chat/refs";
