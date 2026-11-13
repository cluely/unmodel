---
"unmodel": patch
---

cohere: `CohereTextModelId` and `CohereModelId` say on hover that they are models.dev's ids, not the ones `cohere.chat` validates

Both unions are still the keys of the generated `models` table, and two of
those keys are models.dev spellings no Cohere page uses:
`north-mini-code-1-0` and `north-small-translate-09-2026`. `cohere.chat`
validates them with an `unknown_model` warning. Type model ids as
`CohereChatModelId` to get the ids `cohere.chat` knows, including Cohere's own
`north-mini-code-1.0` and `north-small-translate-1.0`. Both are exported from
`unmodel/cohere` and `unmodel/cohere/types`.
