import { describe, expect, test } from "bun:test";
import {
  AI_INFLUENCER_OPTIONS_URL,
  CUSTOM_REFERENCES_LIST_URL,
  CUSTOM_REFERENCES_URL,
  FILES_GENERATE_UPLOAD_URL,
  GENJUTSU_RESTYLE_PRESETS_URL,
  HF_EXPIRES_AFTER_HEADER,
  HF_EXPIRES_AFTER_MIN_SECONDS,
  HF_WEBHOOK_PARAM,
  HIGGSFIELD_BASE_URL,
  IDEMPOTENCY_KEY_HEADER,
  IDEMPOTENCY_KEY_MAX_LENGTH,
  MARKETING_STUDIO_IMAGE_PRESETS_URL,
  MODELS_USAGE_URL,
  SOUL_STYLES_URL,
  SOUL_STYLES_V2_URL,
  WEBHOOK_ID_HEADER,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
  customReferenceUrl,
  estimateUrl,
  requestCancelUrl,
  requestStatusUrl,
  requestUrl,
  submitUrl,
} from "./urls";

const REQUEST_ID = "d7e6c0f3-6699-4f6c-bb45-2ad7fd9158ff";

describe("higgsfield urls", () => {
  test("the submit URL is the base and the route id, slashes kept", () => {
    expect(HIGGSFIELD_BASE_URL).toBe("https://api.higgsfield.ai");
    expect(submitUrl("bytedance/seedance-2.5/text-to-video")).toBe("https://api.higgsfield.ai/bytedance/seedance-2.5/text-to-video");
    expect(submitUrl("higgsfield-ai/soul/v2/standard")).toBe("https://api.higgsfield.ai/higgsfield-ai/soul/v2/standard");
  });

  test("each path segment is encoded on its own, so an id cannot add a query or climb the path", () => {
    expect(submitUrl("maker/a b/c?x=1#y")).toBe("https://api.higgsfield.ai/maker/a%20b/c%3Fx%3D1%23y");
    expect(new URL(submitUrl("maker/%2e%2e/admin")).pathname).toBe("/maker/%252e%252e/admin");
  });

  test("`hf_webhook` is a query parameter, URL-encoded whole", () => {
    expect(HF_WEBHOOK_PARAM).toBe("hf_webhook");
    const url = submitUrl("z-image/turbo", "https://hooks.example.com/hf?job=1&kind=image");
    expect(url).toBe("https://api.higgsfield.ai/z-image/turbo?hf_webhook=https%3A%2F%2Fhooks.example.com%2Fhf%3Fjob%3D1%26kind%3Dimage");
    expect(new URL(url).searchParams.get("hf_webhook")).toBe("https://hooks.example.com/hf?job=1&kind=image");
  });

  test("the estimate URL is the same route under /estimate", () => {
    // https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md, read 2026-11-24:
    //   --url https://api.higgsfield.ai/estimate/higgsfield-ai/soul/v2/standard
    expect(estimateUrl("higgsfield-ai/soul/v2/standard")).toBe("https://api.higgsfield.ai/estimate/higgsfield-ai/soul/v2/standard");
  });

  test("the request URLs are the ones a submit answers", () => {
    // https://docs.higgsfield.ai/docs/concepts/requests.md, read 2026-11-24.
    expect(requestStatusUrl(REQUEST_ID)).toBe(`https://api.higgsfield.ai/requests/${REQUEST_ID}/status`);
    expect(requestCancelUrl(REQUEST_ID)).toBe(`https://api.higgsfield.ai/requests/${REQUEST_ID}/cancel`);
    expect(requestUrl(REQUEST_ID)).toBe(`https://api.higgsfield.ai/requests/${REQUEST_ID}`);
    expect(requestUrl("a/b")).toBe("https://api.higgsfield.ai/requests/a%2Fb");
  });

  test("the fixed routes", () => {
    expect(FILES_GENERATE_UPLOAD_URL).toBe("https://api.higgsfield.ai/files/generate-upload-url");
    expect(CUSTOM_REFERENCES_URL).toBe("https://api.higgsfield.ai/v1/custom-references");
    expect(CUSTOM_REFERENCES_LIST_URL).toBe("https://api.higgsfield.ai/v1/custom-references/list");
    expect(customReferenceUrl("3f0c8a2e-5b7d-4e19-9a61-2c4d8e7f1a90")).toBe(
      "https://api.higgsfield.ai/v1/custom-references/3f0c8a2e-5b7d-4e19-9a61-2c4d8e7f1a90",
    );
    expect(SOUL_STYLES_URL).toBe("https://api.higgsfield.ai/v1/text2image/soul-styles");
    expect(SOUL_STYLES_V2_URL).toBe("https://api.higgsfield.ai/v1/text2image/soul-styles/v2");
    expect(GENJUTSU_RESTYLE_PRESETS_URL).toBe("https://api.higgsfield.ai/models/higgsfield/genjutsu/restyle/v1.0/presets");
    expect(MARKETING_STUDIO_IMAGE_PRESETS_URL).toBe("https://api.higgsfield.ai/marketing-studio/image/presets");
    expect(AI_INFLUENCER_OPTIONS_URL).toBe("https://api.higgsfield.ai/models/higgsfield/ai-influencer/options");
    expect(MODELS_USAGE_URL).toBe("https://api.higgsfield.ai/models/usage");
  });

  test("the header names and their published bounds", () => {
    expect(IDEMPOTENCY_KEY_HEADER).toBe("Idempotency-Key");
    expect(IDEMPOTENCY_KEY_MAX_LENGTH).toBe(255);
    expect(HF_EXPIRES_AFTER_HEADER).toBe("Hf-Expires-After");
    expect(HF_EXPIRES_AFTER_MIN_SECONDS).toBe(3600);
    expect([WEBHOOK_ID_HEADER, WEBHOOK_TIMESTAMP_HEADER, WEBHOOK_SIGNATURE_HEADER]).toEqual(["webhook-id", "webhook-timestamp", "webhook-signature"]);
  });
});
