import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REVANA_WEBHOOK_TOLERANCE_SECONDS, verifyWebhook, type WebhookVerification } from "./webhook";

/**
 * `verifyWebhook`, against the two deliveries Revana really made
 * (`test/fixtures/revana/queue.webhook.*.json`, 2026-11-13: raw body, headers).
 *
 * The account's signing secret is not in the repository, so the recorded
 * signatures cannot be re-checked here — that was done once, when they were
 * recorded, and is what fixed the key as the secret's own UTF-8 text. What
 * these tests hold is the scheme: each recorded BODY, byte for byte, signed
 * the documented way with a stand-in secret, verifies; and the recorded
 * signature, made with a different secret, does not.
 */

interface Recorded {
  headers: Record<string, string>;
  body: string;
}

function recorded(name: string): Recorded {
  return JSON.parse(readFileSync(join(import.meta.dir, "../../../test/fixtures/revana", name), "utf8")) as Recorded;
}

const SECRET = "a-stand-in-signing-secret";
const NOW = 1_794_533_700;

/** `t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">`, by Node's own HMAC. */
function sign(body: string, t: number, secret = SECRET): string {
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
}

function verify(body: string | Uint8Array, signature: string | undefined, now = NOW): Promise<WebhookVerification> {
  return verifyWebhook({
    body,
    headers: signature === undefined ? {} : { "revana-signature": signature },
    secret: SECRET,
    now,
  });
}

const ok = recorded("queue.webhook.ok.json");
const failed = recorded("queue.webhook.error.json");

describe("the recorded deliveries", () => {
  test("carry the documented headers, in the documented form", () => {
    for (const delivery of [ok, failed]) {
      expect(delivery.headers["revana-signature"]).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
      const requestId = (JSON.parse(delivery.body) as { request_id: string }).request_id;
      expect(delivery.headers["revana-webhook-id"]).toBe(`wh_${requestId}`);
      expect(delivery.headers["content-length"]).toBe(String(Buffer.byteLength(delivery.body)));
    }
  });

  test("the success, signed the documented way, verifies and is typed", async () => {
    const verdict = await verify(ok.body, sign(ok.body, NOW));
    if (!verdict.ok) throw new Error(verdict.message);
    expect(verdict.authentic).toBe(true);
    expect(verdict.timestamp).toBe(NOW);
    const { delivery } = verdict;
    if (delivery.status !== "OK") throw new Error("the fixture is the success");
    expect(delivery.request_id).toBe("gen_ea7940d91db84aad8d22");
    expect(delivery.gateway_request_id).toBe(delivery.request_id);
    expect(delivery.payload.images?.[0]).toEqual({
      url: "https://api.revana.si/v1/queue/revana/z-image/requests/gen_ea7940d91db84aad8d22/content",
      width: 1024,
      height: 1024,
      file_name: "gen_ea7940d91db84aad8d22.png",
      file_size: 1115782,
      content_type: "image/png",
    });
  });

  test("the failure verifies too, and says what failed", async () => {
    const verdict = await verify(failed.body, sign(failed.body, NOW));
    if (!verdict.ok) throw new Error(verdict.message);
    const { delivery } = verdict;
    if (delivery.status !== "ERROR") throw new Error("the fixture is the failure");
    expect(delivery.payload.error_type).toBe("invalid_input");
    expect(delivery.payload.detail).toBe(delivery.error);
    expect(delivery.error).toContain("You were not charged.");
  });

  test("Revana's own signature does not verify under another secret", async () => {
    const signature = ok.headers["revana-signature"] as string;
    const t = Number(/^t=(\d+)/.exec(signature)?.[1]);
    const verdict = await verify(ok.body, signature, t);
    expect(verdict).toMatchObject({ ok: false, authentic: false, reason: "signature_mismatch" });
  });
});

describe("what makes a delivery not Revana's", () => {
  const body = ok.body;

  test("no signature header", async () => {
    expect(await verify(body, undefined)).toMatchObject({ ok: false, authentic: false, reason: "missing_signature" });
  });

  test("a header that is not `t=<digits>,v1=<64 hex digits>`", async () => {
    const good = sign(body, NOW);
    for (const header of ["", "v1=abc", `${good},v1=00`, good.replace("t=", "ts="), good.toUpperCase(), good.slice(0, -1), ` ${good}`]) {
      expect(await verify(body, header)).toMatchObject({ authentic: false, reason: "malformed_signature" });
    }
  });

  test("a timestamp more than 300 seconds from now, either way", async () => {
    expect(REVANA_WEBHOOK_TOLERANCE_SECONDS).toBe(300);
    expect((await verify(body, sign(body, NOW - 300))).ok).toBe(true);
    expect((await verify(body, sign(body, NOW + 300))).ok).toBe(true);
    expect(await verify(body, sign(body, NOW - 301))).toMatchObject({ authentic: false, reason: "stale_timestamp" });
    expect(await verify(body, sign(body, NOW + 301))).toMatchObject({ authentic: false, reason: "stale_timestamp" });
  });

  test("a body that is not, byte for byte, the one that was signed", async () => {
    const signature = sign(body, NOW);
    const reserialised = JSON.stringify(JSON.parse(body), null, 1);
    expect(await verify(reserialised, signature)).toMatchObject({ authentic: false, reason: "signature_mismatch" });
    expect(await verify(`${body} `, signature)).toMatchObject({ authentic: false, reason: "signature_mismatch" });
  });

  test("another secret, or the timestamp of another delivery", async () => {
    expect(await verify(body, sign(body, NOW, "another-secret"))).toMatchObject({ reason: "signature_mismatch" });
    const moved = sign(body, NOW).replace(`t=${NOW}`, `t=${NOW + 1}`);
    expect(await verify(body, moved)).toMatchObject({ reason: "signature_mismatch" });
  });

  test("the message of a mismatch names the two usual causes", async () => {
    const verdict = await verify(`${body} `, sign(body, NOW));
    if (verdict.ok) throw new Error("should not verify");
    expect(verdict.message).toContain("raw request body");
    expect(verdict.message).toContain("rather than the API key");
  });
});

describe("what it takes as a request", () => {
  const body = ok.body;
  const signature = sign(body, NOW);

  test("fetch `Headers`, and Node's lowercased record with a list value", async () => {
    const viaHeaders = await verifyWebhook({ body, headers: new Headers({ "Revana-Signature": signature }), secret: SECRET, now: NOW });
    expect(viaHeaders.ok).toBe(true);
    const viaNode = await verifyWebhook({ body, headers: { "revana-signature": [signature] }, secret: SECRET, now: NOW });
    expect(viaNode.ok).toBe(true);
    const viaMixedCase = await verifyWebhook({ body, headers: { "Revana-Signature": signature }, secret: SECRET, now: NOW });
    expect(viaMixedCase.ok).toBe(true);
  });

  test("the raw bytes as readily as the raw text, non-ASCII included", async () => {
    expect((await verify(new TextEncoder().encode(body), signature)).ok).toBe(true);
    const accented = body.replace("gen_ea7940d91db84aad8d22.png", "renard-é.png");
    expect((await verify(new TextEncoder().encode(accented), sign(accented, NOW))).ok).toBe(true);
    expect((await verify(accented, sign(accented, NOW))).ok).toBe(true);
  });

  test("the clock, when `now` is left out", async () => {
    const t = Math.floor(Date.now() / 1000);
    const verdict = await verifyWebhook({ body, headers: { "revana-signature": sign(body, t) }, secret: SECRET });
    expect(verdict.ok).toBe(true);
    const old = await verifyWebhook({ body, headers: { "revana-signature": signature }, secret: SECRET });
    expect(old).toMatchObject({ authentic: false, reason: "stale_timestamp" });
  });
});

describe("authentic, and not a delivery unmodel knows", () => {
  test("is kept apart from a forgery, with the parsed body handed back", async () => {
    for (const json of [
      { request_id: "gen_1", gateway_request_id: "gen_1", status: "PARTIAL", payload: {} },
      { request_id: "gen_1", gateway_request_id: "gen_1", status: "OK", payload: { text: "hi" } },
      { request_id: "gen_1", gateway_request_id: "gen_1", status: "ERROR", payload: { detail: "no" } },
      { status: "OK", payload: { images: [] } },
      [],
    ]) {
      const body = JSON.stringify(json);
      const verdict = await verify(body, sign(body, NOW));
      expect(verdict).toMatchObject({ ok: false, authentic: true, reason: "unrecognized_body", timestamp: NOW });
      if (!verdict.ok && verdict.authentic) expect(verdict.json).toEqual(json);
    }
  });

  test("a signed body that is not JSON at all", async () => {
    const verdict = await verify("pong", sign("pong", NOW));
    expect(verdict).toMatchObject({ ok: false, authentic: true, reason: "unrecognized_body" });
    if (!verdict.ok && verdict.authentic) expect(verdict.json).toBeUndefined();
  });

  test("a video and a sound are deliveries as much as a picture is", async () => {
    for (const payload of [{ video: { url: "https://api.revana.si/v" } }, { audio: { url: "https://api.revana.si/a" }, audios: [] }]) {
      const body = JSON.stringify({ request_id: "gen_1", gateway_request_id: "gen_1", status: "OK", payload });
      expect((await verify(body, sign(body, NOW))).ok).toBe(true);
    }
  });
});
