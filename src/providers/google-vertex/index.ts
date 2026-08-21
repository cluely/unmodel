/**
 * unmodel/google-vertex — Gemini `generateContent` on Vertex AI.
 *
 * Same camelCase wire dialect as unmodel/google (the Gemini API), but the URL
 * is project/location-scoped, so there is no provider-wide static URL:
 *
 * - Regional: `POST https://{location}-aiplatform.googleapis.com/v1/projects/{project}/locations/{location}/publishers/google/models/{model}:generateContent`
 * - Global (location "global"): `POST https://aiplatform.googleapis.com/v1/projects/{project}/locations/global/publishers/google/models/{model}:generateContent`
 *
 * Source: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/inference
 * (checked 2026-08-13).
 *
 * Body differences from the Gemini API, per the same reference: no `store` /
 * `serviceTier` fields; `labels` (billing labels) is supported. Vertex-only
 * part fields like `displayName` are valid here (unmodel/google warns on them
 * for generativelanguage).
 *
 * Auth is your job (unmodel never touches credentials): Vertex uses OAuth —
 * add `authorization: Bearer <access token>` (e.g. from Application Default
 * Credentials or `gcloud auth print-access-token`).
 *
 * ```ts
 * const vertex = createGoogleVertex({ project: "my-project", location: "us-central1" });
 * const params = vertex.chat({ model: "gemini-2.5-flash", contents: [...] });
 * await fetch(params.request.url, {
 *   method: params.request.method,
 *   headers: { ...params.request.headers, authorization: `Bearer ${accessToken}` },
 *   body: JSON.stringify(params),
 * });
 * // Or via @google/genai: new GoogleGenAI({ vertexai: true, project, location })
 * //   .models.generateContent(params.toSdk("google-vertex"))
 * ```
 */
import {
  createChat,
  type GoogleVertexConfig,
  type GoogleVertexChat,
} from "./chat";
import { checkChat } from "./check";

export interface GoogleVertexProvider {
  /**
   * Validates params for `models/{model}:generateContent` on this
   * project/location. The result's enumerable properties are the exact fetch
   * body (`model` is stripped — it lives in `.request.url`);
   * `.toSdk("google-vertex")` re-shapes for `@google/genai`
   * (`vertexai: true`); `.toApi("google")` retargets the same Gemini request
   * at the AI Studio endpoint (same dialect, so it is a URL swap).
   */
  chat: GoogleVertexChat;
  /** Post-generation response inspection + usage pricing. Never throws. */
  checkChat: typeof checkChat;
}

/** Builds the validator surface bound to one Google Cloud project + location. */
export function createGoogleVertex(config: GoogleVertexConfig): GoogleVertexProvider {
  return {
    chat: createChat(config),
    checkChat,
  };
}

export { checkChat } from "./check";
export {
  createChat,
  generateContentUrl,
  type GoogleVertexConfig,
  type GoogleVertexChat,
  type VertexGenerateContentBody,
  type VertexGenerateContentSdkParams,
  type VertexChatSdkTargets,
} from "./chat";

// The wire dialect types are unmodel/google's — re-exported so callers don't
// need a second import.
export type {
  ChatResponseLike,
  GoogleCodeExecutionResult,
  GoogleContent,
  GoogleExecutableCode,
  GoogleFileData,
  GoogleFinishReason,
  GoogleFunctionCall,
  GoogleFunctionCallingConfig,
  GoogleFunctionDeclaration,
  GoogleFunctionResponse,
  GoogleGenerationConfig,
  GoogleHarmBlockThreshold,
  GoogleHarmCategory,
  GoogleInlineData,
  GooglePart,
  GoogleRole,
  GoogleSafetySetting,
  GoogleThinkingConfig,
  GoogleTool,
  GoogleToolCall,
  GoogleToolConfig,
  GoogleToolResponse,
  GoogleVideoMetadata,
} from "../google";

export { models, provider } from "../../catalog/google-vertex.gen";
export type {
  GoogleVertexModelId,
  GoogleVertexTextModelId,
  GoogleVertexImageModelId,
  GoogleVertexAudioModelId,
  GoogleVertexVideoModelId,
} from "../../catalog/google-vertex.gen";
