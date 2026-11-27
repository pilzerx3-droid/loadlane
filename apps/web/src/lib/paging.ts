/** `?page=` as a whole number of at least 1; anything else (missing, repeated, text, 0, huge) is page 1. */
export function parsePage(value: string | string[] | undefined): number {
  const text = Array.isArray(value) ? value[0] : value;
  return text !== undefined && /^\d{1,6}$/.test(text) && Number(text) >= 1 ? Number(text) : 1;
}
