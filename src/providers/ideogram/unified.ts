/**
 * Ideogram's unified adapters, one per category: `image` (the 3.0 and 4.0
 * generation routes) and `imageEdit` (3.0 remix).
 *
 * A barrel over two modules rather than one file with two exports, because
 * `unmodel/image` and `unmodel/image-edit` both reach this provider and neither
 * should pay for the other's validators and schemas. Import this subpath to get
 * both; the ready-made packs import the halves directly.
 */
export {
  image,
  type IdeogramGenerateResult,
  type IdeogramGenerateWire,
  type IdeogramImageResult,
  type IdeogramImageV4Result,
  type IdeogramImageV4Wire,
  type IdeogramImageWire,
} from "./unified-image";
export {
  imageEdit,
  type IdeogramImageEditResult,
  type IdeogramImageEditWire,
} from "./unified-image-edit";
