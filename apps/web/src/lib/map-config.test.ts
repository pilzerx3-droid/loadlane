import { describe, expect, it } from "vitest";
import { DEFAULT_MAP_STYLE_URL, mapConfig } from "./map-config";

describe("mapConfig", () => {
  it("uses the public OpenFreeMap style by default", () => {
    expect(mapConfig({})).toEqual({
      styleUrl: DEFAULT_MAP_STYLE_URL,
      origins: ["https://tiles.openfreemap.org"],
    });
  });

  it("takes a self-hosted style and extra hosts", () => {
    expect(
      mapConfig({
        MAP_STYLE_URL: "https://maps.example.com/style.json",
        MAP_EXTRA_ORIGINS: "https://fonts.example.com/glyphs, https://cdn.example.com",
      }),
    ).toEqual({
      styleUrl: "https://maps.example.com/style.json",
      origins: ["https://maps.example.com", "https://fonts.example.com", "https://cdn.example.com"],
    });
  });

  it("allows http only for localhost and ignores anything else", () => {
    expect(mapConfig({ MAP_STYLE_URL: "http://localhost:8080/style.json" }).origins).toEqual([
      "http://localhost:8080",
    ]);
    expect(mapConfig({ MAP_STYLE_URL: "http://evil.example.com/style.json" }).styleUrl).toBe(
      DEFAULT_MAP_STYLE_URL,
    );
    expect(mapConfig({ MAP_STYLE_URL: "javascript:alert(1)" }).styleUrl).toBe(
      DEFAULT_MAP_STYLE_URL,
    );
    expect(mapConfig({ MAP_EXTRA_ORIGINS: "http://evil.example.com, not a url" }).origins).toEqual([
      "https://tiles.openfreemap.org",
    ]);
  });
});
