/**
 * IR → the wire body the model ref's provider actually speaks.
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
 * ## The two things that are genuinely this module's job
 *
 * 1. **Choosing the decoder.** By dialect, not by provider — that is what keeps
 *    31 OpenAI-compatible providers costing one codec.
 * 2. **The Gemini streaming URL.** The concrete provider validator supplies
 *    request metadata and SDK views. Gemini alone needs a post-validation URL
 *    adjustment because streaming is a different method rather than a body
 *    flag; {@link finalizeChat} rebuilds the provider's `Validated` through
 *    `core/request`'s `reroute` seam rather than writing into it, and derives
 *    the new URL from the one the validator built so the model stays
 *    single-authority.
 *
 * Gemini's model id rides in the URL and never on the body: `decodeGemini`
 * returns `Omit<GenerateContentBody, "model">`, exactly like
 * `google.chat`'s own result, so the "enumerable properties are the fetch body"
 * invariant holds on every dialect without a special case here.
 */
import type { ChatIR } from "../core/translate/ir";
import type { TargetEndpoint } from "../core/translate/endpoints";
import { endpointStreamUrl } from "../core/translate/endpoints";
import { TranslationUnavailableError } from "../core/translate/errors";
import { reroute } from "../core/request";
import type { TranslationWarning, Warn } from "../core/translate/warnings";
import { attachWarnings } from "../core/translate/warnings";
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
}

/**
 * Runs the target dialect's decoder. Request metadata is deliberately absent:
 * the concrete provider validator is the authority that builds it.
 *
 * Losses go to `warn`, which `validate.ts` owns: the encoder's warnings and the
 * decoder's land in one list, because from the caller's side "what did
 * compiling this request cost?" is a single question.
 */
export function compileChat(input: ChatCompileInput, warn: Warn): CompiledChat {
  const { ir, provider, modelId, endpoint } = input;
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

  return { body };
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
 * Decorates the concrete provider validator's result with the two facts and
 * warning list that belong specifically to unified compilation.
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
  validated: object,
  warnings: readonly TranslationWarning[],
): object {
  const streaming = input.stream && input.endpoint.dialect === "gemini";
  const result = attachWarnings(streaming ? streamRoute(input, validated) : validated, warnings);

  hide(result, "target", input.provider);
  hide(result, "modelId", input.modelId);
  return result;
}

/**
 * The Gemini streaming route, derived from the URL the provider validator
 * already built.
 *
 * Gemini streams via `:streamGenerateContent?alt=sse` — a different method,
 * not a body flag — so the canonical `stream` option can only be expressed in
 * the URL. It is derived by rewriting the method segment of the validator's
 * own URL rather than by re-deriving one from the model ref, because the
 * validator resolves the model itself (`providerOptions.google.model` is a
 * supported, warning-only override) and two independent derivations would let
 * a streaming request be validated against one model and sent to another.
 *
 * `endpointStreamUrl` is still consulted, but only to confirm this build ships
 * a streaming route for the endpoint at all; a shape it cannot recognise is a
 * loud failure rather than a silently non-streaming request.
 */
function streamRoute(input: ChatCompileInput, validated: object): object {
  const unavailable = (why: string): never => {
    throw new TranslationUnavailableError(
      `unmodel: "${input.provider}" has no resolvable streaming URL — ${why}.`,
    );
  };
  if (endpointStreamUrl(input.endpoint, input.modelId) === undefined) {
    unavailable("its endpoint table entry declares no streaming route");
  }
  const current = (validated as { request?: { url?: unknown } }).request?.url;
  if (typeof current !== "string") unavailable("the provider result carries no `.request.url`");
  const url = current as string;
  const method = url.lastIndexOf(":generateContent");
  if (method < 0) {
    unavailable(
      `the provider addressed ${JSON.stringify(url)}, which does not end in the \`:generateContent\` method this route rewrites`,
    );
  }
  return reroute(validated, `${url.slice(0, method)}:streamGenerateContent?alt=sse`);
}
