---
"unmodel": patch
---

zhipuai: `zhipuai.chat` accepts `{type: "file"}` content parts on `glm-4.6v-flash`, `glm-4.6v` and `glm-4.5v`

- These three vision models refused every file part with
  `unsupported_capability` ("does not accept pdf input"), because models.dev
  lists their input as text, image and video only. Each model's page lists its
  input as "视频、图像、文本、文件" (video, image, text, file)
  (https://docs.bigmodel.cn/cn/guide/models/free/glm-4.6v-flash,
  https://docs.bigmodel.cn/cn/guide/models/vlm/glm-4.6v,
  https://docs.bigmodel.cn/cn/guide/models/vlm/glm-4.5v). The chat API
  reference says "视觉模型支持纯文本和多模态内容（文本、图片、视频、文件）"
  (https://docs.bigmodel.cn/api-reference/模型-api/对话补全, checked
  2026-11-13). A file part now validates on all three, whether it uses
  `file.file_id` or Zhipu's `file.file_url`, both directly and through
  `unmodel/chat`. Text-only models such as `glm-4.6` still refuse it.
- `unmodel/zhipuai` exports `chatModels`, the catalog `zhipuai.chat`
  validates against. It is the generated `models` table, which is unchanged,
  with these three rows corrected.
