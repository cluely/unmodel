/**
 * VEED's unified adapters, one per category: `lipsync` (a clip goes in) and
 * `avatar` (a still goes in).
 *
 * A barrel over two modules for the reason `openai/unified.ts` states — one
 * module per category is what keeps each ready-made pack paying only for the
 * endpoints it calls. Here the two categories are two URLs with disjoint
 * schemas, so a merged module would be a smaller leak than sync.'s (whose two
 * categories share one URL) and still a real one: the avatar bundle would pick
 * up the clip route's validator and zod schema for nothing.
 */
export { lipsync, type VeedLipsyncResult, type VeedLipsyncWire } from "./unified-lipsync";
export { avatar, type VeedAvatarResult, type VeedAvatarWire } from "./unified-avatar";
