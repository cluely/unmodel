/**
 * fal's unified adapters, one per category: `image` (32 text-to-image
 * endpoints), `imageEdit` (17 editing; the eighteenth direct endpoint is
 * substrate-only), `video` (35 generation and editing routes), `lipsync` (10),
 * `avatar` (8), `upscale` (11), `threeD` (19), `tts` (23), `stt` (6) and
 * `music` (10).
 *
 * A barrel over ten modules rather than one file with ten exports, because ten
 * different category packs reach this provider and none should pay for the
 * others' validators, zod schemas and generated narrowing tables. That matters
 * more here than at any other provider: fal is the only one serving ten
 * categories, so a single `unified.ts` holding all of them would put ~35 video
 * wire types into the 8-endpoint lipsync pack and 23 speech rosters into the
 * 10-endpoint music one. Import this subpath to get all ten; the ready-made
 * packs import the leaves directly, and `test/bundle-budget.test.ts` measures
 * that they do.
 */
export { image, type FalImageResult, type FalImageWire } from "./unified-image";
export {
  imageEdit,
  type FalImageEditResult,
  type FalImageEditWire,
} from "./unified-image-edit";
export { video, type FalVideoResult, type FalVideoWire } from "./unified-video";
export { lipsync, type FalLipsyncResult, type FalLipsyncWire } from "./unified-lipsync";
export { avatar, type FalAvatarResult, type FalAvatarWire } from "./unified-avatar";
export { upscale, type FalUpscaleResult, type FalUpscaleWire } from "./unified-upscale";
export { threeD, type FalThreeDResult, type FalThreeDWire } from "./unified-3d";
export { tts, type FalTtsResult, type FalTtsWire } from "./unified-tts";
export { stt, type FalSttResult, type FalSttWire } from "./unified-stt";
export { music, type FalMusicResult, type FalMusicWire } from "./unified-music";
