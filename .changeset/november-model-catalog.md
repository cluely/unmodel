---
"unmodel": minor
---

Add GPT-6.2 Astra and Sol, Gemini 4 Neon, and Qwen4-Max to the chat catalog. Apply OpenAI's Chat Completions tool and reasoning rules and long-context pricing. Validate Neon's thinking and long-decode settings on Gemini and Vertex. Accept Alibaba's Qwen video parts on the native chat entry.

Add Seedance 2.5 Flash on BytePlus and fal. Add MAI Image 2.7 and 2.7 Flash generation and editing on fal and Azure. Azure edits accept up to five reference images as repeated multipart image fields.

GPT-6.2 pricing includes cache writes when selecting the long-context tier and uses the published tier on OpenRouter. Neon validates its generation settings and accounts for continuation input in cost estimates.

Alibaba and OpenRouter accept their documented video request shapes. Video requests with unverifiable token costs report that limitation and fail validation when a cost cap is supplied. The Azure edit body type defaults to a single Blob. Use `MaiImagesEditsBody<Blob[]>` for a typed multipart image list.
