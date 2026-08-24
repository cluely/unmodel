import { describe, expect, test } from "bun:test";

import {
  DEFAULT_ENDPOINT_ID,
  ENDPOINTS,
  endpointStreamUrl,
  endpointUrl,
  isFactoryEndpoint,
  resolveEndpoint,
  type TargetEndpoint,
} from "./endpoints";

// The endpoint table is hand-written (models.dev records `api: null` for azure
// and google-vertex, and the factory providers have no provider-wide URL at
// all), so the only thing keeping it honest is this file: every static entry
// is compared against the URL constant the provider module itself exports.
// A provider that moves its base URL now fails here instead of retargeting
// requests into a 404.
import { CHAT_COMPLETIONS_URL as alibaba } from "../../providers/alibaba";
import { CHAT_COMPLETIONS_URL as baseten } from "../../providers/baseten";
import { CHAT_COMPLETIONS_URL as cerebras } from "../../providers/cerebras";
import { CHAT_COMPLETIONS_URL as deepinfra } from "../../providers/deepinfra";
import { CHAT_COMPLETIONS_URL as deepseek } from "../../providers/deepseek";
import { CHAT_COMPLETIONS_URL as fireworksAi } from "../../providers/fireworks-ai";
import { CHAT_COMPLETIONS_URL as friendli } from "../../providers/friendli";
import { CHAT_COMPLETIONS_URL as groq } from "../../providers/groq";
import { CHAT_COMPLETIONS_URL as huggingface } from "../../providers/huggingface";
import { CHAT_COMPLETIONS_URL as inception } from "../../providers/inception";
import { CHAT_COMPLETIONS_URL as longcat } from "../../providers/longcat";
import { CHAT_COMPLETIONS_URL as meta } from "../../providers/meta";
import { CHAT_COMPLETIONS_URL as minimax } from "../../providers/minimax";
import { CHAT_COMPLETIONS_URL as mistral } from "../../providers/mistral";
import { CHAT_COMPLETIONS_URL as moonshotai } from "../../providers/moonshotai";
import { CHAT_COMPLETIONS_URL as nebius } from "../../providers/nebius";
import { CHAT_COMPLETIONS_URL as novitaAi } from "../../providers/novita-ai";
import { CHAT_COMPLETIONS_URL as nvidia } from "../../providers/nvidia";
import { CHAT_COMPLETIONS_URL as openai } from "../../providers/openai";
import { CHAT_COMPLETIONS_URL as openrouter } from "../../providers/openrouter";
import { CHAT_COMPLETIONS_URL as perplexity } from "../../providers/perplexity";
import { CHAT_COMPLETIONS_URL as sarvam } from "../../providers/sarvam";
import { CHAT_COMPLETIONS_URL as scaleway } from "../../providers/scaleway";
import { CHAT_COMPLETIONS_URL as siliconflow } from "../../providers/siliconflow";
import { CHAT_COMPLETIONS_URL as stepfun } from "../../providers/stepfun";
import { CHAT_COMPLETIONS_URL as togetherai } from "../../providers/togetherai";
import { CHAT_COMPLETIONS_URL as upstage } from "../../providers/upstage";
import { CHAT_COMPLETIONS_URL as vercel } from "../../providers/vercel";
import { CHAT_COMPLETIONS_URL as xai } from "../../providers/xai";
import { CHAT_COMPLETIONS_URL as zhipuai } from "../../providers/zhipuai";

import { MESSAGES_URL, ANTHROPIC_VERSION } from "../../providers/anthropic";
import { generateContentUrl } from "../../providers/google";
import { createCloudflare } from "../../providers/cloudflare-workers-ai";
import { azureChatCompletionsUrl } from "../../providers/azure";
import { converseUrl } from "../../providers/amazon-bedrock";
import { generateContentUrl as vertexGenerateContentUrl } from "../../providers/google-vertex";

/** Provider id → the chat URL that provider's own module publishes. */
const PROVIDER_CHAT_URLS: Readonly<Record<string, string>> = {
  alibaba,
  baseten,
  cerebras,
  deepinfra,
  deepseek,
  "fireworks-ai": fireworksAi,
  friendli,
  groq,
  huggingface,
  inception,
  longcat,
  meta,
  minimax,
  mistral,
  moonshotai,
  nebius,
  "novita-ai": novitaAi,
  nvidia,
  openai,
  openrouter,
  perplexity,
  sarvam,
  scaleway,
  siliconflow,
  stepfun,
  togetherai,
  upstage,
  vercel,
  xai,
  zhipuai,
};

const entries = Object.entries(ENDPOINTS);

describe("endpoint table", () => {
  test("every entry's key is its own id", () => {
    for (const [key, endpoint] of entries) expect(endpoint.id).toBe(key);
  });

  test("every entry's id is `<provider>.<endpoint>`", () => {
    for (const [, endpoint] of entries) {
      expect(endpoint.id.startsWith(`${endpoint.provider}.`)).toBe(true);
    }
  });

  test("every provider has exactly one default endpoint, and it exists", () => {
    for (const [provider, id] of Object.entries(DEFAULT_ENDPOINT_ID)) {
      const endpoint = ENDPOINTS[id];
      expect(endpoint, `${provider} defaults to a missing endpoint ${id}`).toBeDefined();
      expect(endpoint?.provider).toBe(provider);
    }
    const providers = new Set(entries.map(([, e]) => e.provider));
    for (const provider of providers) {
      expect(Object.hasOwn(DEFAULT_ENDPOINT_ID, provider), `${provider} has no default`).toBe(true);
    }
  });

  test("every entry sends JSON", () => {
    for (const [, endpoint] of entries) {
      expect(endpoint.headers["content-type"]).toBe("application/json");
    }
  });

  // Checked against each row's own `auth.header` rather than a hardcoded list
  // of header names: a literal deny-list only guards the names someone thought
  // of (the previous one missed `x-goog-api-key`, which google.chat uses), and
  // it goes stale the moment a row arrives with a header not on it. This form
  // cannot: adding an endpoint adds its own guard.
  test("no entry's static headers include its own auth header", () => {
    for (const [id, endpoint] of entries) {
      const auth = endpoint.auth.header.toLowerCase();
      const names = Object.keys(endpoint.headers).map((name) => name.toLowerCase());
      const why = `${id} ships its own auth header — unmodel never touches API keys`;
      expect(names, why).not.toContain(auth);
    }
  });

  test("every entry names a lowercase auth header, and a scheme only from the union", () => {
    for (const [id, endpoint] of entries) {
      const { header, scheme } = endpoint.auth;
      expect(header, `${id} has an empty auth header`).not.toBe("");
      expect(header, `${id} spells its auth header with capitals`).toBe(header.toLowerCase());
      if (scheme !== undefined) expect(["Bearer", "Basic", "Token"]).toContain(scheme);
    }
  });
});

describe("agreement with provider modules", () => {
  test("every openai-chat target's URL equals the provider's own constant", () => {
    const declared = entries
      .filter(([, e]) => e.dialect === "openai-chat" && !isFactoryEndpoint(e))
      .map(([, e]) => e.provider)
      .sort();
    // Guards against the table quietly shrinking: the assertion below is
    // vacuous if the list it iterates is empty or partial.
    expect(declared).toEqual(Object.keys(PROVIDER_CHAT_URLS).sort());

    for (const provider of declared) {
      const endpoint = resolveEndpoint(provider) as TargetEndpoint;
      expect(endpointUrl(endpoint, "any-model"), `${provider} URL drifted`).toBe(
        PROVIDER_CHAT_URLS[provider] as string,
      );
    }
  });

  test("anthropic.chat matches MESSAGES_URL and requires anthropic-version", () => {
    const endpoint = resolveEndpoint("anthropic") as TargetEndpoint;
    expect(endpoint.dialect).toBe("anthropic-messages");
    expect(endpointUrl(endpoint, "claude-opus-5")).toBe(MESSAGES_URL);
    expect(endpoint.headers["anthropic-version"]).toBe(ANTHROPIC_VERSION);
  });

  test("google.chat builds the same per-model URL as the provider", () => {
    const endpoint = resolveEndpoint("google") as TargetEndpoint;
    expect(endpoint.dialect).toBe("gemini");
    for (const model of ["gemini-3-pro", "models/gemini-3-pro"]) {
      expect(endpointUrl(endpoint, model)).toBe(generateContentUrl(model));
    }
  });
});

describe("endpointStreamUrl", () => {
  // Gemini is the one surface where streaming is a different *method*, so it
  // is the only entry that declares a `streamUrl`; the `?alt=sse` suffix is
  // load-bearing (without it the method returns a JSON array, not a stream).
  test("google.chat streams from :streamGenerateContent?alt=sse", () => {
    const endpoint = resolveEndpoint("google") as TargetEndpoint;
    expect(endpointStreamUrl(endpoint, "gemini-3-pro")).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro:streamGenerateContent?alt=sse",
    );
    // The same "models/" tolerance the non-streaming builder has.
    expect(endpointStreamUrl(endpoint, "models/gemini-3-pro")).toBe(
      endpointStreamUrl(endpoint, "gemini-3-pro"),
    );
  });

  test("in-body streamers fall back to their plain URL", () => {
    // openai-chat and anthropic-messages both carry `stream: true` on the body
    // and post to the same place, so declaring a streamUrl for them would be
    // duplication that can drift.
    for (const provider of ["openai", "groq", "anthropic"]) {
      const endpoint = resolveEndpoint(provider) as TargetEndpoint;
      expect(endpoint.streamUrl).toBeUndefined();
      expect(endpointStreamUrl(endpoint, "m")).toBe(endpointUrl(endpoint, "m"));
    }
  });

  test("is undefined for factory targets, exactly like endpointUrl", () => {
    const vertex = ENDPOINTS["google-vertex.chat"] as TargetEndpoint;
    expect(endpointStreamUrl(vertex, "gemini-3-pro")).toBeUndefined();
  });
});

describe("factory targets", () => {
  const FACTORY_IDS = [
    "amazon-bedrock.chat",
    "azure.chat",
    "cloudflare-workers-ai.chat",
    "google-vertex.chat",
    "google-vertex.chatMaas",
  ];

  test("are exactly the entries with no static URL", () => {
    const withoutUrl = entries
      .filter(([, e]) => e.url === undefined)
      .map(([id]) => id)
      .sort();
    expect(withoutUrl).toEqual(FACTORY_IDS);
    for (const id of FACTORY_IDS) {
      const endpoint = ENDPOINTS[id] as TargetEndpoint;
      expect(isFactoryEndpoint(endpoint), `${id} must declare its config keys`).toBe(true);
      expect(endpointUrl(endpoint, "any-model")).toBeUndefined();
    }
  });

  // The config keys are the reason these are excluded from the one-arg
  // `.toApi` union, so each one must line up with the argument its provider's
  // real factory takes.
  test("their config keys match what each provider's factory needs", () => {
    expect(ENDPOINTS["amazon-bedrock.chat"]?.config).toEqual(["region"]);
    expect(converseUrl("us-east-1", "anthropic.claude-opus-5")).toContain("us-east-1");

    expect(ENDPOINTS["azure.chat"]?.config).toEqual(["endpoint"]);
    expect(azureChatCompletionsUrl("https://acme.openai.azure.com")).toContain("acme");

    expect(ENDPOINTS["google-vertex.chat"]?.config).toEqual(["project", "location"]);
    expect(vertexGenerateContentUrl("p1", "us-central1", "gemini-3-pro")).toContain("p1");

    expect(ENDPOINTS["cloudflare-workers-ai.chat"]?.config).toEqual(["accountId"]);
    expect(createCloudflare("acct-1").chatUrl).toContain("acct-1");
  });
});

describe("resolveEndpoint", () => {
  test("falls back to the provider's default surface", () => {
    expect(resolveEndpoint("groq")?.id).toBe("groq.chat");
    expect(resolveEndpoint("google")?.id).toBe("google.chat");
  });

  test("honours the explicit endpoint id the availability data carries", () => {
    // The `*-maas` rows point here: same provider, different dialect.
    const maas = resolveEndpoint("google-vertex", "google-vertex.chatMaas");
    expect(maas?.dialect).toBe("openai-chat");
    expect(resolveEndpoint("google-vertex")?.dialect).toBe("gemini");
  });

  test("is undefined for unknown providers and unknown endpoint ids", () => {
    expect(resolveEndpoint("not-a-provider")).toBeUndefined();
    expect(resolveEndpoint("groq", "groq.embeddings")).toBeUndefined();
  });

  test("does not resolve inherited Object.prototype keys", () => {
    expect(resolveEndpoint("constructor")).toBeUndefined();
    expect(resolveEndpoint("groq", "toString")).toBeUndefined();
  });
});
