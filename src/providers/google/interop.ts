/**
 * The **gemini** dialect codec.
 *
 * The one structural problem this codec exists to solve: **Gemini's
 * `functionCall` parts carry no id**, while all three other dialects require
 * one to pair a call with its result. So `encodeGemini` *synthesizes*
 * deterministic ids (`gemini_call_<messageIndex>_<partIndex>`), pairs
 * `functionResponse` parts to them by name and order, and emits a
 * `synthesized_tool_call_id` warning for each. Without that, every
 * Gemini → (anything) tool conversation is broken.
 *
 * `decodeGemini` is the inverse and deliberately **omits** ids it recognises
 * as synthesized, so `decodeGemini(encodeGemini(x))` is exactly `x` again
 * (minus `model`, which Gemini carries in the URL path, not the body). Ids
 * that came from another dialect are written through, since Gemini accepts an
 * explicit `functionCall.id`.
 *
 * The second structural problem is `fileData.fileUri`, which is **two things
 * wearing one field name**. A Files API URI (`…googleapis.com/…/files/…`) or a
 * `gs://` Cloud Storage URI is a provider-scoped handle that resolves only
 * with the caller's Google credentials, so it becomes `IRData`'s
 * `{ kind: "file", dialect: "gemini" }` and every foreign decoder drops it
 * with a warning; anything else is a plain `{ kind: "url" }`. In reverse,
 * Gemini will not fetch an arbitrary web URL — `fileData` resolves only those
 * two forms plus YouTube links — so writing one in is an `approximated_param`,
 * not a lossless carry. Both directions used to translate with *zero*
 * warnings, i.e. asserted lossless while producing requests the target
 * rejects.
 *
 * The other judgement call is tool results. Gemini's `functionResponse.response`
 * is a JSON object while the other dialects' tool results are text, so the
 * single-key forms `{ result: "…" }` and `{ error: "…" }` are treated as the
 * canonical wrappers: they unwrap to an IR text output on the way in and are
 * rebuilt on the way out. Anything richer stays a JSON output untouched.
 *
 * Import-graph rule 5: only `src/core/translate/**` and this directory.
 */
import type { ChatIR, DecodeContext, IRPart, IRTextBlock } from "../../core/translate/ir";
import {
  emptyIR,
  inferMediaTypeFromUrl,
  ownNativeTools,
  ownPassthrough,
  putPassthrough,
  toolOutputToText,
  warnForeignExtras,
} from "../../core/translate/ir";
import type { Warn } from "../../core/translate/warnings";
import type {
  GenerateContentBody,
  GoogleContent,
  GoogleFunctionDeclaration,
  GoogleGenerationConfig,
  GooglePart,
  GoogleServiceTier,
  GoogleThinkingConfig,
  GoogleTool,
} from "./wire";

const DIALECT = "gemini" as const;

/** The wire body a decode produces: Gemini keeps the model id in the URL path. */
export type GeminiWireBody = Omit<GenerateContentBody, "model">;

/** Prefix marking an id this codec invented rather than one the wire carried. */
export const SYNTHESIZED_ID_PREFIX = "gemini_call_";

const synthesizedId = (message: number, part: number): string =>
  `${SYNTHESIZED_ID_PREFIX}${message}_${part}`;

const isSynthesizedId = (id: string): boolean => id.startsWith(SYNTHESIZED_ID_PREFIX);

/** `"models/gemini-3-pro"` → `"gemini-3-pro"`. */
function stripModelsPrefix(modelId: string): string {
  return modelId.startsWith("models/") ? modelId.slice("models/".length) : modelId;
}

/**
 * `fileData.fileUri` is two different things wearing one field name, and the
 * IR distinguishes them where the wire does not.
 *
 * - A **Files API URI** (`https://generativelanguage.googleapis.com/v1beta/files/…`)
 *   or a **Cloud Storage URI** (`gs://…`, the Vertex form) is a *provider-scoped
 *   handle*: it resolves only with the caller's Google credentials and is
 *   namespaced to their project. Handing one to Anthropic or OpenAI produces a
 *   URL they cannot fetch — which is exactly what `IRData`'s `kind: "file"`
 *   arm exists to record, so the other decoders can drop it *with a warning*
 *   instead of emitting a dead link silently.
 * - Anything else (a public `http(s)` asset, a YouTube link) is a plain remote
 *   URL and stays `kind: "url"`.
 */
const GEMINI_FILES_API = /^https:\/\/[a-z0-9-]*\.?googleapis\.com\/[^\s]*\/files\//i;

export function isGeminiFileHandle(uri: string): boolean {
  return uri.startsWith("gs://") || GEMINI_FILES_API.test(uri);
}

/**
 * The remote URLs Gemini's `fileData` can actually resolve. Gemini does *not*
 * fetch arbitrary web URLs: it accepts its own Files API URIs, Cloud Storage
 * URIs on Vertex, and YouTube links. Everything else must be inlined as
 * `inlineData`, so writing it into `fileData` produces a request the API
 * rejects — hence the decoder warns rather than pretending it is lossless.
 */
const YOUTUBE = /^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i;

function isGeminiFetchableUrl(uri: string): boolean {
  return isGeminiFileHandle(uri) || YOUTUBE.test(uri);
}

/** Top-level params this codec maps; the rest is swept into `passthrough`. */
const MAPPED_KEYS: ReadonlySet<string> = new Set([
  "model",
  "contents",
  "systemInstruction",
  "tools",
  "toolConfig",
  "generationConfig",
]);

/** `generationConfig` fields this codec maps; the rest rides in `passthrough`. */
const MAPPED_GENERATION_KEYS: ReadonlySet<string> = new Set([
  "maxOutputTokens",
  "temperature",
  "topP",
  "topK",
  "stopSequences",
  "seed",
  "candidateCount",
  "presencePenalty",
  "frequencyPenalty",
  "responseMimeType",
  "responseSchema",
  "responseJsonSchema",
  "thinkingConfig",
]);

/** Provider-defined tool keys on a `GoogleTool`; each becomes an `IRNativeTool`. */
const NATIVE_TOOL_KEYS = [
  "googleSearch",
  "googleSearchRetrieval",
  "codeExecution",
  "urlContext",
  "fileSearch",
  "computerUse",
  "googleMaps",
  "mcpServers",
] as const;

// ---------------------------------------------------------------------------
// Encode: generateContent body → ChatIR
// ---------------------------------------------------------------------------

interface PendingCall {
  id: string;
  name: string;
  consumed: boolean;
}

function encodePart(
  part: GooglePart,
  path: Array<string | number>,
  messageIndex: number,
  partIndex: number,
  pending: PendingCall[],
  warn: Warn,
): IRPart | undefined {
  if (part.videoMetadata !== undefined || part.mediaResolution !== undefined) {
    warn({
      code: "dropped_param",
      path,
      message:
        "Gemini's per-part `videoMetadata` / `mediaResolution` hints have no equivalent in the other dialects; the media itself is carried, the hints are not.",
    });
  }
  if (part.text !== undefined) {
    if (part.thought === true) {
      return {
        type: "reasoning",
        text: part.text,
        ...(part.thoughtSignature !== undefined && { signature: part.thoughtSignature }),
      };
    }
    return { type: "text", text: part.text };
  }
  if (part.inlineData !== undefined) {
    return {
      type: "media",
      mediaType: part.inlineData.mimeType,
      data: { kind: "base64", base64: part.inlineData.data },
    };
  }
  if (part.fileData !== undefined) {
    const { fileUri, mimeType } = part.fileData;
    return {
      type: "media",
      ...(mimeType !== undefined && { mediaType: mimeType }),
      data: isGeminiFileHandle(fileUri)
        ? { kind: "file", dialect: DIALECT, ref: fileUri }
        : { kind: "url", url: fileUri },
    };
  }
  if (part.functionCall !== undefined) {
    const call = part.functionCall;
    const id = call.id ?? synthesizedId(messageIndex, partIndex);
    if (call.id === undefined) {
      warn({
        code: "synthesized_tool_call_id",
        path,
        message: `Gemini's \`functionCall\` parts carry no id, but every other dialect pairs a tool result to its call by id; "${id}" was synthesized deterministically from the message and part index for "${call.name}".`,
        meta: { id, name: call.name },
      });
    }
    pending.push({ id, name: call.name, consumed: false });
    return { type: "tool-call", id, name: call.name, input: call.args ?? {} };
  }
  if (part.functionResponse !== undefined) {
    const response = part.functionResponse;
    const match =
      response.id !== undefined
        ? pending.find((call) => call.id === response.id)
        : pending.find((call) => call.name === response.name && !call.consumed);
    if (match !== undefined) match.consumed = true;
    const keys = Object.keys(response.response);
    const only = keys.length === 1 ? keys[0] : undefined;
    const value = only === undefined ? undefined : response.response[only];
    const isText = typeof value === "string" && (only === "result" || only === "error");
    return {
      type: "tool-result",
      id: match?.id ?? response.id ?? response.name,
      name: response.name,
      output: isText
        ? { kind: "text", text: value as string }
        : { kind: "json", value: response.response },
      ...(isText && only === "error" && { isError: true }),
    };
  }
  const kind = part.executableCode !== undefined
    ? "executableCode"
    : part.codeExecutionResult !== undefined
      ? "codeExecutionResult"
      : part.toolCall !== undefined
        ? "toolCall"
        : part.toolResponse !== undefined
          ? "toolResponse"
          : "unknown";
  warn({
    code: "dropped_content",
    path,
    message: `a \`${kind}\` part belongs to Gemini's server-side tool loop and has no equivalent in the other dialects; it was dropped.`,
    meta: { kind },
  });
  return undefined;
}

export function encodeGemini(body: GenerateContentBody, warn: Warn): ChatIR {
  const ir = emptyIR(DIALECT, stripModelsPrefix(body.model));

  if (body.systemInstruction !== undefined) {
    const blocks: IRTextBlock[] = [];
    body.systemInstruction.parts.forEach((part, j) => {
      if (part.text !== undefined) blocks.push({ text: part.text });
      else {
        warn({
          code: "dropped_content",
          path: ["systemInstruction", "parts", j],
          message:
            "a non-text part in `systemInstruction` has no equivalent in the other dialects' system prompts (they are text-only) and was dropped.",
        });
      }
    });
    if (blocks.length > 0) ir.system = blocks;
  }

  const pending: PendingCall[] = [];
  body.contents.forEach((content: GoogleContent, index) => {
    const role = content.role === "model" ? "assistant" : "user";
    const parts: IRPart[] = [];
    content.parts.forEach((part, j) => {
      const encoded = encodePart(part, ["contents", index, "parts", j], index, j, pending, warn);
      if (encoded !== undefined) parts.push(encoded);
    });
    ir.messages.push({ role, content: parts });
  });

  for (const tool of body.tools ?? []) {
    for (const declaration of tool.functionDeclarations ?? []) {
      ir.tools ??= [];
      ir.tools.push({
        kind: "function",
        name: declaration.name,
        ...(declaration.description !== undefined && { description: declaration.description }),
        parameters:
          declaration.parameters ??
          ((declaration.parametersJsonSchema as Record<string, unknown> | undefined) ?? {
            type: "object",
            properties: {},
          }),
      });
      if (declaration.parameters === undefined && declaration.parametersJsonSchema !== undefined) {
        putPassthrough(ir, DIALECT, "__parameters_field", "parametersJsonSchema");
      }
    }
    for (const key of NATIVE_TOOL_KEYS) {
      if (tool[key] === undefined) continue;
      ir.nativeTools ??= [];
      ir.nativeTools.push({ kind: "native", dialect: DIALECT, name: key, raw: { [key]: tool[key] } });
    }
  }

  const config = body.toolConfig?.functionCallingConfig;
  if (config !== undefined) {
    const allowed = config.allowedFunctionNames ?? [];
    switch (config.mode) {
      case "AUTO":
      case undefined:
        ir.toolChoice = { mode: "auto" };
        break;
      case "NONE":
        ir.toolChoice = { mode: "none" };
        break;
      case "ANY":
        if (allowed.length === 1) ir.toolChoice = { mode: "tool", name: allowed[0] as string };
        else {
          ir.toolChoice = { mode: "required" };
          if (allowed.length > 1) {
            warn({
              code: "approximated_param",
              path: ["toolConfig", "functionCallingConfig", "allowedFunctionNames"],
              message: `Gemini can restrict forced tool use to a subset (${allowed.join(", ")}); the other dialects can only force "one of all declared tools" or one named tool, so the restriction was widened to "any tool".`,
              meta: { allowed: [...allowed] },
            });
          }
        }
        break;
      default:
        ir.toolChoice = { mode: "auto" };
        warn({
          code: "approximated_param",
          path: ["toolConfig", "functionCallingConfig", "mode"],
          message: `\`functionCallingConfig.mode: "${config.mode}"\` is Gemini-only; it was approximated as "auto" for the target.`,
          meta: { mode: config.mode },
        });
    }
  }

  const generation = body.generationConfig ?? {};
  const s = ir.settings;
  if (generation.maxOutputTokens !== undefined) s.maxOutputTokens = generation.maxOutputTokens;
  if (generation.temperature !== undefined) {
    s.temperature = generation.temperature;
    s.temperatureMax = 2;
  }
  if (generation.topP !== undefined) s.topP = generation.topP;
  if (generation.topK !== undefined) s.topK = generation.topK;
  if (generation.stopSequences !== undefined) s.stopSequences = generation.stopSequences;
  if (generation.seed !== undefined) s.seed = generation.seed;
  if (generation.candidateCount !== undefined) s.candidates = generation.candidateCount;
  if (generation.presencePenalty !== undefined) s.presencePenalty = generation.presencePenalty;
  if (generation.frequencyPenalty !== undefined) s.frequencyPenalty = generation.frequencyPenalty;

  const schema = generation.responseJsonSchema ?? generation.responseSchema;
  if (schema !== undefined && typeof schema === "object" && schema !== null) {
    s.responseFormat = { kind: "json-schema", schema: schema as Record<string, unknown> };
    if (generation.responseJsonSchema === undefined) {
      putPassthrough(ir, DIALECT, "__response_schema_field", "responseSchema");
    }
    if (generation.responseMimeType !== undefined && generation.responseMimeType !== "application/json") {
      putPassthrough(ir, DIALECT, "__response_mime_type", generation.responseMimeType);
    }
  } else if (generation.responseMimeType === "application/json") {
    s.responseFormat = { kind: "json" };
  } else if (generation.responseMimeType !== undefined) {
    putPassthrough(ir, DIALECT, "__response_mime_type", generation.responseMimeType);
  }

  const thinking = generation.thinkingConfig;
  if (thinking !== undefined) {
    if (thinking.thinkingBudget !== undefined) {
      s.reasoning =
        thinking.thinkingBudget === 0
          ? { mode: "off" }
          : { mode: "budget", budgetTokens: thinking.thinkingBudget };
    } else if (thinking.thinkingLevel !== undefined) {
      s.reasoning = { mode: "effort", effort: String(thinking.thinkingLevel).toLowerCase() };
    }
    if (thinking.includeThoughts !== undefined) {
      putPassthrough(ir, DIALECT, "__include_thoughts", thinking.includeThoughts);
    }
  }

  const generationRest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(generation as Record<string, unknown>)) {
    if (MAPPED_GENERATION_KEYS.has(key) || value === undefined) continue;
    generationRest[key] = value;
  }
  if (Object.keys(generationRest).length > 0) {
    putPassthrough(ir, DIALECT, "generationConfig", generationRest);
  }

  for (const [key, value] of Object.entries(body as unknown as Record<string, unknown>)) {
    if (MAPPED_KEYS.has(key) || value === undefined) continue;
    putPassthrough(ir, DIALECT, key, value);
  }

  return ir;
}

// ---------------------------------------------------------------------------
// Decode: ChatIR → generateContent body (without `model`)
// ---------------------------------------------------------------------------

function decodeToolResponse(
  part: Extract<IRPart, { type: "tool-result" }>,
  path: Array<string | number>,
  warn: Warn,
): Record<string, unknown> {
  const output = part.output;
  if (output.kind === "json" && typeof output.value === "object" && output.value !== null && !Array.isArray(output.value)) {
    return output.value as Record<string, unknown>;
  }
  const text = toolOutputToText(output, (dropped) => {
    warn({
      code: "dropped_content",
      path,
      message: `a \`${dropped.type}\` block inside a tool result has no Gemini representation (\`functionResponse.response\` is a JSON object of scalars) and was dropped.`,
    });
  });
  if (part.isError === true) {
    warn({
      code: "approximated_param",
      path,
      message:
        "Gemini's `functionResponse` has no error flag; the failed tool result is carried as `{ error: … }` so the model still sees that the call failed.",
    });
    return { error: text };
  }
  return { result: text };
}

export function decodeGemini(ir: ChatIR, warn: Warn, ctx?: DecodeContext): GeminiWireBody {
  const own = ownPassthrough(ir, DIALECT);
  const contents: GoogleContent[] = [];

  ir.messages.forEach((message, index) => {
    const parts: GooglePart[] = [];
    message.content.forEach((part, j) => {
      const path: Array<string | number> = ["messages", index, "content", j];
      switch (part.type) {
        case "text":
          parts.push({ text: part.text });
          if (part.cache !== undefined) {
            warn({
              code: "dropped_param",
              path,
              message:
                "explicit prompt-cache breakpoints have no Gemini equivalent — Gemini caches through `cachedContent`, which is created by a separate API call; the breakpoint was dropped.",
            });
          }
          break;
        case "media": {
          if (part.data.kind === "file") {
            // Gemini's own handle round-trips verbatim; a foreign one cannot
            // be resolved here at all, so it is dropped with a named warning.
            if (part.data.dialect === DIALECT) {
              const mimeType = part.mediaType;
              parts.push({
                fileData: {
                  fileUri: part.data.ref,
                  ...(mimeType !== undefined && { mimeType }),
                },
              });
              break;
            }
            warn({
              code: "dropped_content",
              path,
              message: `a ${part.data.dialect} file handle ("${part.data.ref}") cannot be carried to Gemini — file-id namespaces are per-provider. Upload the file to Gemini's Files API and reference its own URI.`,
              meta: { ref: part.data.ref, dialect: part.data.dialect },
            });
            break;
          }
          if (part.data.kind === "url") {
            const mimeType = part.mediaType ?? inferMediaTypeFromUrl(part.data.url);
            if (mimeType === undefined) {
              warn({
                code: "approximated_param",
                path,
                message: `Gemini's \`fileData\` wants a \`mimeType\` and the source carried none for "${part.data.url}"; it was sent without one, which the API may reject.`,
                meta: { url: part.data.url },
              });
            }
            // Gemini will not fetch an arbitrary web URL: `fileData.fileUri`
            // resolves only Files API URIs, `gs://` (Vertex) and YouTube
            // links. The other dialects happily reference any public URL, so
            // this is a real crossing cost and must not translate silently.
            if (!isGeminiFetchableUrl(part.data.url)) {
              warn({
                code: "approximated_param",
                path,
                message: `Gemini cannot fetch arbitrary remote media: \`fileData.fileUri\` resolves only Files API URIs, \`gs://\` Cloud Storage URIs and YouTube links, and "${part.data.url}" is none of those. It was written through as \`fileData\` and the API will most likely reject it — upload the asset to Gemini's Files API, or inline it as base64.`,
                meta: { url: part.data.url },
              });
            }
            parts.push({ fileData: { fileUri: part.data.url, ...(mimeType !== undefined && { mimeType }) } });
            break;
          }
          if (part.mediaType === undefined) {
            warn({
              code: "dropped_content",
              path,
              message:
                "Gemini's `inlineData` requires a `mimeType` and the source part declared none, so the media was dropped rather than sent with an invented type.",
            });
            break;
          }
          parts.push({ inlineData: { mimeType: part.mediaType, data: part.data.base64 } });
          break;
        }
        case "tool-call":
          parts.push({
            functionCall: {
              // A synthesized id is this codec's own bookkeeping and must not
              // leak back onto the wire; a real one from another dialect is
              // written through, since Gemini accepts an explicit id.
              ...(!isSynthesizedId(part.id) && { id: part.id }),
              name: part.name,
              args:
                typeof part.input === "object" && part.input !== null
                  ? (part.input as Record<string, unknown>)
                  : { value: part.input },
            },
          });
          break;
        case "tool-result":
          parts.push({
            functionResponse: {
              ...(!isSynthesizedId(part.id) && { id: part.id }),
              name: part.name ?? part.id,
              response: decodeToolResponse(part, path, warn),
            },
          });
          break;
        case "reasoning":
          if (part.text !== undefined) {
            parts.push({
              text: part.text,
              thought: true,
              ...(part.signature !== undefined && { thoughtSignature: part.signature }),
            });
          } else {
            warn({
              code: "dropped_content",
              path,
              message:
                "a redacted reasoning block carries no text Gemini can replay as a thought part; it was dropped.",
            });
          }
          break;
      }
    });
    contents.push({ role: message.role === "assistant" ? "model" : "user", parts });
  });

  const body: GeminiWireBody = { contents };

  if (ir.system !== undefined && ir.system.length > 0) {
    body.systemInstruction = { parts: ir.system.map((block) => ({ text: block.text })) };
    if (ir.system.some((block) => block.cache !== undefined)) {
      warn({
        code: "dropped_param",
        path: ["system"],
        message:
          "an explicit prompt-cache breakpoint on the system prompt has no Gemini equivalent (Gemini caches through `cachedContent`); it was dropped.",
      });
    }
  }

  const declarations: GoogleFunctionDeclaration[] = (ir.tools ?? []).map((tool) => {
    if (tool.cache !== undefined) {
      warn({
        code: "dropped_param",
        path: ["tools"],
        message: `the cache breakpoint on tool "${tool.name}" has no Gemini equivalent and was dropped; the declaration itself is carried.`,
      });
    }
    if (tool.strict !== undefined) {
      warn({
        code: "dropped_param",
        path: ["tools"],
        message: `\`strict\` on tool "${tool.name}" has no Gemini equivalent (Gemini validates against the declared schema itself); it was dropped.`,
      });
    }
    const useJsonSchemaField = own["__parameters_field"] === "parametersJsonSchema";
    return {
      name: tool.name,
      ...(tool.description !== undefined && { description: tool.description }),
      ...(useJsonSchemaField
        ? { parametersJsonSchema: tool.parameters }
        : { parameters: tool.parameters }),
    };
  });
  const tools: GoogleTool[] = [];
  if (declarations.length > 0) tools.push({ functionDeclarations: declarations });
  for (const native of ownNativeTools(ir, DIALECT)) tools.push(native.raw as GoogleTool);
  if (tools.length > 0) body.tools = tools;

  const choice = ir.toolChoice;
  if (choice !== undefined) {
    body.toolConfig = {
      functionCallingConfig:
        choice.mode === "auto"
          ? { mode: "AUTO" }
          : choice.mode === "none"
            ? { mode: "NONE" }
            : choice.mode === "required"
              ? { mode: "ANY" }
              : { mode: "ANY", allowedFunctionNames: [choice.name] },
    };
  }

  const s = ir.settings;
  const generation: GoogleGenerationConfig = {};
  if (s.maxOutputTokens !== undefined) generation.maxOutputTokens = s.maxOutputTokens;
  if (s.temperature !== undefined) {
    generation.temperature = Math.min(s.temperature, 2);
    if (s.temperature > 2) {
      warn({
        code: "approximated_param",
        path: ["temperature"],
        message: `temperature ${s.temperature} exceeds Gemini's maximum of 2 and was clamped.`,
        meta: { from: s.temperature, to: 2 },
      });
    }
  }
  if (s.topP !== undefined) generation.topP = s.topP;
  if (s.topK !== undefined) generation.topK = s.topK;
  if (s.stopSequences !== undefined) generation.stopSequences = s.stopSequences;
  if (s.seed !== undefined) generation.seed = s.seed;
  if (s.candidates !== undefined) generation.candidateCount = s.candidates;
  if (s.presencePenalty !== undefined) generation.presencePenalty = s.presencePenalty;
  if (s.frequencyPenalty !== undefined) generation.frequencyPenalty = s.frequencyPenalty;

  if (s.responseFormat !== undefined) {
    const mime = own["__response_mime_type"];
    generation.responseMimeType = typeof mime === "string" ? mime : "application/json";
    if (s.responseFormat.kind === "json-schema") {
      if (own["__response_schema_field"] === "responseSchema") {
        generation.responseSchema = s.responseFormat.schema;
      } else {
        generation.responseJsonSchema = s.responseFormat.schema;
      }
      if (s.responseFormat.strict !== undefined) {
        warn({
          code: "dropped_param",
          path: ["response_format", "json_schema", "strict"],
          message:
            "`strict` has no Gemini equivalent — Gemini always constrains generation to the response schema; the flag was dropped and the schema is still enforced.",
        });
      }
    }
  } else if (typeof own["__response_mime_type"] === "string") {
    generation.responseMimeType = own["__response_mime_type"] as string;
  }

  if (s.reasoning !== undefined) {
    const includeThoughts =
      typeof own["__include_thoughts"] === "boolean"
        ? { includeThoughts: own["__include_thoughts"] as boolean }
        : {};
    const thinking: GoogleThinkingConfig =
      s.reasoning.mode === "budget"
        ? { thinkingBudget: s.reasoning.budgetTokens, ...includeThoughts }
        : s.reasoning.mode === "off"
          ? { thinkingBudget: 0, ...includeThoughts }
          : { thinkingLevel: s.reasoning.effort.toUpperCase(), ...includeThoughts };
    if (s.reasoning.mode === "effort") {
      const level = s.reasoning.effort.toUpperCase();
      if (level !== "MINIMAL" && level !== "LOW" && level !== "MEDIUM" && level !== "HIGH") {
        warn({
          code: "approximated_param",
          path: ["reasoning_effort"],
          message: `\`reasoning_effort: "${s.reasoning.effort}"\` is not one of Gemini's thinking levels (MINIMAL, LOW, MEDIUM, HIGH); it was sent as "${level}" and the API may reject it.`,
          meta: { effort: s.reasoning.effort },
        });
      }
    }
    generation.thinkingConfig = thinking;
  }

  const generationExtra = own["generationConfig"];
  if (typeof generationExtra === "object" && generationExtra !== null) {
    Object.assign(generation, generationExtra as Record<string, unknown>);
  }
  if (Object.keys(generation).length > 0) body.generationConfig = generation;

  if (s.stream === true) {
    warn({
      code: "dropped_param",
      path: ["stream"],
      message:
        "Gemini streams through a different method (`:streamGenerateContent`), not a body flag; `stream: true` was dropped. Point the request at the streaming URL instead.",
    });
  }
  if (s.user !== undefined) {
    warn({
      code: "dropped_param",
      path: ["user"],
      message:
        "`user` / `metadata.user_id` has no Gemini equivalent (end-user attribution is not part of generateContent); it was dropped.",
    });
  }
  if (s.parallelToolCalls === false) {
    warn({
      code: "dropped_param",
      path: ["parallel_tool_calls"],
      message:
        "Gemini has no switch to disable parallel tool calls; the request was left with Gemini's default behaviour.",
    });
  }
  if (s.serviceTier !== undefined) {
    const tiers: readonly string[] = ["unspecified", "standard", "flex", "priority"];
    if (tiers.includes(s.serviceTier)) body.serviceTier = s.serviceTier as GoogleServiceTier;
    else {
      warn({
        code: "approximated_param",
        path: ["service_tier"],
        message: `\`service_tier: "${s.serviceTier}"\` is not one of Gemini's tiers (${tiers.join(", ")}); it was dropped and the project default applies.`,
        meta: { service_tier: s.serviceTier },
      });
    }
  }

  for (const [key, value] of Object.entries(own)) {
    if (key.startsWith("__") || key === "generationConfig") continue;
    (body as unknown as Record<string, unknown>)[key] = value;
  }
  warnForeignExtras(ir, DIALECT, warn);

  // `ctx.targetModelId` is deliberately unused: Gemini carries the model id in
  // the URL path (`models/{id}:generateContent`), which the endpoint table
  // interpolates, so putting it on the body would break the "enumerable
  // properties are exactly the wire body" invariant.
  void ctx;
  return body;
}
