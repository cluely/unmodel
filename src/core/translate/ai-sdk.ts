/**
 * `toSdk("ai-sdk")` — the **fifth decoder**.
 *
 * The Vercel AI SDK's `generateText` / `streamText` options are just another
 * target shape, so once the IR exists this falls out for free: one
 * implementation here serves every dialect that has an encoder, instead of one
 * hand-written adapter per endpoint. That is the strongest single argument for
 * building the IR at all.
 *
 * **What is emitted, and why so little.** Only the option surface that has
 * been stable across AI SDK v5 and v6 (checked against the `generateText`
 * reference on **2026-08-13**): `messages` + the sampling settings + `tools` /
 * `toolChoice` + `providerOptions`. Newer options the docs also list
 * (`instructions`, `reasoning`, `toolOrder`, `activeTools`, `timeout`) are
 * deliberately not emitted — unmodel does not depend on `ai`, so nothing here
 * would catch their drift, and an option that does not exist on the caller's
 * installed version is a runtime error in their app.
 *
 * Three shape decisions that are the classic bugs when adapting from OpenAI
 * chat, all asserted in `ai-sdk.test.ts`:
 *
 * - **`messages` always**, never `prompt` / `instructions`. One code path, and
 *   a leading `{role:"system"}` message is exactly equivalent.
 * - **no `model`** — the caller supplies the provider instance
 *   (`openai("gpt-5.4")`); unmodel cannot construct a `LanguageModel` without
 *   importing a `@ai-sdk/*` package, which `src/` never does.
 * - **tool-call `input` stays an object**, not a JSON string, and tool results
 *   use the SDK's discriminated `output` union (`IRToolOutput` was designed to
 *   mirror it 1:1, with `isError` selecting `"error-text"`).
 *
 * Tool schemas are emitted as **plain JSON Schema**. The SDK's `inputSchema`
 * wants either a Zod schema or the symbol-branded object that its own
 * `jsonSchema()` helper returns — which unmodel cannot forge without
 * depending on `ai`. The dependency-free fix is the `unmodel/ai-sdk` subpath's
 * `withJsonSchemaTools(options, jsonSchema)`, which takes the wrapper as an
 * argument; requests without tools need no adapter at all.
 */
import type { ChatIR, IRPart, IRToolOutput } from "./ir";
import { inferMediaTypeFromUrl } from "./ir";
import type { TranslationWarning, Warn } from "./warnings";
import { attachWarnings, createWarningSink } from "./warnings";

// ---------------------------------------------------------------------------
// The emitted shape. Hand-written structurally: `ai` is not a dependency and
// must not become one.
// ---------------------------------------------------------------------------

export interface AiSdkTextPart {
  type: "text";
  text: string;
  providerOptions?: Record<string, Record<string, unknown>>;
}

/**
 * The SDK expresses images as **file parts with a `mediaType`** in current
 * docs, so this emits `{type:"file"}` uniformly rather than the legacy
 * `{type:"image"}`. `data` accepts a base64 string, a data URL or an
 * `http(s)` URL string — which is why all three `IRData` kinds map losslessly
 * except a provider file handle.
 */
export interface AiSdkFilePart {
  type: "file";
  mediaType: string;
  data: string;
  filename?: string;
  providerOptions?: Record<string, Record<string, unknown>>;
}

export interface AiSdkToolCallPart {
  type: "tool-call";
  toolCallId: string;
  toolName: string;
  input: unknown;
}

export type AiSdkToolOutput =
  | { type: "text"; value: string }
  | { type: "json"; value: unknown }
  | { type: "error-text"; value: string }
  | { type: "content"; value: Array<{ type: "text"; text: string } | { type: "media"; data: string; mediaType: string }> };

export interface AiSdkToolResultPart {
  type: "tool-result";
  toolCallId: string;
  toolName: string;
  output: AiSdkToolOutput;
}

export type AiSdkModelMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: Array<AiSdkTextPart | AiSdkFilePart> }
  | { role: "assistant"; content: Array<AiSdkTextPart | AiSdkToolCallPart> }
  | { role: "tool"; content: AiSdkToolResultPart[] };

export interface AiSdkToolSpec {
  description?: string;
  /** Plain JSON Schema — wrap with `withJsonSchemaTools` from `unmodel/ai-sdk`. */
  inputSchema: Record<string, unknown>;
}

export type AiSdkToolChoice = "auto" | "none" | "required" | { type: "tool"; toolName: string };

export interface AiSdkChatOptions {
  messages: AiSdkModelMessage[];
  maxOutputTokens?: number;
  temperature?: number;
  topP?: number;
  topK?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
  stopSequences?: string[];
  seed?: number;
  tools?: Record<string, AiSdkToolSpec>;
  toolChoice?: AiSdkToolChoice;
  providerOptions?: Record<string, Record<string, unknown>>;
}

/**
 * What `.toSdk("ai-sdk")` actually returns: the options plus the
 * non-enumerable `warnings` audit trail, mirroring `Retargeted`.
 *
 * Declared as a distinct type rather than folding `warnings` into
 * `AiSdkChatOptions` because the two are not the same contract — the options
 * are what you spread into `generateText`, and `warnings` is deliberately not
 * spreadable. `.toSdk("ai-sdk")` genuinely drops things (reasoning parts,
 * server tools, system-prompt cache breakpoints), so the drops must be
 * *typed* and not just present at runtime; otherwise the lossy-translation
 * contract is unobservable to a typed caller.
 */
export type AiSdkChatResult = AiSdkChatOptions & {
  readonly warnings: readonly TranslationWarning[];
};

/**
 * models.dev provider id → the key the AI SDK uses in `providerOptions`.
 * Mostly the identity; the entries below are the ones that are not, so the
 * fallback can safely be "same string".
 */
const AI_SDK_PROVIDER_KEY: Readonly<Record<string, string>> = Object.freeze({
  "google-vertex": "vertex",
  "amazon-bedrock": "bedrock",
  "fireworks-ai": "fireworks",
  "novita-ai": "novita",
  vercel: "gateway",
});

export function aiSdkProviderKey(provider: string): string {
  return Object.hasOwn(AI_SDK_PROVIDER_KEY, provider)
    ? (AI_SDK_PROVIDER_KEY[provider] as string)
    : provider;
}

// ---------------------------------------------------------------------------
// IR → options
// ---------------------------------------------------------------------------

function toolOutput(output: IRToolOutput, isError: boolean, warn: Warn, path: Array<string | number>): AiSdkToolOutput {
  if (isError) {
    return {
      type: "error-text",
      value: output.kind === "text" ? output.text : JSON.stringify(output.kind === "json" ? output.value : output),
    };
  }
  switch (output.kind) {
    case "text":
      return { type: "text", value: output.text };
    case "json":
      return { type: "json", value: output.value };
    case "content": {
      const value: Array<{ type: "text"; text: string } | { type: "media"; data: string; mediaType: string }> = [];
      for (const part of output.parts) {
        if (part.type === "text") value.push({ type: "text", text: part.text });
        else if (part.type === "media" && part.data.kind === "base64" && part.mediaType !== undefined) {
          value.push({ type: "media", data: part.data.base64, mediaType: part.mediaType });
        } else {
          warn({
            code: "dropped_content",
            path,
            message: `a \`${part.type}\` block inside a tool result has no AI SDK tool-output representation (text and inline media only) and was dropped.`,
          });
        }
      }
      return { type: "content", value };
    }
  }
}

function filePart(
  part: Extract<IRPart, { type: "media" }>,
  warn: Warn,
  path: Array<string | number>,
  cacheOptions: Record<string, Record<string, unknown>> | undefined,
): AiSdkFilePart | undefined {
  if (part.data.kind === "file") {
    warn({
      code: "dropped_content",
      path,
      message: `a ${part.data.dialect} file handle ("${part.data.ref}") has no AI SDK representation — the SDK takes bytes, a data URL or an http(s) URL, and file-id namespaces are per-provider. It was dropped.`,
      meta: { ref: part.data.ref },
    });
    return undefined;
  }
  const data = part.data.kind === "base64" ? part.data.base64 : part.data.url;
  const mediaType =
    part.mediaType ?? (part.data.kind === "url" ? inferMediaTypeFromUrl(part.data.url) : undefined);
  if (mediaType === undefined) {
    warn({
      code: "approximated_param",
      path,
      message:
        "the AI SDK's file part requires a `mediaType` and the source carried none (a bare remote URL); `application/octet-stream` was used, which the target provider may reject.",
    });
  }
  return {
    type: "file",
    mediaType: mediaType ?? "application/octet-stream",
    data,
    ...(part.filename !== undefined && { filename: part.filename }),
    ...(cacheOptions !== undefined && { providerOptions: cacheOptions }),
  };
}

export interface AiSdkDecodeOptions {
  /** models.dev provider id of the SOURCE endpoint, for `providerOptions` keying. */
  provider: string;
  /** Source endpoint id, e.g. `"anthropic.messages"` — used in warning routes. */
  endpoint: string;
}

/**
 * Builds one endpoint's `"ai-sdk"` formatter from its encoder. The endpoint
 * declares it in its `init.sdk` map:
 *
 * ```ts
 * const toAiSdk = createAiSdkChat({
 *   endpoint: "anthropic.messages", provider: "anthropic", encode: encodeAnthropic,
 * });
 * // …
 * sdk: { anthropic: () => body, "ai-sdk": () => toAiSdk(body) }
 * ```
 *
 * The returned options carry their `TranslationWarning[]` **non-enumerably**
 * on `warnings`, exactly like a `.toApi` result — so spreading them into
 * `generateText({ model, ...options })` carries the options and nothing else.
 */
export function createAiSdkChat<Body extends object>(spec: {
  endpoint: string;
  provider: string;
  encode: (body: Body, warn: Warn) => ChatIR;
}): (body: Body) => AiSdkChatResult {
  return (body) => {
    const sink = createWarningSink(spec.endpoint, "ai-sdk");
    const ir = spec.encode(body, sink.warn);
    const options = toAiSdkChat(ir, { provider: spec.provider, endpoint: spec.endpoint }, sink.warn);
    return attachWarnings(options, sink.warnings);
  };
}

export function toAiSdkChat(
  ir: ChatIR,
  options: AiSdkDecodeOptions,
  warn: Warn,
): AiSdkChatOptions {
  const key = aiSdkProviderKey(options.provider);
  const messages: AiSdkModelMessage[] = [];
  const providerOptions: Record<string, unknown> = {};

  if (ir.system !== undefined && ir.system.length > 0) {
    messages.push({ role: "system", content: ir.system.map((block) => block.text).join("\n\n") });
    if (ir.system.some((block) => block.cache !== undefined)) {
      // The AI SDK does model Anthropic cache breakpoints (as part-level
      // providerOptions), but a system message's content is a bare string, so
      // there is nowhere to hang one.
      warn({
        code: "dropped_param",
        path: ["system"],
        message:
          "a prompt-cache breakpoint on the system prompt has no AI SDK representation — the SDK's system message content is a bare string with no part-level options; it was dropped.",
      });
    }
  }

  const cacheOptionsFor = (
    part: { cache?: { kind: "ephemeral"; ttl?: string } },
    path: Array<string | number>,
  ): Record<string, Record<string, unknown>> | undefined => {
    if (part.cache === undefined) return undefined;
    if (options.provider !== "anthropic") {
      warn({
        code: "dropped_param",
        path,
        message: `an explicit prompt-cache breakpoint has no AI SDK representation for ${options.provider}; it was dropped.`,
      });
      return undefined;
    }
    return {
      anthropic: {
        cacheControl: { type: "ephemeral", ...(part.cache.ttl !== undefined && { ttl: part.cache.ttl }) },
      },
    };
  };

  ir.messages.forEach((message, index) => {
    const path = (j: number): Array<string | number> => ["messages", index, "content", j];
    if (message.role === "assistant") {
      const content: Array<AiSdkTextPart | AiSdkToolCallPart> = [];
      message.content.forEach((part, j) => {
        switch (part.type) {
          case "text": {
            const cache = cacheOptionsFor(part, path(j));
            content.push({ type: "text", text: part.text, ...(cache !== undefined && { providerOptions: cache }) });
            break;
          }
          case "tool-call":
            content.push({
              type: "tool-call",
              toolCallId: part.id,
              toolName: part.name,
              // Object, not a JSON string — the classic adaptation bug.
              input: part.input,
            });
            break;
          case "reasoning":
            warn({
              code: "dropped_content",
              path: path(j),
              message:
                "the AI SDK models reasoning on the *result* of a call, not on a request message, so a prior assistant reasoning block has no place in `messages` and was dropped.",
            });
            break;
          default:
            warn({
              code: "dropped_content",
              path: path(j),
              message: `an assistant \`${part.type}\` part has no AI SDK representation (assistant messages carry text and tool calls) and was dropped.`,
            });
        }
      });
      messages.push({ role: "assistant", content });
      return;
    }

    // A user turn's tool results become their own tool-role message, the same
    // structural split the openai-chat decoder makes.
    const toolResults: AiSdkToolResultPart[] = [];
    const content: Array<AiSdkTextPart | AiSdkFilePart> = [];
    message.content.forEach((part, j) => {
      switch (part.type) {
        case "tool-result":
          toolResults.push({
            type: "tool-result",
            toolCallId: part.id,
            toolName: part.name ?? part.id,
            output: toolOutput(part.output, part.isError === true, warn, path(j)),
          });
          break;
        case "text": {
          const cache = cacheOptionsFor(part, path(j));
          content.push({ type: "text", text: part.text, ...(cache !== undefined && { providerOptions: cache }) });
          break;
        }
        case "media": {
          const file = filePart(part, warn, path(j), cacheOptionsFor(part, path(j)));
          if (file !== undefined) content.push(file);
          break;
        }
        default:
          warn({
            code: "dropped_content",
            path: path(j),
            message: `a \`${part.type}\` part has no AI SDK representation in a user message and was dropped.`,
          });
      }
    });
    if (toolResults.length > 0) messages.push({ role: "tool", content: toolResults });
    if (content.length > 0) messages.push({ role: "user", content });
  });

  const out: AiSdkChatOptions = { messages };

  // Tools -------------------------------------------------------------------
  if (ir.tools !== undefined && ir.tools.length > 0) {
    const tools: Record<string, AiSdkToolSpec> = {};
    for (const tool of ir.tools) {
      tools[tool.name] = {
        ...(tool.description !== undefined && { description: tool.description }),
        inputSchema: tool.parameters,
      };
      if (tool.cache !== undefined) {
        warn({
          code: "dropped_param",
          path: ["tools"],
          message: `the cache breakpoint on tool "${tool.name}" has no AI SDK representation and was dropped; the tool itself is carried.`,
        });
      }
    }
    out.tools = tools;
  }
  for (const native of ir.nativeTools ?? []) {
    warn({
      code: "dropped_tool",
      path: ["tools"],
      message: `the provider-defined tool "${native.name}" has no portable AI SDK \`ToolSet\` representation; it was dropped. Declare the SDK provider's own tool helper alongside these options if you need it.`,
      meta: { tool: native.name, dialect: native.dialect },
    });
  }
  if (ir.toolChoice !== undefined) {
    out.toolChoice =
      ir.toolChoice.mode === "tool"
        ? { type: "tool", toolName: ir.toolChoice.name }
        : ir.toolChoice.mode;
  }

  // Settings ----------------------------------------------------------------
  const s = ir.settings;
  if (s.maxOutputTokens !== undefined) out.maxOutputTokens = s.maxOutputTokens;
  if (s.temperature !== undefined) out.temperature = s.temperature;
  if (s.topP !== undefined) out.topP = s.topP;
  if (s.topK !== undefined) out.topK = s.topK;
  if (s.presencePenalty !== undefined) out.presencePenalty = s.presencePenalty;
  if (s.frequencyPenalty !== undefined) out.frequencyPenalty = s.frequencyPenalty;
  if (s.stopSequences !== undefined) out.stopSequences = s.stopSequences;
  if (s.seed !== undefined) out.seed = s.seed;

  if (s.reasoning !== undefined) {
    if (s.reasoning.mode === "budget" && options.provider === "anthropic") {
      providerOptions["thinking"] = { type: "enabled", budgetTokens: s.reasoning.budgetTokens };
    } else if (s.reasoning.mode === "budget" && options.provider === "google") {
      providerOptions["thinkingConfig"] = { thinkingBudget: s.reasoning.budgetTokens };
    } else if (s.reasoning.mode === "effort") {
      providerOptions["reasoningEffort"] = s.reasoning.effort;
    } else if (s.reasoning.mode === "off") {
      providerOptions["reasoningEffort"] = "none";
    } else {
      warn({
        code: "dropped_param",
        path: ["reasoning"],
        message: `a ${s.reasoning.mode === "budget" ? "token-budget" : "reasoning"} setting has no documented AI SDK provider option for ${options.provider}; it was dropped.`,
      });
    }
  }
  if (s.responseFormat !== undefined) {
    warn({
      code: "dropped_param",
      path: ["response_format"],
      message:
        "`generateText` has no structured-output option; the requested JSON schema was dropped. Use `generateObject({ schema })` for structured output.",
    });
  }
  if (s.stream === true) {
    warn({
      code: "dropped_param",
      path: ["stream"],
      message:
        "streaming is a function choice in the AI SDK (`streamText` vs `generateText`), not an option; `stream: true` was dropped — call `streamText` with these options instead.",
    });
  }
  if (s.candidates !== undefined && s.candidates > 1) {
    warn({
      code: "dropped_param",
      path: ["n"],
      message: `the AI SDK returns a single completion per call; \`n: ${s.candidates}\` was dropped.`,
      meta: { n: s.candidates },
    });
  }
  if (s.user !== undefined) {
    warn({
      code: "dropped_param",
      path: ["user"],
      message:
        "end-user attribution (`user` / `metadata.user_id`) is not part of the AI SDK's stable option surface; it was dropped.",
    });
  }
  if (s.parallelToolCalls !== undefined) providerOptions["parallelToolCalls"] = s.parallelToolCalls;
  if (s.serviceTier !== undefined) providerOptions["serviceTier"] = s.serviceTier;

  // The source dialect's own params ride in `providerOptions`, under the
  // source provider's key and their wire spellings — which is exactly what
  // provider options are for. Other dialects' buckets cannot apply here.
  for (const [dialect, bucket] of Object.entries(ir.passthrough ?? {})) {
    if (bucket === undefined) continue;
    for (const [param, value] of Object.entries(bucket)) {
      if (param.startsWith("__")) continue;
      if (dialect === ir.source) providerOptions[param] = value;
      else {
        warn({
          code: "dropped_param",
          path: [param],
          message: `\`${param}\` is a ${dialect} param and this request is being formatted for ${options.provider}; it was dropped.`,
          meta: { param, dialect },
        });
      }
    }
  }
  if (Object.keys(providerOptions).length > 0) {
    out.providerOptions = { [key]: providerOptions };
  }

  return out;
}
