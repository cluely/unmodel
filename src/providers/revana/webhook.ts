/**
 * The receiving end of `fal_webhook`: is this POST Revana's, and what does it
 * say?
 *
 * A `revana.*Queue` address validates the request that asks for a webhook.
 * The delivery arrives later, at the caller's own route, and this is the half
 * of it that is not transport — the caller still owns the server, the route
 * and the 2xx. unmodel sends nothing here either; it reads what was received.
 *
 * # The signature, as documented and as recorded
 *
 * "Every delivery carries `Revana-Signature: t=<unix seconds>,v1=<hex
 * HMAC-SHA256 of "<t>.<raw body>">`, keyed with your account's signing secret
 * … Compute the HMAC over the raw body bytes before parsing them, compare in
 * constant time and refuse a `t` more than 300 seconds from now"
 * (https://revana.si/queue.md).
 *
 * The page does not say how the secret becomes a key. Two real deliveries
 * (2026-11-13, `test/fixtures/revana/queue.webhook.*.json`) settle it: the key
 * is the secret's own text, UTF-8 — the signature does not match with the
 * secret decoded from hex or from base64.
 *
 * # The one secret this library is ever handed
 *
 * unmodel never sees an API key, and this does not change that: the signing
 * secret is a separate value (`GET /v1/webhooks/secret`) that can only check a
 * delivery, not call the API. It is passed in per call, used to key one HMAC,
 * and kept nowhere.
 *
 * # Authentic and understood are two answers
 *
 * A delivery can fail to verify, or verify and not be a document unmodel
 * knows — Revana adding a field or an outcome must not look like a forgery.
 * {@link WebhookVerification} keeps the two apart: `authentic` says whether
 * the signature held, `ok` whether `delivery` is typed.
 */

import type { QueueWebhookDelivery } from "./queue-wire";

/** The header a delivery is signed in: `t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">`. */
export const REVANA_SIGNATURE_HEADER = "Revana-Signature";
/**
 * `wh_<request id>` — "the same on every retry". The signature does not cover
 * it, so deduplicate on the verified `delivery.request_id`, which it does.
 */
export const REVANA_WEBHOOK_ID_HEADER = "Revana-Webhook-Id";
/** "refuse a `t` more than 300 seconds from now" — also `tolerance_s` on `GET /v1/webhooks/secret`. */
export const REVANA_WEBHOOK_TOLERANCE_SECONDS = 300;

/** A request's headers: a fetch `Headers`, or the plain record Node hands a server (`req.headers`). */
export type WebhookHeaders =
  | { get(name: string): string | null }
  | Readonly<Record<string, string | readonly string[] | undefined>>;

export interface VerifyWebhookInput {
  /**
   * The request body EXACTLY as it arrived — `await request.text()`, or the
   * raw bytes — and never a re-serialised object: the signature is over these
   * bytes, and `JSON.stringify(JSON.parse(body))` is not them.
   */
  body: string | Uint8Array;
  headers: WebhookHeaders;
  /** The account's signing secret: `secret` on `GET /v1/webhooks/secret`. Not the API key. */
  secret: string;
  /** The time to judge the delivery's `t` against, in unix seconds. Defaults to the clock. */
  now?: number;
}

/** Why a delivery was not taken as Revana's. */
export type WebhookForgeryReason =
  /** No `Revana-Signature` header. */
  | "missing_signature"
  /** The header is not `t=<digits>,v1=<64 hex digits>`. */
  | "malformed_signature"
  /** `t` is more than 300 seconds from `now` — a replay, or a clock that is off. */
  | "stale_timestamp"
  /** The HMAC is not the one this secret makes over this body. */
  | "signature_mismatch";

export type WebhookVerification =
  /** Revana sent it, and it is a delivery unmodel knows. Branch on `delivery.status`. */
  | {
      ok: true;
      authentic: true;
      delivery: QueueWebhookDelivery;
      /** The signed `t`: when Revana signed this delivery, in unix seconds. */
      timestamp: number;
    }
  /** Not shown to be Revana's. Answer it with a 4xx and do nothing else. */
  | {
      ok: false;
      authentic: false;
      reason: WebhookForgeryReason;
      message: string;
    }
  /**
   * Revana sent it — the signature holds — and the body is not a delivery
   * unmodel knows. Answer it with a 2xx (it is not a forgery, and a non-2xx is
   * retried "up to 30 attempts over 24 hours"); `json` is the parsed body, or
   * `undefined` if it was not JSON.
   */
  | {
      ok: false;
      authentic: true;
      reason: "unrecognized_body";
      message: string;
      json: unknown;
      timestamp: number;
    };

const SIGNATURE = /^t=(\d+),v1=([0-9a-f]{64})$/;

/**
 * Verifies one `fal_webhook` delivery and returns it typed. Never throws on a
 * bad delivery — every outcome is a {@link WebhookVerification}.
 *
 * ```ts
 * // POST https://your-app.example/revana
 * const verdict = await verifyWebhook({ body: await request.text(), headers: request.headers, secret });
 * if (!verdict.authentic) return new Response(verdict.message, { status: 400 });
 * if (verdict.ok && verdict.delivery.status === "OK") save(verdict.delivery.request_id, verdict.delivery.payload);
 * return new Response(null, { status: 204 });
 * ```
 *
 * Async because the HMAC is WebCrypto's (`crypto.subtle`), which is what Node
 * 20, Bun and Workers share and which compares in constant time.
 */
export async function verifyWebhook(input: VerifyWebhookInput): Promise<WebhookVerification> {
  const header = readHeader(input.headers, REVANA_SIGNATURE_HEADER);
  if (header === undefined) {
    return forged("missing_signature", `The request has no \`${REVANA_SIGNATURE_HEADER}\` header.`);
  }
  const parts = SIGNATURE.exec(header);
  if (parts === null) {
    return forged(
      "malformed_signature",
      `\`${REVANA_SIGNATURE_HEADER}\` must be \`t=<unix seconds>,v1=<64 hex digits>\`; got ${JSON.stringify(header)}.`,
    );
  }
  const timestamp = Number(parts[1]);
  const now = input.now ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > REVANA_WEBHOOK_TOLERANCE_SECONDS) {
    return forged(
      "stale_timestamp",
      `The delivery was signed at t=${timestamp}, ${Math.abs(now - timestamp)} seconds from now (${now}); ` +
        `Revana says to refuse one more than ${REVANA_WEBHOOK_TOLERANCE_SECONDS} seconds away.`,
    );
  }

  const encoder = new TextEncoder();
  const body = typeof input.body === "string" ? encoder.encode(input.body) : input.body;
  const prefix = encoder.encode(`${parts[1]}.`);
  const signed = new Uint8Array(prefix.length + body.length);
  signed.set(prefix);
  signed.set(body, prefix.length);
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(input.secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  if (!(await crypto.subtle.verify("HMAC", key, fromHex(parts[2] as string), signed))) {
    return forged(
      "signature_mismatch",
      "The signature is not the one this secret makes over this body. Check that `body` is the raw request body, " +
        "byte for byte, and that `secret` is the signing secret from `GET /v1/webhooks/secret` rather than the API key.",
    );
  }

  let json: unknown;
  try {
    json = JSON.parse(typeof input.body === "string" ? input.body : new TextDecoder().decode(input.body));
  } catch {
    json = undefined;
  }
  if (isDelivery(json)) return { ok: true, authentic: true, delivery: json, timestamp };
  return {
    ok: false,
    authentic: true,
    reason: "unrecognized_body",
    message:
      "The signature holds, so Revana sent this, but the body is not a delivery unmodel knows: " +
      '`{ request_id, gateway_request_id, status: "OK", payload }` with `images`, `video` or `audio`, or ' +
      '`{ …, status: "ERROR", error, payload: { detail, error_type } }`.',
    json,
    timestamp,
  };
}

function forged(reason: WebhookForgeryReason, message: string): WebhookVerification {
  return { ok: false, authentic: false, reason, message };
}

/** Header names are case-insensitive; a Node record lowercases them and may hold a list. */
function readHeader(headers: WebhookHeaders, name: string): string | undefined {
  if (typeof (headers as { get?: unknown }).get === "function") {
    return (headers as { get(name: string): string | null }).get(name) ?? undefined;
  }
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers as Record<string, string | readonly string[] | undefined>)) {
    if (key.toLowerCase() !== wanted) continue;
    return typeof value === "string" ? value : value?.[0];
  }
  return undefined;
}

function fromHex(hex: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index++) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Holds the parsed body to what {@link QueueWebhookDelivery} claims of it. */
function isDelivery(json: unknown): json is QueueWebhookDelivery {
  if (!isRecord(json) || typeof json["request_id"] !== "string" || typeof json["gateway_request_id"] !== "string") {
    return false;
  }
  const payload = json["payload"];
  if (!isRecord(payload)) return false;
  if (json["status"] === "OK") {
    return Array.isArray(payload["images"]) || isRecord(payload["video"]) || isRecord(payload["audio"]);
  }
  return (
    json["status"] === "ERROR" &&
    typeof json["error"] === "string" &&
    typeof payload["detail"] === "string" &&
    typeof payload["error_type"] === "string"
  );
}
