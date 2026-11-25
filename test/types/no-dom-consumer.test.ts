/**
 * Does a consumer compiling with no DOM and no Node types keep typed
 * `providerOptions`?
 *
 * Such a consumer (`lib: ["ESNext"]`, `types: []` — a Workers or library
 * build) has no global `Blob`. A public conditional type that names `Blob`
 * then resolves against an unresolved name, and under `skipLibCheck` that
 * collapses silently to `any`: every typed bucket stops checking, and nothing
 * in this repo's own `tsc` run — which has DOM types — can see it. This
 * compiles such a consumer against the real `dist/` and requires each wrong
 * type below to still be an error (an unused `@ts-expect-error` is TS2578).
 */
import { $ } from "bun";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..", "..");
const TSC = join(ROOT, "node_modules", ".bin", "tsc");

/** Same on-demand build as `test/bundle-budget.test.ts` — `dist/` is gitignored. */
const built = existsSync(join(ROOT, "dist", "unified", "video.d.ts")) || (await $`bun run build`.quiet().then(() => true));

const FIXTURE = `
import { video } from "unmodel/video";
import { tts } from "unmodel/tts";
import { image } from "unmodel/image";
// @ts-expect-error — google's aspectRatio is a string.
export const b = video({ model: "google/veo-3.1-generate-preview", prompt: "a fox", providerOptions: { google: { parameters: { aspectRatio: 5 } } } });
// @ts-expect-error — openai's speed is a number.
export const c = tts({ model: "openai/gpt-4o-mini-tts", text: "hi", voice: "alloy", providerOptions: { openai: { speed: "fast" } } });
// @ts-expect-error — recraft's style is a string.
export const d = image({ model: "recraft/recraftv3", prompt: "x", providerOptions: { recraft: { style: 5 } } });
`;

let workspace = "";

beforeAll(() => {
  workspace = mkdtempSync(join(tmpdir(), "unmodel-no-dom-"));
  mkdirSync(join(workspace, "node_modules"), { recursive: true });
  symlinkSync(ROOT, join(workspace, "node_modules", "unmodel"), "dir");
  symlinkSync(join(ROOT, "node_modules", "typescript"), join(workspace, "node_modules", "typescript"), "dir");
  writeFileSync(join(workspace, "package.json"), JSON.stringify({ name: "no-dom-consumer", private: true, type: "module" }));
  writeFileSync(
    join(workspace, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: { lib: ["ESNext"], target: "ESNext", module: "Preserve", moduleResolution: "bundler", strict: true, noEmit: true, skipLibCheck: true, types: [] },
      files: ["index.ts"],
    }),
  );
  writeFileSync(join(workspace, "index.ts"), FIXTURE);
});

afterAll(() => {
  if (workspace !== "") rmSync(workspace, { recursive: true, force: true });
});

test("a consumer with no Blob global still has typed providerOptions buckets", () => {
  expect(built).toBe(true);
  const result = Bun.spawnSync([TSC, "-p", "."], { cwd: workspace, stdout: "pipe", stderr: "pipe" });
  expect(`${result.stdout.toString()}${result.stderr.toString()}`.trim()).toBe("");
  expect(result.exitCode).toBe(0);
}, 120_000);
