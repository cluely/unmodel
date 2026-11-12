---
"unmodel": patch
---

catalog refresh (2026-11-12), hosts and gateways: models.dev snapshot for every provider except the first-party labs and cloud mirrors, which land in their own entries

- 28 providers join `unmodel/catalog` (catalog-only — no validator): `ai21`,
  `aimlapi`, `ainetcafe`, `bee`, `boundless`, `commandcode`, `engy`, `hopper`,
  `inco`, `infer`, `kimi-code-plan-cn`, `kimi-code-plan-global`, `liquid`,
  `lowrouter`, `melious`, `modular`, `munito`, `munito-eu`, `nan`, `oci`,
  `pareto`, `prime`, `reflection`, `sambanova`, `tempr`, `vispark`, `wallaby`,
  `wally`.
- 5 providers left models.dev and no longer resolve in `unmodel/catalog`:
  `crof`, `iflowcn`, `kimi-for-coding`, `llama`, `v0`.
- Host and gateway catalogs (openrouter, vercel, togetherai, fireworks-ai,
  deepinfra, nvidia, friendli, siliconflow, novita-ai, …) pick up the new
  flagship rows. Ids that left a host's catalog now validate with an
  `unknown_model` warning and no cost estimate — among them
  `accounts/fireworks/models/gpt-oss-120b`, `deepseek-ai/DeepSeek-V3.2` on
  friendli and `meta/llama-3.3-70b-instruct` on nvidia.
- `deepinfra.chat` gains `.toApi("anthropic")`: DeepInfra now serves
  `anthropic/claude-fable-5`, so the generated availability table names an
  anthropic target for it, and the entry now ships the anthropic-messages
  codec behind that edge (as openrouter and vercel already do) instead of a
  promised edge that would throw `TranslationUnavailableError`.
