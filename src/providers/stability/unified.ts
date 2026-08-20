/**
 * Stability's unified adapters, one per category: `image` (the three Stable
 * Image generation routes) and `music` (POST
 * /v2beta/audio/stable-audio-2/text-to-audio).
 *
 * A barrel over two modules rather than one file with two exports, because
 * `unmodel/image` and `unmodel/music` both reach this provider and neither
 * should pay for the other's validator or catalog. Import this subpath to get
 * both; the ready-made packs import the halves directly.
 */
export { image, type StabilityImageResult, type StabilityImageWire } from "./unified-image";
export { music, type StabilityMusicResult, type StabilityMusicWire } from "./unified-music";
