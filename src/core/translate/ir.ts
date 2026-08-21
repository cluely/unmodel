/**
 * `ChatIR` — the hub of the hub-and-spoke translator.
 *
 * Four dialects means twelve directed pairs if you write translators
 * pairwise, but only four encoders + four decoders through a hub — and the
 * hub is what makes `toSdk("ai-sdk")` fall out for free as a fifth decoder
 * (`./ai-sdk.ts`). That is the whole argument for the IR existing.
 *
 * **The IR is a superset, not a lowest common denominator.** A feature is
 * first-class here if *two or more* dialects express it — cache breakpoints,
 * reasoning blocks, mandatory tool-call ids all qualify. That is deliberate:
 * the risk of a hub is double-lossiness (A→IR→B losing more than a direct
 * A→B pair would), and it bites hardest on anthropic ↔ bedrock-converse,
 * which is the *least* lossy pair in reality. Anything genuinely one-off
 * lands in `passthrough`, keyed by the dialect that owns it, so the decoder
 * for that same dialect can re-emit it and every other decoder can warn
 * `dropped_param` by name instead of silently discarding it.
 *
 * This module is self-contained by construction: it imports one type from
 * `./endpoints` (which itself imports nothing) and **nothing from
 * `src/providers/**`** — import-graph rule 1, asserted in
 * `test/import-graph.test.ts`.
 */
import type { AvailabilityNarrows } from "./availability-types";
import type { DialectId } from "./endpoints";
import type { Warn } from "./warnings";

export type { DialectId };

/**
 * What a decoder knows about where the body is going.
 *
 * Optional at the call site so a codec can be exercised standalone (the
 * golden-fixture suite does exactly that), but always supplied by
 * `createToApi`. Three of the four facts here are load-bearing:
 *
 * - `targetModelId` — the IR carries the *source* spelling, and only the
 *   availability table knows the target's.
 * - `provider` — a handful of mappings are genuinely target-conditional
 *   (`top_k` and Anthropic-style `cache_control` are accepted by some
 *   OpenAI-compatible gateways and rejected by others).
 * - `narrows` — generated capability metadata, so a decoder that has to
 *   invent a required param (Anthropic's `max_tokens`) can bound it by what
 *   the target actually serves instead of importing the target's catalog.
 */
export interface DecodeContext {
  /** The target provider's own spelling of the model id. */
  targetModelId?: string;
  /** models.dev provider id of the target, e.g. `"openrouter"`. */
  provider?: string;
  /** Target endpoint id, e.g. `"openrouter.chat"`. */
  endpoint?: string;
  /** Generated narrowing metadata for this (model, target) pair. */
  narrows?: AvailabilityNarrows;
}

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------

/**
 * A prompt-cache breakpoint. Anthropic spells it `cache_control`, Bedrock
 * `cachePoint`, OpenAI `prompt_cache_breakpoint`, and OpenRouter accepts
 * Anthropic's spelling on Claude models — two or more dialects, so it is
 * IR-first-class rather than a `passthrough` key.
 */
export interface IRCacheBreakpoint {
  kind: "ephemeral";
  /** Anthropic-only today; decoders that cannot express it warn. */
  ttl?: "5m" | "1h";
}

export interface IRTextBlock {
  text: string;
  cache?: IRCacheBreakpoint;
}

/**
 * Base64 bytes, a remote URL, or a provider file handle. Every dialect uses
 * some subset; `kind: "file"` records which dialect minted the handle, since
 * file-id namespaces are per-provider and never portable.
 */
export type IRData =
  | { kind: "base64"; base64: string }
  | { kind: "url"; url: string }
  | { kind: "file"; dialect: DialectId; ref: string };

/**
 * Mirrors the AI SDK's tool-result output union 1:1 on purpose (`text` /
 * `json` / `content`, with `isError` selecting `error-text`), because that is
 * the shape the fifth decoder has to produce anyway.
 */
export type IRToolOutput =
  | { kind: "text"; text: string }
  | { kind: "json"; value: unknown }
  | { kind: "content"; parts: IRPart[] };

export type IRPart =
  | { type: "text"; text: string; cache?: IRCacheBreakpoint }
  | {
      type: "media";
      /**
       * IANA MIME type. Optional because two of the four dialects allow a
       * bare remote URL with no declared type (Anthropic's `image.source.url`,
       * OpenAI's `image_url.url`); inventing one there would be a lie, so
       * decoders that need it infer from the URL and warn if they cannot.
       */
      mediaType?: string;
      data: IRData;
      filename?: string;
      cache?: IRCacheBreakpoint;
    }
  | { type: "reasoning"; text?: string; signature?: string; redacted?: string; budget?: number }
  | { type: "tool-call"; id: string; name: string; input: unknown; cache?: IRCacheBreakpoint }
  | { type: "tool-result"; id: string; name?: string; output: IRToolOutput; isError?: boolean };

/**
 * Only `user` and `assistant`. System text lives in `ChatIR.system` (every
 * dialect keeps it out of the turn list in some form), and tool results ride
 * as `tool-result` parts on a user message — the Anthropic/Bedrock shape.
 * The OpenAI and AI SDK decoders split those back out into `tool`-role
 * messages, which is the one genuinely structural mapping in the set.
 */
export interface IRMessage {
  role: "user" | "assistant";
  content: IRPart[];
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export interface IRTool {
  kind: "function";
  name: string;
  description?: string;
  /** JSON Schema — the one tool representation every dialect and the AI SDK share. */
  parameters: Record<string, unknown>;
  strict?: boolean;
  cache?: IRCacheBreakpoint;
}

/**
 * A provider-defined tool (`web_search_20250305`, `googleSearch`,
 * `codeExecution`, OpenAI's `custom` grammar tools …). These never cross
 * dialects; they are recorded so the decoder can name the real tool in its
 * `dropped_tool` warning instead of dropping an anonymous object.
 */
export interface IRNativeTool {
  kind: "native";
  dialect: DialectId;
  name: string;
  raw: unknown;
}

export type IRToolChoice =
  | { mode: "auto" }
  | { mode: "required" }
  | { mode: "none" }
  | { mode: "tool"; name: string };

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export type IRResponseFormat =
  | { kind: "json" }
  | { kind: "json-schema"; name?: string; schema: Record<string, unknown>; strict?: boolean };

export type IRReasoning =
  | { mode: "budget"; budgetTokens: number }
  | { mode: "effort"; effort: string }
  | { mode: "off" };

export interface IRSettings {
  maxOutputTokens?: number;
  /**
   * Carried on the **source's** scale, with `temperatureMax` as the
   * discriminant — Anthropic is 0–1, OpenAI and Gemini 0–2. Rescaling would
   * silently change sampling behaviour, so decoders clamp and warn instead,
   * and only when the value actually falls outside the target's range. At
   * temperature ≤ 1 (the overwhelming majority of real requests) every
   * cross-dialect hop is lossless and warning-free.
   */
  temperature?: number;
  temperatureMax?: 1 | 2;
  topP?: number;
  topK?: number;
  stopSequences?: string[];
  seed?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
  /** OpenAI `n` / Gemini `candidateCount`. */
  candidates?: number;
  stream?: boolean;
  /** OpenAI `user` / Anthropic `metadata.user_id`. */
  user?: string;
  /** OpenAI `parallel_tool_calls` / Anthropic `…disable_parallel_tool_use` (inverted). */
  parallelToolCalls?: boolean;
  responseFormat?: IRResponseFormat;
  reasoning?: IRReasoning;
  serviceTier?: string;
}

// ---------------------------------------------------------------------------
// The IR itself
// ---------------------------------------------------------------------------

export interface ChatIR {
  /** The dialect this IR was encoded from. Never compared for equivalence. */
  readonly source: DialectId;
  /** The SOURCE model id; decoders take the target's spelling from `DecodeContext`. */
  model: string;
  system?: IRTextBlock[];
  messages: IRMessage[];
  tools?: IRTool[];
  nativeTools?: IRNativeTool[];
  toolChoice?: IRToolChoice;
  settings: IRSettings;
  /**
   * Source-dialect-only params, keyed by the dialect that owns them. A
   * decoder re-emits its **own** dialect's bucket verbatim and warns
   * `dropped_param` for every key in the others — which is what makes the
   * "never silently drops" contract hold for one-off params without every
   * codec having to enumerate every other dialect's surface.
   */
  passthrough?: Partial<Record<DialectId, Record<string, unknown>>>;
}

// ---------------------------------------------------------------------------
// Small shared helpers. Kept here rather than duplicated per spoke: an interop
// spoke may import `src/core/translate/**` and its own directory, nothing else.
// ---------------------------------------------------------------------------

/** Records a source-dialect-only param. Undefined values are not recorded. */
export function putPassthrough(
  ir: ChatIR,
  dialect: DialectId,
  key: string,
  value: unknown,
): void {
  if (value === undefined) return;
  const buckets = (ir.passthrough ??= {});
  const bucket = (buckets[dialect] ??= {});
  bucket[key] = value;
}

/** This dialect's own passthrough bucket, for a decoder to re-emit verbatim. */
export function ownPassthrough(ir: ChatIR, dialect: DialectId): Record<string, unknown> {
  const bucket = ir.passthrough?.[dialect];
  return bucket === undefined ? {} : { ...bucket };
}

/**
 * Warns `dropped_param` for every param another dialect owns, and
 * `dropped_tool` for every provider-defined tool that is not this dialect's.
 * Every decoder calls this exactly once; it is the uniform half of the lossy
 * contract, so an individual codec only has to describe what *it* maps.
 */
export function warnForeignExtras(ir: ChatIR, self: DialectId, warn: Warn): void {
  for (const [dialect, bucket] of Object.entries(ir.passthrough ?? {})) {
    if (dialect === self || bucket === undefined) continue;
    for (const key of Object.keys(bucket)) {
      warn({
        code: "dropped_param",
        path: [key],
        message: `\`${key}\` is a ${dialect} param with no ${self} equivalent; it was dropped from the translated body.`,
        // `Object.entries` widens the passthrough key to `string`; the value
        // is a DialectId by construction (that is what `passthrough` is keyed by).
        meta: { param: key, dialect: dialect as DialectId },
      });
    }
  }
  for (const tool of ir.nativeTools ?? []) {
    if (tool.dialect === self) continue;
    warn({
      code: "dropped_tool",
      path: ["tools"],
      message: `the provider-defined tool "${tool.name}" is a ${tool.dialect} tool with no ${self} equivalent; it was dropped. Re-declare an equivalent tool for the target provider if you need it.`,
      meta: { tool: tool.name, dialect: tool.dialect },
    });
  }
}

/** This dialect's own provider-defined tools, for a decoder to re-emit. */
export function ownNativeTools(ir: ChatIR, dialect: DialectId): IRNativeTool[] {
  return (ir.nativeTools ?? []).filter((tool) => tool.dialect === dialect);
}

/** `"image/png"` + bytes → `"data:image/png;base64,…"`. */
export function toDataUrl(mediaType: string, base64: string): string {
  return `data:${mediaType};base64,${base64}`;
}

/** Parses a `data:` URL. Returns `undefined` for http(s) URLs and malformed input. */
export function parseDataUrl(url: string): { mediaType: string; base64: string } | undefined {
  if (!url.startsWith("data:")) return undefined;
  const comma = url.indexOf(",");
  if (comma === -1) return undefined;
  const meta = url.slice("data:".length, comma);
  if (!meta.endsWith(";base64")) return undefined;
  return { mediaType: meta.slice(0, -";base64".length), base64: url.slice(comma + 1) };
}

const EXTENSION_MEDIA_TYPES: Readonly<Record<string, string>> = Object.freeze({
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  pdf: "application/pdf",
  txt: "text/plain",
  wav: "audio/wav",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  mov: "video/quicktime",
});

/**
 * Best-effort MIME for a remote URL, by extension. Used only by decoders that
 * *must* declare a type (Gemini's `inlineData`, the AI SDK's file part); they
 * warn when this returns `undefined` rather than inventing one.
 */
export function inferMediaTypeFromUrl(url: string): string | undefined {
  const withoutQuery = url.split(/[?#]/)[0] ?? url;
  const dot = withoutQuery.lastIndexOf(".");
  if (dot === -1) return undefined;
  const ext = withoutQuery.slice(dot + 1).toLowerCase();
  return Object.hasOwn(EXTENSION_MEDIA_TYPES, ext) ? EXTENSION_MEDIA_TYPES[ext] : undefined;
}

/**
 * UTF-8 text → base64. Anthropic's `document` block has a plain-text source
 * that carries the text inline while every other dialect wants bytes, so the
 * conversion has to live somewhere both spokes can reach — and an interop
 * spoke may import `src/core/translate/**` and nothing else.
 */
export function textToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** base64 → UTF-8 text. The inverse of `textToBase64`. */
export function base64ToText(base64: string): string {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** True for `image/*`. */
export const isImageMediaType = (mediaType: string | undefined): boolean =>
  mediaType !== undefined && mediaType.startsWith("image/");

/** True for `audio/*`. */
export const isAudioMediaType = (mediaType: string | undefined): boolean =>
  mediaType !== undefined && mediaType.startsWith("audio/");

/**
 * Flattens a tool result to a plain string, for the dialects whose tool
 * results are text-only. Non-text parts are reported through `onDropped` so
 * the caller can attach a `dropped_content` warning with its own path.
 */
export function toolOutputToText(
  output: IRToolOutput,
  onDropped?: (part: IRPart) => void,
): string {
  switch (output.kind) {
    case "text":
      return output.text;
    case "json":
      return typeof output.value === "string" ? output.value : JSON.stringify(output.value);
    case "content": {
      const texts: string[] = [];
      for (const part of output.parts) {
        if (part.type === "text") texts.push(part.text);
        else onDropped?.(part);
      }
      return texts.join("\n");
    }
  }
}

/** An empty IR for a dialect, so encoders can build incrementally. */
export function emptyIR(source: DialectId, model: string): ChatIR {
  return { source, model, messages: [], settings: {} };
}
