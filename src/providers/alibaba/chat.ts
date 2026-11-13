/**
 * `alibaba.chat` — Alibaba Model Studio (Qwen model family) chat over the
 * OpenAI-compatible dialect: POST
 * https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions.
 * Params mirror the wire format exactly; validation runs against the
 * generated alibaba catalog. This is DashScope's international "compatible
 * mode" endpoint (the China endpoint is the separate alibaba-cn catalog).
 *
 * DashScope-only params (enable_thinking, enable_search, thinking_budget, …)
 * are not part of the shared dialect schema and surface as unknown-param
 * warnings rather than errors.
 *
 * A dedicated LEAF, not part of ../alibaba's barrel body, for the same reason
 * anthropic, google, openai and minimax have one: `src/chat/providers.ts`
 * imports the chat validator directly from here, so the ready `unmodel/chat`
 * entry never walks the provider barrel — which re-exports the video and TTS
 * validators that a chat bundle must not pay for (pinned by
 * `test/bundle-budget.test.ts`'s chat-graph enumeration). The per-model rule
 * tables below stay in this leaf for the same reason.
 */

import { createOpenAICompatible, type ChatCompletionsBodyBase } from "../openai-compatible";
import { models, provider } from "../../catalog/alibaba.gen";
import type { AlibabaTextModelId } from "../../catalog/alibaba.gen";
import { availability } from "../../catalog/availability/alibaba.gen";
import type { ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import type { PipelineContext } from "../../core/pipeline";

/** The Chat Completions reference: per-model `reasoning_effort` ladders and tool-call notes. */
const CHAT_DOCS =
  "https://www.alibabacloud.com/help/en/model-studio/qwen-api-via-openai-chat-completions";
/** The Qwen-Omni page: Qwen3.8-Omni-Flash's thinking and structured-output notes. */
const OMNI_DOCS = "https://www.alibabacloud.com/help/en/model-studio/qwen-omni";

/**
 * The Qwen3.8 `reasoning_effort` ladder (checked 2026-11-12). CHAT_DOCS, for
 * "qwen3.8-max, qwen3.8-max-0902, qwen3.8-flash, qwen3.8-2.4t-a95b,
 * qwen3.8-27b": "Valid values: xhigh (default) … medium … low … OpenAI
 * standard value mapping: max is mapped to xhigh, high is mapped to xhigh,
 * minimal is mapped to low, and none is mapped to enable_thinking=False.
 * Setting values other than the above valid values and mapped values will
 * cause an error." OMNI_DOCS, for qwen3.8-omni-flash: "The top-level Chat
 * Completions request field reasoning_effort accepts none, minimal, low,
 * medium, high, xhigh, and max."
 */
const QWEN38_REASONING_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];

/**
 * The ids both pages say reject `reasoning_effort` beside `thinking_budget`
 * (checked 2026-11-12). CHAT_DOCS: "For the … qwen3.8-max, qwen3.8-max-0902,
 * qwen3.8-flash, qwen3.8-2.4t-a95b, qwen3.8-27b, reasoning_effort and
 * thinking_budget cannot be set at the same time. Setting both will cause an
 * error." OMNI_DOCS, for qwen3.8-omni-flash: "Do not set reasoning_effort and
 * thinking_budget together: the request returns an error."
 */
const QWEN38_MODEL_IDS = [
  "qwen3.8-max",
  "qwen3.8-max-0902",
  "qwen3.8-flash",
  "qwen3.8-2.4t-a95b",
  "qwen3.8-27b",
  "qwen3.8-omni-flash",
] as const;

const QWEN38_MODEL_ID_SET: ReadonlySet<string> = new Set(QWEN38_MODEL_IDS);

/** Per-model rules the catalog cannot express. Every row cites its page (checked 2026-11-12). */
const chatConstraints: Readonly<Partial<Record<string, EndpointConstraints>>> = {
  ...Object.fromEntries(
    QWEN38_MODEL_IDS.map((id) => [id, { enums: { reasoning_effort: QWEN38_REASONING_EFFORTS } }]),
  ),
  "kimi-k3": {
    // CHAT_DOCS, the kimi-k3 group: "Default value: max Valid values: max
    // (default): deep reasoning high: enhanced reasoning low: light
    // reasoning" — no mapped values for this group, so anything else falls
    // under "Setting values other than the above valid values and mapped
    // values will cause an error."
    //
    // `top_p`: https://www.alibabacloud.com/help/en/model-studio/kimi-api
    // (checked 2026-11-12), "Default parameters": "| kimi-k3 | true (can be
    // disabled; keeping it enabled is recommended) | 1.0 | 0.95 | 0.0 | - |
    // - |" (columns: enable_thinking, temperature, top_p, presence_penalty).
    // The generated row's `temperature: false` makes this a fixed-sampling
    // model, so only the documented default passes — here 0.95, not the
    // generic 1. Corroborated by
    // https://platform.kimi.ai/docs/api/models-overview (checked 2026-11-12):
    // "The K3 series column applies to `kimi-k3`, …", "`top_p` | Fixed at
    // `0.95`" and "passing any other value returns an error". `temperature`
    // stays with the catalog check (1 passes); `presence_penalty` is
    // documented here only as a default, so it is not pinned.
    enums: { top_p: [0.95], reasoning_effort: ["max", "high", "low"] },
    deny: {
      parallel_tool_calls: {
        ignored: true,
        reason:
          "kimi-k3 does not support using this parameter to control whether tool calls are " +
          "parallel; the model may still return multiple tool_calls in one turn",
        source: CHAT_DOCS,
      },
    },
  },
  "kimi-k3.1-pro": {
    // https://www.alibabacloud.com/help/en/model-studio/kimi-api (checked
    // 2026-11-12): "The sampling parameters for kimi-k3.1-pro are fixed at
    // `temperature=1.0`, `top_p=0.95`, and `presence_penalty=0.0`. Passing a
    // non-default value for any of these parameters returns an error." and
    // "The following reasoning effort levels apply only to kimi-k3.1-pro,
    // with `max` as the default: max … high … medium … low". The id has no
    // models.dev row yet, so it validates with an unknown_model warning and
    // these enums are its only gate.
    enums: {
      temperature: [1],
      top_p: [0.95],
      presence_penalty: [0],
      reasoning_effort: ["max", "high", "medium", "low"],
    },
  },
};

export const { chat, chatUrl, checkChat, estimateChatTokens } =
  createOpenAICompatible<AlibabaTextModelId, typeof availability, "alibaba">({
    id: "alibaba",
    // Legacy international compatible-mode domain (the models.dev value;
    // still functional). Alibaba's doc page now recommends workspace/
    // region-specific domains like {WorkspaceId}.ap-southeast-1.maas.aliyuncs.com
    // — override via raw fetch if your workspace requires one.
    // https://www.alibabacloud.com/help/en/model-studio/compatibility-of-openai-with-dashscope
    baseUrl: provider.api,
    catalog: models,
    availability,
    constraints: chatConstraints,
    extraChecks: [checkThinkingBudgetPairing, checkOmniJsonSchema],
  });

/** `reasoning_effort` + the DashScope `thinking_budget` extension is a 400 on Qwen3.8. */
function checkThinkingBudgetPairing(
  params: ChatCompletionsBodyBase,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (!QWEN38_MODEL_ID_SET.has(params.model)) return;
  const thinkingBudget = (params as { thinking_budget?: unknown }).thinking_budget;
  if (params.reasoning_effort == null || thinkingBudget == null) return;
  ctx.report({
    code: "unsupported_param",
    path: ["thinking_budget"],
    model: params.model,
    message: `"${params.model}" rejects \`reasoning_effort\` and \`thinking_budget\` together; send one — \`reasoning_effort\` picks a thinking level, \`thinking_budget\` caps the thinking tokens.`,
    meta: {
      conflicting: ["reasoning_effort", "thinking_budget"],
      source: params.model === "qwen3.8-omni-flash" ? OMNI_DOCS : CHAT_DOCS,
    },
  });
}

/**
 * OMNI_DOCS (checked 2026-11-12): "Qwen3.8-Omni-Flash does not support JSON
 * Schema mode. JSON Mode guarantees JSON syntax only; define field
 * constraints in the prompt and validate them on the client." A warning, not
 * an error: the structured-output page documents a silent fall-back to
 * `json_object` for multimodal inputs and states no rejection, so the request
 * may well be served — without the schema.
 */
function checkOmniJsonSchema(
  params: ChatCompletionsBodyBase,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (params.model !== "qwen3.8-omni-flash" || params.response_format?.type !== "json_schema") {
    return;
  }
  ctx.report({
    code: "unsupported_capability",
    severity: "warning",
    path: ["response_format"],
    model: params.model,
    message:
      '"qwen3.8-omni-flash" does not support JSON Schema mode; it offers JSON Mode ' +
      '(`response_format: { type: "json_object" }`), which guarantees JSON syntax only — the ' +
      "schema's field constraints are not enforced, so validate the output on the client.",
    meta: { source: OMNI_DOCS },
  });
}
