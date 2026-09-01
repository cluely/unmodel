/**
 * Hume's unified adapters, one per category: `tts` (POST /v0/tts) and `sts`
 * (POST /v0/tts/voice_conversion/file).
 *
 * A barrel over two modules rather than one file with two exports, because
 * `unmodel/tts` and `unmodel/sts` both reach this provider and neither should
 * pay for the other's validator or catalog. Import this subpath to get both;
 * the ready-made packs import the halves directly.
 */
export { tts, type HumeTtsResult, type HumeTtsWire } from "./unified-tts";
export { sts, type HumeStsResult, type HumeStsWire } from "./unified-sts";
