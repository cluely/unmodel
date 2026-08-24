/**
 * Type-level tests for `toRequestInit`. NOT run by `bun test` (the filename
 * avoids the *.test.* pattern); checked by `bun run check` (tsc --noEmit).
 *
 * `src/core/request.test.ts` covers what the helper RETURNS. What only a
 * type-level file can pin is what it REFUSES, and refusing is most of the
 * point: two whole classes of endpoint hand back a `.request` that no
 * `fetch(url, { body: JSON.stringify(…) })` can serve, and both are excluded
 * before the program runs rather than by a throw.
 */
import { chat as anthropicChat } from "../../src/providers/anthropic";
import { stt as openaiStt, tts as openaiTts } from "../../src/providers/openai";
import { voiceClone as elevenlabsVoiceClone } from "../../src/providers/elevenlabs";
import { listenLive } from "../../src/providers/deepgram";
import { toRequestInit, type FetchArgs } from "../../src";
import { expectAssignable, expectNotAny } from "./helpers";

const claude = anthropicChat({
  model: "claude-opus-5",
  max_tokens: 1024,
  messages: [{ role: "user", content: "hi" }],
});

function returnShape(): void {
  const args = toRequestInit(claude);

  expectNotAny<typeof args>();
  expectAssignable<FetchArgs>(args);
  expectAssignable<string>(args.url);
  // Pinned as the literal, not `string`: an endpoint reached through this
  // helper has proved it speaks HTTP POST.
  expectAssignable<"POST">(args.method);
  expectAssignable<Record<string, string>>(args.headers);
  // Already serialized — the caller never re-runs JSON.stringify.
  expectAssignable<string>(args.body);
}

/** The documented call-site idiom, including the auth the helper never takes. */
function callSiteIdiom(): void {
  const { url, ...init } = toRequestInit(claude);

  expectAssignable<string>(url);
  expectAssignable<RequestInit>(init);
  expectAssignable<RequestInit>({
    ...init,
    headers: { ...init.headers, "x-api-key": "sk-…" },
  });
}

/** Endpoints with no `toApi` reach the helper the same way. */
function jsonEndpointsWithoutRetargeting(): void {
  expectAssignable<FetchArgs>(
    toRequestInit(openaiTts({ model: "tts-1", input: "hello", voice: "alloy" })),
  );
}

/**
 * The multipart endpoints. Their body is a `FormData` built by the endpoint's
 * own `toFormData`, so `JSON.stringify` of the validated params is wrong on
 * every one of them — silently, since a `Blob` serializes to `{}`. They
 * declare `ValidatedForm`, and that is what fails here.
 */
function multipartIsExcluded(): void {
  const transcript = openaiStt({
    model: "whisper-1",
    file: new File([new Uint8Array(4)], "speech.mp3", { type: "audio/mpeg" }),
  });
  // @ts-expect-error openai.stt is multipart — build its body with toFormData
  toRequestInit(transcript);

  const voice = elevenlabsVoiceClone({ name: "Narrator", files: [new Blob([new Uint8Array(4)])] });
  // @ts-expect-error elevenlabs.voiceClone is multipart
  toRequestInit(voice);
}

/**
 * The socket CONFIG surfaces. `SocketMeta.method` is `"GET"` (a handshake is
 * an upgrade, and an upgrade has no body), so the exclusion costs nothing:
 * `RequestMeta`'s `"POST"` already rejects them.
 */
function socketConfigsAreExcluded(): void {
  const live = listenLive({ model: "nova-3", interim_results: true });
  // @ts-expect-error a socket config has no HTTP body to serialize
  toRequestInit(live);
}
