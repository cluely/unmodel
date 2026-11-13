---
"unmodel": patch
---

leonardo: a sibling model's key is a warning, and the refusal copy cites real routes

- **Sibling-model keys and guidance kinds now warn instead of erroring.** On
  `leonardo.image`, a `parameters` key that belongs to another tabled model
  (`contrast` on `lucid-origin`, `transparency` on `phoenix-v1.0`, …) and a
  guidance kind outside the model's table (`guidances.edge` on Phoenix) are
  still reported as `unsupported_param` with the models that take them, but as
  a **warning**, so the request passes. The published reference
  (https://docs.leonardo.ai/reference/creategeneration, OpenAPI updatedAt
  2026-09-01, read 2026-11-12) leaves `parameters` and `guidances` open on all
  13 tabled image arms (no `additionalProperties: false`, which it sets 62 times
  elsewhere), and no page or recorded response says the API rejects such a key.
  Pass `severity: { unsupported_param: "error" }` to keep refusing them. The
  unified `negativePrompt` on a Lucid model is still refused: a canonical field
  that cannot be delivered is a typed gap.
- **`outputFormat` / `outputDelivery` refusal copy.** Both messages cited a
  `GET /v2/generations/{id}` route that the v2 reference does not publish. The
  images come back from the v1
  `GET https://cloud.leonardo.ai/api/rest/v1/generations/{id}`
  (https://docs.leonardo.ai/v1.0/reference/getgenerationbyid) or a webhook,
  and the messages now say so. The `outputFormat` message also no longer claims
  that no model on the endpoint has a format field: none of the tabled Leonardo
  models does, but seedream-5.0-pro and bytedance/seedream-5.0-flash take
  `output_format` and remove-bg takes `format`, set through
  `providerOptions.leonardo.parameters`.
