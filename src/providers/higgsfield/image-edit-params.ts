/**
 * The `higgsfield.imageEdit` adapter's **data**: the routes
 * `unmodel/image-edit` addresses and the per-route narrowing table.
 *
 * The image sibling's header explains the leaf rule; this is the same file
 * for the picture-editing view (`HIGGSFIELD_IMAGE_EDIT_ENDPOINTS`). A row here
 * differs from the same route's row there in two ways: it says where the
 * picture to edit lands (`imageWire`), and the route's own `resolution` and
 * `negative_prompt` are among its `extras`, because the canonical edit
 * vocabulary has no word for either.
 */

export {
  HIGGSFIELD_IMAGE_EDIT_UNIFIED_PARAMS as HIGGSFIELD_IMAGE_EDIT_MODEL_PARAMS,
  HIGGSFIELD_IMAGE_EDIT_UNIFIED_MODELS as MODELS,
} from "./gen/image-edit-params.gen";
