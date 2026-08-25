/**
 * HeyGen's unified adapters, one per category: `lipsync` (a clip goes in) and
 * `avatar` (a still goes in).
 *
 * A barrel over two modules for the reason `openai/unified.ts` states — one
 * module per category is what keeps each ready-made pack paying only for the
 * endpoints it calls. Here the two are two URLs with two response shapes and
 * two status enums, so a merged module would put the avatar route's watermark,
 * caption, background and voice-settings schemas into a lipsync bundle that
 * has fields for none of them.
 */
export { lipsync, type HeygenLipsyncResult, type HeygenLipsyncWire } from "./unified-lipsync";
export { avatar, type HeygenAvatarResult, type HeygenAvatarWire } from "./unified-avatar";
