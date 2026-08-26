/**
 * The **openai-chat** dialect codec — one module serving all 31 fleet
 * providers plus `openai.chat`, which is the fact that makes the whole
 * translator affordable: codecs are per *dialect* (4), not per *provider*
 * (36), so an endpoint that declares cross-dialect targets statically imports
 * at most three extra codec modules and never another provider's validator,
 * schema or catalog.
 *
 * Import-graph rule 5 (asserted in `test/import-graph.test.ts`): an interop
 * spoke imports only `src/core/translate/**` and its own directory's leaves.
 *
 * Two mapping decisions worth stating up front, because both are visible in
 * `warnings`:
 *
 * - **`top_k` is dropped when translating *into* this dialect.** It is not in
 *   the OpenAI Chat Completions reference; the gateways that accept it do so
 *   as an extension, and betting on one is how you turn a translation into a
 *   400. Translating *out of* this dialect still lifts a `top_k` extension
 *   into the IR, because Anthropic and Gemini both have a real one.
 * - **Cache breakpoints only survive to OpenAI itself**, whose wire body has
 *   `prompt_cache_breakpoint` (verified against openai@7.4.0's generated
 *   types in `./wire.ts`). For any other target they are dropped with a
 *   named warning rather than guessed at.
 */
import type { ChatIR, DecodeContext, IRMessage, IRPart, IRTextBlock } from "../../core/translate/ir";
import {
  emptyIR,
  inferMediaTypeFromUrl,
  isAudioMediaType,
  isImageMediaType,
  ownNativeTools,
  ownPassthrough,
  parseDataUrl,
  putPassthrough,
  toDataUrl,
  toolOutputToText,
  warnForeignExtras,
} from "../../core/translate/ir";
import type { Warn } from "../../core/translate/warnings";
import type {
  ChatAssistantMessage,
  ChatCompletionsBodyBase,
  ChatMessage,
  ChatTextPart,
  ChatTool,
  ChatToolChoice,
  ChatUserContentPart,
} from "./wire";

const DIALECT = "openai-chat" as const;

/**
 * Top-level params this codec maps into the IR. Everything else on the body —
 * OpenAI-only params (`audio`, `store`, `prediction`, …), gateway extensions
 * (`provider`, `transforms`, …) and anything a provider adds tomorrow — is
 * swept into `passthrough["openai-chat"]`, so the openai-chat decoder
 * re-emits it verbatim and every other decoder warns `dropped_param` by name.
 * That sweep is what makes "never silently drops" true for params this file
 * has never heard of.
 */
const MAPPED_KEYS: ReadonlySet<string> = new Set([
  "model",
  "messages",
  "frequency_penalty",
  "max_completion_tokens",
  "max_tokens",
  "n",
  "parallel_tool_calls",
  "presence_penalty",
  "reasoning_effort",
  "response_format",
  "seed",
  "service_tier",
  "stop",
  "stream",
  "temperature",
  "tool_choice",
  "tools",
  "top_k",
  "top_p",
  "user",
]);

// ---------------------------------------------------------------------------
// Encode: openai-chat wire body → ChatIR
// ---------------------------------------------------------------------------

function textPartsOf(content: string | ChatTextPart[]): IRTextBlock[] {
  if (typeof content === "string") return [{ text: content }];
  return content.map((part) => ({
    text: part.text,
    ...(part.prompt_cache_breakpoint !== undefined && { cache: { kind: "ephemeral" as const } }),
  }));
}

function audioMediaType(format: "wav" | "mp3"): string {
  return format === "wav" ? "audio/wav" : "audio/mpeg";
}

function encodeUserPart(part: ChatUserContentPart, path: Array<string | number>, warn: Warn): IRPart | undefined {
  const cache =
    part.prompt_cache_breakpoint !== undefined ? { cache: { kind: "ephemeral" as const } } : {};
  switch (part.type) {
    case "text":
      return { type: "text", text: part.text, ...cache };
    case "image_url": {
      // `detail` used to be dropped here with a warning calling it "an OpenAI
      // chat-completions concept with no equivalent in the other dialects".
      // Gemini's per-`Part` `mediaResolution.level` is that equivalent, so the
      // IR carries the hint and the *target* decoder decides what it costs:
      // Gemini takes it as-is, Anthropic drops it by name, and OpenAI's own
      // decoder narrows `medium` (which only Gemini has) to `high`.
      const detail = part.image_url.detail !== undefined ? { detail: part.image_url.detail } : {};
      const parsed = parseDataUrl(part.image_url.url);
      return parsed === undefined
        ? { type: "media", data: { kind: "url", url: part.image_url.url }, ...detail, ...cache }
        : {
            type: "media",
            mediaType: parsed.mediaType,
            data: { kind: "base64", base64: parsed.base64 },
            ...detail,
            ...cache,
          };
    }
    case "input_audio":
      return {
        type: "media",
        mediaType: audioMediaType(part.input_audio.format),
        data: { kind: "base64", base64: part.input_audio.data },
        ...cache,
      };
    case "file": {
      const { file_data, file_id, filename } = part.file;
      const name = filename !== undefined ? { filename } : {};
      if (file_data !== undefined) {
        const parsed = parseDataUrl(file_data);
        return parsed === undefined
          ? {
              type: "media",
              ...(filename !== undefined && { mediaType: inferMediaTypeFromUrl(filename) }),
              data: { kind: "base64", base64: file_data },
              ...name,
              ...cache,
            }
          : {
              type: "media",
              mediaType: parsed.mediaType,
              data: { kind: "base64", base64: parsed.base64 },
              ...name,
              ...cache,
            };
      }
      if (file_id !== undefined) {
        return {
          type: "media",
          data: { kind: "file", dialect: DIALECT, ref: file_id },
          ...name,
          ...cache,
        };
      }
      warn({
        code: "dropped_content",
        path,
        message:
          "a `file` content part carries neither `file_data` nor `file_id`; there is nothing to translate, so it was dropped.",
      });
      return undefined;
    }
  }
}

function parseToolArguments(raw: string, path: Array<string | number>, warn: Warn): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    warn({
      code: "approximated_param",
      path,
      message:
        "tool call `arguments` is not valid JSON; it was carried through verbatim, which dialects that model tool input as an object (Gemini, Anthropic, the AI SDK) may reject.",
    });
    return raw;
  }
}

function encodeAssistant(
  message: ChatAssistantMessage,
  index: number,
  toolNames: Map<string, string>,
  warn: Warn,
): IRPart[] {
  const parts: IRPart[] = [];
  const content = message.content;
  if (typeof content === "string") {
    if (content.length > 0) parts.push({ type: "text", text: content });
  } else if (Array.isArray(content)) {
    content.forEach((part, j) => {
      if (part.type === "text") {
        parts.push({
          type: "text",
          text: part.text,
          ...(part.prompt_cache_breakpoint !== undefined && { cache: { kind: "ephemeral" as const } }),
        });
      } else {
        warn({
          code: "dropped_content",
          path: ["messages", index, "content", j],
          message:
            "an assistant `refusal` part is a response artifact with no request-side equivalent in the other dialects; it was dropped.",
        });
      }
    });
  }
  (message.tool_calls ?? []).forEach((call, j) => {
    if (call.type === "function") {
      toolNames.set(call.id, call.function.name);
      parts.push({
        type: "tool-call",
        id: call.id,
        name: call.function.name,
        input: parseToolArguments(
          call.function.arguments,
          ["messages", index, "tool_calls", j, "function", "arguments"],
          warn,
        ),
      });
    } else {
      warn({
        code: "dropped_content",
        path: ["messages", index, "tool_calls", j],
        message: `the custom (grammar) tool call "${call.custom.name}" is an OpenAI-only content kind; only function tool calls cross dialects, so it was dropped.`,
        meta: { tool: call.custom.name },
      });
    }
  });
  return parts;
}

export function encodeOpenAIChat(body: ChatCompletionsBodyBase, warn: Warn): ChatIR {
  const ir = emptyIR(DIALECT, body.model);
  const system: IRTextBlock[] = [];
  const toolNames = new Map<string, string>();
  let pendingToolResults: IRPart[] = [];
  let sawTurn = false;

  const flush = (): void => {
    if (pendingToolResults.length === 0) return;
    ir.messages.push({ role: "user", content: pendingToolResults });
    pendingToolResults = [];
  };

  body.messages.forEach((message: ChatMessage, index) => {
    if (message.role === "system" || message.role === "developer") {
      if (sawTurn) {
        warn({
          code: "approximated_param",
          path: ["messages", index],
          message: `the \`${message.role}\` message at index ${index} appears after a conversational turn; every other dialect keeps system text in a single leading slot, so it was moved to the front of the system prompt.`,
        });
      }
      if (message.role === "developer") putPassthrough(ir, DIALECT, "__system_role", "developer");
      system.push(...textPartsOf(message.content));
      return;
    }
    sawTurn = true;
    if (message.role === "user") {
      const parts: IRPart[] = [];
      if (typeof message.content === "string") {
        parts.push({ type: "text", text: message.content });
      } else {
        message.content.forEach((part, j) => {
          const encoded = encodeUserPart(part, ["messages", index, "content", j], warn);
          if (encoded !== undefined) parts.push(encoded);
        });
      }
      if (message.name !== undefined) {
        warn({
          code: "dropped_param",
          path: ["messages", index, "name"],
          message:
            "`messages[].name` is an OpenAI chat-completions field with no equivalent in the other dialects; it was dropped.",
        });
      }
      ir.messages.push({ role: "user", content: [...pendingToolResults, ...parts] });
      pendingToolResults = [];
      return;
    }
    if (message.role === "assistant") {
      flush();
      ir.messages.push({ role: "assistant", content: encodeAssistant(message, index, toolNames, warn) });
      if (message.function_call != null) {
        warn({
          code: "dropped_param",
          path: ["messages", index, "function_call"],
          message:
            "`messages[].function_call` is the deprecated legacy functions API; it has no equivalent in the other dialects and was dropped. Use `tool_calls`.",
        });
      }
      return;
    }
    if (message.role === "tool") {
      const name = toolNames.get(message.tool_call_id);
      pendingToolResults.push({
        type: "tool-result",
        id: message.tool_call_id,
        ...(name !== undefined && { name }),
        output: {
          kind: "text",
          text:
            typeof message.content === "string"
              ? message.content
              : message.content.map((part) => part.text).join("\n"),
        },
      });
      return;
    }
    // role: "function" — the deprecated legacy shape.
    warn({
      code: "dropped_content",
      path: ["messages", index],
      message: `the legacy \`function\` message for "${message.name}" has no equivalent in the other dialects (they all model tool results against a tool-call id); it was dropped. Use a \`tool\` message.`,
    });
  });
  flush();

  if (system.length > 0) ir.system = system;

  // Tools -------------------------------------------------------------------
  for (const tool of body.tools ?? []) {
    if (tool.type === "function") {
      ir.tools ??= [];
      ir.tools.push({
        kind: "function",
        name: tool.function.name,
        ...(tool.function.description !== undefined && { description: tool.function.description }),
        parameters: tool.function.parameters ?? { type: "object", properties: {} },
        ...(tool.function.strict != null && { strict: tool.function.strict }),
      });
    } else {
      ir.nativeTools ??= [];
      ir.nativeTools.push({ kind: "native", dialect: DIALECT, name: tool.custom.name, raw: tool });
    }
  }

  const choice = body.tool_choice;
  if (typeof choice === "string") {
    ir.toolChoice = choice === "required" ? { mode: "required" } : { mode: choice };
  } else if (choice !== undefined && typeof choice === "object") {
    if (choice.type === "function") ir.toolChoice = { mode: "tool", name: choice.function.name };
    else putPassthrough(ir, DIALECT, "tool_choice", choice);
  }

  // Settings ----------------------------------------------------------------
  const s = ir.settings;
  const maxTokens = body.max_completion_tokens ?? body.max_tokens;
  if (maxTokens != null) s.maxOutputTokens = maxTokens;
  if (body.temperature != null) {
    s.temperature = body.temperature;
    s.temperatureMax = 2;
  }
  if (body.top_p != null) s.topP = body.top_p;
  const topK = (body as unknown as Record<string, unknown>)["top_k"];
  if (typeof topK === "number") s.topK = topK;
  if (body.stop != null) s.stopSequences = typeof body.stop === "string" ? [body.stop] : body.stop;
  if (body.seed != null) s.seed = body.seed;
  if (body.presence_penalty != null) s.presencePenalty = body.presence_penalty;
  if (body.frequency_penalty != null) s.frequencyPenalty = body.frequency_penalty;
  if (body.n != null) s.candidates = body.n;
  if (body.stream != null) s.stream = body.stream;
  if (body.user !== undefined) s.user = body.user;
  if (body.parallel_tool_calls !== undefined) s.parallelToolCalls = body.parallel_tool_calls;
  if (body.service_tier != null) s.serviceTier = body.service_tier;
  if (body.reasoning_effort != null) s.reasoning = { mode: "effort", effort: body.reasoning_effort };
  const format = body.response_format;
  if (format !== undefined) {
    if (format.type === "json_object") s.responseFormat = { kind: "json" };
    else if (format.type === "json_schema" && format.json_schema.schema !== undefined) {
      s.responseFormat = {
        kind: "json-schema",
        name: format.json_schema.name,
        schema: format.json_schema.schema,
        ...(format.json_schema.strict != null && { strict: format.json_schema.strict }),
      };
    } else putPassthrough(ir, DIALECT, "response_format", format);
  }

  // Everything this codec does not map, by name, so a foreign decoder can warn.
  for (const [key, value] of Object.entries(body as unknown as Record<string, unknown>)) {
    if (MAPPED_KEYS.has(key) || value === undefined) continue;
    putPassthrough(ir, DIALECT, key, value);
  }

  return ir;
}

// ---------------------------------------------------------------------------
// Decode: ChatIR → openai-chat wire body
// ---------------------------------------------------------------------------

/** Whether the target can express a cache breakpoint, and how. */
function cacheStyle(ctx: DecodeContext | undefined): "openai" | "none" {
  // `undefined` provider = the codec is being driven directly (golden fixtures,
  // round-trip tests), where the breakpoint came from this dialect to begin with.
  return ctx?.provider === undefined || ctx.provider === "openai" ? "openai" : "none";
}

function cacheProps(
  part: { cache?: { kind: "ephemeral"; ttl?: string } },
  style: "openai" | "none",
  path: Array<string | number>,
  warn: Warn,
  ctx: DecodeContext | undefined,
): { prompt_cache_breakpoint?: { mode: "explicit" } } {
  if (part.cache === undefined) return {};
  if (style === "none") {
    warn({
      code: "dropped_param",
      path,
      message: `an explicit prompt-cache breakpoint has no documented representation on ${ctx?.provider ?? "this target"}'s chat-completions surface; it was dropped and the request will simply not be cached at that point.`,
    });
    return {};
  }
  if (part.cache.ttl !== undefined) {
    warn({
      code: "approximated_param",
      path,
      message: `the cache breakpoint's \`ttl: "${part.cache.ttl}"\` has no OpenAI equivalent; the breakpoint is kept but its lifetime falls back to the provider default.`,
      meta: { ttl: part.cache.ttl },
    });
  }
  return { prompt_cache_breakpoint: { mode: "explicit" } };
}

/**
 * The canonical resolution hint, in Chat Completions' own three-value
 * vocabulary.
 *
 * `medium` is Gemini's, and this dialect has no `medium`: `image_url.detail`
 * documents `auto | low | high` (openai@7.5.0 types it the same way; the
 * fourth value `original` is Responses-only). Rounding *up* rather than down
 * is the `ChatReasoningEffort` rule — a request that costs a little more is
 * recoverable, one that silently loses resolution on a document scan is not —
 * and it is loud, because a caller who wrote `medium` asked for something this
 * target cannot give.
 *
 * A hint on a NON-image part is dropped rather than mis-attached: this dialect
 * hangs `detail` off `image_url`, and an `input_audio` or `file` part has
 * nowhere to put it.
 */
function imageDetailFor(
  part: Extract<IRPart, { type: "media" }>,
  path: Array<string | number>,
  warn: Warn,
): { detail?: "auto" | "low" | "high" } {
  if (part.detail === undefined) return {};
  if (part.detail !== "medium") return { detail: part.detail };
  warn({
    code: "approximated_param",
    path: [...path, "detail"],
    message:
      '`detail: "medium"` is Gemini\'s middle media-resolution level and chat-completions has no equivalent — `image_url.detail` takes `auto | low | high`. It was raised to `"high"` rather than lowered, so nothing is lost but tokens.',
    meta: { from: "medium", to: "high" },
  });
  return { detail: "high" };
}

function decodeMediaPart(
  part: Extract<IRPart, { type: "media" }>,
  style: "openai" | "none",
  path: Array<string | number>,
  warn: Warn,
  ctx: DecodeContext | undefined,
): ChatUserContentPart | undefined {
  const cache = cacheProps(part, style, path, warn, ctx);
  if (part.data.kind === "file") {
    warn({
      code: "dropped_content",
      path,
      message: `a ${part.data.dialect} file handle ("${part.data.ref}") cannot be carried across providers — file-id namespaces are per-provider. Re-upload the file to the target and reference its own id.`,
      meta: { ref: part.data.ref, dialect: part.data.dialect },
    });
    return undefined;
  }
  const mediaType =
    part.mediaType ?? (part.data.kind === "url" ? inferMediaTypeFromUrl(part.data.url) : undefined);
  if (part.data.kind === "url") {
    if (mediaType !== undefined && !isImageMediaType(mediaType)) {
      warn({
        code: "dropped_content",
        path,
        message: `chat-completions can only reference remote media by URL for images; a remote \`${mediaType}\` part has no equivalent and was dropped. Inline it as base64 instead.`,
        meta: { mediaType },
      });
      return undefined;
    }
    return {
      type: "image_url",
      image_url: { url: part.data.url, ...imageDetailFor(part, path, warn) },
      ...cache,
    };
  }
  const base64 = part.data.base64;
  if (isImageMediaType(mediaType)) {
    return {
      type: "image_url",
      image_url: {
        url: toDataUrl(mediaType as string, base64),
        ...imageDetailFor(part, path, warn),
      },
      ...cache,
    };
  }
  warnNonImageDetail(part, mediaType, path, warn);
  if (isAudioMediaType(mediaType)) {
    const format = mediaType === "audio/wav" || mediaType === "audio/x-wav" ? "wav" : "mp3";
    return { type: "input_audio", input_audio: { data: base64, format }, ...cache };
  }
  return {
    type: "file",
    file: {
      file_data: toDataUrl(mediaType ?? "application/octet-stream", base64),
      ...(part.filename !== undefined && { filename: part.filename }),
    },
    ...cache,
  };
}

/**
 * This dialect hangs `detail` off `image_url` and nowhere else, so a hint on an
 * audio or document part has no slot. Gemini's per-`Part` `mediaResolution`
 * does apply to PDFs and video, so this is a real crossing cost rather than a
 * caller mistake — it is dropped by name, not silently.
 */
function warnNonImageDetail(
  part: Extract<IRPart, { type: "media" }>,
  mediaType: string | undefined,
  path: Array<string | number>,
  warn: Warn,
): void {
  if (part.detail === undefined) return;
  warn({
    code: "dropped_param",
    path: [...path, "detail"],
    message: `chat-completions carries a resolution hint only on images (\`image_url.detail\`), and this is a \`${mediaType ?? "application/octet-stream"}\` part; the media itself is carried, \`detail: "${part.detail}"\` is not.`,
    meta: { param: "detail", detail: part.detail },
  });
}

function decodeToolChoice(ir: ChatIR): ChatToolChoice | undefined {
  const choice = ir.toolChoice;
  if (choice === undefined) return undefined;
  switch (choice.mode) {
    case "auto":
      return "auto";
    case "none":
      return "none";
    case "required":
      return "required";
    case "tool":
      return { type: "function", function: { name: choice.name } };
  }
}

export function decodeOpenAIChat(
  ir: ChatIR,
  warn: Warn,
  ctx?: DecodeContext,
): ChatCompletionsBodyBase {
  const style = cacheStyle(ctx);
  const messages: ChatMessage[] = [];

  if (ir.system !== undefined && ir.system.length > 0) {
    const role = ownPassthrough(ir, DIALECT)["__system_role"] === "developer" ? "developer" : "system";
    // Build the parts first, then collapse: a breakpoint the target cannot
    // express is dropped by `cacheProps`, and once it is gone a single block
    // is just a string again — the plainest body that says the same thing.
    const parts: ChatTextPart[] = ir.system.map((block, i) => ({
      type: "text" as const,
      text: block.text,
      ...cacheProps(block, style, ["system", i], warn, ctx),
    }));
    const only = parts.length === 1 && parts[0]?.prompt_cache_breakpoint === undefined ? parts[0] : undefined;
    const content: string | ChatTextPart[] = only !== undefined ? only.text : parts;
    messages.push(role === "developer" ? { role, content } : { role: "system", content });
  }

  ir.messages.forEach((message: IRMessage, index) => {
    const path = (j: number): Array<string | number> => ["messages", index, "content", j];
    if (message.role === "assistant") {
      const texts: ChatTextPart[] = [];
      const toolCalls: NonNullable<ChatAssistantMessage["tool_calls"]> = [];
      message.content.forEach((part, j) => {
        switch (part.type) {
          case "text":
            texts.push({
              type: "text",
              text: part.text,
              ...cacheProps(part, style, path(j), warn, ctx),
            });
            break;
          case "tool-call":
            toolCalls.push({
              id: part.id,
              type: "function",
              function: {
                name: part.name,
                arguments: typeof part.input === "string" ? part.input : JSON.stringify(part.input ?? {}),
              },
            });
            break;
          case "reasoning":
            warn({
              code: "dropped_content",
              path: path(j),
              message:
                "assistant reasoning blocks (Anthropic `thinking`, Gemini thought parts, Bedrock `reasoningContent`) have no chat-completions representation and were dropped; the target model will not see the prior chain of thought.",
            });
            break;
          default:
            warn({
              code: "dropped_content",
              path: path(j),
              message: `an assistant \`${part.type}\` part has no chat-completions representation (assistant turns carry text and tool calls only) and was dropped.`,
            });
        }
      });
      const single = texts.length === 1 && texts[0]?.prompt_cache_breakpoint === undefined;
      const content =
        texts.length === 0 ? undefined : single ? (texts[0] as ChatTextPart).text : texts;
      messages.push({
        role: "assistant",
        ...(content !== undefined && { content }),
        ...(toolCalls.length > 0 && { tool_calls: toolCalls }),
      });
      return;
    }

    // User turn: tool results become their own `tool` messages, which is the
    // one genuinely structural mapping in this codec — one Anthropic/Bedrock
    // user message can split into N tool messages plus a user message.
    const rest: ChatUserContentPart[] = [];
    message.content.forEach((part, j) => {
      if (part.type === "tool-result") {
        const text = toolOutputToText(part.output, (dropped) => {
          warn({
            code: "dropped_content",
            path: path(j),
            message: `a \`${dropped.type}\` block inside a tool result has no chat-completions equivalent (tool messages are text-only) and was dropped.`,
          });
        });
        if (part.isError === true) {
          warn({
            code: "approximated_param",
            path: path(j),
            message:
              "chat-completions tool messages have no error flag; the failed tool result is prefixed with \"Error: \" so the model still sees it failed.",
          });
        }
        messages.push({
          role: "tool",
          tool_call_id: part.id,
          content: part.isError === true ? `Error: ${text}` : text,
        });
        return;
      }
      if (part.type === "text") {
        rest.push({ type: "text", text: part.text, ...cacheProps(part, style, path(j), warn, ctx) });
        return;
      }
      if (part.type === "media") {
        const decoded = decodeMediaPart(part, style, path(j), warn, ctx);
        if (decoded !== undefined) rest.push(decoded);
        return;
      }
      warn({
        code: "dropped_content",
        path: path(j),
        message: `a \`${part.type}\` part has no chat-completions representation in a user turn and was dropped.`,
      });
    });
    if (rest.length > 0) {
      const single = rest.length === 1 && rest[0]?.type === "text" && rest[0].prompt_cache_breakpoint === undefined;
      messages.push({
        role: "user",
        content: single ? (rest[0] as ChatTextPart).text : rest,
      });
    }
  });

  const body: ChatCompletionsBodyBase = {
    model: ctx?.targetModelId ?? ir.model,
    messages,
  };

  // Tools -------------------------------------------------------------------
  const tools: ChatTool[] = (ir.tools ?? []).map((tool) => {
    if (tool.cache !== undefined) {
      warn({
        code: "dropped_param",
        path: ["tools"],
        message: `the cache breakpoint on tool "${tool.name}" has no chat-completions equivalent and was dropped; the tool definition itself is carried.`,
      });
    }
    return {
      type: "function" as const,
      function: {
        name: tool.name,
        ...(tool.description !== undefined && { description: tool.description }),
        parameters: tool.parameters,
        ...(tool.strict !== undefined && { strict: tool.strict }),
      },
    };
  });
  for (const native of ownNativeTools(ir, DIALECT)) tools.push(native.raw as ChatTool);
  if (tools.length > 0) body.tools = tools;

  const toolChoice = decodeToolChoice(ir);
  if (toolChoice !== undefined) body.tool_choice = toolChoice;

  // Settings ----------------------------------------------------------------
  const s = ir.settings;
  if (s.maxOutputTokens !== undefined) body.max_completion_tokens = s.maxOutputTokens;
  if (s.temperature !== undefined) {
    // This dialect's ceiling is 2, so a value from the 0–1 dialect never
    // clamps; the guard exists so a future 0–2 → 0–1 direction is symmetric.
    body.temperature = Math.min(s.temperature, 2);
    if (s.temperature > 2) {
      warn({
        code: "approximated_param",
        path: ["temperature"],
        message: `temperature ${s.temperature} exceeds the chat-completions maximum of 2 and was clamped; sampling will be less random than the source request asked for.`,
        meta: { from: s.temperature, to: 2 },
      });
    }
  }
  if (s.topP !== undefined) body.top_p = s.topP;
  if (s.topK !== undefined) {
    warn({
      code: "dropped_param",
      path: ["top_k"],
      message:
        "`top_k` is not part of the OpenAI Chat Completions API; the gateways that accept it do so as an undocumented extension, so it was dropped rather than risk a 400 on the target.",
      meta: { top_k: s.topK },
    });
  }
  if (s.stopSequences !== undefined) body.stop = s.stopSequences;
  if (s.seed !== undefined) body.seed = s.seed;
  if (s.presencePenalty !== undefined) body.presence_penalty = s.presencePenalty;
  if (s.frequencyPenalty !== undefined) body.frequency_penalty = s.frequencyPenalty;
  if (s.candidates !== undefined) body.n = s.candidates;
  if (s.stream !== undefined) body.stream = s.stream;
  if (s.user !== undefined) body.user = s.user;
  if (s.parallelToolCalls !== undefined) body.parallel_tool_calls = s.parallelToolCalls;
  if (s.serviceTier !== undefined) body.service_tier = s.serviceTier;
  if (s.responseFormat !== undefined) {
    body.response_format =
      s.responseFormat.kind === "json"
        ? { type: "json_object" }
        : {
            type: "json_schema",
            json_schema: {
              name: s.responseFormat.name ?? "response",
              schema: s.responseFormat.schema,
              ...(s.responseFormat.strict !== undefined && { strict: s.responseFormat.strict }),
            },
          };
  }
  if (s.reasoning !== undefined) {
    if (s.reasoning.mode === "effort") body.reasoning_effort = s.reasoning.effort;
    else if (s.reasoning.mode === "budget") {
      const effort = s.reasoning.budgetTokens <= 2048 ? "low" : s.reasoning.budgetTokens <= 8192 ? "medium" : "high";
      body.reasoning_effort = effort;
      warn({
        code: "approximated_param",
        path: ["thinking", "budget_tokens"],
        message: `a ${s.reasoning.budgetTokens}-token reasoning budget has no chat-completions equivalent; it was bucketed to \`reasoning_effort: "${effort}"\`, which the target sizes on its own terms.`,
        meta: { budgetTokens: s.reasoning.budgetTokens, effort },
      });
    } else body.reasoning_effort = "none";
  }

  // This dialect's own params, re-emitted verbatim; every other dialect's are
  // warned about by name.
  for (const [key, value] of Object.entries(ownPassthrough(ir, DIALECT))) {
    if (key.startsWith("__")) continue;
    (body as unknown as Record<string, unknown>)[key] = value;
  }
  warnForeignExtras(ir, DIALECT, warn);

  return body;
}
