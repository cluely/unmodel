/**
 * Type-level tests for unmodel/google-vertex. Not executed by `bun test` —
 * type-checked by `bun run check` (tsc --noEmit).
 *
 * Vertex is the one endpoint in the native-chat set whose `.toApi` has a
 * *working* v1 edge: `google-vertex.generateContent → google.generateContent`
 * is same-dialect, so it needs no codec. That makes it the right place to
 * assert the whole mechanism end to end through a public cast.
 */
import { createGoogleVertex } from "../../src/providers/google-vertex";
import type { VertexGenerateContentBody } from "../../src/providers/google-vertex";
import type { GoogleContent } from "../../src/providers/google/wire";
import { expectAssignable, expectTrue, type IsNever, type KeyIn } from "./helpers";

const vertex = createGoogleVertex({ project: "my-project", location: "us-central1" });

const validated = vertex.generateContent({
  model: "gemini-2.5-flash",
  contents: [{ role: "user", parts: [{ text: "hi" }] }],
  generationConfig: { temperature: 0.2 },
  labels: { team: "search" },
});

// ---------------------------------------------------------------------------
// PREREQUISITE — `model` must be `Union | (string & {})`, never plain
// `string`, or the caller's literal is widened and `.toApi` silently accepts
// every target (design-types §3.4). Nothing else in the suite would fail.
// ---------------------------------------------------------------------------

type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
  ? true
  : false;

expectTrue<Equals<VertexGenerateContentBody["model"], string> extends true ? false : true>();
expectAssignable<VertexGenerateContentBody["model"]>("gemini-2.5-flash");

// ---------------------------------------------------------------------------
// `.toSdk(target)` — @google/genai with `vertexai: true`, and nothing else.
// ---------------------------------------------------------------------------

expectAssignable<{ model: "gemini-2.5-flash" }>(validated.toSdk("google-vertex"));
// @ts-expect-error — the zero-arg form is gone.
validated.toSdk();
// @ts-expect-error — the AI Studio client is a different target id.
validated.toSdk("google");

// `model` is stripped from the wire body; it lives in `.request.url`.
expectTrue<IsNever<KeyIn<typeof validated, "model">>>();
expectAssignable<GoogleContent[]>(validated.contents);
expectAssignable<string>(validated.request.url);

// ---------------------------------------------------------------------------
// `.toApi(provider)` — the union comes from the fourth type param, since the
// model id is not on the body.
// ---------------------------------------------------------------------------

const viaGoogle = validated.toApi("google");
// Same dialect, so the target body is a Gemini body — and still model-less.
expectAssignable<GoogleContent[]>(viaGoogle.contents);
expectTrue<IsNever<KeyIn<typeof viaGoogle, "model">>>();
expectAssignable<string>(viaGoogle.request.url);
expectAssignable<"google">(viaGoogle.target);
expectAssignable<number>(viaGoogle.warnings.length);

validated.toApi("openrouter");
validated.toApi("vercel");

// @ts-expect-error — anthropic does not serve Gemini.
validated.toApi("anthropic");
// @ts-expect-error — groq does not serve "gemini-2.5-flash".
validated.toApi("groq");
// @ts-expect-error — not a catalog provider id.
validated.toApi("google-ai-studio");
// @ts-expect-error — one hop only; a retargeted result carries no availability.
viaGoogle.toApi("vercel");

// safe() carries the same surface.
const result = vertex.generateContent.safe({
  model: "gemini-2.5-flash",
  contents: [{ role: "user", parts: [{ text: "hi" }] }],
});
if (result.ok) {
  const routed = result.params.toApiSafe("google");
  if (routed.ok) expectAssignable<string>(routed.params.request.url);
}

// A model the catalog has not caught up on degrades to permissive + a runtime
// check, matching the library's "unknown model is a warning" philosophy.
const future = vertex.generateContent({
  model: "gemini-99-ultra",
  contents: [{ role: "user", parts: [{ text: "hi" }] }],
});
future.toApi("groq");
// @ts-expect-error — still not a factory target, even on the permissive arm.
future.toApi("amazon-bedrock");
