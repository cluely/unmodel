---
"unmodel": patch
---

atlascloud: `AtlasAssetRef`'s JSDoc names the Asset Library as the source of `asset://` ids (vendor page read 2026-11-12)

The hover text said an `asset://<ASSET_ID>` was "an id from `POST
/api/v1/model/uploadMedia`". That is wrong: `uploadMedia` "Returns a JSON object
with a temporary URL for the uploaded file." (https://www.atlascloud.ai/docs/upload-files).
Asset ids come from Atlas's Asset Library, `POST
https://console.atlascloud.ai/api/v1/sd/assets`, on the console host: "Asset
Library endpoints live on the console host, NOT on the inference host where
generation endpoints live." and "Do not call
`https://api.atlascloud.ai/api/v1/sd/assets` — it will return 404."
(https://www.atlascloud.ai/models/bytedance/seedance-2.5/reference-to-video).
An asset is usable once it reaches `Active`. Docs only: the type and the
validator are unchanged.
