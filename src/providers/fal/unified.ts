/**
 * fal's unified adapters, one per category: `image` (28 text-to-image
 * endpoints), `imageEdit` (17 editing), `video` (30 generation and editing
 * routes), `lipsync` (8) and `avatar` (8).
 *
 * A barrel over five modules rather than one file with five exports, because
 * five different category packs reach this provider and none should pay for
 * the others' validators, zod schemas and generated narrowing tables. That
 * matters more here than at any other provider: fal is the only one serving
 * five categories, so a single `unified.ts` holding all five would put ~30
 * video wire types into the 8-endpoint lipsync pack. Import this subpath to get
 * all five; the ready-made packs import the leaves directly, and
 * `test/bundle-budget.test.ts` measures that they do.
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
