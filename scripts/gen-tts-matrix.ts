/**
 * Regenerates the **machine columns** of `docs/tts.md`.
 *
 *   bun run gen:tts-matrix
 *
 * The matrix is split by provenance, and this script is one half of the split.
 * URL, method and static headers are things the validators already know: each
 * one is a property of a compiled `.request`, so a hand-written table of them
 * is a copy that can only drift. Everything this script emits therefore comes
 * from calling the real adapter — no literal in {@link TTS_MATRIX_ROWS} names
 * a URL. Auth, response delivery, checkers and quirks have no API surface to
 * read (auth is deliberately absent from `.request.headers` — unmodel never
 * touches keys), so they stay hand-written *outside* the markers and this
 * script never touches them.
 *
 * `test/docs/tts-matrix.test.ts` imports {@link TTS_MATRIX_ROWS} and the
 * parser below, so the committed doc is asserted against a live `.request` on
 * every run: a stale table is a failing test, not a stale table.
 */
import { tts } from "../src/unified/tts";
import type { TtsParams } from "../src/core/unified/vocabulary/tts";

const DOC_PATH = new URL("../docs/tts.md", import.meta.url).pathname;

/** Everything between these lines is this script's output. */
export const MATRIX_START = "<!-- gen:tts-matrix — regenerate with `bun run gen:tts-matrix` -->";
export const MATRIX_END = "<!-- /gen:tts-matrix -->";

/**
 * One minimal valid call per adapter, and the reason each sample is what it
 * is: the URL a provider compiles is not always constant. ElevenLabs
 * interpolates the voice into the path and Deepgram URL-encodes the whole
 * option set into the query, so those two cells are only meaningful next to
 * the request that produced them — hence a fixed, obviously-placeholder
 * `VOICE_ID` rather than a real voice id.
 *
 * Shared with the test rather than restated there, so the doc and its guard
 * cannot disagree about what was asked.
 */
export const TTS_MATRIX_SAMPLES = [
  { provider: "openai", params: { model: "openai/gpt-4o-mini-tts", text: "Sample.", voice: "alloy" } },
  { provider: "elevenlabs", params: { model: "elevenlabs/eleven_multilingual_v2", text: "Sample.", voice: "VOICE_ID" } },
  {
    provider: "cartesia",
    params: {
      model: "cartesia/sonic-3",
      text: "Sample.",
      voice: "VOICE_ID",
      outputFormat: { format: "mp3", sampleRate: 44100, bitrate: 128000 },
    },
  },
  { provider: "deepgram", params: { model: "deepgram/aura-2-thalia-en", text: "Sample." } },
  { provider: "google", params: { model: "google/gemini-2.5-flash-preview-tts", text: "Sample.", voice: "Kore" } },
  { provider: "hume", params: { model: "hume/octave", text: "Sample.", voice: "VOICE_ID" } },
  { provider: "minimax", params: { model: "minimax/speech-2.8-hd", text: "Sample.", voice: "VOICE_ID" } },
  { provider: "rime", params: { model: "rime/mistv3", text: "Sample.", voice: "VOICE_ID" } },
  { provider: "lmnt", params: { model: "lmnt/blizzard", text: "Sample.", voice: "VOICE_ID" } },
  { provider: "fish-audio", params: { model: "fish-audio/s2.1-pro", text: "Sample.", voice: "VOICE_ID" } },
  { provider: "murf", params: { model: "murf/gen2", text: "Sample.", voice: "VOICE_ID" } },
  { provider: "resemble", params: { model: "resemble/resemble-ultra", text: "Sample.", voice: "VOICE_ID" } },
  { provider: "smallest-ai", params: { model: "smallest-ai/lightning_v3.1", text: "Sample.", voice: "VOICE_ID" } },
  { provider: "speechify", params: { model: "speechify/simba-3.2", text: "Sample.", voice: "VOICE_ID" } },
  { provider: "stepfun", params: { model: "stepfun/stepaudio-2.5-tts", text: "Sample.", voice: "vibrant-youth" } },
  { provider: "breezeblue", params: { model: "breezeblue/breeze-tts-2", text: "Sample.", voice: "VOICE_ID" } },
  { provider: "alibaba", params: { model: "alibaba/qwen3-tts-flash", text: "Sample.", voice: "Cherry" } },
  { provider: "inworld", params: { model: "inworld/inworld-tts-1.5", text: "Sample.", voice: "VOICE_ID" } },
] as const satisfies readonly { provider: string; params: TtsParams }[];

/** One machine row: nothing here is written down, all three come off `.request`. */
export interface TtsMatrixRow {
  provider: string;
  url: string;
  method: string;
  headers: Record<string, string>;
}

/** Compiles every sample and reads its `.request`. Throws on a sample that stopped validating. */
export function ttsMatrixRows(): TtsMatrixRow[] {
  return TTS_MATRIX_SAMPLES.map(({ provider, params }) => {
    const result = tts.safe(params);
    if (!result.ok) {
      throw new Error(
        `unmodel: the docs/tts.md sample for "${provider}" no longer validates — ${result.errors.map((e) => e.message).join("; ")}`,
      );
    }
    const { url, method, headers } = result.params.request;
    return { provider, url, method, headers };
  });
}

/** `k: v` pairs, sorted so a header object's insertion order cannot churn the diff. */
function renderHeaders(headers: Record<string, string>): string {
  return Object.entries(headers)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `\`${key}: ${value}\``)
    .join("<br>");
}

export function renderMachineTable(rows: readonly TtsMatrixRow[]): string {
  const header = ["| Provider | Method | URL | Static headers |", "| --- | --- | --- | --- |"];
  const body = rows.map(
    (r) => `| \`${r.provider}\` | ${r.method} | \`${r.url}\` | ${renderHeaders(r.headers)} |`,
  );
  return [...header, ...body].join("\n");
}

/**
 * Reads back what {@link renderMachineTable} wrote. The test uses this rather
 * than a second regex of its own, so "what the doc says" has one definition.
 */
export function parseMachineTable(doc: string): { provider: string; url: string; method: string }[] {
  const start = doc.indexOf(MATRIX_START);
  const end = doc.indexOf(MATRIX_END);
  if (start < 0 || end < 0) throw new Error(`unmodel: docs/tts.md is missing its gen:tts-matrix markers.`);
  return doc
    .slice(start + MATRIX_START.length, end)
    .split("\n")
    .map((line) => /^\| `([^`]+)` \| (\w+) \| `([^`]+)` \|/.exec(line.trim()))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ provider: m[1] as string, method: m[2] as string, url: m[3] as string }));
}

/** Splices a freshly rendered table between the markers, leaving every hand-written column alone. */
export function applyMachineTable(doc: string, table: string): string {
  const start = doc.indexOf(MATRIX_START);
  const end = doc.indexOf(MATRIX_END);
  if (start < 0 || end < 0) throw new Error(`unmodel: docs/tts.md is missing its gen:tts-matrix markers.`);
  return `${doc.slice(0, start + MATRIX_START.length)}\n\n${table}\n\n${doc.slice(end)}`;
}

if (import.meta.main) {
  const doc = await Bun.file(DOC_PATH).text();
  const next = applyMachineTable(doc, renderMachineTable(ttsMatrixRows()));
  if (next === doc) {
    console.log("docs/tts.md machine columns already current.");
  } else {
    await Bun.write(DOC_PATH, next);
    console.log(`docs/tts.md machine columns regenerated (${TTS_MATRIX_SAMPLES.length} rows).`);
  }
}
