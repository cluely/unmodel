/**
 * The `unmodel/chat` pipeline: four validation layers around one compile step.
 *
 * The layers are the same four every provider validator runs, and they are run
 * in the same order for the same reasons — but two of them are looking at a
 * different object than usual, and that is the whole design:
 *
 * | layer | subject | why |
 * |---|---|---|
 * | 1 · shape | the caller's `ChatParams` | unified vocabulary, unified paths |
 * | — · ref | `model`'s provider half | decides the dialect everything below depends on |
 * | 2 · catalog | the bundled slim profile table | capabilities and limits, per model |
 * | — · compile | encode → IR → decode | the dialect body the request becomes |
 * | 3 · constraints | the **compiled body** | deny tables are written against the wire |
 * | 4 · estimate | the caller's `ChatParams` | tokens are a property of the prompt, not the body |
 *
 * ## Layer 3 is the only one that cannot stay in the unified vocabulary
 *
 * A provider's deny table says "`logprobs` returns a 400 here". That fact is
 * about the wire param, and the only place a wire param exists is the compiled
 * body — which is exactly why the compile step sits *between* layers 2 and 3
 * rather than at the end. The price is that layer 3's issue paths come back in
 * the wrong vocabulary, which `wire-paths.ts` translates back before anything
 * is reported.
 *
 * ## Structural failures are not validation failures
 *
 * A ref naming cohere, azure or a typo'd provider is not a request with a bad
 * param — there is no request, because no body can be built at all. Those short
 * circuit before compilation with the messages `refs.ts` writes, and follow the
 * same contract `.toApi` established: the throwing form throws
 * `TranslationUnavailableError` (so the thrown type names the structural
 * cause), the `safe` form reports the identical message through `errors` with
 * `meta.structural`, because a caller who asked for `safe` opted out of
 * exceptions and this is precisely the kind they opted out of catching.
 *
 * Those issues are built **directly** rather than through the severity sink, so
 * an `options.severity` override cannot silence one and hand back an `ok: true`
 * result with no body in it.
 *
 * ## An unknown model is a warning, not an error
 *
 * models.dev is a committed snapshot; a model released after it must still be
 * callable. So an unrecognised id on a *recognised* provider warns
 * `unknown_model` and skips every model-dependent check — the same bargain
 * every provider validator in the library makes.
 */
import type { Issue } from "../core/issues";
import type { ValidateEstimate, ValidateResult } from "../core/result";
import type { ValidateOptions } from "../core/options";
import type { Tokenizer } from "../core/tokens";
import { estimateToolDefinitionTokens, heuristicTokenizer, PER_MESSAGE_TOKEN_OVERHEAD } from "../core/tokens";
import { computeCostUSD } from "../core/cost";
import type { Modality } from "../core/catalog-types";
import { createIssueSink, partition, reportUnknownTopLevelKeys } from "../core/pipeline";
import { checkConstraints } from "../core/translate/constraint-check";
import { resolveEndpoint } from "../core/translate/endpoints";
import { TranslationUnavailableError } from "../core/translate/errors";
import { inferMediaTypeFromUrl, parseDataUrl } from "../core/translate/ir";
import { createWarningSink } from "../core/translate/warnings";
import type { ChatCatalog, ChatModelProfile } from "../catalog/chat-profiles.gen";
import { chatProfiles } from "../catalog/chat-profiles.gen";
import { CHAT_ROUTE, compileChat, finalizeChat, type ChatCompileInput } from "./compile";
import { chatConstraintsFor } from "./constraints";
import { encodeUnified } from "./encode";
import { classifyRef, parseModelRef, refProblemMessage } from "./refs";
import { chatParamsSchema } from "./schema";
import type { ChatFilePart, ChatParams } from "./types";
import { PROVIDER_OPTIONS_SUFFIX, unifiedPath } from "./wire-paths";

/** The endpoint label that appears in thrown errors and unknown-param messages. */
export const CHAT_ENDPOINT = "unmodel/chat";

/** Fraction of the context window above which `near_context` fires. */
const NEAR_CONTEXT_RATIO = 0.9;

/** Per-image token estimate when no constraint table supplies a real one. */
const DEFAULT_IMAGE_TOKENS = 1000;

export interface ChatOptions extends ValidateOptions {
  /**
   * Replaces the bundled `chatProfiles` table for layers 2 and 4.
   *
   * The profiles ship *inside* this entry rather than behind a subpath, because
   * a validator that has to be handed its own catalog before it can check
   * anything is a validator most people will call without one. The override
   * exists for the two cases that genuinely need it: pinning a snapshot, and
   * adding a model that shipped after unmodel's.
   */
  catalog?: ChatCatalog;
}

/**
 * What one run produced. `structural` is set when the ref itself is
 * unserviceable; the public `chat()` throws it verbatim so the thrown type
 * stays `TranslationUnavailableError`, while `chat.safe()` ignores it and
 * returns `result`, which carries the same message.
 */
export interface ChatOutcome {
  result: ValidateResult<object>;
  structural?: Error;
}

// ---------------------------------------------------------------------------
// Media helpers — used by the modality check
// ---------------------------------------------------------------------------

/** Mirrors `encode.ts`'s `URL_SCHEME`. */
const URL_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

/**
 * The media type of an attachment, by the same three readings the encoder
 * uses: declared, recovered from a `data:` URL, or inferred from a remote
 * URL's extension. `undefined` means "not knowable here" — a provider file
 * handle, or a URL with no extension — and the modality check then says
 * nothing rather than guessing a rejection.
 */
function mediaTypeOf(part: ChatFilePart): string | undefined {
  if (part.mediaType !== undefined) return part.mediaType;
  if (typeof part.data !== "string") return undefined;
  if (part.data.startsWith("data:")) return parseDataUrl(part.data)?.mediaType;
  if (URL_SCHEME.test(part.data)) return inferMediaTypeFromUrl(part.data);
  return undefined;
}

function modalityOf(mediaType: string | undefined): Modality | undefined {
  if (mediaType === undefined) return undefined;
  const mime = mediaType.trim().toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  if (mime === "application/pdf") return "pdf";
  return undefined;
}

/** True when `reasoning` asks the model to think rather than to stop thinking. */
function asksForReasoning(reasoning: ChatParams["reasoning"]): boolean {
  return reasoning !== undefined && reasoning !== false && reasoning !== "off";
}

// ---------------------------------------------------------------------------
// Layer 4 — estimation
// ---------------------------------------------------------------------------

/**
 * A heuristic prompt-token count over the **unified** messages.
 *
 * Deliberately measured before compilation: the token cost is a property of the
 * prompt, and counting the compiled body instead would make the same
 * conversation estimate differently per provider purely because of JSON
 * punctuation.
 *
 * Attachments are the honest weak spot. Images are charged the constraint
 * table's per-image number (or a flat default), and audio / video / PDF are not
 * estimated at all — no per-byte heuristic exists that is better than silence,
 * and the count is documented as a floor. Text-only requests, which is most of
 * them, are as accurate as the tokenizer supplied.
 */
function estimateInputTokens(
  params: ChatParams,
  tokenizer: Tokenizer,
  imageTokens: number,
): number {
  let total = 0;

  if (typeof params.system === "string") {
    total += tokenizer.count(params.system) + PER_MESSAGE_TOKEN_OVERHEAD;
  } else if (Array.isArray(params.system)) {
    for (const block of params.system) {
      total += tokenizer.count(block.text ?? "") + PER_MESSAGE_TOKEN_OVERHEAD;
    }
  }

  for (const message of params.messages) {
    total += PER_MESSAGE_TOKEN_OVERHEAD;
    const content: unknown = message.content;
    if (typeof content === "string") {
      total += tokenizer.count(content);
      continue;
    }
    if (!Array.isArray(content)) continue;
    for (const part of content as Array<Record<string, unknown>>) {
      if (typeof part !== "object" || part === null) continue;
      switch (part["type"]) {
        case "text":
          if (typeof part["text"] === "string") total += tokenizer.count(part["text"]);
          break;
        case "reasoning":
          if (typeof part["text"] === "string") total += tokenizer.count(part["text"]);
          break;
        case "tool-call":
          total += estimateToolDefinitionTokens(tokenizer, part["input"]);
          break;
        case "tool-result":
          total += estimateToolDefinitionTokens(tokenizer, part["output"]);
          break;
        case "file":
          if (modalityOf(mediaTypeOf(part as unknown as ChatFilePart)) === "image") {
            total += imageTokens;
          }
          break;
        default:
          break;
      }
    }
  }

  for (const [name, spec] of Object.entries(params.tools ?? {})) {
    total += estimateToolDefinitionTokens(tokenizer, { name, ...spec });
  }
  return total;
}

// ---------------------------------------------------------------------------
// The pipeline
// ---------------------------------------------------------------------------

/** A structural issue, built outside the sink so no override can silence it. */
function structuralIssue(model: string, provider: string, message: string): Issue {
  return {
    severity: "error",
    code: "unsupported_capability",
    path: ["model"],
    model,
    message,
    meta: { provider, structural: true },
  };
}

export function runChat(params: ChatParams, options: ChatOptions = {}): ChatOutcome {
  const sink = createIssueSink(options);
  const tokenizer = options.tokenizer ?? heuristicTokenizer;

  // --- Layer 1: shape -------------------------------------------------------
  const parsed = chatParamsSchema.safeParse(params);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      sink.report({
        code: "invalid_shape",
        path: issue.path.filter(
          (segment): segment is string | number =>
            typeof segment === "string" || typeof segment === "number",
        ),
        message: issue.message,
      });
    }
    return { result: { ok: false, ...partition(sink.issues) } };
  }
  reportUnknownTopLevelKeys(chatParamsSchema, params, {
    endpoint: CHAT_ENDPOINT,
    report: (issue) => sink.report(issue),
  });

  // --- Ref resolution -------------------------------------------------------
  const ref = parseModelRef(params.model);
  if (ref === undefined) {
    // A missing provider half is a *shape* problem, not a structural one: the
    // fix is in the string the caller typed, so it belongs with the other
    // layer-1 findings and must not throw `TranslationUnavailableError`.
    sink.report({
      code: "invalid_shape",
      path: ["model"],
      message: refProblemMessage({ kind: "no-slash", ref: params.model }),
    });
    return { result: { ok: false, ...partition(sink.issues) } };
  }

  const classification = classifyRef(ref.provider);
  if (classification.kind !== "supported") {
    const message = refProblemMessage(classification);
    const errors = [structuralIssue(params.model, ref.provider, message), ...sink.issues.filter((i) => i.severity === "error")];
    return {
      result: { ok: false, errors, warnings: sink.issues.filter((i) => i.severity === "warning") },
      structural: new TranslationUnavailableError(message),
    };
  }

  // `classifyRef` only returns `supported` for providers `ENDPOINTS` resolves,
  // so this cannot be undefined; the guard keeps the type honest.
  const endpoint = resolveEndpoint(ref.provider);
  if (endpoint === undefined) {
    const message = `unmodel: "${ref.provider}" has no entry in the endpoint table.`;
    return {
      result: { ok: false, errors: [structuralIssue(params.model, ref.provider, message)], warnings: [] },
      structural: new TranslationUnavailableError(message),
    };
  }

  // --- Layer 2: catalog -----------------------------------------------------
  const catalog = options.catalog ?? chatProfiles;
  const models = Object.hasOwn(catalog, ref.provider) ? catalog[ref.provider] : undefined;
  const profile: ChatModelProfile | undefined =
    models !== undefined && Object.hasOwn(models, ref.modelId) ? models[ref.modelId] : undefined;

  if (profile === undefined) {
    sink.report({
      code: "unknown_model",
      path: ["model"],
      model: params.model,
      message: `Model "${ref.modelId}" is not in the ${ref.provider} catalog; model-dependent checks were skipped. If this model is new, catalog data may lag behind.`,
    });
  } else {
    checkProfile(params, ref.modelId, params.model, profile, sink.report);
  }

  // --- Compile --------------------------------------------------------------
  // One sink for the whole translation, so `warnings` answers the single
  // question "what did compiling this request cost?" — encoder losses and
  // decoder losses are indistinguishable from where the caller stands.
  const translation = createWarningSink(CHAT_ROUTE, endpoint.id);
  const ir = encodeUnified(params, endpoint.dialect, translation.warn);
  const input: ChatCompileInput = {
    ir,
    provider: ref.provider,
    modelId: ref.modelId,
    endpoint,
    stream: params.stream === true,
  };

  let compiled;
  try {
    compiled = compileChat(input, translation.warn);
  } catch (error) {
    // `compileChat` throws only `TranslationUnavailableError`, and only for
    // states `classifyRef` should already have caught. Surfacing it through the
    // same structural channel keeps `safe()` exception-free.
    const message = error instanceof Error ? error.message : String(error);
    return {
      result: { ok: false, errors: [structuralIssue(params.model, ref.provider, message)], warnings: [] },
      structural: error instanceof Error ? error : new TranslationUnavailableError(message),
    };
  }

  // --- Layer 3: the provider's deny/enum tables, against the compiled body ---
  const layer3: Issue[] = [];
  checkConstraints(chatConstraintsFor(endpoint.id, ref.modelId), compiled.body, ref.modelId, layer3);
  for (const issue of layer3) {
    const { path, unmapped } = unifiedPath(endpoint.dialect, issue.path);
    sink.report({
      code: issue.code,
      path,
      message: unmapped ? `${issue.message}${PROVIDER_OPTIONS_SUFFIX}` : issue.message,
      ...(issue.model !== undefined && { model: issue.model }),
      ...(issue.meta !== undefined && { meta: issue.meta }),
      // Preserve `ignored` deny rules' downgrade to a warning; the user's own
      // `options.severity` still wins over it inside the sink.
      severity: issue.severity,
    });
  }

  // --- Layer 4: tokens, context, budget -------------------------------------
  const imageTokens =
    chatConstraintsFor(endpoint.id, ref.modelId).find((table) => table.imageTokens !== undefined)
      ?.imageTokens ?? DEFAULT_IMAGE_TOKENS;
  const inputTokens = estimateInputTokens(params, tokenizer, imageTokens);
  const outputTokens = params.maxOutputTokens ?? profile?.limit.output;
  const costUSD = computeCostUSD(profile?.cost, { inputTokens, outputTokens });
  const estimate: ValidateEstimate = {
    inputTokens,
    ...(costUSD !== undefined && { costUSD }),
  };

  const context = profile?.limit.context ?? 0;
  if (context > 0) {
    if (inputTokens > context) {
      sink.report({
        code: "over_context",
        path: ["messages"],
        model: params.model,
        message: `~${inputTokens} estimated prompt tokens exceed the ${context}-token context window of "${ref.modelId}".`,
        meta: { estimated: inputTokens, limit: context },
      });
    } else if (inputTokens > context * NEAR_CONTEXT_RATIO) {
      sink.report({
        code: "near_context",
        path: ["messages"],
        model: params.model,
        message: `~${inputTokens} estimated prompt tokens are within 10% of the ${context}-token context window of "${ref.modelId}"; the estimate is heuristic, so the request may not fit.`,
        meta: { estimated: inputTokens, limit: context },
      });
    }
  }
  if (options.maxCostUSD !== undefined && costUSD !== undefined && costUSD > options.maxCostUSD) {
    sink.report({
      code: "over_budget",
      path: ["model"],
      model: params.model,
      message: `Estimated worst-case cost $${costUSD.toFixed(4)} exceeds maxCostUSD $${options.maxCostUSD}.`,
      meta: { estimated: costUSD, limit: options.maxCostUSD },
    });
  }

  const { errors, warnings } = partition(sink.issues);
  if (errors.length > 0) return { result: { ok: false, errors, warnings } };
  return {
    result: {
      ok: true,
      params: finalizeChat(input, compiled, translation.warnings),
      warnings,
      estimate,
    },
  };
}

// ---------------------------------------------------------------------------
// Layer 2 checks
// ---------------------------------------------------------------------------

type Report = (issue: {
  code: Issue["code"];
  message: string;
  path?: Array<string | number>;
  model?: string;
  meta?: Record<string, unknown>;
  severity?: Issue["severity"];
}) => void;

/**
 * The model-dependent checks. Each one exists because the failure it prevents
 * is otherwise a 400 (or worse, a silently ignored param) that names the wire
 * spelling of something the caller never wrote.
 */
function checkProfile(
  params: ChatParams,
  modelId: string,
  ref: string,
  profile: ChatModelProfile,
  report: Report,
): void {
  if (profile.status === "deprecated") {
    report({
      code: "deprecated_model",
      path: ["model"],
      model: ref,
      message: `Model "${modelId}" is marked deprecated by the provider.`,
    });
  }

  const toolNames = Object.keys(params.tools ?? {});
  if (toolNames.length > 0 && profile.toolCall === false) {
    report({
      code: "unsupported_capability",
      path: ["tools"],
      model: ref,
      message: `"${modelId}" does not support tool calling, and ${toolNames.length} tool(s) were supplied (${toolNames.join(", ")}); every dialect either rejects the request or ignores the tools entirely.`,
      meta: { tools: toolNames },
    });
  }

  // Attachments vs the model's declared input modalities. Checked per part so
  // the path points at the offending attachment rather than at `messages`.
  const accepted = new Set<Modality>(profile.modalities.input);
  params.messages.forEach((message, index) => {
    if (message.role !== "user" || typeof message.content === "string") return;
    message.content.forEach((part, j) => {
      if (part.type !== "file") return;
      const mediaType = mediaTypeOf(part);
      const modality = modalityOf(mediaType);
      if (modality === undefined || accepted.has(modality)) return;
      report({
        code: "unsupported_capability",
        path: ["messages", index, "content", j],
        model: ref,
        message: `"${modelId}" does not accept ${modality} input (it accepts ${[...accepted].join(", ")}); the \`${mediaType}\` attachment would be rejected.`,
        meta: { modality, mediaType, accepted: [...accepted] },
      });
    });
  });

  // `structuredOutput` is tri-state in the catalog: absent means models.dev has
  // no answer, and an absent answer must not fail a request.
  if (params.responseFormat?.type === "json-schema" && profile.structuredOutput === false) {
    report({
      code: "unsupported_capability",
      path: ["responseFormat"],
      model: ref,
      message: `"${modelId}" does not support schema-constrained structured output; a \`json-schema\` response format cannot be honoured. Use \`{ type: "json" }\` and validate the result yourself, or pick a model with structured output.`,
    });
  }

  if (asksForReasoning(params.reasoning) && profile.reasoning === false) {
    report({
      code: "unsupported_capability",
      path: ["reasoning"],
      model: ref,
      message: `"${modelId}" is not a reasoning model, so \`reasoning\` has nothing to control. Drop it, or use a model the catalog marks \`reasoning: true\`.`,
    });
  }

  const limit = profile.limit.output;
  if (limit !== undefined && params.maxOutputTokens !== undefined && params.maxOutputTokens > limit) {
    report({
      code: "over_output_limit",
      path: ["maxOutputTokens"],
      model: ref,
      message: `\`maxOutputTokens\` is ${params.maxOutputTokens}, above the ${limit}-token output limit of "${modelId}".`,
      meta: { requested: params.maxOutputTokens, limit },
    });
  }
}
