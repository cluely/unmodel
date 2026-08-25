/**
 * Alibaba's unified adapters, one per category: `tts` (Qwen3 TTS over
 * DashScope multimodal-generation) and `video` (the Wan and HappyHorse
 * video-synthesis models).
 *
 * A barrel over two modules for the reason `openai/unified.ts` states — one
 * module per category is what keeps each ready-made pack paying only for the
 * endpoint it calls.
 */
export { tts, type AlibabaTtsResult, type AlibabaTtsWire } from "./unified-tts";
export { video, type AlibabaVideoResult, type AlibabaVideoWire } from "./unified-video";
