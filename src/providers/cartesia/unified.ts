/**
 * Cartesia's unified adapters, one per category: `tts` (POST /tts/bytes)
 * and `stt` (POST /stt).
 *
 * A barrel over two modules rather than one file with two exports, because
 * `unmodel/tts` and `unmodel/stt` both reach this provider and
 * neither should pay for the other's validator or catalog. Import this subpath
 * to get both; the ready-made packs import the halves directly.
 */
export { tts, type CartesiaTtsResult, type CartesiaTtsWire } from "./unified-tts";
export { stt, type CartesiaSttResult, type CartesiaSttWire } from "./unified-stt";
