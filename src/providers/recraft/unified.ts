/**
 * Recraft's unified adapters, one per category: `image` (POST
 * /v1/images/generations) and `imageEdit` (POST /v1/images/imageToImage).
 *
 * A barrel over two modules rather than one file with two exports, because
 * `unmodel/image` and `unmodel/image-edit` both reach this provider and neither
 * should pay for the other's validators and schemas. Import this subpath to get
 * both; the ready-made packs import the halves directly.
 */
export { image, type RecraftImageResult, type RecraftImageWire } from "./unified-image";
export {
  imageEdit,
  type RecraftImageEditResult,
  type RecraftImageEditWire,
} from "./unified-image-edit";
