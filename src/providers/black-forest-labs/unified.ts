/**
 * Black Forest Labs' unified adapters, one per category: `image` (the FLUX.2
 * and FLUX.1 generation routes) and `imageEdit` (FLUX.1 Kontext).
 *
 * A barrel over two modules rather than one file with two exports, because
 * `unmodel/image` and `unmodel/image-edit` both reach this provider and neither
 * should pay for the other's validators and schemas. Import this subpath to get
 * both; the ready-made packs import the halves directly.
 */
export {
  image,
  type BflImageFlux1Result,
  type BflImageFlux1Wire,
  type BflImageResult,
  type BflImageWire,
} from "./unified-image";
export { imageEdit, type BflImageEditResult, type BflImageEditWire } from "./unified-image-edit";
