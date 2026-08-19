/**
 * IR → the wire body the model ref's provider actually speaks, plus the fetch
 * metadata to send it with.
 *
 * This is the step that makes `unmodel/chat` a *spoke* rather than a fourth
 * emitter. `encode.ts` turned `ChatParams` into a `ChatIR`; everything below is
 * a dispatch to one of the three dialect decoders the translation layer already
 * ships, tested by the twelve directed pairs of the golden suite. No wire shape
 * is constructed here — if it were, the unified vocabulary would have its own
 * private idea of what an Anthropic request looks like, and the interesting
 * failure mode (the compiled body disagreeing with the one a hand-written
 * `unmodel/anthropic` call produces) would be untestable.
 *
 * ## The three things that are genuinely this module's job
 *
 * 1. **Choosing the decoder.** By dialect, not by provider — that is what keeps
 *    31 OpenAI-compatible providers costing one codec.
 * 2. **The URL, including the streaming one.** Gemini streams from a different
 *    *method* (`:streamGenerateContent?alt=sse`), so `stream: true` there is a
 *    URL decision, not a body flag; the encoder already withheld the flag from
 *    the IR for that target, and this is where the other half happens. The
 *    other two dialects stream in-body and post to the same place.
 * 3. **The SDK views.** Identity for the two dialects whose SDK params *are*
 *    the wire body, `geminiSdkParams` for the one that is not, and `"ai-sdk"`
 *    for all three — fed the IR that is already built rather than re-encoding a
 *    body back into one, which would be a lossy round-trip taken for no reason.
 *
 * Gemini's model id rides in the URL and never on the body: `decodeGemini`
 * returns `Omit<GenerateContentBody, "model">`, exactly like
 * `google.chat`'s own result, so the "enumerable properties are the fetch body"
 * invariant holds on every dialect without a special case here.
 */
import type { RequestMeta, SdkFormatters } from "../core/request";
import { toValidated } from "../core/request";
import type { ChatIR } from "../core/translate/ir";
import type { TargetEndpoint } from "../core/translate/endpoints";
import { endpointStreamUrl, endpointUrl } from "../core/translate/endpoints";
import { TranslationUnavailableError } from "../core/translate/errors";
import { geminiSdkParams } from "../core/translate/sdk-shapes";
import { toAiSdkChat } from "../core/translate/ai-sdk";
import type { TranslationWarning, Warn } from "../core/translate/warnings";
import { attachWarnings, createWarningSink } from "../core/translate/warnings";
// The three dialect decoders, imported as leaves. Import-graph amendment A1
// pins this set: a fourth codec here is a deliberate, reviewable edit.
import { decodeAnthropic } from "../providers/anthropic/interop";
import { decodeGemini } from "../providers/google/interop";
import { decodeOpenAIChat } from "../providers/openai-compatible/interop";

/** The `from` half of every warning route this entry produces. */
export const CHAT_ROUTE = "unmodel/chat";

export interface ChatCompileInput {
  /** The already-built IR. Encoding happens once, in `validate.ts`. */
  readonly ir: ChatIR;
  /** models.dev provider id — the half of the ref before the first slash. */
  readonly provider: string;
  /** The **bare** model id — everything after the first slash. */
  readonly modelId: string;
  readonly endpoint: TargetEndpoint;
  /** Whether the caller asked to stream; only Gemini reads it here. */
  readonly stream: boolean;
}

export interface CompiledChat {
  /** The dialect wire body. Enumerable properties only — this is the fetch body. */
  readonly body: object;
  readonly request: RequestMeta;
}

/**
 * Runs the target dialect's decoder and builds the request metadata.
 *
 * Losses go to `warn`, which `validate.ts` owns: the encoder's warnings and the
 * decoder's land in one list, because from the caller's side "what did
 * compiling this request cost?" is a single question.
 */
export function compileChat(input: ChatCompileInput, warn: Warn): CompiledChat {
  const { ir, provider, modelId, endpoint, stream } = input;
  const ctx = { targetModelId: modelId, provider, endpoint: endpoint.id };

  let body: object;
  switch (endpoint.dialect) {
    case "anthropic-messages":
      body = decodeAnthropic(ir, warn, ctx);
      break;
    case "gemini":
      body = decodeGemini(ir, warn, ctx);
      break;
    case "openai-chat":
      body = decodeOpenAIChat(ir, warn, ctx);
      break;
    default:
      // Unreachable: `classifyRef` refuses every provider whose dialect has no
      // codec before compilation is ever reached. Named rather than silent, so
      // that adding a dialect to `ENDPOINTS` without a decoder fails loudly.
      throw new TranslationUnavailableError(
        `unmodel: "${provider}" speaks the ${endpoint.dialect} dialect and this build ships no codec for it. Use \`unmodel/${provider}\`'s own \`chat()\`.`,
      );
  }

  // `endpointStreamUrl` falls back to `endpointUrl` for the dialects that
  // stream in-body, so there is exactly one branch and it is on the caller's
  // intent rather than on the dialect.
  const url = stream ? endpointStreamUrl(endpoint, modelId) : endpointUrl(endpoint, modelId);
  if (url === undefined) {
    // Belt and braces: factory-configured providers are rejected at ref
    // classification, so this only fires if the endpoint table and the ref
    // classifier fall out of sync — better a named error than `undefined` in a
    // fetch call.
    throw new TranslationUnavailableError(
      `unmodel: "${provider}" has no resolvable URL in the endpoint table${endpoint.config !== undefined ? ` — it needs ${endpoint.config.join(" + ")}` : ""}.`,
    );
  }

  return { body, request: { url, method: "POST", headers: { ...endpoint.headers } } };
}

/**
 * The SDK targets a compiled result offers.
 *
 * `openai` / `anthropic` are identity formatters because those SDKs' param
 * objects *are* the wire body; `google` needs the real `{ model, contents,
 * config }` shaping, from the same `geminiSdkParams` that `google.chat`'s own
 * `toSdk("google")` uses, so the two cannot drift.
 *
 * `"ai-sdk"` is on every dialect, and it is the one place the already-built IR
 * pays off twice: the AI SDK view is just a fourth decoder over the same IR, so
 * it costs a function call rather than an encode/decode round trip through a
 * wire body.
 */
function sdkFormattersFor(input: ChatCompileInput, body: object): SdkFormatters {
  const { ir, provider, modelId, endpoint } = input;
  const aiSdk = (): unknown => {
    const sink = createWarningSink(CHAT_ROUTE, "ai-sdk");
    const options = toAiSdkChat(ir, { provider, endpoint: endpoint.id }, sink.warn);
    return attachWarnings(options, sink.warnings);
  };
  switch (endpoint.dialect) {
    case "anthropic-messages":
      return { anthropic: () => body, "ai-sdk": aiSdk };
    case "gemini":
      return { google: () => geminiSdkParams(modelId, body), "ai-sdk": aiSdk };
    default:
      return { openai: () => body, "ai-sdk": aiSdk };
  }
}

/** Defines a non-enumerable, non-writable member on a compiled result. */
function hide(target: object, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: false,
    writable: false,
    configurable: false,
  });
}

/**
 * Assembles the returned object: the wire body, plus everything that is *not*
 * the wire body hung off it non-enumerably.
 *
 * `target` and `modelId` are the two facts a caller cannot recover from the
 * body alone. `target` is the provider the request compiled for; `modelId` is
 * the **bare** id — which matters most on Gemini, where the body carries no
 * model at all, and is what makes the documented composition idiom
 * (`google.chat({ model: result.modelId, ...result })`) work. Both are exempt
 * from `ExactKeys` for exactly that reason (see `ValidatedMember`).
 */
export function finalizeChat(
  input: ChatCompileInput,
  compiled: CompiledChat,
  warnings: readonly TranslationWarning[],
): object {
  const validated = toValidated(compiled.body, compiled.request, {
    sdk: sdkFormattersFor(input, compiled.body),
  });
  const result = attachWarnings(validated as object, warnings);
  hide(result, "target", input.provider);
  hide(result, "modelId", input.modelId);
  return result;
}
