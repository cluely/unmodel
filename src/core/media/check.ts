import type { MediaRule } from "../constraint-types";
import type { MediaDeclaration } from "../options";
import type { PipelineContext } from "../pipeline";
import type { SniffedImage } from "./image";

/** Finds the declaration whose path deep-equals `path`, if any. */
export function findMediaDeclaration(
  media: MediaDeclaration[] | undefined,
  path: Array<string | number>,
): MediaDeclaration | undefined {
  return media?.find(
    (d) => d.path.length === path.length && d.path.every((segment, i) => segment === path[i]),
  );
}

export interface MediaCheckInput {
  kind: "image" | "audio" | "video";
  rule: MediaRule;
  /** Location of the media part inside the params object. */
  path: Array<string | number>;
  model?: string;
  /** Header-sniffed facts about the bytes, when they were inspectable. */
  sniffed?: SniffedImage;
  /** Base64-encoded length, for endpoints whose byte limit is encoded-size-based. */
  encodedBytes?: number;
  /** The user's out-of-band declaration for this path (options.media). */
  declaration?: MediaDeclaration;
  /** Docs URL backing the rule; surfaced in meta.source. */
  source?: string;
}

/**
 * Enforces a MediaRule against what is known about one media part —
 * header-sniffed facts, the user's declaration, and/or the encoded size.
 * Shared by every provider so the media_* issue semantics never diverge.
 */
export function reportMediaIssues(ctx: PipelineContext, input: MediaCheckInput): void {
  const { kind, rule, path, model, sniffed, encodedBytes, declaration, source } = input;
  const target = model !== undefined ? `"${model}"` : ctx.endpoint;
  const withSource = (meta: Record<string, unknown>): Record<string, unknown> =>
    source === undefined ? meta : { ...meta, source };

  // Format allowlist — only enforceable when sniffing identified the format.
  if (rule.formats !== undefined && sniffed !== undefined && !rule.formats.includes(sniffed.format)) {
    ctx.report({
      code: "media_unsupported_format",
      path,
      ...(model !== undefined && { model }),
      message: `${kind} format "${sniffed.format}" is not supported by ${target}; supported formats: ${rule.formats.join(", ")}.`,
      meta: withSource({ format: sniffed.format, allowed: [...rule.formats] }),
    });
  }

  const bytes = sniffed?.bytes ?? declaration?.bytes ?? encodedBytes;
  if (rule.maxBytes !== undefined && bytes !== undefined && bytes > rule.maxBytes) {
    ctx.report({
      code: "media_too_large",
      path,
      ...(model !== undefined && { model }),
      message: `${kind} is ${bytes} bytes; ${target} caps ${kind} media at ${rule.maxBytes} bytes.`,
      meta: withSource({ bytes, limit: rule.maxBytes }),
    });
  }

  const dims = sniffed ?? declaration;
  const tooWide = rule.maxWidth !== undefined && dims?.width !== undefined && dims.width > rule.maxWidth;
  const tooTall =
    rule.maxHeight !== undefined && dims?.height !== undefined && dims.height > rule.maxHeight;
  if (tooWide || tooTall) {
    ctx.report({
      code: "media_dimensions_exceeded",
      path,
      ...(model !== undefined && { model }),
      message: `${kind} is ${dims?.width ?? "?"}x${dims?.height ?? "?"}; ${target} caps ${kind} dimensions at ${rule.maxWidth ?? "∞"}x${rule.maxHeight ?? "∞"}.`,
      meta: withSource({
        width: dims?.width,
        height: dims?.height,
        maxWidth: rule.maxWidth,
        maxHeight: rule.maxHeight,
      }),
    });
  }

  if (rule.maxDurationSeconds !== undefined) {
    const declared = declaration?.durationSeconds;
    if (declared === undefined) {
      ctx.report({
        code: "media_duration_undeclared",
        path,
        ...(model !== undefined && { model }),
        message: `${target} caps ${kind} at ${rule.maxDurationSeconds}s but the duration of this ${kind} cannot be inspected; declare it via options.media = [{ path: ${JSON.stringify(path)}, durationSeconds }].`,
        meta: withSource({ limit: rule.maxDurationSeconds }),
      });
    } else if (declared > rule.maxDurationSeconds) {
      ctx.report({
        code: "media_duration_exceeded",
        path,
        ...(model !== undefined && { model }),
        message: `${kind} is declared as ${declared}s; ${target} caps ${kind} at ${rule.maxDurationSeconds}s.`,
        meta: withSource({ durationSeconds: declared, limit: rule.maxDurationSeconds }),
      });
    }
  }
}
