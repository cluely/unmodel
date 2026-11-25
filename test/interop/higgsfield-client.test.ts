/**
 * `.toSdk("higgsfield")` against the real `@higgsfield/client` — the golden
 * for the one promise that target makes: handed to `subscribe`, the client
 * sends the request `.request` describes.
 *
 * The client is pointed at a local server through its own `baseURL` option,
 * so what is compared is what it actually put on the wire: the path, the
 * `hf_webhook` query and the JSON body. Nothing leaves the machine and no
 * credential is real.
 *
 * The compile-time half — which `.toSdk` results `subscribe` accepts as
 * written — is in `test/types/higgsfield.test-d.ts`.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHiggsfieldClient, type HiggsfieldClient } from "@higgsfield/client/v2";

import { image, video } from "../../src/providers/higgsfield";

interface Received {
  method: string;
  target: string;
  body: unknown;
}

const SEEDANCE = "bytedance/seedance-2.5/text-to-video";
const SOUL = "higgsfield-ai/soul/standard";
const HOOK = "https://hooks.example.com/hf?job=1&step=2";

let server: ReturnType<typeof Bun.serve>;
let client: HiggsfieldClient;
let received: Received[] = [];

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      const url = new URL(request.url);
      received.push({ method: request.method, target: url.pathname + url.search, body: await request.json() });
      return Response.json({ status: "queued", request_id: "REQUEST_ID" });
    },
  });
  client = createHiggsfieldClient({ apiKey: "KEY_ID", apiSecret: "KEY_SECRET", baseURL: `http://127.0.0.1:${server.port}`, maxRetries: 0 });
});

afterAll(() => {
  void server.stop(true);
});

/** The path and query of a validated request's URL: what the client must send to its own base. */
function targetOf(url: string): string {
  const parsed = new URL(url);
  return parsed.pathname + parsed.search;
}

describe('`.toSdk("higgsfield")` through @higgsfield/client/v2 `subscribe`', () => {
  test("without a webhook: the same path and the same body, and the value is passed as written", async () => {
    received = [];
    const params = video({ endpoint: SEEDANCE, prompt: "a fox", resolution: "720p", duration: 5 });
    await client.subscribe(SEEDANCE, { ...params.toSdk("higgsfield"), withPolling: false });
    expect(received).toEqual([{ method: "POST", target: targetOf(params.request.url), body: JSON.parse(JSON.stringify(params)) }]);
    expect(received[0]?.body).toEqual({ prompt: "a fox", resolution: "720p", duration: 5 });
  });

  test("with a webhook: the client builds the `hf_webhook` query `.request.url` carries", async () => {
    received = [];
    const params = image({ endpoint: SOUL, prompt: "x", seed: null, hf_webhook: HOOK });
    const sdk = params.toSdk("higgsfield");
    // The client's type asks for a `secret` its v2 code never reads.
    await client.subscribe(SOUL, { ...sdk, webhook: { ...sdk.webhook, secret: "WEBHOOK_SECRET" }, withPolling: false });
    expect(received).toEqual([{ method: "POST", target: targetOf(params.request.url), body: { prompt: "x", seed: null } }]);
    expect(received[0]?.target).toBe("/higgsfield-ai/soul/standard?hf_webhook=https%3A%2F%2Fhooks.example.com%2Fhf%3Fjob%3D1%26step%3D2");
  });
});
