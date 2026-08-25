import { test, expect } from "bun:test";
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MULTIPART_ONLY, REGISTRY, UNIFIED } from "./cli-registry";
import type { CliEndpointId, CliMultipartOnlyId, CliUnifiedId } from "./cli-registry";

const CLI = new URL("./cli.ts", import.meta.url).pathname;

async function runCli(
  args: string[],
  stdin?: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", CLI, ...args], {
    stdin: stdin === undefined ? "ignore" : new TextEncoder().encode(stdin),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

const VALID_CHAT_PARAMS = {
  model: "gpt-4o",
  messages: [{ role: "user", content: "hello there" }],
  max_tokens: 100,
};

// ---------------------------------------------------------------------------
// unmodel models
// ---------------------------------------------------------------------------

test("models lists all providers with model counts (--json)", async () => {
  const { stdout, exitCode } = await runCli(["models", "--json"]);
  expect(exitCode).toBe(0);
  const providers = JSON.parse(stdout) as Array<{ id: string; name: string; models: number }>;
  expect(providers.length).toBeGreaterThan(100);
  const openai = providers.find((p) => p.id === "openai");
  expect(openai).toBeDefined();
  expect(openai!.models).toBeGreaterThan(0);
  expect(openai!.name).toBe("OpenAI");
});

test("models lists all providers as a human table", async () => {
  const { stdout, exitCode } = await runCli(["models"]);
  expect(exitCode).toBe(0);
  expect(stdout).toContain("PROVIDER");
  expect(stdout).toContain("openai");
});

test("models <provider> --json emits the provider catalog entry", async () => {
  const { stdout, exitCode } = await runCli(["models", "openai", "--json"]);
  expect(exitCode).toBe(0);
  const entry = JSON.parse(stdout) as {
    provider: { id: string };
    models: Record<string, { id: string; limit: { context: number } }>;
  };
  expect(entry.provider.id).toBe("openai");
  expect(entry.models["gpt-4o"]).toBeDefined();
  expect(entry.models["gpt-4o"]!.limit.context).toBeGreaterThan(0);
});

test("models <provider> renders a human table with limits and caps", async () => {
  const { stdout, exitCode } = await runCli(["models", "openai"]);
  expect(exitCode).toBe(0);
  expect(stdout).toContain("MODEL");
  expect(stdout).toContain("CONTEXT");
  expect(stdout).toContain("gpt-4o");
});

test("models <provider> <modelId> --json emits the full ModelInfo", async () => {
  const { stdout, exitCode } = await runCli(["models", "openai", "gpt-4o", "--json"]);
  expect(exitCode).toBe(0);
  const info = JSON.parse(stdout) as {
    id: string;
    modalities: { input: string[] };
    limit: { context: number };
  };
  expect(info.id).toBe("gpt-4o");
  expect(info.modalities.input).toContain("text");
  expect(info.limit.context).toBeGreaterThan(0);
});

test("models with an unknown provider exits 1", async () => {
  const { stderr, exitCode } = await runCli(["models", "not-a-provider"]);
  expect(exitCode).toBe(1);
  expect(stderr).toContain("unknown provider");
});

test("models with an unknown model exits 1", async () => {
  const { stderr, exitCode } = await runCli(["models", "openai", "not-a-model"]);
  expect(exitCode).toBe(1);
  expect(stderr).toContain("unknown model");
});

// ---------------------------------------------------------------------------
// unmodel validate
// ---------------------------------------------------------------------------

test("validate passes valid params from a file (exit 0)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "unmodel-cli-"));
  const file = join(dir, "params.json");
  writeFileSync(file, JSON.stringify(VALID_CHAT_PARAMS));
  const { stdout, exitCode } = await runCli(["validate", "openai.chat", file]);
  expect(exitCode).toBe(0);
  expect(stdout).toContain("ok: openai.chat");
});

test("validate reads params from stdin", async () => {
  const { stdout, exitCode } = await runCli(
    ["validate", "openai.chat"],
    JSON.stringify(VALID_CHAT_PARAMS),
  );
  expect(exitCode).toBe(0);
  expect(stdout).toContain("ok: openai.chat");
});

test("validate --json emits the serialized result with wire body and request meta", async () => {
  const { stdout, exitCode } = await runCli(
    ["validate", "openai.chat", "--json"],
    JSON.stringify(VALID_CHAT_PARAMS),
  );
  expect(exitCode).toBe(0);
  const result = JSON.parse(stdout) as {
    ok: boolean;
    params: Record<string, unknown>;
    request: { url: string; method: string };
    warnings: unknown[];
    estimate: { inputTokens?: number };
  };
  expect(result.ok).toBe(true);
  expect(result.params).toEqual(VALID_CHAT_PARAMS);
  expect(result.request.url).toBe("https://api.openai.com/v1/chat/completions");
  expect(result.request.method).toBe("POST");
  expect(result.estimate.inputTokens).toBeGreaterThan(0);
});

test("validate reports shape errors and exits 1", async () => {
  const { stderr, exitCode } = await runCli(
    ["validate", "openai.chat"],
    JSON.stringify({ model: "gpt-4o", messages: "nope" }),
  );
  expect(exitCode).toBe(1);
  expect(stderr).toContain("invalid_shape");
  expect(stderr).toContain("messages");
});

test("validate --json on errors emits issues and exits 1", async () => {
  const { stdout, exitCode } = await runCli(
    ["validate", "openai.chat", "--json"],
    JSON.stringify({ model: "gpt-4o", messages: "nope" }),
  );
  expect(exitCode).toBe(1);
  const result = JSON.parse(stdout) as {
    ok: boolean;
    errors: Array<{ severity: string; code: string; path: unknown[]; message: string }>;
  };
  expect(result.ok).toBe(false);
  expect(result.errors.length).toBeGreaterThan(0);
  expect(result.errors[0]!.code).toBe("invalid_shape");
  expect(result.errors[0]!.severity).toBe("error");
});

test("validate --max-cost triggers over_budget (exit 1)", async () => {
  const { stderr, exitCode } = await runCli(
    ["validate", "openai.chat", "--max-cost", "0.0000001"],
    JSON.stringify(VALID_CHAT_PARAMS),
  );
  expect(exitCode).toBe(1);
  expect(stderr).toContain("over_budget");
});

test("validate --max-cost passes when under budget", async () => {
  const { exitCode } = await runCli(
    ["validate", "openai.chat", "--max-cost", "100"],
    JSON.stringify(VALID_CHAT_PARAMS),
  );
  expect(exitCode).toBe(0);
});

test("validate rejects a malformed --max-cost", async () => {
  const { stderr, exitCode } = await runCli(
    ["validate", "openai.chat", "--max-cost", "cheap"],
    JSON.stringify(VALID_CHAT_PARAMS),
  );
  expect(exitCode).toBe(1);
  expect(stderr).toContain("--max-cost");
});

test("validate with an unknown endpoint lists available targets and exits 1", async () => {
  const { stderr, exitCode } = await runCli(["validate", "nope.chat"], "{}");
  expect(exitCode).toBe(1);
  expect(stderr).toContain("unknown endpoint");
  expect(stderr).toContain("openai.chat");
  expect(stderr).toContain("anthropic.chat");
  expect(stderr).toContain("google.chat");
  expect(stderr).toContain("groq.chat");
});

test("validate with malformed JSON input exits 1", async () => {
  const { stderr, exitCode } = await runCli(["validate", "openai.chat"], "{not json");
  expect(exitCode).toBe(1);
  expect(stderr).toContain("could not read params JSON");
});

test("validate anthropic.chat via the registry", async () => {
  const { stdout, exitCode } = await runCli(
    ["validate", "anthropic.chat"],
    JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: 100,
      messages: [{ role: "user", content: "hi" }],
    }),
  );
  expect(exitCode).toBe(0);
  expect(stdout).toContain("ok: anthropic.chat");
});

test("validate flags a multipart endpoint so the body is not posted as JSON", async () => {
  const { stdout, exitCode } = await runCli(
    ["validate", "stability.image"],
    JSON.stringify({ prompt: "a fox" }),
  );
  expect(exitCode).toBe(0);
  expect(stdout).toContain("ok: stability.image");
  expect(stdout).toContain("multipart/form-data");
  expect(stdout).toContain("toFormData(validated)");
  expect(stdout).toContain('"unmodel/stability"');
});

test("validate --json carries the multipart transport hint", async () => {
  const { stdout, exitCode } = await runCli(
    ["validate", "ideogram.image", "--json"],
    JSON.stringify({ prompt: "a fox" }),
  );
  expect(exitCode).toBe(0);
  const result = JSON.parse(stdout) as {
    request: { headers: Record<string, string> };
    transport?: string;
    note?: string;
  };
  // An empty header map is the multipart signal the hint keys on.
  expect(result.request.headers).toEqual({});
  expect(result.transport).toBe("multipart/form-data");
  expect(result.note).toContain("unmodel/ideogram");
});

test("JSON-bodied endpoints carry no multipart hint", async () => {
  const { stdout } = await runCli(
    ["validate", "recraft.image", "--json"],
    JSON.stringify({ prompt: "a fox", model: "recraftv4_1" }),
  );
  const result = JSON.parse(stdout) as {
    request: { headers: Record<string, string> };
    transport?: string;
    note?: string;
  };
  expect(result.request.headers["content-type"]).toBe("application/json");
  expect(result.transport).toBeUndefined();
  expect(result.note).toBeUndefined();
});

test("realtime session configs carry the websocket hint, not the multipart one", async () => {
  const { stdout, exitCode } = await runCli(
    ["validate", "soniox.realtimeTranscription", "--json"],
    JSON.stringify({
      model: "stt-rt-v5",
      audio_format: "pcm_s16le",
      sample_rate: 16000,
      num_channels: 1,
    }),
  );
  expect(exitCode).toBe(0);
  const result = JSON.parse(stdout) as {
    request: { url: string; method: string; headers: Record<string, string> };
    transport?: string;
    note?: string;
  };
  // A socket handshake sets no headers, which is also the multipart signal —
  // the ws:// scheme is what tells the two apart.
  expect(result.request.headers).toEqual({});
  expect(result.request.url.startsWith("wss://")).toBe(true);
  expect(result.transport).toBe("websocket");
  expect(result.note).toContain("realtime session config");
  expect(result.note).not.toContain("multipart");
});

// ---------------------------------------------------------------------------
// unified.<category> — the canonical vocabulary from the command line
// ---------------------------------------------------------------------------

test("validate unified.tts compiles a canonical request through the ref's provider", async () => {
  const { stdout, exitCode } = await runCli(
    ["validate", "unified.tts", "--json"],
    JSON.stringify({
      model: "elevenlabs/eleven_flash_v2_5",
      text: "Hello from the CLI.",
      voice: "JBFqnCBsd6RMkjVDRZzb",
      outputFormat: { format: "mp3", sampleRate: 44100, bitrate: 128000 },
    }),
  );
  expect(exitCode).toBe(0);
  const result = JSON.parse(stdout) as {
    ok: boolean;
    params: Record<string, unknown>;
    request: { url: string };
  };
  expect(result.ok).toBe(true);
  // The body is ElevenLabs' own, not the canonical vocabulary: `voice` and the
  // format left for the URL, and `text`/`model_id` are the wire spellings.
  expect(result.params).toEqual({ text: "Hello from the CLI.", model_id: "eleven_flash_v2_5" });
  expect(result.request.url).toBe(
    "https://api.elevenlabs.io/v1/text-to-speech/JBFqnCBsd6RMkjVDRZzb?output_format=mp3_44100_128",
  );
});

test("validate unified.tts reports a provider gap at the canonical path", async () => {
  const { stderr, exitCode } = await runCli(
    ["validate", "unified.tts"],
    JSON.stringify({ model: "lmnt/blizzard", text: "hi", voice: "leah", speed: 1.5 }),
  );
  expect(exitCode).toBe(1);
  expect(stderr).toContain("unsupported_param");
  expect(stderr).toContain("speed");
});

test("validate unified.image compiles one canonical request through the ref's provider", async () => {
  const { stdout, exitCode } = await runCli(
    ["validate", "unified.image", "--json"],
    JSON.stringify({
      model: "ideogram/ideogram-3.0-quality",
      prompt: "a lighthouse in fog",
      aspectRatio: "16:9",
      resolution: "1k",
    }),
  );
  expect(exitCode).toBe(0);
  const result = JSON.parse(stdout) as {
    ok: boolean;
    params: Record<string, unknown>;
    request: { url: string };
  };
  expect(result.ok).toBe(true);
  // Ideogram's own body, in Ideogram's own spellings: the ref chose the route
  // AND the rendering speed, and `16:9` came back as this provider's `16x9`.
  expect(result.params).toEqual({
    prompt: "a lighthouse in fog",
    rendering_speed: "QUALITY",
    aspect_ratio: "16x9",
  });
  expect(result.request.url).toBe("https://api.ideogram.ai/v1/ideogram-v3/generate");
});

test("validate unified.image reports a provider gap at the canonical path", async () => {
  const { stderr, exitCode } = await runCli(
    ["validate", "unified.image"],
    JSON.stringify({ model: "openai/gpt-image-1", prompt: "hi", seed: 7 }),
  );
  expect(exitCode).toBe(1);
  expect(stderr).toContain("unsupported_param");
  expect(stderr).toContain("seed");
});

test("validate unified.video compiles one canonical request through the ref's provider", async () => {
  const { stdout, exitCode } = await runCli(
    ["validate", "unified.video", "--json"],
    JSON.stringify({
      model: "openai/sora-2",
      prompt: "a red fox trotting through fresh snow",
      duration: 8,
      aspectRatio: "16:9",
    }),
  );
  expect(exitCode).toBe(0);
  const result = JSON.parse(stdout) as {
    ok: boolean;
    params: Record<string, unknown>;
    request: { url: string };
  };
  expect(result.ok).toBe(true);
  // Sora's own body: `duration: 8` became the string `seconds`, and the shape
  // plus Sora's own default tier became one `size` enum member.
  expect(result.params).toEqual({
    model: "sora-2",
    prompt: "a red fox trotting through fresh snow",
    seconds: "8",
    size: "1280x720",
  });
  expect(result.request.url).toBe("https://api.openai.com/v1/videos");
});

test("validate unified.video reports a route the model does not serve", async () => {
  const { stderr, exitCode } = await runCli(
    ["validate", "unified.video"],
    JSON.stringify({ model: "runway/gen4_turbo", prompt: "hi", duration: 5 }),
  );
  expect(exitCode).toBe(1);
  expect(stderr).toContain("no text-to-video route");
  expect(stderr).toContain("pass `image`");
});

test("validate unified.stt compiles a canonical request through the ref's provider", async () => {
  const { stdout, exitCode } = await runCli(
    ["validate", "unified.stt", "--json"],
    JSON.stringify({
      model: "assemblyai/universal-2",
      audio: { url: "https://example.com/interview.wav" },
      language: "pt",
      diarization: { enabled: true, speakers: 2 },
    }),
  );
  expect(exitCode).toBe(0);
  const result = JSON.parse(stdout) as {
    ok: boolean;
    params: Record<string, unknown>;
    request: { url: string };
  };
  expect(result.ok).toBe(true);
  // AssemblyAI's own body: the ref became a routing array, `audio` became the
  // URL field, and `diarization` split into a flag and a count.
  expect(result.params).toEqual({
    audio_url: "https://example.com/interview.wav",
    speech_models: ["universal-2"],
    language_code: "pt",
    speaker_labels: true,
    speakers_expected: 2,
  });
  expect(result.request.url).toBe("https://api.assemblyai.com/v2/transcript");
});

test("validate unified.stt reports an audio shape the route has no field for", async () => {
  const { stderr, exitCode } = await runCli(
    ["validate", "unified.stt"],
    JSON.stringify({
      model: "assemblyai/universal-2",
      audio: { fileId: "file-abc" },
    }),
  );
  expect(exitCode).toBe(1);
  expect(stderr).toContain("unsupported_param");
  expect(stderr).toContain("audio");
  // …and it names what this route DOES take, which is the whole point.
  expect(stderr).toContain("{ url }");
});

test("validate unified.music compiles a canonical request through the ref's provider", async () => {
  const { stdout, exitCode } = await runCli(
    ["validate", "unified.music", "--json"],
    JSON.stringify({
      model: "elevenlabs/music_v1",
      prompt: "slow post-rock build, no vocals",
      durationSeconds: 90,
      instrumental: true,
    }),
  );
  expect(exitCode).toBe(0);
  const result = JSON.parse(stdout) as {
    ok: boolean;
    params: Record<string, unknown>;
    request: { url: string };
  };
  expect(result.ok).toBe(true);
  // Seconds became milliseconds, exactly and silently.
  expect(result.params).toEqual({
    prompt: "slow post-rock build, no vocals",
    model_id: "music_v1",
    music_length_ms: 90000,
    force_instrumental: true,
  });
  expect(result.request.url).toBe("https://api.elevenlabs.io/v1/music");
});

test("validate unified.music reports a provider gap at the canonical path", async () => {
  const { stderr, exitCode } = await runCli(
    ["validate", "unified.music"],
    JSON.stringify({ model: "stability/stable-audio-2", prompt: "hi", instrumental: true }),
  );
  expect(exitCode).toBe(1);
  expect(stderr).toContain("unsupported_param");
  expect(stderr).toContain("instrumental");
});

test("validate unified.imageEdit compiles a canonical request through the ref's provider", async () => {
  const { stdout, exitCode } = await runCli(
    ["validate", "unified.imageEdit", "--json"],
    JSON.stringify({
      operation: "edit",
      model: "black-forest-labs/flux-kontext-pro",
      prompt: "replace the sky with a thunderstorm",
      image: { url: "https://example.com/street.png" },
      aspectRatio: "16:9",
    }),
  );
  expect(exitCode).toBe(0);
  const result = JSON.parse(stdout) as {
    ok: boolean;
    params: Record<string, unknown>;
    request: { url: string };
  };
  expect(result.ok).toBe(true);
  // BFL's own body: `image` became the dual-purpose `input_image` string, the
  // ref became the route, and `operation` is a discriminant that never ships.
  expect(result.params).toEqual({
    prompt: "replace the sky with a thunderstorm",
    input_image: "https://example.com/street.png",
    aspect_ratio: "16:9",
  });
  expect(result.request.url).toBe("https://api.bfl.ai/v1/flux-kontext-pro");
});

test("validate unified.imageEdit reports an image shape the route has no field for", async () => {
  const { stderr, exitCode } = await runCli(
    ["validate", "unified.imageEdit"],
    JSON.stringify({
      operation: "edit",
      model: "black-forest-labs/flux-kontext-pro",
      prompt: "hi",
      image: { file: "not-a-blob" },
    }),
  );
  expect(exitCode).toBe(1);
  expect(stderr).toContain("unsupported_param");
  expect(stderr).toContain("image");
  // …and it names what this route DOES take, which is the whole point.
  expect(stderr).toContain("{ data }");
  expect(stderr).toContain("{ url }");
});

test("the unified map names one target per shipped pack", () => {
  expect(Object.keys(UNIFIED)).toEqual([
    "unified.image",
    "unified.imageEdit",
    "unified.music",
    "unified.tts",
    "unified.stt",
    "unified.video",
    "unified.lipsync",
    "unified.avatar",
    "unified.upscale",
    "unified.voiceClone",
    "unified.voiceDesign",
  ]);
  // Never both maps: a `unified.*` id is not a provider endpoint.
  expect(Object.keys(REGISTRY).filter((id) => id.startsWith("unified."))).toEqual([]);
});

// ---------------------------------------------------------------------------
// Registry drift guard
//
// REGISTRY and MULTIPART_ONLY are hand-maintained: the loaders must use
// literal import specifiers so bundlers can code-split each provider, so the
// map cannot be generated at runtime. Without this test a new endpoint is
// silently CLI-invisible — it validates fine from the library and `unmodel
// validate provider.newEndpoint` just says "unknown endpoint". Every
// module-level validator must appear in exactly one of the two maps: REGISTRY
// if JSON params can express it, MULTIPART_ONLY if it needs a Blob.
// ---------------------------------------------------------------------------

/** A module-level endpoint validator, as produced by `createValidator`. */
function isValidator(value: unknown): boolean {
  if (typeof value !== "function") return false;
  const fn = value as { safe?: unknown; constraintsFor?: unknown };
  return typeof fn.safe === "function" && typeof fn.constraintsFor === "function";
}

const PROVIDERS_DIR = new URL("./providers/", import.meta.url).pathname;

/** Every `<provider>.<export>` reachable from a provider subpath entry. */
async function collectValidatorTargets(): Promise<Set<string>> {
  const providers = readdirSync(PROVIDERS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  expect(providers.length).toBeGreaterThan(60);

  const targets = new Set<string>();
  for (const provider of providers) {
    const mod = (await import(`${PROVIDERS_DIR}${provider}/index.ts`)) as Record<string, unknown>;
    for (const [name, value] of Object.entries(mod)) {
      if (isValidator(value)) targets.add(`${provider}.${name}`);
    }
  }
  return targets;
}

test("every module-level validator is reachable from the CLI registry", async () => {
  const registered = new Set([...Object.keys(REGISTRY), ...Object.keys(MULTIPART_ONLY)]);
  const exported = await collectValidatorTargets();

  const missing = [...exported].filter((target) => !registered.has(target)).sort();
  const stale = [...registered].filter((target) => !exported.has(target)).sort();

  // Named separately so a failure says WHICH endpoint drifted and which way.
  expect({ missingFromCli: missing, staleInCli: stale }).toEqual({
    missingFromCli: [],
    staleInCli: [],
  });
  expect(exported.size).toBe(registered.size);
});

test("REGISTRY and MULTIPART_ONLY never claim the same endpoint", () => {
  const both = Object.keys(REGISTRY).filter((target) => Object.hasOwn(MULTIPART_ONLY, target));
  expect(both).toEqual([]);
});

// ---------------------------------------------------------------------------
// The drift guard's compile-time half
//
// The three maps keep their literal keys (`satisfies`, not `Record<string, …>`),
// so "REGISTRY names this endpoint" is a statement tsc can check. These lines
// are the type-level twin of the runtime guards above: they cost nothing at run
// time and they fail the build — not a test — if an id is renamed or dropped.
// ---------------------------------------------------------------------------

const registryIds: readonly CliEndpointId[] = ["openai.chat", "anthropic.chat", "google.chat"];
const unifiedIds: readonly CliUnifiedId[] = ["unified.image", "unified.video"];
const multipartIds: readonly CliMultipartOnlyId[] = ["openai.imageEdit", "stability.musicInpaint"];
// @ts-expect-error — `keyof typeof REGISTRY` was `string`, so this used to compile.
const notAnEndpoint: CliEndpointId = "openai.chatt";
// @ts-expect-error — a unified category id is not a provider endpoint id.
const notAnEndpoint2: CliEndpointId = "unified.image";
// @ts-expect-error — MULTIPART_ONLY's values are package subpaths, nothing else.
const notASubpath: CliMultipartOnlyId = "openai.chat";

test("the registry ids are literal types, not `string`", () => {
  // The assertions above are the test; this keeps the bindings live so no
  // "unused variable" lint sweeps them away with the guarantee.
  expect(registryIds.every((id) => Object.hasOwn(REGISTRY, id))).toBe(true);
  expect(unifiedIds.every((id) => Object.hasOwn(UNIFIED, id))).toBe(true);
  expect(multipartIds.every((id) => Object.hasOwn(MULTIPART_ONLY, id))).toBe(true);
  expect([notAnEndpoint, notAnEndpoint2, notASubpath].length).toBe(3);
});
