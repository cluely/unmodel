/**
 * `toFormData` — the multipart body of a Photoroom request, on an
 * **import-free** leaf.
 *
 * Kept apart from `./shared.ts` because that module builds the zod schema and
 * its exports are typed in zod's terms; this is the one runtime helper the
 * public entry re-exports from the validators' side, and its declaration has
 * to stay free of `zod` (docs/decisions.md §5).
 */

/**
 * Builds the `multipart/form-data` body for a Photoroom request.
 *
 * A `Blob` becomes a file part; everything else is stringified, which is what
 * the wire wants — "Booleans are the strings `true`/`false`", and a number is
 * its decimal text (`padding=0.15`), written out in full: `1e-7` goes out as
 * `0.0000001`, because no Photoroom source writes an exponent and whether its
 * form parser reads one is not documented. A string is sent as written.
 * `null` and `undefined` are omitted.
 *
 * Pass the VALIDATED result, not the raw params: `photoroom.imageEdit` moves
 * the five `pr-*` feature headers off the body and onto `.request.headers`,
 * and they must not be sent as form fields.
 *
 * ```ts
 * const req = photoroom.imageEdit({ imageFile, "shadow.mode": "ai.soft", padding: 0.1 });
 * await fetch(req.request.url, {
 *   method: req.request.method,
 *   headers: { ...req.request.headers, "x-api-key": process.env.PHOTOROOM_API_KEY! },
 *   body: photoroom.toFormData(req),
 * });
 * ```
 *
 * Do NOT set `content-type` yourself — `fetch` derives the multipart boundary
 * from the `FormData`, which is why `.request.headers` never carries one.
 */
export function toFormData(params: object): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined) continue;
    if (value instanceof Blob) form.append(key, value);
    else form.append(key, typeof value === "number" ? decimalText(value) : String(value));
  }
  return form;
}

/**
 * A finite number as plain decimal digits. `String` switches to exponent
 * notation below 1e-6 and from 1e21; this moves the decimal point of that
 * text instead of re-rounding, so the digits are the ones `String` chose.
 */
function decimalText(value: number): string {
  const text = String(value);
  const match = /^(-?)(\d+)(?:\.(\d+))?e([+-]\d+)$/.exec(text);
  if (match === null) return text;
  const [, sign = "", whole = "", fraction = "", exponent = "0"] = match;
  const digits = whole + fraction;
  const point = whole.length + Number(exponent);
  if (point <= 0) return `${sign}0.${"0".repeat(-point)}${digits}`;
  if (point >= digits.length) return `${sign}${digits}${"0".repeat(point - digits.length)}`;
  return `${sign}${digits.slice(0, point)}.${digits.slice(point)}`;
}
