/**
 * MiniMax's unified adapters, one per category: `speech` (POST /v1/t2a_v2) and
 * `video` (the Hailuo and MiniMax-H3 routes).
 *
 * A barrel over two modules for the reason `openai/unified.ts` states — one
 * module per category is what keeps each ready-made pack paying only for the
 * endpoint it calls.
 */
export { speech, type MinimaxSpeechResult, type MinimaxSpeechWire } from "./unified-speech";
export { video, type MinimaxVideoResult, type MinimaxVideoWire } from "./unified-video";
