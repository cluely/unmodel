/**
 * Can a downstream package that emits its own `.d.ts` name what unmodel hands
 * back?
 *
 * This is the only test in the repo that compiles a **consumer** against the
 * real `dist/`, and it is the only one that could have caught the bug it
 * exists for. `tsc --noEmit` over `src/` cannot: inside this repo every symbol
 * is reachable by relative path, so nothing is ever unnameable. The declaration
 * *budgets* cannot either: they measure bytes, and a chunk full of types that
 * cannot be named weighs exactly as much as one full of types that can.
 *
 * ## The failure
 *
 * ```
 * TS2883: The inferred type of 'ask' cannot be named without a reference to
 * 'Validated' | 'RequestMeta' | 'ExactKeys' | … from 'unmodel/dist/request-C5iXilo6'.
 * This is likely not portable. A type annotation is necessary.
 * ```
 *
 * TypeScript can only name a symbol through a module **already in the
 * program**, so a consumer whose only import is `unmodel/openai` cannot use
 * anything exported from `unmodel` — however public it is. The fix is
 * reachability from the entry the consumer actually imported, which is what
 * `src/core/carriers.ts` and the one-line re-export on every entry provide, and
 * what this test proves against a real install layout.
 *
 * ## Two layouts, because the diagnostic differs
 *
 * - **flat** (`npm` / `bun`): `node_modules/unmodel` is the package. TypeScript
 *   5.9 reports TS2742 here, naming the chunk but not the symbols.
 * - **nested** (`pnpm`): `node_modules/unmodel` is a symlink whose realpath is
 *   `node_modules/.store/…/node_modules/unmodel`, so the path TypeScript would
 *   have to write escapes the consumer's own tree. This is the layout that
 *   produces TS2883 under TypeScript 7 — and the layout the bug was reported
 *   from. It is exercised even under 5.9, because the *reachability* question
 *   is layout-independent and a fix that only worked flat would be a fix that
 *   only worked for the reporter's colleagues.
 *
 * ## What is asserted
 *
 * Zero diagnostics with any portability code — 2742, 2883, 4023, 4058, 4081 —
 * across the fixture, in both layouts. Everything else `tsc` says is ignored on
 * purpose: this is not a re-run of the type tests, and a fixture that had to
 * stay type-correct in every other respect would rot into being commented out.
 */
import { $ } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..", "..");
const DIST = join(ROOT, "dist");
const TSC = join(ROOT, "node_modules", ".bin", "tsc");

/** Same on-demand build as `test/bundle-budget.test.ts` — `dist/` is gitignored. */
const built =
  existsSync(join(DIST, "chat", "index.d.ts")) ||
  (await $`bun run build`.quiet().then(() => true));

/**
 * One exported function per public entry, each returning a **validated
 * result** — the inferred type that carries the whole machinery
 * (`Validated`, the SDK targets, the result kind, `.toApi`'s `Retargeted`).
 * An `export const` rather than a `function` in a couple of places on purpose:
 * TS reports TS4023 for variables and TS4058 for function return types, and
 * both codes are in scope.
 *
 * The params are real. A `never`-typed argument would resolve every pack call
 * to the union of every provider's arm, which is a harder problem than any
 * caller has and would turn this into a test of a shape nobody writes.
 */
const FIXTURE = `
import { chat as openaiChat, image as openaiImage, tts as openaiTts, video as openaiVideo } from "unmodel/openai";
import { chat as anthropicChat } from "unmodel/anthropic";
import { chat as googleChat, image as googleImage } from "unmodel/google";
import { chat as groqChat } from "unmodel/groq";
import { createChat } from "unmodel/chat/factory";
import { chat as readyChat } from "unmodel/chat";
import { image as unifiedImage } from "unmodel/image";
import { video as unifiedVideo } from "unmodel/video";
import { stt as unifiedStt } from "unmodel/stt";

const chat = createChat({ openai: openaiChat, anthropic: anthropicChat, google: googleChat });

// The reported case: a registry-built \`chat()\` re-exported from a package that
// emits declarations.
export function ask(prompt: string) {
  return chat({ model: "openai/gpt-5.2", messages: [{ role: "user", content: prompt }] });
}

// …and with \`stream\`, which is now part of the result type rather than the
// dialect's open surface.
export function askStreaming(prompt: string) {
  return chat({
    model: "anthropic/claude-opus-5",
    messages: [{ role: "user", content: prompt }],
    maxOutputTokens: 256,
    stream: true,
  });
}

// The ready-made entry, which is a different module graph from the factory.
export function askReady(prompt: string) {
  return readyChat({ model: "google/gemini-2.5-flash", messages: [{ role: "user", content: prompt }] });
}

// A \`.safe()\` result: \`ValidateResult<…>\` wrapping the same machinery.
export function askSafe(prompt: string) {
  return chat.safe({ model: "openai/gpt-5.2", messages: [{ role: "user", content: prompt }] });
}

// The provider substrate, directly — the case that fails even without
// \`createChat\` anywhere in the program.
export function askOpenAiDirect(prompt: string) {
  return openaiChat({ model: "gpt-5.2", messages: [{ role: "user", content: prompt }] });
}
export function askGroqDirect(prompt: string) {
  return groqChat({ model: "llama-3.1-8b-instant", messages: [{ role: "user", content: prompt }] });
}

// A retargeted result — \`Retargeted<P, M>\`, whose own generic parameters are
// the target-id vocabulary.
export function askViaOpenRouter(prompt: string) {
  return anthropicChat({
    model: "claude-opus-5",
    max_tokens: 64,
    messages: [{ role: "user", content: prompt }],
  }).toApi("openrouter");
}

// The media substrate: per-model body maps (\`ImagesBodyByModel\` and friends)
// used to be unexported, which no re-export elsewhere could reach.
export const makeImage = (prompt: string) => openaiImage({ model: "gpt-image-1", prompt });
export const speak = (input: string) => openaiTts({ model: "gpt-4o-mini-tts", input, voice: "alloy" });
export const makeVideo = (prompt: string) => openaiVideo({ model: "sora-2", prompt });
export const makeImagen = (prompt: string) =>
  googleImage({ model: "imagen-4.0-generate-001", instances: [{ prompt }] });

// The unified packs, whose results are the adapter's output rather than a
// provider body.
export const unifiedImageCall = (prompt: string) =>
  unifiedImage({ model: "openai/gpt-image-1", prompt });
export const unifiedVideoCall = (prompt: string) =>
  unifiedVideo({ model: "openai/sora-2", prompt });
export const unifiedSttCall = (url: string) =>
  unifiedStt({ model: "openai/whisper-1", audio: { url } });
`;

const TSCONFIG = {
  compilerOptions: {
    strict: true,
    target: "ES2022",
    module: "preserve",
    moduleResolution: "bundler",
    declaration: true,
    emitDeclarationOnly: true,
    outDir: "out",
    skipLibCheck: true,
    types: [] as string[],
  },
  include: ["src"],
};

/** Every diagnostic code that means "this type exists but you cannot write it". */
const PORTABILITY_CODES = [2742, 2883, 4023, 4058, 4081] as const;

let workspace = "";

/**
 * Builds one consumer project.
 *
 * `layout: "nested"` reproduces pnpm's shape — `node_modules/unmodel` is a
 * symlink into a store directory, so the package's realpath is *outside* the
 * consumer's own `node_modules` and any path TypeScript tries to write is
 * unusable. `typescript` is linked in both, because `tsc` resolves its own lib
 * files relative to itself.
 */
function makeConsumer(name: string, layout: "flat" | "nested"): string {
  const dir = join(workspace, name);
  const modules = join(dir, "node_modules");
  mkdirSync(join(dir, "src"), { recursive: true });
  mkdirSync(modules, { recursive: true });

  if (layout === "flat") {
    symlinkSync(ROOT, join(modules, "unmodel"), "dir");
  } else {
    const store = join(modules, ".store", "unmodel@0.0.0", "node_modules");
    mkdirSync(store, { recursive: true });
    symlinkSync(ROOT, join(store, "unmodel"), "dir");
    symlinkSync(join(store, "unmodel"), join(modules, "unmodel"), "dir");
  }
  symlinkSync(join(ROOT, "node_modules", "typescript"), join(modules, "typescript"), "dir");

  writeFileSync(join(dir, "tsconfig.json"), JSON.stringify(TSCONFIG, null, 2));
  writeFileSync(join(dir, "src", "index.ts"), FIXTURE);
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name, private: true, type: "module", version: "0.0.0" }, null, 2),
  );
  return dir;
}

interface Diagnostic {
  code: number;
  line: string;
}

function portabilityDiagnostics(dir: string): Diagnostic[] {
  const result = Bun.spawnSync([TSC, "-p", "."], { cwd: dir, stdout: "pipe", stderr: "pipe" });
  const output = `${result.stdout.toString()}${result.stderr.toString()}`;
  const found: Diagnostic[] = [];
  for (const line of output.split("\n")) {
    const match = /error TS(\d+):/.exec(line);
    if (match === null) continue;
    const code = Number(match[1]);
    if ((PORTABILITY_CODES as readonly number[]).includes(code)) found.push({ code, line });
  }
  return found;
}

beforeAll(() => {
  workspace = mkdtempSync(join(tmpdir(), "unmodel-portability-"));
});

afterAll(() => {
  if (workspace !== "") rmSync(workspace, { recursive: true, force: true });
});

describe("declaration portability", () => {
  test("the build is present, so the compilations below assert something", () => {
    expect(built).toBe(true);
    expect(existsSync(TSC), `${TSC} must exist`).toBe(true);
    expect(existsSync(join(DIST, "providers", "openai", "index.d.ts"))).toBe(true);
    expect(existsSync(join(DIST, "chat", "factory.d.ts"))).toBe(true);
  });

  test.each(["flat", "nested"] as const)(
    "a %s-layout consumer emitting declarations names every inferred type",
    (layout) => {
      const dir = makeConsumer(`consumer-${layout}`, layout);
      const found = portabilityDiagnostics(dir);
      expect(
        found.map((d) => d.line),
        `${layout} layout: ${found.length} portability diagnostic(s). Each one is a type ` +
          "that is part of unmodel's public shape but is not reachable from the entry the " +
          "consumer imported — add it to src/core/carriers.ts, or re-export it from the " +
          "provider entry whose results mention it.",
      ).toEqual([]);
    },
    120_000,
  );

  /**
   * The fixture must actually reach the machinery, or the test above passes by
   * compiling nothing. `dirname` is used rather than a glob so a rename of the
   * emit directory fails here instead of silently emptying the assertion.
   */
  test("the fixture really emitted declarations", () => {
    const emitted = join(workspace, "consumer-flat", "out", "index.d.ts");
    expect(existsSync(emitted), `${dirname(emitted)} must contain the emitted declaration`).toBe(
      true,
    );
    const text = Bun.file(emitted).text();
    return text.then((content) => {
      expect(content).toContain("export declare function ask");
      expect(content.length).toBeGreaterThan(500);
    });
  });
});

/**
 * The one class of unnameable type this wave did NOT close, asserted so it
 * cannot quietly grow and so the day it is fixed the failure says so.
 *
 * A result carrying `.toApi("fal")` is `MediaApiMember<Overlap, M>`, and
 * `Overlap` resolves to fal's own GENERATED per-endpoint body interfaces
 * (`FalAiFlux2ProInput`, …). Six providers wire that seam in a
 * `fal-target.ts` beside their `index.ts`, and each one's alias for the fal
 * body is now exported and re-exported — which removed the TS2742 half — but
 * TypeScript resolves through the alias to the generated interface, and a
 * generated interface can only become reachable through `fal/interop.ts`, the
 * one door the cross-provider import rule opens.
 *
 * It is left open deliberately rather than patched, and the reason is rot: the
 * fix is either a hand-written list of ~23 generated interface names in six
 * hand-written modules — which goes stale the next time fal's roster moves —
 * or an `export type *` of fal's whole wire chunk into six providers' public
 * surfaces. Neither is obviously better than the diagnostic. The honest state
 * is one recorded gap with a name on it.
 */
describe("declaration portability: the recorded gap", () => {
  const FAL_SEAM_FIXTURE = `
import { image } from "unmodel/black-forest-labs";
export const flux = (prompt: string) => image({ model: "flux-2-pro", prompt });
`;

  test("`.toApi(\"fal\")` results still name a generated fal body — and nothing else does", () => {
    const dir = makeConsumer("consumer-fal-seam", "flat");
    writeFileSync(join(dir, "src", "index.ts"), FAL_SEAM_FIXTURE);
    const found = portabilityDiagnostics(dir);
    // Exactly one class, and it is the one described above. If this goes to
    // zero, delete this describe block — the gap is closed.
    expect(found.length).toBeGreaterThan(0);
    for (const diagnostic of found) {
      expect(diagnostic.code, diagnostic.line).toBe(4023);
      expect(diagnostic.line).toContain("Input");
    }
  }, 120_000);
});
