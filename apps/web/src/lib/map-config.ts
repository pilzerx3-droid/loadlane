/** The public OpenFreeMap style (OpenStreetMap data, no key). Replace it with MAP_STYLE_URL to self-host. */
export const DEFAULT_MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function usableOrigin(value: string): string | undefined {
  if (!URL.canParse(value)) return undefined;
  const url = new URL(value);
  if (url.protocol === "https:" || (url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname))) {
    return url.origin;
  }
  return undefined;
}

export interface MapConfig {
  styleUrl: string;
  /** Origins the browser may contact to draw the map: the style host and any extra hosts it names. */
  origins: string[];
}

/**
 * Where the map comes from (ADR 0021). MAP_STYLE_URL is the MapLibre style; MAP_EXTRA_ORIGINS lists
 * other hosts a custom style uses for tiles, sprites or fonts (comma separated). A value that is not
 * https (or http on localhost) is ignored and the default is used, so a typo cannot open the
 * Content Security Policy to an unexpected host.
 */
export function mapConfig(env: Record<string, string | undefined>): MapConfig {
  const requested = env["MAP_STYLE_URL"]?.trim();
  const styleUrl = requested && usableOrigin(requested) ? requested : DEFAULT_MAP_STYLE_URL;
  const origins = new Set<string>();
  const styleOrigin = usableOrigin(styleUrl);
  if (styleOrigin) origins.add(styleOrigin);
  for (const extra of (env["MAP_EXTRA_ORIGINS"] ?? "").split(",")) {
    const origin = usableOrigin(extra.trim());
    if (origin) origins.add(origin);
  }
  return { styleUrl, origins: [...origins] };
}
