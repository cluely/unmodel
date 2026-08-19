import { z } from "zod";
import type { GenerateContentBody } from "../google/wire";
import type { GoogleVertexTextModelId } from "../../catalog/google-vertex.gen";

// ---------------------------------------------------------------------------
// Wire leaf for Vertex AI generateContent: the wire types and the zod schema,
// and nothing else. This module imports only zod, type-only catalog ids, and
// the sibling Gemini wire leaf — no pipeline, no validator, no checks — so
// retarget/translate machinery can depend on the dialect without creating a
// cycle back through ./chat.ts. Enforced by
// test/import-graph.test.ts.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Wire types — Gemini generateContent on Vertex AI:
// POST https://{location}-aiplatform.googleapis.com/v1/projects/{project}/locations/{location}/publishers/google/models/{model}:generateContent
// The body is the same camelCase wire dialect as the Gemini API
// (src/providers/google/chat.ts) with two verified differences:
// Vertex has no `store` / `serviceTier` fields and adds `labels`.
// Reference: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/inference
// (checked 2026-08-13; request fields: contents, systemInstruction, tools,
// toolConfig, safetySettings, generationConfig, cachedContent, labels).
// ---------------------------------------------------------------------------

/**
 * Raw Vertex wire body plus `model`. On the wire the model id lives ONLY in
 * the URL path — the validated output strips `model` from the enumerable
 * body and interpolates it into `.request.url` instead.
 *
 * Reuses the Gemini API dialect types from unmodel/google; note that on
 * Vertex `fileData.fileUri` is a Cloud Storage URI ("gs://…") or public URL,
 * and `cachedContent` is a full resource name
 * ("projects/{p}/locations/{l}/cachedContents/{id}").
 */
export interface VertexGenerateContentBody
  extends Omit<GenerateContentBody, "model" | "store" | "serviceTier"> {
  model: GoogleVertexTextModelId | (string & {});
  /** User-defined metadata labels to break down billed charges (Vertex-only). */
  labels?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Schema — DUPLICATED (minimally) from src/providers/google/wire.ts.
// Differences: `store`/`serviceTier` removed, `labels` added. Keep in sync.
// ---------------------------------------------------------------------------

const PART_KINDS = [
  "text",
  "inlineData",
  "fileData",
  "functionCall",
  "functionResponse",
  "executableCode",
  "codeExecutionResult",
  "toolCall",
  "toolResponse",
] as const;

const partSchema = z.looseObject({
  text: z.string().optional(),
  inlineData: z.looseObject({ mimeType: z.string(), data: z.string() }).optional(),
  fileData: z.looseObject({ fileUri: z.string(), mimeType: z.string().optional() }).optional(),
  functionCall: z
    .looseObject({ name: z.string(), args: z.record(z.string(), z.unknown()).optional() })
    .optional(),
  functionResponse: z
    .looseObject({ name: z.string(), response: z.record(z.string(), z.unknown()) })
    .optional(),
  executableCode: z.looseObject({ language: z.string().optional(), code: z.string().optional() }).optional(),
  codeExecutionResult: z
    .looseObject({ outcome: z.string().optional(), output: z.string().optional() })
    .optional(),
  toolCall: z
    .looseObject({
      id: z.string().optional(),
      toolName: z.string().optional(),
      toolType: z.string().optional(),
      args: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
  toolResponse: z
    .looseObject({
      id: z.string().optional(),
      toolType: z.string().optional(),
      response: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
  thought: z.boolean().optional(),
  thoughtSignature: z.string().optional(),
});

const contentSchema = z.looseObject({
  role: z.enum(["user", "model"]).optional(),
  parts: z.array(partSchema),
});

const generationConfigSchema = z.looseObject({
  stopSequences: z.array(z.string()).optional(),
  responseMimeType: z.string().optional(),
  responseSchema: z.record(z.string(), z.unknown()).optional(),
  responseJsonSchema: z.unknown().optional(),
  responseModalities: z.array(z.string()).optional(),
  candidateCount: z.number().int().optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  temperature: z.number().optional(),
  topP: z.number().optional(),
  topK: z.number().optional(),
  seed: z.number().int().optional(),
  presencePenalty: z.number().optional(),
  frequencyPenalty: z.number().optional(),
  responseLogprobs: z.boolean().optional(),
  logprobs: z.number().int().optional(),
  thinkingConfig: z
    .looseObject({
      includeThoughts: z.boolean().optional(),
      thinkingBudget: z.number().int().optional(),
      thinkingLevel: z.string().optional(),
    })
    .optional(),
  mediaResolution: z.string().optional(),
});

/** Loose top-level schema for the Vertex generateContent wire body. */
export const vertexGenerateContentSchema = z
  .looseObject({
    model: z.string(),
    contents: z.array(contentSchema).min(1, "contents must contain at least one Content"),
    systemInstruction: contentSchema.optional(),
    tools: z.array(z.looseObject({})).optional(),
    toolConfig: z.looseObject({}).optional(),
    safetySettings: z.array(z.looseObject({ category: z.string(), threshold: z.string() })).optional(),
    generationConfig: generationConfigSchema.optional(),
    cachedContent: z.string().optional(),
    labels: z.record(z.string(), z.string()).optional(),
  })
  .superRefine((value, refCtx) => {
    value.contents.forEach((content, i) => {
      content.parts.forEach((part, j) => {
        const kinds = PART_KINDS.filter((kind) => (part as Record<string, unknown>)[kind] !== undefined);
        if (kinds.length !== 1) {
          refCtx.addIssue({
            code: "custom",
            path: ["contents", i, "parts", j],
            message: `each part must set exactly one of ${PART_KINDS.join(", ")}; found ${
              kinds.length === 0 ? "none" : kinds.join(" + ")
            }.`,
          });
        }
      });
    });
  });
