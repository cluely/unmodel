/**
 * The **anthropic-messages** dialect codec.
 *
 * This is the spoke behind the flagship path — `chat({model:"claude-opus-5"})
 * .toApi("openrouter")` — so three of its rules are worth stating where they
 * can be read next to the code:
 *
 * 1. **`temperature` keeps its source scale.** Anthropic's range is 0–1 while
 *    OpenAI's and Gemini's is 0–2, so `encodeAnthropic` stamps
 *    `temperatureMax: 1` and `decodeAnthropic` clamps a 0–2 value to 1 with an
 *    `approximated_param` warning *only when it actually exceeds 1*. Rescaling
 *    instead would silently change sampling on every request; clamping changes
 *    nothing for the overwhelming majority (temperature ≤ 1) and is loud when
 *    it does.
 * 2. **`max_tokens` is required here and optional everywhere else**, so
 *    decoding a body that never had one has to invent it. The invention is
 *    bounded by the generated availability metadata when there is any
 *    (`DecodeContext.narrows`) and always carries an `approximated_param`
 *    warning naming the number and where it came from. Refusing outright was
 *    the alternative and is worse: a translation that throws is a translation
 *    you cannot inspect.
 * 3. **Anthropic's `tool_result` blocks ride on user messages**, which is
 *    exactly the IR's shape, so this direction is structure-preserving; the
 *    splitting into `tool`-role messages happens in the openai-chat codec.
 *
 * Import-graph rule 5: only `src/core/translate/**` and this directory.
 */
import type { ChatIR, DecodeContext, IRPart, IRTextBlock } from "../../core/translate/ir";
import {
  emptyIR,
  inferMediaTypeFromUrl,
  base64ToText,
  isImageMediaType,
  ownNativeTools,
  ownPassthrough,
  putPassthrough,
  textToBase64,
  toolOutputToText,
  warnForeignExtras,
} from "../../core/translate/ir";
import type { Warn } from "../../core/translate/warnings";
import type {
  CacheControlEphemeral,
  ContentBlock,
  CustomTool,
  DocumentBlock,
  ImageBlock,
  ImageMediaType,
  MessageParam,
  MessagesBody,
  TextBlock,
  Tool,
  ToolChoice,
  ToolResultBlock,
} from "./wire";

const DIALECT = "anthropic-messages" as const;

/**
 * Anthropic requires `max_tokens`. When the source dialect had none, this is
 * the floor the decoder falls back to — deliberately conservative (it is the
 * value every Claude model can serve) and always accompanied by a warning, so
 * "unexpectedly truncated at 4096" is never a silent outcome.
 */
export const INVENTED_MAX_TOKENS = 4096;

/** Params this codec maps; everything else is swept into `passthrough`. */
const MAPPED_KEYS: ReadonlySet<string> = new Set([
  "model",
  "messages",
  "max_tokens",
  "system",
  "temperature",
  "top_p",
  "top_k",
  "stop_sequences",
  "stream",
  "tools",
  "tool_choice",
  "thinking",
  "metadata",
  "service_tier",
  "output_config",
]);

const IMAGE_MEDIA_TYPES: ReadonlySet<string> = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

// ---------------------------------------------------------------------------
// Encode: /v1/messages body → ChatIR
// ---------------------------------------------------------------------------

function cacheOf(control: CacheControlEphemeral | null | undefined): { cache?: { kind: "ephemeral"; ttl?: "5m" | "1h" } } {
  if (control == null) return {};
  return { cache: { kind: "ephemeral", ...(control.ttl !== undefined && { ttl: control.ttl }) } };
}

function systemBlocks(system: string | TextBlock[]): IRTextBlock[] {
  if (typeof system === "string") return [{ text: system }];
  return system.map((block) => ({ text: block.text, ...cacheOf(block.cache_control) }));
}

/**
 * @param toolNames tool_use id → name, filled in as the encoder walks the
 * conversation. Anthropic's `tool_result` blocks carry only the id, while the
 * IR (and therefore Gemini's `functionResponse.name` and the AI SDK's
 * `toolName`) needs the name — so it is recovered from the call that the
 * result answers.
 */
function encodeBlock(
  block: ContentBlock,
  path: Array<string | number>,
  toolNames: Map<string, string>,
  warn: Warn,
): IRPart | undefined {
  switch (block.type) {
    case "text":
      return { type: "text", text: block.text, ...cacheOf(block.cache_control) };
    case "image": {
      const source = block.source;
      if (source.type === "base64") {
        return {
          type: "media",
          mediaType: source.media_type,
          data: { kind: "base64", base64: source.data },
          ...cacheOf(block.cache_control),
        };
      }
      if (source.type === "url") {
        return {
          type: "media",
          data: { kind: "url", url: source.url },
          ...cacheOf(block.cache_control),
        };
      }
      return {
        type: "media",
        data: { kind: "file", dialect: DIALECT, ref: source.file_id },
        ...cacheOf(block.cache_control),
      };
    }
    case "document": {
      const source = block.source;
      const title = block.title != null ? { filename: block.title } : {};
      if (source.type === "base64") {
        return {
          type: "media",
          mediaType: source.media_type,
          data: { kind: "base64", base64: source.data },
          ...title,
          ...cacheOf(block.cache_control),
        };
      }
      if (source.type === "text") {
        return {
          type: "media",
          mediaType: "text/plain",
          // Anthropic's plain-text document source carries the text inline,
          // not base64; every other dialect wants bytes, so encode it.
          data: { kind: "base64", base64: textToBase64(source.data) },
          ...title,
          ...cacheOf(block.cache_control),
        };
      }
      if (source.type === "url") {
        return {
          type: "media",
          data: { kind: "url", url: source.url },
          ...title,
          ...cacheOf(block.cache_control),
        };
      }
      if (source.type === "file") {
        return {
          type: "media",
          data: { kind: "file", dialect: DIALECT, ref: source.file_id },
          ...title,
          ...cacheOf(block.cache_control),
        };
      }
      warn({
        code: "dropped_content",
        path,
        message:
          "a `document` block with a `content` source (inline blocks rather than bytes) is an Anthropic-only shape with no equivalent in the other dialects; it was dropped.",
      });
      return undefined;
    }
    case "tool_use":
      toolNames.set(block.id, block.name);
      return {
        type: "tool-call",
        id: block.id,
        name: block.name,
        input: block.input,
        ...cacheOf(block.cache_control),
      };
    case "tool_result": {
      const content = block.content;
      const output =
        content === undefined
          ? { kind: "text" as const, text: "" }
          : typeof content === "string"
            ? { kind: "text" as const, text: content }
            : {
                kind: "content" as const,
                parts: content
                  .map((inner, k) => encodeBlock(inner, [...path, "content", k], toolNames, warn))
                  .filter((part): part is IRPart => part !== undefined),
              };
      // A single text block is semantically identical to the string form; the
      // IR normalizes so an Anthropic fixture and an OpenAI one converge.
      const normalized =
        output.kind === "content" && output.parts.length === 1 && output.parts[0]?.type === "text"
          ? { kind: "text" as const, text: (output.parts[0] as { text: string }).text }
          : output;
      const name = toolNames.get(block.tool_use_id);
      return {
        type: "tool-result",
        id: block.tool_use_id,
        ...(name !== undefined && { name }),
        output: normalized,
        ...(block.is_error === true && { isError: true }),
      };
    }
    case "thinking":
      return { type: "reasoning", text: block.thinking, signature: block.signature };
    case "redacted_thinking":
      return { type: "reasoning", redacted: block.data };
  }
}

function isCustomTool(tool: Tool): tool is CustomTool {
  return (tool as CustomTool).input_schema !== undefined;
}

export function encodeAnthropic(body: MessagesBody, warn: Warn): ChatIR {
  const ir = emptyIR(DIALECT, body.model);

  if (body.system !== undefined) ir.system = systemBlocks(body.system);

  const toolNames = new Map<string, string>();
  body.messages.forEach((message: MessageParam, index) => {
    const content = message.content;
    if (typeof content === "string") {
      ir.messages.push({ role: message.role, content: [{ type: "text", text: content }] });
      return;
    }
    const parts: IRPart[] = [];
    content.forEach((block, j) => {
      const part = encodeBlock(block, ["messages", index, "content", j], toolNames, warn);
      if (part !== undefined) parts.push(part);
    });
    ir.messages.push({ role: message.role, content: parts });
  });

  for (const tool of body.tools ?? []) {
    if (isCustomTool(tool)) {
      ir.tools ??= [];
      ir.tools.push({
        kind: "function",
        name: tool.name,
        ...(tool.description !== undefined && { description: tool.description }),
        parameters: tool.input_schema as Record<string, unknown>,
        ...(tool.strict !== undefined && { strict: tool.strict }),
        ...cacheOf(tool.cache_control),
      });
    } else {
      ir.nativeTools ??= [];
      ir.nativeTools.push({ kind: "native", dialect: DIALECT, name: tool.name, raw: tool });
    }
  }

  const choice = body.tool_choice;
  if (choice !== undefined) {
    switch (choice.type) {
      case "auto":
        ir.toolChoice = { mode: "auto" };
        break;
      case "any":
        ir.toolChoice = { mode: "required" };
        break;
      case "none":
        ir.toolChoice = { mode: "none" };
        break;
      case "tool":
        ir.toolChoice = { mode: "tool", name: choice.name };
        break;
    }
    if (choice.type !== "none" && choice.disable_parallel_tool_use !== undefined) {
      ir.settings.parallelToolCalls = !choice.disable_parallel_tool_use;
    }
  }

  const s = ir.settings;
  s.maxOutputTokens = body.max_tokens;
  if (body.temperature !== undefined) {
    s.temperature = body.temperature;
    s.temperatureMax = 1;
  }
  if (body.top_p !== undefined) s.topP = body.top_p;
  if (body.top_k !== undefined) s.topK = body.top_k;
  if (body.stop_sequences !== undefined) s.stopSequences = body.stop_sequences;
  if (body.stream !== undefined) s.stream = body.stream;
  if (body.metadata?.user_id != null) s.user = body.metadata.user_id;
  if (body.service_tier !== undefined) s.serviceTier = body.service_tier;

  const thinking = body.thinking;
  if (thinking !== undefined) {
    if (thinking.type === "enabled") {
      s.reasoning = { mode: "budget", budgetTokens: thinking.budget_tokens };
      if (thinking.display != null) putPassthrough(ir, DIALECT, "__thinking_display", thinking.display);
    } else if (thinking.type === "disabled") {
      s.reasoning = { mode: "off" };
    } else {
      // "adaptive" has no cross-dialect analogue: it is neither a budget nor
      // an effort bucket, so it rides as an Anthropic-only param.
      putPassthrough(ir, DIALECT, "thinking", thinking);
    }
  }

  const outputConfig = body.output_config;
  if (outputConfig !== undefined) {
    const { effort, format, ...rest } = outputConfig;
    if (effort !== undefined && s.reasoning === undefined) s.reasoning = { mode: "effort", effort };
    if (format !== undefined) {
      const schema = format["schema"];
      if (typeof schema === "object" && schema !== null) {
        s.responseFormat = {
          kind: "json-schema",
          ...(typeof format["name"] === "string" && { name: format["name"] }),
          schema: schema as Record<string, unknown>,
        };
      } else putPassthrough(ir, DIALECT, "__output_format", format);
    }
    if (Object.keys(rest).length > 0) putPassthrough(ir, DIALECT, "__output_config_rest", rest);
  }

  if (body.metadata !== undefined) {
    const { user_id: _userId, ...rest } = body.metadata;
    if (Object.keys(rest).length > 0) putPassthrough(ir, DIALECT, "__metadata_rest", rest);
  }

  for (const [key, value] of Object.entries(body as unknown as Record<string, unknown>)) {
    if (MAPPED_KEYS.has(key) || value === undefined) continue;
    putPassthrough(ir, DIALECT, key, value);
  }

  return ir;
}

// ---------------------------------------------------------------------------
// Decode: ChatIR → /v1/messages body
// ---------------------------------------------------------------------------

function cacheControl(part: { cache?: { kind: "ephemeral"; ttl?: "5m" | "1h" } }): {
  cache_control?: CacheControlEphemeral;
} {
  if (part.cache === undefined) return {};
  return {
    cache_control: { type: "ephemeral", ...(part.cache.ttl !== undefined && { ttl: part.cache.ttl }) },
  };
}

function decodeMedia(
  part: Extract<IRPart, { type: "media" }>,
  path: Array<string | number>,
  warn: Warn,
): ImageBlock | DocumentBlock | undefined {
  const cache = cacheControl(part);
  const mediaType =
    part.mediaType ?? (part.data.kind === "url" ? inferMediaTypeFromUrl(part.data.url) : undefined);

  if (part.data.kind === "file") {
    if (part.data.dialect === DIALECT) {
      return { type: "image", source: { type: "file", file_id: part.data.ref }, ...cache };
    }
    warn({
      code: "dropped_content",
      path,
      message: `a ${part.data.dialect} file handle ("${part.data.ref}") cannot be carried to Anthropic — file-id namespaces are per-provider. Upload the file to Anthropic's Files API and reference its own id.`,
      meta: { ref: part.data.ref, dialect: part.data.dialect },
    });
    return undefined;
  }

  if (part.data.kind === "url") {
    if (mediaType !== undefined && mediaType === "application/pdf") {
      return { type: "document", source: { type: "url", url: part.data.url }, ...cache };
    }
    if (mediaType === undefined || isImageMediaType(mediaType)) {
      return { type: "image", source: { type: "url", url: part.data.url }, ...cache };
    }
    warn({
      code: "dropped_content",
      path,
      message: `Anthropic accepts remote URLs only for images and PDFs; a remote \`${mediaType}\` part has no equivalent and was dropped.`,
      meta: { mediaType },
    });
    return undefined;
  }

  if (mediaType !== undefined && IMAGE_MEDIA_TYPES.has(mediaType)) {
    return {
      type: "image",
      source: { type: "base64", media_type: mediaType as ImageMediaType, data: part.data.base64 },
      ...cache,
    };
  }
  if (mediaType === "application/pdf") {
    return {
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: part.data.base64 },
      ...(part.filename !== undefined && { title: part.filename }),
      ...cache,
    };
  }
  if (mediaType === "text/plain") {
    return {
      type: "document",
      source: { type: "text", media_type: "text/plain", data: base64ToText(part.data.base64) },
      ...(part.filename !== undefined && { title: part.filename }),
      ...cache,
    };
  }
  warn({
    code: "dropped_content",
    path,
    message: `Anthropic's /v1/messages accepts images (jpeg, png, gif, webp), PDFs and plain text as content blocks; a \`${mediaType ?? "type-less"}\` part has no equivalent and was dropped.`,
    meta: { mediaType },
  });
  return undefined;
}

function decodeToolResultContent(
  part: Extract<IRPart, { type: "tool-result" }>,
  path: Array<string | number>,
  warn: Warn,
): ToolResultBlock {
  const output = part.output;
  if (output.kind === "content") {
    const blocks: Array<TextBlock | ImageBlock | DocumentBlock> = [];
    output.parts.forEach((inner, k) => {
      if (inner.type === "text") blocks.push({ type: "text", text: inner.text });
      else if (inner.type === "media") {
        const decoded = decodeMedia(inner, [...path, "content", k], warn);
        if (decoded !== undefined) blocks.push(decoded);
      } else {
        warn({
          code: "dropped_content",
          path: [...path, "content", k],
          message: `a \`${inner.type}\` block inside a tool result has no Anthropic representation and was dropped.`,
        });
      }
    });
    return {
      type: "tool_result",
      tool_use_id: part.id,
      content: blocks,
      ...(part.isError === true && { is_error: true }),
    };
  }
  return {
    type: "tool_result",
    tool_use_id: part.id,
    content: toolOutputToText(output),
    ...(part.isError === true && { is_error: true }),
  };
}

/**
 * The `max_tokens` invention rule. Order of preference:
 * 1. what the source asked for;
 * 2. the target's context window from the generated `narrows` metadata,
 *    capped so an invented cap never exceeds what the target serves;
 * 3. `INVENTED_MAX_TOKENS`.
 *
 * Steps 2 and 3 warn. Note this deliberately does **not** import the target's
 * catalog: that import is precisely what the per-provider availability data
 * exists to avoid.
 */
function resolveMaxTokens(ir: ChatIR, ctx: DecodeContext | undefined, warn: Warn): number {
  const asked = ir.settings.maxOutputTokens;
  if (asked !== undefined) return asked;
  const context = ctx?.narrows?.context;
  const invented = context !== undefined ? Math.min(INVENTED_MAX_TOKENS, context) : INVENTED_MAX_TOKENS;
  warn({
    code: "approximated_param",
    path: ["max_tokens"],
    message: `Anthropic's /v1/messages requires \`max_tokens\` and the source request did not set an output cap, so ${invented} was used${context !== undefined ? ` (bounded by the ${context}-token window the availability data records for this target)` : ""}. Set an explicit output limit on the source request to control it.`,
    meta: { max_tokens: invented, ...(context !== undefined && { context }) },
  });
  return invented;
}

export function decodeAnthropic(ir: ChatIR, warn: Warn, ctx?: DecodeContext): MessagesBody {
  const messages: MessageParam[] = [];

  ir.messages.forEach((message, index) => {
    const blocks: ContentBlock[] = [];
    message.content.forEach((part, j) => {
      const path: Array<string | number> = ["messages", index, "content", j];
      switch (part.type) {
        case "text":
          blocks.push({ type: "text", text: part.text, ...cacheControl(part) });
          break;
        case "media": {
          const decoded = decodeMedia(part, path, warn);
          if (decoded !== undefined) blocks.push(decoded);
          break;
        }
        case "tool-call":
          blocks.push({
            type: "tool_use",
            id: part.id,
            name: part.name,
            input:
              typeof part.input === "object" && part.input !== null
                ? (part.input as Record<string, unknown>)
                : { value: part.input },
            ...cacheControl(part),
          });
          break;
        case "tool-result":
          blocks.push(decodeToolResultContent(part, path, warn));
          break;
        case "reasoning":
          if (part.redacted !== undefined) {
            blocks.push({ type: "redacted_thinking", data: part.redacted });
          } else if (part.signature !== undefined) {
            blocks.push({ type: "thinking", thinking: part.text ?? "", signature: part.signature });
          } else {
            // Anthropic rejects `thinking` blocks without their signature —
            // the signature is what proves the block was model-generated.
            warn({
              code: "dropped_content",
              path,
              message:
                "a reasoning block without a signature cannot be replayed to Anthropic (it verifies the signature on every thinking block), so it was dropped.",
            });
          }
          break;
      }
    });
    messages.push({ role: message.role, content: blocks });
  });

  // Anthropic requires the conversation to start with a user turn, and a
  // tool-result-only turn from another dialect can leave one that does not.
  const body: MessagesBody = {
    model: ctx?.targetModelId ?? ir.model,
    max_tokens: resolveMaxTokens(ir, ctx, warn),
    messages,
  };

  if (ir.system !== undefined && ir.system.length > 0) {
    const only = ir.system.length === 1 ? ir.system[0] : undefined;
    body.system =
      only !== undefined && only.cache === undefined
        ? only.text
        : ir.system.map((block) => ({ type: "text" as const, text: block.text, ...cacheControl(block) }));
  }

  const tools: Tool[] = (ir.tools ?? []).map((tool) => ({
    name: tool.name,
    ...(tool.description !== undefined && { description: tool.description }),
    input_schema: {
      type: "object" as const,
      ...(tool.parameters as Record<string, unknown>),
    },
    ...(tool.strict !== undefined && { strict: tool.strict }),
    ...cacheControl(tool),
  }));
  for (const native of ownNativeTools(ir, DIALECT)) tools.push(native.raw as Tool);
  if (tools.length > 0) body.tools = tools;

  const parallel = ir.settings.parallelToolCalls;
  const disable = parallel === false ? { disable_parallel_tool_use: true } : {};
  const choice = ir.toolChoice;
  if (choice !== undefined) {
    const toolChoice: ToolChoice =
      choice.mode === "auto"
        ? { type: "auto", ...disable }
        : choice.mode === "required"
          ? { type: "any", ...disable }
          : choice.mode === "none"
            ? { type: "none" }
            : { type: "tool", name: choice.name, ...disable };
    body.tool_choice = toolChoice;
  } else if (parallel === false) {
    warn({
      code: "dropped_param",
      path: ["parallel_tool_calls"],
      message:
        "`parallel_tool_calls: false` is expressed on Anthropic as `tool_choice.disable_parallel_tool_use`, which needs a `tool_choice`; the source request set neither, so the flag was dropped.",
    });
  }

  const s = ir.settings;
  if (s.temperature !== undefined) {
    const clamped = Math.min(s.temperature, 1);
    body.temperature = clamped;
    if (s.temperature > 1) {
      warn({
        code: "approximated_param",
        path: ["temperature"],
        message: `temperature ${s.temperature} is on the source's 0–${s.temperatureMax ?? 2} scale, but Anthropic's maximum is 1; it was clamped to 1 rather than rescaled, so sampling will be less random than the source request asked for.`,
        meta: { from: s.temperature, to: clamped },
      });
    }
  }
  if (s.topP !== undefined) body.top_p = s.topP;
  if (s.topK !== undefined) body.top_k = s.topK;
  if (s.stopSequences !== undefined) body.stop_sequences = s.stopSequences;
  if (s.stream !== undefined) body.stream = s.stream;
  if (s.user !== undefined) body.metadata = { user_id: s.user };
  if (s.serviceTier === "auto" || s.serviceTier === "standard_only") {
    body.service_tier = s.serviceTier;
  } else if (s.serviceTier !== undefined) {
    warn({
      code: "approximated_param",
      path: ["service_tier"],
      message: `\`service_tier: "${s.serviceTier}"\` is not one of Anthropic's values ("auto", "standard_only"); it was dropped and the account default applies.`,
      meta: { service_tier: s.serviceTier },
    });
  }
  if (s.seed !== undefined) {
    warn({
      code: "dropped_param",
      path: ["seed"],
      message: "`seed` has no Anthropic equivalent (the API documents no determinism control); it was dropped.",
    });
  }
  if (s.presencePenalty !== undefined || s.frequencyPenalty !== undefined) {
    warn({
      code: "dropped_param",
      path: [s.presencePenalty !== undefined ? "presence_penalty" : "frequency_penalty"],
      message:
        "`presence_penalty` / `frequency_penalty` have no Anthropic equivalent; they were dropped. Use `stop_sequences` or prompt guidance instead.",
    });
  }
  if (s.candidates !== undefined && s.candidates > 1) {
    warn({
      code: "dropped_param",
      path: ["n"],
      message: `Anthropic's /v1/messages returns exactly one completion; \`n: ${s.candidates}\` was dropped. Issue ${s.candidates} requests to get ${s.candidates} candidates.`,
      meta: { n: s.candidates },
    });
  }

  const reasoning = s.reasoning;
  if (reasoning !== undefined) {
    if (reasoning.mode === "budget") {
      body.thinking = { type: "enabled", budget_tokens: reasoning.budgetTokens };
      const display = ownPassthrough(ir, DIALECT)["__thinking_display"];
      if (display === "summarized" || display === "omitted") body.thinking.display = display;
    } else if (reasoning.mode === "off") {
      body.thinking = { type: "disabled" };
    } else {
      // Anthropic's own effort vocabulary, so an effort bucket maps directly
      // when it is one of theirs; anything else is a foreign bucket name.
      const effort = reasoning.effort;
      if (effort === "low" || effort === "medium" || effort === "high" || effort === "xhigh" || effort === "max") {
        body.output_config = { ...body.output_config, effort };
      } else {
        warn({
          code: "approximated_param",
          path: ["reasoning_effort"],
          message: `\`reasoning_effort: "${effort}"\` is not one of Anthropic's effort levels (low, medium, high, xhigh, max); extended thinking was left off and the model decides on its own.`,
          meta: { effort },
        });
      }
    }
  }

  if (s.responseFormat !== undefined) {
    if (s.responseFormat.kind === "json-schema") {
      body.output_config = {
        ...body.output_config,
        format: {
          type: "json_schema",
          ...(s.responseFormat.name !== undefined && { name: s.responseFormat.name }),
          schema: s.responseFormat.schema,
        },
      };
    } else {
      warn({
        code: "approximated_param",
        path: ["response_format"],
        message:
          "`response_format: { type: \"json_object\" }` (JSON mode without a schema) has no Anthropic equivalent — Anthropic's structured outputs require a schema. It was dropped; state the JSON requirement in the system prompt or supply a schema.",
      });
    }
  }

  for (const [key, value] of Object.entries(ownPassthrough(ir, DIALECT))) {
    if (key.startsWith("__")) continue;
    (body as unknown as Record<string, unknown>)[key] = value;
  }
  warnForeignExtras(ir, DIALECT, warn);

  return body;
}
