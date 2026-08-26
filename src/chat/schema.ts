/**
 * Validation **layer 1** for the unified vocabulary: is this a `ChatParams`?
 *
 * Every other schema in unmodel mirrors a wire format and is therefore loose
 * almost everywhere — providers ship params faster than a snapshot tracks them,
 * and rejecting an unknown key would make the library the thing standing
 * between a user and a feature that shipped this morning. This schema is the
 * one place that reasoning does **not** apply wholesale, because there is no
 * API on the other end of it: `ChatParams` is unmodel's own vocabulary, so an
 * unrecognised value in it is never "new", it is wrong.
 *
 * The line drawn here, in both directions:
 *
 * - **Strict about structure.** Roles, part `type` discriminators, the
 *   reasoning union, `toolChoice`, `responseFormat` — a typo in any of these is
 *   a request that compiles to a body missing a chunk of what the caller meant,
 *   and the failure would surface as a bad completion rather than an error.
 *   These are closed unions and stay closed.
 * - **Loose about extension.** Every object is a `looseObject`, so an extra
 *   field inside a message part or a tool spec passes through rather than
 *   failing; unknown *top-level* keys are reported as `unknown_param` warnings
 *   by `reportUnknownTopLevelKeys`, which is the same treatment every provider
 *   schema gives them.
 *
 * ## `temperature` is 0–2 and out of range is an error
 *
 * The unified vocabulary declares a canonical 0–2 scale (see `types.ts`), which
 * is what lets the encoder stamp `temperatureMax: 2` on the IR and lets the
 * Anthropic decoder clamp 1.4 → 1 with an `approximated_param` warning instead
 * of silently rescaling every request. A value of 3 is outside the vocabulary
 * itself, not outside one target's range, so it is an `invalid_shape` error
 * here rather than something to clamp later: clamping it would mean two
 * different rules for "too hot" depending on which provider the ref named.
 *
 * ## Base64 attachments must declare a `mediaType`
 *
 * `ChatFilePart.data` has three readings and only one of them needs the field:
 * a `data:` URL carries its own type, an `http(s)` URL is fetched by the
 * provider, and bare base64 carries nothing. No dialect accepts bytes without a
 * declared type, and guessing one is how a request comes back as a 400 that
 * reads like a content-policy refusal — so it is required exactly on that arm,
 * checked where the arm is known rather than as a blanket rule.
 *
 * The top-level schema stays a plain `ZodObject` (no top-level `superRefine`,
 * which would wrap it in a pipe) because `reportUnknownTopLevelKeys`
 * introspects `.shape` to find the keys it does not know.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------

const cacheSchema = z.union([
  z.boolean(),
  z.looseObject({ ttl: z.enum(["5m", "1h"]).optional() }),
]);

const textPartSchema = z.looseObject({
  type: z.literal("text"),
  text: z.string(),
  cache: cacheSchema.optional(),
});

/** Mirrors `encode.ts`'s `URL_SCHEME` — anything with a scheme is a locator. */
const URL_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

const fileHandleSchema = z.looseObject({ fileId: z.string(), provider: z.string() });

const filePartSchema = z
  .looseObject({
    type: z.literal("file"),
    mediaType: z.string().optional(),
    data: z.union([z.string(), fileHandleSchema]),
    filename: z.string().optional(),
    detail: z.enum(["auto", "low", "medium", "high"]).optional(),
    cache: cacheSchema.optional(),
  })
  .superRefine((part, ctx) => {
    if (typeof part.data !== "string") return;
    if (part.data.startsWith("data:") || URL_SCHEME.test(part.data)) return;
    if (part.mediaType !== undefined) return;
    ctx.addIssue({
      code: "custom",
      path: ["mediaType"],
      message:
        "`mediaType` is required when `data` is bare base64: no provider accepts attachment bytes without a declared IANA type, and unmodel will not guess one. Supply it, or pass a `data:` URL / an http(s) URL, which carry their own.",
    });
  });

const toolCallPartSchema = z.looseObject({
  type: z.literal("tool-call"),
  toolCallId: z.string(),
  toolName: z.string(),
  input: z.unknown(),
  cache: cacheSchema.optional(),
});

const reasoningPartSchema = z.looseObject({
  type: z.literal("reasoning"),
  text: z.string().optional(),
  signature: z.string().optional(),
  redacted: z.string().optional(),
});

const toolOutputSchema = z.discriminatedUnion("type", [
  z.looseObject({ type: z.literal("text"), value: z.string() }),
  z.looseObject({ type: z.literal("json"), value: z.unknown() }),
  z.looseObject({ type: z.literal("error-text"), value: z.string() }),
  z.looseObject({
    type: z.literal("content"),
    value: z.array(
      z.discriminatedUnion("type", [
        z.looseObject({ type: z.literal("text"), text: z.string() }),
        z.looseObject({
          type: z.literal("media"),
          data: z.string(),
          mediaType: z.string(),
        }),
      ]),
    ),
  }),
]);

const toolResultPartSchema = z.looseObject({
  type: z.literal("tool-result"),
  toolCallId: z.string(),
  toolName: z.string().optional(),
  output: toolOutputSchema,
});

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

const messageSchema = z.discriminatedUnion("role", [
  z.looseObject({
    role: z.literal("system"),
    content: z.string(),
    cache: cacheSchema.optional(),
  }),
  z.looseObject({
    role: z.literal("user"),
    content: z.union([
      z.string(),
      // A user turn carries text and attachments. Tool *results* are their own
      // role here even though the IR folds them onto a user turn — one spelling
      // per concept is what keeps the vocabulary teachable.
      z.array(z.union([textPartSchema, filePartSchema])),
    ]),
  }),
  z.looseObject({
    role: z.literal("assistant"),
    content: z.union([
      z.string(),
      z.array(z.union([textPartSchema, toolCallPartSchema, reasoningPartSchema])),
    ]),
  }),
  z.looseObject({ role: z.literal("tool"), content: z.array(toolResultPartSchema) }),
]);

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

const effortSchema = z.enum(["minimal", "low", "medium", "high", "xhigh", "max"]);

/**
 * Order matters: the `{ effort, budgetTokens? }` arm is tried before the
 * budget-only arm, so `{ effort: "high", budgetTokens: 2048 }` — the portable
 * "budget where budgets exist, effort where they do not" form — matches the
 * arm that carries both rather than being read as a budget with a stray key.
 */
const reasoningSchema = z.union([
  z.enum(["minimal", "low", "medium", "high", "xhigh", "max", "off"]),
  z.literal(false),
  z.looseObject({
    effort: effortSchema,
    budgetTokens: z.number().int().positive().optional(),
  }),
  z.looseObject({ budgetTokens: z.number().int().positive() }),
]);

const jsonSchemaSchema = z.record(z.string(), z.unknown());

const responseFormatSchema = z.discriminatedUnion("type", [
  z.looseObject({ type: z.literal("text") }),
  z.looseObject({ type: z.literal("json") }),
  z.looseObject({
    type: z.literal("json-schema"),
    name: z.string().optional(),
    schema: jsonSchemaSchema,
    strict: z.boolean().optional(),
  }),
]);

const toolSpecSchema = z.looseObject({
  description: z.string().optional(),
  inputSchema: jsonSchemaSchema,
  strict: z.boolean().optional(),
  cache: cacheSchema.optional(),
});

const toolChoiceSchema = z.union([
  z.enum(["auto", "none", "required"]),
  z.looseObject({ type: z.literal("tool"), toolName: z.string() }),
]);

const nativeToolSchema = z.looseObject({
  provider: z.string(),
  definition: z.unknown(),
});

// ---------------------------------------------------------------------------
// The request
// ---------------------------------------------------------------------------

export const chatParamsSchema = z.looseObject({
  model: z.string().min(1),
  // Non-empty: every dialect rejects a conversation with no turns, and an
  // empty array is nearly always a mapping bug upstream rather than intent.
  messages: z.array(messageSchema).min(1, "`messages` must contain at least one turn."),
  system: z
    .union([
      z.string(),
      z.array(z.looseObject({ text: z.string(), cache: cacheSchema.optional() })),
    ])
    .optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  temperature: z
    .number()
    .min(0)
    .max(
      2,
      "`temperature` is on unmodel's canonical 0–2 scale. Targets whose own ceiling is 1 (Anthropic) are clamped with an `approximated_param` warning at compile time; a value above 2 is outside the vocabulary itself.",
    )
    .optional(),
  topP: z.number().min(0).max(1).optional(),
  topK: z.number().int().nonnegative().optional(),
  stopSequences: z.array(z.string()).optional(),
  seed: z.number().int().optional(),
  // Penalty ranges differ across dialects (and have moved), so these stay open:
  // getting them wrong is a provider-side 400 with a clear message, not a
  // silently wrong request.
  presencePenalty: z.number().optional(),
  frequencyPenalty: z.number().optional(),
  candidates: z.number().int().positive().optional(),
  reasoning: reasoningSchema.optional(),
  responseFormat: responseFormatSchema.optional(),
  tools: z.record(z.string(), toolSpecSchema).optional(),
  nativeTools: z.array(nativeToolSchema).optional(),
  toolChoice: toolChoiceSchema.optional(),
  parallelToolCalls: z.boolean().optional(),
  user: z.string().optional(),
  serviceTier: z.string().optional(),
  stream: z.boolean().optional(),
  // Record of records: the values ride into the target's body verbatim, so
  // their shapes belong to the provider, not to this schema. What *is* checked
  // is that a bucket is an object — `providerOptions: { openai: true }` is a
  // mistake no downstream layer could interpret.
  providerOptions: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
});
