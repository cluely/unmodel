/**
 * fal's unified adapters, one per category: `image` (28 text-to-image
 * endpoints) and `imageEdit` (17 editing endpoints).
 *
 * A barrel over two modules rather than one file with two exports, because
 * `unmodel/image` and `unmodel/image-edit` both reach this provider and
 * neither should pay for the other's validators, zod schema and generated
 * narrowing tables. Import this subpath to get both; the ready-made packs
 * import the halves directly, and `test/bundle-budget.test.ts` measures that
 * they do.
 */
export { image, type FalImageResult, type FalImageWire } from "./unified-image";
export {
  imageEdit,
  type FalImageEditResult,
  type FalImageEditWire,
} from "./unified-image-edit";
