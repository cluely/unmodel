/**
 * The unified vocabulary's **encoder**: `ChatParams` → `ChatIR`.
 *
 * `unmodel/chat` is a fifth spoke on the hub-and-spoke translator — it just
 * happens to be the one nobody has to receive a response in. So it needs an
 * encoder and no decoder, and once the IR exists the three dialect decoders
 * turn it into an Anthropic, OpenAI-compatible or Gemini body with no code
 * written here at all. That is the entire architectural argument for compiling
 * *through* the IR instead of writing three emitters: the twelve directed
 * pairs the golden suite already pins are exactly the guarantee that the
 * compiled body is the one a hand-written request would have produced.
 *
 * ## Why the target dialect is an argument
 *
 * Encoding is otherwise target-blind, and the temptation is to make this a
 * pure `ChatParams → ChatIR` function. One thing genuinely resists:
 * **reasoning**. The three dialects disagree about both the *shape* (a token
 * budget vs an effort bucket) and the *vocabulary* (`minimal` exists on OpenAI
 * and Gemini but not Anthropic; `xhigh`/`max` exist on Anthropic and nowhere
 * else). Normalizing later — in each decoder — would mean three copies of the
 * same clamping table and warnings whose `path` points at wire spellings the
 * caller never wrote. Doing it here means one table and warning paths in the
 * vocabulary the caller actually typed (`["reasoning", "effort"]`).
 *
 * The other two target-conditional bits fall out of the same argument:
 * `providerOptions` has to know which bucket is the live one, and Gemini's
 * `stream` is a *method* (`:streamGenerateContent`), not a body flag, so the
 * flag is deliberately withheld from the IR on that path rather than emitted
 * and then warned about by a decoder that cannot honour it.
 *
 * ## `ChatIR.source` is the **target** dialect
 *
 * This looks wrong and is load-bearing. `source` is documented as "the dialect
 * this IR was encoded from", and this IR was encoded from no dialect at all.
 * Two things decide it:
 *
 * 1. **`passthrough` is keyed by dialect, and `warnForeignExtras` warns
 *    `dropped_param` for every bucket that is not the decoder's own.** The
 *    unified vocabulary's `providerOptions` are *addressed* — a bucket keyed
 *    `openai` is only ever meant for OpenAI. Writing the live bucket under the
 *    target's key makes the target decoder re-emit it verbatim; not writing
 *    the inert buckets at all is what keeps them silent instead of producing a
 *    `dropped_param` warning for a param the caller never asked this target
 *    for. Neither of those needs `source` — `warnForeignExtras` reads
 *    `passthrough`'s keys, not `source`.
 * 2. **`ai-sdk.ts` — the fifth decoder — *does* read `ir.source`** (it lifts
 *    the source dialect's bucket into `providerOptions` and warns about the
 *    rest). Setting `source` to the target dialect is exactly right there
 *    too: the one live bucket is the target's, and it is the one that should
 *    survive.
 *
 * Verified by reading all four decoders: `anthropic/interop.ts`,
 * `google/interop.ts` and `openai-compatible/interop.ts` never mention
 * `ir.source`; `core/translate/ai-sdk.ts` mentions it once, at the line above.
 *
 * ## Encoding never fails
 *
 * There is no error path here. A request this module cannot express perfectly
 * still produces an IR, plus a `TranslationWarning` naming what it cost —
 * the same contract `.toApi()` holds. Shape validation (a base64 attachment
 * with no `mediaType`, an empty `messages`) belongs to the schema layer in
 * front of this, where it can be reported as an `Issue` with a path.
 *
 * Import-graph: this module sees `src/core/translate/**` and its own
 * directory. It never imports a provider — decoding is the caller's step.
 */
import type {
  ChatIR,
  DialectId,
  IRCacheBreakpoint,
  IRData,
  IRNativeTool,
  IRPart,
  IRReasoning,
  IRTextBlock,
  IRTool,
  IRToolChoice,
  IRToolOutput,
} from "../core/translate/ir";
import { emptyIR, parseDataUrl, putPassthrough } from "../core/translate/ir";
import type { Warn } from "../core/translate/warnings";
import type {
  ChatCache,
  ChatFilePart,
  ChatNativeTool,
  ChatParams,
  ChatReasoning,
  ChatReasoningEffort,
  ChatToolResultPart,
} from "./types";
import { classifyRef, dialectOf, parseModelRef } from "./refs";

// ---------------------------------------------------------------------------
// Small mappings
// ---------------------------------------------------------------------------

/**
 * `true` → the provider-default ephemeral breakpoint (5 minutes everywhere
 * that has one). `false` is spelled out as "no breakpoint" rather than
 * rejected, so `cache: someFlag` works without a conditional spread.
 */
function cacheOf(cache: ChatCache | undefined): { cache?: IRCacheBreakpoint } {
  if (cache === undefined || cache === false) return {};
  if (cache === true) return { cache: { kind: "ephemeral" } };
  return { cache: { kind: "ephemeral", ...(cache.ttl !== undefined && { ttl: cache.ttl }) } };
}

/** `gs://`, `https://`, … — anything with a scheme is a locator, not bytes. */
const URL_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

/**
 * The three readings of `ChatFilePart.data`, resolved. A declared `mediaType`
 * always wins over one recovered from a `data:` URL: the caller is closer to
 * the bytes than the URL header is.
 *
 * Note what this deliberately does **not** do: infer a media type from a
 * remote URL's extension. Every decoder that needs one already infers it
 * (`inferMediaTypeFromUrl`), so inferring here would add nothing to the
 * emitted body while making this encoder's IR differ from what the dialect
 * encoders produce for the same request — and IR convergence against those is
 * the property this layer is judged by (`test/chat/golden.test.ts`).
 */
function resolveData(
  raw: string,
  declared: string | undefined,
): { data: IRData; mediaType?: string } {
  if (raw.startsWith("data:")) {
    const parsed = parseDataUrl(raw);
    if (parsed !== undefined) {
      return { data: { kind: "base64", base64: parsed.base64 }, mediaType: declared ?? parsed.mediaType };
    }
    return { data: { kind: "url", url: raw }, ...(declared !== undefined && { mediaType: declared }) };
  }
  if (URL_SCHEME.test(raw)) {
    return { data: { kind: "url", url: raw }, ...(declared !== undefined && { mediaType: declared }) };
  }
  // Bare bytes. `mediaType` is required with this form — no dialect accepts
  // base64 without a declared type — but that is the schema layer's error to
  // raise, not this one's: encoding never fails.
  return { data: { kind: "base64", base64: raw }, ...(declared !== undefined && { mediaType: declared }) };
}

function encodeFilePart(
  part: ChatFilePart,
  path: Array<string | number>,
  warn: Warn,
): IRPart | undefined {
  const cache = cacheOf(part.cache);
  const filename = part.filename !== undefined ? { filename: part.filename } : {};

  if (typeof part.data !== "string") {
    const dialect = dialectOf(part.data.provider);
    if (dialect === undefined) {
      // A file handle only means anything paired with the dialect that minted
      // it — that pairing is what lets a foreign decoder drop it loudly
      // instead of emitting a dead reference. With an unrecognised provider
      // there is no honest pairing to record, so the part goes now, by name.
      warn({
        code: "dropped_content",
        path,
        message: `the file handle "${part.data.fileId}" names provider "${part.data.provider}", which unmodel has no endpoint for; file-id namespaces are per-provider, so it could not be attributed to a wire format and was dropped.`,
        meta: { ref: part.data.fileId, provider: part.data.provider },
      });
      return undefined;
    }
    return {
      type: "media",
      ...(part.mediaType !== undefined && { mediaType: part.mediaType }),
      data: { kind: "file", dialect, ref: part.data.fileId },
      ...filename,
      ...cache,
    };
  }

  const { data, mediaType } = resolveData(part.data, part.mediaType);
  return {
    type: "media",
    ...(mediaType !== undefined && { mediaType }),
    data,
    ...filename,
    ...cache,
  };
}

/**
 * The tool-result union maps 1:1 onto `IRToolOutput`, with one join:
 * `error-text` is the `text` arm plus `isError`, because the IR (like
 * Anthropic and the AI SDK) carries failure as a flag on the result rather
 * than a distinct output kind.
 */
function encodeToolResult(part: ChatToolResultPart): IRPart {
  const output = part.output;
  let irOutput: IRToolOutput;
  let isError = false;
  switch (output.type) {
    case "text":
      irOutput = { kind: "text", text: output.value };
      break;
    case "error-text":
      irOutput = { kind: "text", text: output.value };
      isError = true;
      break;
    case "json":
      irOutput = { kind: "json", value: output.value };
      break;
    case "content":
      irOutput = {
        kind: "content",
        parts: output.value.map((inner): IRPart => {
          if (inner.type === "text") return { type: "text", text: inner.text };
          const { data, mediaType } = resolveData(inner.data, inner.mediaType);
          return { type: "media", ...(mediaType !== undefined && { mediaType }), data };
        }),
      };
      break;
  }
  return {
    type: "tool-result",
    id: part.toolCallId,
    ...(part.toolName !== undefined && { name: part.toolName }),
    output: irOutput,
    ...(isError && { isError: true }),
  };
}

/**
 * A provider-defined tool's name, best effort, in the order the dialects
 * actually spell it: Anthropic puts it on `name`, Gemini *is* the key
 * (`{ googleSearch: {} }`), OpenAI nests it under `custom`. The name is only
 * ever used in a `dropped_tool` warning, so "best effort" is the right bar —
 * but a warning that says `"googleSearch"` is worth a great deal more than
 * one that says "a provider-defined tool".
 */
function nativeToolName(definition: unknown): string {
  if (typeof definition !== "object" || definition === null) return "native";
  const record = definition as Record<string, unknown>;
  if (typeof record["name"] === "string") return record["name"];
  const keys = Object.keys(record);
  if (keys.length === 1 && keys[0] !== undefined) return keys[0];
  const custom = record["custom"];
  if (typeof custom === "object" && custom !== null) {
    const name = (custom as Record<string, unknown>)["name"];
    if (typeof name === "string") return name;
  }
  if (typeof record["type"] === "string") return record["type"];
  return "native";
}

function encodeNativeTool(
  tool: ChatNativeTool,
  index: number,
  warn: Warn,
): IRNativeTool | undefined {
  const dialect = dialectOf(tool.provider);
  if (dialect === undefined) {
    warn({
      code: "dropped_tool",
      path: ["nativeTools", index],
      message: `the provider-defined tool at nativeTools[${index}] names provider "${tool.provider}", which unmodel has no endpoint for; provider-defined tools never cross wire formats, so with no dialect to attribute it to it was dropped.`,
      meta: { provider: tool.provider },
    });
    return undefined;
  }
  return { kind: "native", dialect, name: nativeToolName(tool.definition), raw: tool.definition };
}

// ---------------------------------------------------------------------------
// Reasoning
// ---------------------------------------------------------------------------

/**
 * Each dialect's effort vocabulary, verbatim.
 *
 * - `openai-chat`: `reasoning_effort` — `minimal | low | medium | high`.
 * - `anthropic-messages`: `output_config.effort` — `low | medium | high | xhigh | max`.
 *   No `minimal`.
 * - `gemini`: `thinkingConfig.thinkingLevel` — `MINIMAL | LOW | MEDIUM | HIGH`.
 * - `bedrock-converse`: no codec in v1, so nothing consumes this; listed with
 *   the full union so adding the codec is a decision made there, not a
 *   silent clamp inherited from here.
 */
const EFFORT_VOCABULARY: Readonly<Record<DialectId, ReadonlySet<ChatReasoningEffort>>> = {
  "openai-chat": new Set<ChatReasoningEffort>(["minimal", "low", "medium", "high"]),
  "anthropic-messages": new Set<ChatReasoningEffort>(["low", "medium", "high", "xhigh", "max"]),
  gemini: new Set<ChatReasoningEffort>(["minimal", "low", "medium", "high"]),
  "bedrock-converse": new Set<ChatReasoningEffort>([
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
  ]),
};

/** Dialects whose reasoning control is a token budget rather than a bucket. */
const HAS_BUDGET: ReadonlySet<DialectId> = new Set<DialectId>([
  "anthropic-messages",
  "gemini",
  "bedrock-converse",
]);

/**
 * Narrows an effort to what the target can say, in the only direction that is
 * safe: **towards more thinking, never less**. `xhigh`/`max` collapse to
 * `high` (the target's ceiling) and `minimal` rises to `low` (its floor). The
 * alternative — dropping the level and letting the model choose — turns an
 * explicit "think hard about this" into silence.
 */
function narrowEffort(
  effort: ChatReasoningEffort,
  dialect: DialectId,
  path: Array<string | number>,
  warn: Warn,
): string {
  if (EFFORT_VOCABULARY[dialect].has(effort)) return effort;
  const narrowed = effort === "minimal" ? "low" : "high";
  warn({
    code: "approximated_param",
    path,
    message: `\`reasoning\` effort "${effort}" is not one of ${dialect}'s levels (${[...EFFORT_VOCABULARY[dialect]].join(", ")}); it was mapped to "${narrowed}", which is the closest this target can express.`,
    meta: { from: effort, to: narrowed, dialect },
  });
  return narrowed;
}

/**
 * The reasoning normalization table.
 *
 * The interesting row is `{ effort, budgetTokens }` — both given. That is not
 * a contradiction, it is the only way to write one request that reasons well
 * on every provider: dialects with a real token budget take the budget,
 * dialects without one take the bucket. **No warning**, because nothing was
 * approximated: each target got the more precise of the two controls it
 * actually has.
 */
function encodeReasoning(
  reasoning: ChatReasoning,
  dialect: DialectId,
  warn: Warn,
): IRReasoning | undefined {
  if (reasoning === false || reasoning === "off") return { mode: "off" };
  if (typeof reasoning === "string") {
    // Shorthand: the caller wrote `reasoning: "high"`, so the warning path is
    // the param itself, not a field inside it.
    return { mode: "effort", effort: narrowEffort(reasoning, dialect, ["reasoning"], warn) };
  }
  const hasEffort = "effort" in reasoning && reasoning.effort !== undefined;
  const hasBudget = "budgetTokens" in reasoning && reasoning.budgetTokens !== undefined;
  if (hasEffort && hasBudget) {
    return HAS_BUDGET.has(dialect)
      ? { mode: "budget", budgetTokens: (reasoning as { budgetTokens: number }).budgetTokens }
      : {
          mode: "effort",
          effort: narrowEffort(
            (reasoning as { effort: ChatReasoningEffort }).effort,
            dialect,
            ["reasoning", "effort"],
            warn,
          ),
        };
  }
  if (hasBudget) {
    return { mode: "budget", budgetTokens: (reasoning as { budgetTokens: number }).budgetTokens };
  }
  if (hasEffort) {
    return {
      mode: "effort",
      effort: narrowEffort(
        (reasoning as { effort: ChatReasoningEffort }).effort,
        dialect,
        ["reasoning", "effort"],
        warn,
      ),
    };
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// The encoder
// ---------------------------------------------------------------------------

/**
 * `ChatParams` + a target dialect → the IR that dialect's decoder turns into a
 * wire body.
 *
 * @param targetDialect the dialect the IR is being authored *for*. It decides
 * reasoning normalization, which `providerOptions` bucket is live, and whether
 * `stream` belongs on the body at all.
 * @param warn the loss sink. Paths are in **unified** param space
 * (`["reasoning", "effort"]`, `["messages", 2, "content", 0]`) — the caller
 * never wrote a wire spelling and should never be shown one.
 */
export function encodeUnified(params: ChatParams, targetDialect: DialectId, warn: Warn): ChatIR {
  const ref = parseModelRef(params.model);
  const ir = emptyIR(targetDialect, ref?.modelId ?? params.model);

  // --- system ---------------------------------------------------------------
  // `system` first, then any `role: "system"` messages in the order they
  // appear. Every dialect keeps system text in one leading slot, so there is
  // no other order available — and doing the fold here rather than per
  // decoder means all three targets see the same prompt.
  const system: IRTextBlock[] = [];
  if (typeof params.system === "string") system.push({ text: params.system });
  else if (params.system !== undefined) {
    for (const block of params.system) system.push({ text: block.text, ...cacheOf(block.cache) });
  }

  // --- messages -------------------------------------------------------------
  // Tool results ride as parts on a *user* message (the IR's shape, which is
  // Anthropic's and Bedrock's). A `tool` message therefore does not become a
  // message of its own: its results are held and prepended to the next user
  // turn, exactly as `encodeOpenAIChat` does, so `[assistant, tool, user]`
  // produces two IR messages and not three — three would put two consecutive
  // user turns on the wire, which Anthropic rejects outright.
  let pending: IRPart[] = [];
  const flush = (): void => {
    if (pending.length === 0) return;
    ir.messages.push({ role: "user", content: pending });
    pending = [];
  };

  params.messages.forEach((message, index) => {
    const path = (j: number): Array<string | number> => ["messages", index, "content", j];
    switch (message.role) {
      case "system":
        system.push({ text: message.content, ...cacheOf(message.cache) });
        return;
      case "user": {
        const parts: IRPart[] = [];
        if (typeof message.content === "string") {
          parts.push({ type: "text", text: message.content });
        } else {
          message.content.forEach((part, j) => {
            if (part.type === "text") {
              parts.push({ type: "text", text: part.text, ...cacheOf(part.cache) });
              return;
            }
            const encoded = encodeFilePart(part, path(j), warn);
            if (encoded !== undefined) parts.push(encoded);
          });
        }
        ir.messages.push({ role: "user", content: [...pending, ...parts] });
        pending = [];
        return;
      }
      case "assistant": {
        flush();
        const parts: IRPart[] = [];
        if (typeof message.content === "string") {
          parts.push({ type: "text", text: message.content });
        } else {
          for (const part of message.content) {
            switch (part.type) {
              case "text":
                parts.push({ type: "text", text: part.text, ...cacheOf(part.cache) });
                break;
              case "tool-call":
                parts.push({
                  type: "tool-call",
                  id: part.toolCallId,
                  name: part.toolName,
                  input: part.input,
                  ...cacheOf(part.cache),
                });
                break;
              case "reasoning":
                parts.push({
                  type: "reasoning",
                  ...(part.text !== undefined && { text: part.text }),
                  ...(part.signature !== undefined && { signature: part.signature }),
                  ...(part.redacted !== undefined && { redacted: part.redacted }),
                });
                break;
            }
          }
        }
        ir.messages.push({ role: "assistant", content: parts });
        return;
      }
      case "tool":
        for (const part of message.content) pending.push(encodeToolResult(part));
        return;
    }
  });
  flush();

  if (system.length > 0) ir.system = system;

  // --- tools ----------------------------------------------------------------
  // `Object.entries` order, i.e. the order the object literal was written.
  // Not sorted: the declaration order of tools is visible to the model on
  // every provider, so re-ordering it would quietly change behaviour to buy
  // a determinism the caller already had.
  const tools: IRTool[] = [];
  for (const [name, spec] of Object.entries(params.tools ?? {})) {
    tools.push({
      kind: "function",
      name,
      ...(spec.description !== undefined && { description: spec.description }),
      parameters: spec.inputSchema,
      ...(spec.strict !== undefined && { strict: spec.strict }),
      ...cacheOf(spec.cache),
    });
  }
  if (tools.length > 0) ir.tools = tools;

  const nativeTools: IRNativeTool[] = [];
  (params.nativeTools ?? []).forEach((tool, index) => {
    const encoded = encodeNativeTool(tool, index, warn);
    if (encoded !== undefined) nativeTools.push(encoded);
  });
  if (nativeTools.length > 0) ir.nativeTools = nativeTools;

  if (params.toolChoice !== undefined) {
    const choice = params.toolChoice;
    const irChoice: IRToolChoice =
      typeof choice === "string" ? { mode: choice } : { mode: "tool", name: choice.toolName };
    ir.toolChoice = irChoice;
  }

  // --- settings -------------------------------------------------------------
  const s = ir.settings;
  if (params.maxOutputTokens !== undefined) s.maxOutputTokens = params.maxOutputTokens;
  if (params.temperature !== undefined) {
    s.temperature = params.temperature;
    // Always 2, never 1: the scale is a property of *this* vocabulary, and
    // this vocabulary declares 0–2. Targeting Anthropic clamps 1.4 → 1 with an
    // `approximated_param` warning, which is the honest outcome; rescaling
    // would silently change sampling on every request.
    s.temperatureMax = 2;
  }
  if (params.topP !== undefined) s.topP = params.topP;
  if (params.topK !== undefined) s.topK = params.topK;
  if (params.stopSequences !== undefined) s.stopSequences = params.stopSequences;
  if (params.seed !== undefined) s.seed = params.seed;
  if (params.presencePenalty !== undefined) s.presencePenalty = params.presencePenalty;
  if (params.frequencyPenalty !== undefined) s.frequencyPenalty = params.frequencyPenalty;
  if (params.candidates !== undefined) s.candidates = params.candidates;
  if (params.user !== undefined) s.user = params.user;
  if (params.parallelToolCalls !== undefined) s.parallelToolCalls = params.parallelToolCalls;
  if (params.serviceTier !== undefined) s.serviceTier = params.serviceTier;

  // Gemini has no `stream` flag — streaming is a different method
  // (`:streamGenerateContent`), which the compile step selects by swapping the
  // URL. Putting it in the IR anyway would make the Gemini decoder emit a
  // `dropped_param` warning for a request that streams perfectly well, so it
  // is withheld here instead. Nothing is lost, so nothing is warned.
  if (params.stream !== undefined && targetDialect !== "gemini") s.stream = params.stream;

  if (params.responseFormat !== undefined) {
    const format = params.responseFormat;
    if (format.type === "json") s.responseFormat = { kind: "json" };
    else if (format.type === "json-schema") {
      s.responseFormat = {
        kind: "json-schema",
        ...(format.name !== undefined && { name: format.name }),
        schema: format.schema,
        ...(format.strict !== undefined && { strict: format.strict }),
      };
    }
    // `{ type: "text" }` is every dialect's default and has no IR arm; saying
    // it explicitly and saying nothing are the same request.
  }

  if (params.reasoning !== undefined) {
    const reasoning = encodeReasoning(params.reasoning, targetDialect, warn);
    if (reasoning !== undefined) s.reasoning = reasoning;
  }

  // --- providerOptions ------------------------------------------------------
  // Addressed, not broadcast. The bucket keyed by the provider in `model` is
  // the live one and lands in `passthrough[targetDialect]`, which is exactly
  // the bucket that decoder re-emits verbatim. Every other *known* provider's
  // bucket is dropped without a word — that is the point of the field: one
  // request object can carry tuned settings for several providers and stay
  // portable. A bucket keyed by something that is not a provider id at all is
  // a typo, and gets a `dropped_param` naming it.
  const targetProvider = ref?.provider;
  for (const [key, bucket] of Object.entries(params.providerOptions ?? {})) {
    if (bucket === undefined) continue;
    if (key === targetProvider) {
      for (const [param, value] of Object.entries(bucket)) {
        // `__`-prefixed keys are the codecs' own private channel for
        // round-trip bookkeeping (`__system_role`, `__response_mime_type`);
        // every decoder strips them before emitting. A caller's key with that
        // prefix would therefore vanish silently, which is the one thing this
        // layer promises not to do.
        if (param.startsWith("__")) {
          warn({
            code: "dropped_param",
            path: ["providerOptions", key, param],
            message: `\`${param}\` starts with "__", which unmodel's codecs reserve for their own round-trip bookkeeping and strip before emitting; it was dropped rather than silently discarded downstream.`,
            meta: { param },
          });
          continue;
        }
        putPassthrough(ir, targetDialect, param, value);
      }
      continue;
    }
    if (classifyRef(key).kind !== "unknown-provider") continue;
    warn({
      code: "dropped_param",
      path: ["providerOptions", key],
      message: `\`providerOptions.${key}\` is keyed by "${key}", which is not a provider id unmodel knows; its ${Object.keys(bucket).length} setting(s) reached no provider. \`providerOptions\` is keyed by provider ("openai", "anthropic", "google", …) and only the bucket matching \`model\`'s provider is sent.`,
      meta: { provider: key },
    });
  }

  return ir;
}
