/**
 * Carries `ValidateOptions.media` across the canonical-chat compiler boundary.
 *
 * A declaration path names the object the caller supplied. Provider validators
 * necessarily inspect the compiled body instead: Gemini calls the same part
 * `contents[i].parts[j]`, and chat-completions may insert a leading system
 * message. Matching media by their stable payload/locator lets declarations
 * follow those structural rewrites without teaching the provider validators
 * about the unified vocabulary.
 */
import { formatIssuePath } from "../core/issues";
import type { IssueInput } from "../core/issue-sink";
import type { MediaDeclaration, ValidateOptions } from "../core/options";
import type { DialectId } from "../core/translate/endpoints";
import type { ChatParams } from "./types";

type Path = readonly (string | number)[];
type UnknownRecord = Record<string, unknown>;

interface LocatedMedia {
  readonly path: Path;
  readonly fingerprint: string;
}

function record(value: unknown): UnknownRecord | undefined {
  return typeof value === "object" && value !== null ? (value as UnknownRecord) : undefined;
}

function normalizedData(value: string): string {
  if (!value.startsWith("data:")) return value;
  const comma = value.indexOf(",");
  return comma >= 0 && value.slice(0, comma).toLowerCase().includes(";base64")
    ? value.slice(comma + 1)
    : value;
}

function canonicalFingerprint(value: unknown): string | undefined {
  const part = record(value);
  if (part === undefined) return undefined;

  if (part["type"] === "file") {
    const data = part["data"];
    if (typeof data === "string") return normalizedData(data);
    const handle = record(data);
    return typeof handle?.["fileId"] === "string" ? handle["fileId"] : undefined;
  }

  if (part["type"] === "media" && typeof part["data"] === "string") {
    return normalizedData(part["data"]);
  }
  return undefined;
}

function canonicalMedia(params: ChatParams): LocatedMedia[] {
  const media: LocatedMedia[] = [];
  params.messages.forEach((message, messageIndex) => {
    if (message.role === "user" && Array.isArray(message.content)) {
      message.content.forEach((part, partIndex) => {
        const fingerprint = canonicalFingerprint(part);
        if (fingerprint !== undefined) {
          media.push({
            path: ["messages", messageIndex, "content", partIndex],
            fingerprint,
          });
        }
      });
      return;
    }

    if (message.role !== "tool") return;
    message.content.forEach((part, partIndex) => {
      if (part.output.type !== "content") return;
      part.output.value.forEach((inner, innerIndex) => {
        const fingerprint = canonicalFingerprint(inner);
        if (fingerprint !== undefined) {
          media.push({
            path: [
              "messages",
              messageIndex,
              "content",
              partIndex,
              "output",
              "value",
              innerIndex,
            ],
            fingerprint,
          });
        }
      });
    });
  });
  return media;
}

function anthropicMedia(body: UnknownRecord): LocatedMedia[] {
  const media: LocatedMedia[] = [];
  const visit = (blocks: unknown, prefix: Path): void => {
    if (!Array.isArray(blocks)) return;
    blocks.forEach((value, index) => {
      const block = record(value);
      if (block === undefined) return;
      const path = [...prefix, index];
      if (block["type"] === "tool_result") visit(block["content"], [...path, "content"]);

      const source = record(block["source"]);
      if (source === undefined) return;
      const raw =
        typeof source["url"] === "string"
          ? source["url"]
          : typeof source["data"] === "string"
            ? source["data"]
            : typeof source["file_id"] === "string"
              ? source["file_id"]
              : undefined;
      if (raw !== undefined) media.push({ path, fingerprint: normalizedData(raw) });
    });
  };

  const messages = body["messages"];
  if (Array.isArray(messages)) {
    messages.forEach((value, index) => {
      const message = record(value);
      if (message !== undefined) visit(message["content"], ["messages", index, "content"]);
    });
  }
  return media;
}

function geminiMedia(body: UnknownRecord): LocatedMedia[] {
  const media: LocatedMedia[] = [];
  const contents = body["contents"];
  if (!Array.isArray(contents)) return media;

  contents.forEach((value, contentIndex) => {
    const content = record(value);
    const parts = content?.["parts"];
    if (!Array.isArray(parts)) return;
    parts.forEach((partValue, partIndex) => {
      const part = record(partValue);
      const inline = record(part?.["inlineData"]);
      const file = record(part?.["fileData"]);
      const raw =
        typeof inline?.["data"] === "string"
          ? inline["data"]
          : typeof file?.["fileUri"] === "string"
            ? file["fileUri"]
            : undefined;
      if (raw !== undefined) {
        media.push({
          path: ["contents", contentIndex, "parts", partIndex],
          fingerprint: normalizedData(raw),
        });
      }
    });
  });
  return media;
}

function openAiMedia(body: UnknownRecord): LocatedMedia[] {
  const media: LocatedMedia[] = [];
  const messages = body["messages"];
  if (!Array.isArray(messages)) return media;

  messages.forEach((value, messageIndex) => {
    const message = record(value);
    const content = message?.["content"];
    if (!Array.isArray(content)) return;
    content.forEach((partValue, partIndex) => {
      const part = record(partValue);
      if (part === undefined) return;
      const imageUrl = record(part["image_url"]);
      const inputAudio = record(part["input_audio"]);
      const file = record(part["file"]);
      const raw =
        typeof imageUrl?.["url"] === "string"
          ? imageUrl["url"]
          : typeof inputAudio?.["data"] === "string"
            ? inputAudio["data"]
            : typeof file?.["file_data"] === "string"
              ? file["file_data"]
              : typeof file?.["file_id"] === "string"
                ? file["file_id"]
                : undefined;
      if (raw !== undefined) {
        media.push({
          path: ["messages", messageIndex, "content", partIndex],
          fingerprint: normalizedData(raw),
        });
      }
    });
  });
  return media;
}

function providerMedia(dialect: DialectId, body: object): LocatedMedia[] {
  const wire = body as UnknownRecord;
  switch (dialect) {
    case "anthropic-messages":
      return anthropicMedia(wire);
    case "gemini":
      return geminiMedia(wire);
    case "openai-chat":
      return openAiMedia(wire);
    default:
      return [];
  }
}

function pathKey(path: readonly (string | number)[]): string {
  return JSON.stringify(path);
}

/** Bidirectional correspondence for media that survived compilation. */
export interface ChatMediaPaths {
  toWire(path: Path): Path | undefined;
  toCanonical(path: Path): Path | undefined;
  /**
   * Whether `path` addresses a media part of the *canonical* request, whether
   * or not that part survived compilation. This is what separates "a
   * declaration unmodel could not follow" from "a declaration written in wire
   * coordinates on purpose", and the two must not be treated alike — see
   * {@link providerChatOptions}.
   */
  isCanonicalMedia(path: Path): boolean;
}

export function chatMediaPaths(
  params: ChatParams,
  body: object,
  dialect: DialectId,
): ChatMediaPaths {
  const targets = new Map<string, LocatedMedia[]>();
  for (const location of providerMedia(dialect, body)) {
    const queue = targets.get(location.fingerprint);
    if (queue === undefined) targets.set(location.fingerprint, [location]);
    else queue.push(location);
  }

  const forward = new Map<string, Path>();
  const reverse = new Map<string, Path>();
  const sources = new Set<string>();
  for (const source of canonicalMedia(params)) {
    sources.add(pathKey(source.path));
    const target = targets.get(source.fingerprint)?.shift();
    if (target === undefined) continue;
    forward.set(pathKey(source.path), target.path);
    reverse.set(pathKey(target.path), source.path);
  }

  return {
    isCanonicalMedia: (path) => sources.has(pathKey(path)),
    toWire: (path) => forward.get(pathKey(path)),
    toCanonical(path) {
      // Media checks normally report the block itself. Longest-prefix lookup
      // also keeps nested provider findings attached to the canonical part.
      for (let length = path.length; length > 0; length -= 1) {
        const prefix = path.slice(0, length);
        const mapped = reverse.get(pathKey(prefix));
        if (mapped !== undefined) return [...mapped, ...path.slice(length)];
      }
      return undefined;
    },
  };
}

/**
 * Clone only the path-bearing option; callers' options/declarations stay
 * untouched.
 *
 * ## Why an unfollowable declaration is dropped rather than forwarded
 *
 * A declaration whose canonical part did not survive compilation has no wire
 * target. Forwarding its canonical path unchanged looks harmless and is not:
 * on `openai-chat` and `anthropic-messages` the canonical and wire coordinates
 * share the shape `["messages", i, "content", j]`, and `core/media/check.ts`
 * matches declarations by exact path equality — so the orphaned path lands on
 * whichever *different* attachment now occupies that slot. The declared facts
 * then win over the real ones for anything the checker cannot sniff (an
 * `http(s)` image, a provider file id, every `durationSeconds` rule), and the
 * caller gets a hard `media_too_large` pointed confidently at an attachment
 * they never described.
 *
 * So: drop it, and say so. The wire path of a part that no longer exists is
 * not a better guess than no path at all.
 *
 * A declaration that never named canonical media is a different thing — a
 * caller addressing the compiled body deliberately — and is forwarded verbatim.
 */
export function providerChatOptions(
  options: ValidateOptions,
  paths: ChatMediaPaths,
  report: (issue: IssueInput) => void,
): ValidateOptions {
  if (options.media === undefined) return options;
  const media: MediaDeclaration[] = [];
  for (const declaration of options.media) {
    const wire = paths.toWire(declaration.path);
    if (wire !== undefined) {
      media.push({ ...declaration, path: wire });
      continue;
    }
    if (paths.isCanonicalMedia(declaration.path)) {
      report({
        code: "media_declaration_dropped",
        path: [...declaration.path],
        message:
          `the media declared at \`${formatIssuePath([...declaration.path])}\` did not survive compilation for this ` +
          "provider, so its declared facts were not applied. Compile warnings name what was dropped.",
        meta: { declaredPath: [...declaration.path] },
      });
      continue;
    }
    media.push({ ...declaration, path: [...declaration.path] });
  }
  return { ...options, media };
}
