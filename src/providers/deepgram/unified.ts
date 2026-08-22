/**
 * Deepgram's unified adapters, one per category: `tts` (POST /v1/speak) and
 * `stt` (POST /v1/listen).
 *
 * A barrel over two modules rather than one file with two exports, because
 * `unmodel/tts` and `unmodel/stt` both reach this provider and
 * neither should pay for the other's validator or catalog. Import this subpath
 * to get both; the ready-made packs import the halves directly.
 */
export { tts, type DeepgramTtsResult, type DeepgramTtsWire } from "./unified-tts";
export { stt, type DeepgramSttResult, type DeepgramSttWire } from "./unified-stt";
