/** What a file really is, judged from its first bytes. The type in the upload is not trusted. */
export interface DetectedFile {
  contentType: "application/pdf" | "image/jpeg" | "image/png" | "image/webp" | "image/heic";
}

const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "heim", "heis", "mif1", "msf1"]);

export function sniffFile(bytes: Uint8Array): DetectedFile | undefined {
  const at = (offset: number, text: string): boolean =>
    [...text].every((character, index) => bytes[offset + index] === character.charCodeAt(0));
  if (at(0, "%PDF-")) return { contentType: "application/pdf" };
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return { contentType: "image/jpeg" };
  if (
    bytes[0] === 0x89 &&
    at(1, "PNG") &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return { contentType: "image/png" };
  }
  if (at(0, "RIFF") && at(8, "WEBP")) return { contentType: "image/webp" };
  if (at(4, "ftyp")) {
    const brand = String.fromCharCode(...bytes.slice(8, 12));
    if (HEIC_BRANDS.has(brand)) return { contentType: "image/heic" };
  }
  return undefined;
}

/** A name that is safe to show and to put in a download header: no path, no control characters. */
export function safeFilename(name: string): string {
  const base = name.split("/").pop()?.split("\\").pop() ?? "";
  const forbidden = new Set(['"', "<", ">", "|", ":", "*", "?"]);
  const cleaned = [...base]
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code > 0x1f && code !== 0x7f && !forbidden.has(character);
    })
    .join("")
    .trim()
    .slice(0, 120);
  return cleaned === "" || /^\.+$/.test(cleaned) ? "file" : cleaned;
}
