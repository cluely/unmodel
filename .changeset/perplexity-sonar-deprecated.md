---
"unmodel": patch
---

perplexity: the four Sonar models are marked deprecated

The models.dev snapshot (2026-11-12) now carries `status: "deprecated"` on
`sonar`, `sonar-pro`, `sonar-reasoning-pro` and `sonar-deep-research`, so
`perplexity.chat` adds a `deprecated_model` warning for each of them. They
still validate: Perplexity superseded Sonar Chat
Completions with the Agent API (`POST /v1/agent`) but keeps serving it —
"Sonar Chat Completions support ended on September 27, 2026. Synchronous and
streaming requests keep working: they are being reformulated as Agent API
requests"
([migration overview](https://docs.perplexity.ai/docs/agent-api/migrate-from-sonar/overview),
read 2026-11-12). Perplexity's suggested Agent API starting points are
"`sonar` → `fast`, `sonar-pro` → `fast`, `sonar-reasoning-pro` → `low`,
`sonar-deep-research` → `high`"
([migration how-to](https://docs.perplexity.ai/docs/agent-api/migrate-from-sonar/how-to)).

The same snapshot adds `family: "sonar"` to the `sonar-deep-research` row.
