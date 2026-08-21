/**
 * MiniMax's unified adapters, one per category: `tts` (POST /v1/t2a_v2) and
 * `video` (the Hailuo and MiniMax-H3 routes).
 *
 * A barrel over two modules for the reason `openai/unified.ts` states — one
 * module per category is what keeps each ready-made pack paying only for the
 * endpoint it calls.
 */
export { tts, type MinimaxTtsResult, type MinimaxTtsWire } from "./unified-tts";
export { video, type MinimaxVideoResult, type MinimaxVideoWire } from "./unified-video";
