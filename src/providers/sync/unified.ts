/**
 * sync.'s unified adapters, one per category: `lipsync` (a clip goes in) and
 * `avatar` (a still goes in).
 *
 * A barrel over two modules for the reason `openai/unified.ts` states — one
 * module per category is what keeps each ready-made pack paying only for the
 * endpoints it calls. It matters more here than at most providers, because the
 * two categories reach the SAME URL and one of the five models is in both: a
 * single adapter module would put every lipsync row into the avatar bundle
 * without a single line of either pack changing.
 */
export { lipsync, type SyncLipsyncResult, type SyncLipsyncWire } from "./unified-lipsync";
export { avatar, type SyncAvatarResult, type SyncAvatarWire } from "./unified-avatar";
