---
"unmodel": patch
---

Add `bria/fibo-edit/relight` to fal's exact provider-native `imageEdit` surface
without exposing it through the prompt-required unified adapter. Its request
and result types, enums, checks, route, catalog row, and $0.04-per-image price
are generated from fal's published schema and documented model page.

Also let Google and MiniMax `checkTts` inspect decoded `unknown` JSON safely;
nulls, primitives, and malformed nested values now produce a report instead of
throwing, while the exported structural response interfaces remain available
for callers that want them. Google's checker now counts audio only when an
`audio/*` part carries non-empty inline bytes or a non-empty file URI, and an
unspecified prompt block reason no longer hides an empty-audio warning.
The Google checker now also follows the exported delivery descriptor exactly:
only the documented first response part can satisfy the audio check.
