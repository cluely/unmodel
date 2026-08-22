/**
 * Inworld's unified adapters, one per category: `tts` (POST /tts/v1/voice)
 * and `stt` (POST /stt/v1/transcribe).
 *
 * A barrel over two modules rather than one file with two exports, because
 * `unmodel/tts` and `unmodel/stt` both reach this provider and
 * neither should pay for the other's validator or catalog. Import this subpath
 * to get both; the ready-made packs import the halves directly.
 *
 * The transcribe half declares `audio` unsupported — its route takes base64
 * inline and a synchronous compile step cannot produce it. Its module header
 * is where that decision is argued.
 */
export { tts, type InworldTtsResult, type InworldTtsWire } from "./unified-tts";
export { stt, type InworldSttResult, type InworldSttWire } from "./unified-stt";
