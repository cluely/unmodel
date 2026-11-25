/**
 * Higgsfield's unified adapters, one per category: `image` (the text-to-image
 * routes), `imageEdit` (the picture-editing view) and `video` (every video
 * route with a canonical word for what to make).
 *
 * A barrel over three modules, because three category packs reach this
 * provider and none should pay for the others' generated tables: the video
 * rows are several times the image ones. Import this subpath to get all three;
 * the ready-made packs import the leaves directly, and
 * `test/bundle-budget.test.ts` measures that they do.
 */
export { image, type HiggsfieldImageResult, type HiggsfieldImageWire } from "./unified-image";
export {
  imageEdit,
  type HiggsfieldImageEditResult,
  type HiggsfieldImageEditWire,
} from "./unified-image-edit";
export { video, type HiggsfieldVideoResult, type HiggsfieldVideoWire } from "./unified-video";
