---
"unmodel": patch
---

Linear-time parsing of two caller-supplied strings (CodeQL `js/redos` and `js/polynomial-redos`).

- `data:` URIs: the media-type parameters are now matched one `;`-free segment at a time, so a hostile `data:;;;;…` string with no `,` is rejected in one pass instead of backtracking exponentially. Every data URI that parsed before parses the same way (RFC 2397 parameters never contain `;`). Applies to the unified layer's `requireInlineBytes` / `base64Payload` and heygen's avatar adapter.
- Azure endpoints: `createAzure({ endpoint })` and the MAI image URL builders trim trailing `/` with a scan, not `replace(/\/+$/, "")`, which went quadratic on a long run of slashes that is not at the end. URLs built from ordinary endpoints are unchanged.
