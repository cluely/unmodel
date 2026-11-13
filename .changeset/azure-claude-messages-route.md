---
"unmodel": patch
---

azure: `createAzure` now documents that Claude deployments are not served on `azure.chat`'s route

Microsoft serves Claude in Foundry only on the Anthropic Messages API. The
"API overview" table on
https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/claude-models
(checked 2026-11-13) lists just "Messages (`POST /v1/messages`)" and "Token
counting (`POST /v1/messages/count_tokens`)", at
`https://<resource-name>.services.ai.azure.com/anthropic/v1/messages`.
`unmodel/azure` models only the OpenAI chat-completions route
(`{endpoint}/openai/v1/chat/completions`).

The generated `models` table still carries the 16 azure Claude rows, among them
`claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5` and `claude-fable-5-2`.
`azure.chat` still resolves a deployment named after one of them with no
`unknown_model` warning. Treat that result as unchecked: the Messages request
Azure actually takes for Claude is not one `azure.chat` validates.
