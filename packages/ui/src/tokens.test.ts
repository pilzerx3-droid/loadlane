// Checks the color tokens against WCAG 2.2 contrast minimums (4.5:1 for text, 3:1 for focus indicators).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./tokens.css", import.meta.url), "utf8");

type Tokens = Record<string, string>;

/** The custom properties declared in the first block that starts with `selector`. */
function block(selector: string): Tokens {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`No block for ${selector}`);
  const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
  const tokens: Tokens = {};
  for (const match of body.matchAll(/--([a-z-]+):\s*([^;]+);/g)) {
    tokens[match[1] ?? ""] = (match[2] ?? "").trim();
  }
  return tokens;
}

type Rgb = [number, number, number];

function parse(value: string): Rgb {
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex?.[1]) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  throw new Error(`Not a hex color: ${value}`);
}

function luminance([r, g, b]: Rgb): number {
  const channel = (value: number) => {
    const s = value / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: Rgb, b: Rgb): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

/** `foreground` laid over `background` with the given opacity, as the badge backgrounds are. */
function blend(background: Rgb, foreground: Rgb, opacity: number): Rgb {
  return background.map((channel, i) =>
    Math.round(channel * (1 - opacity) + (foreground[i] ?? 0) * opacity),
  ) as Rgb;
}

const themes: [string, Tokens][] = [
  ["light", block(":root")],
  ["dark", block(':root[data-theme="dark"]')],
];

describe.each(themes)("%s theme", (_name, tokens) => {
  const color = (name: string) => parse(tokens[name] ?? "");

  it("has every token the components use", () => {
    for (const name of [
      "background",
      "card",
      "foreground",
      "muted-foreground",
      "accent",
      "accent-foreground",
      "positive",
      "warning",
      "danger",
      "ring",
    ]) {
      expect(tokens[name], name).toBeDefined();
    }
  });

  it("keeps body and muted text readable on the page and on cards", () => {
    for (const surface of ["background", "card"]) {
      expect(
        contrast(color("foreground"), color(surface)),
        `foreground on ${surface}`,
      ).toBeGreaterThanOrEqual(7);
      expect(
        contrast(color("muted-foreground"), color(surface)),
        `muted on ${surface}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps the text on the accent button readable", () => {
    expect(contrast(color("accent-foreground"), color("accent"))).toBeGreaterThanOrEqual(7);
  });

  it("keeps links and status text readable on the page and on cards", () => {
    for (const surface of ["background", "card"]) {
      for (const text of ["positive", "warning", "danger"]) {
        expect(
          contrast(color(text), color(surface)),
          `${text} on ${surface}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("keeps status chips readable on their own tinted background", () => {
    const card = color("card");
    const chips: [string, string, number][] = [
      ["positive", "accent", 0.25],
      ["warning", "warning", 0.2],
      ["danger", "danger", 0.15],
    ];
    for (const [text, tint, opacity] of chips) {
      const background = blend(card, color(tint), opacity);
      expect(contrast(color(text), background), `${text} chip`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("makes the focus ring visible against the page and cards", () => {
    for (const surface of ["background", "card"]) {
      expect(contrast(color("ring"), color(surface)), `ring on ${surface}`).toBeGreaterThanOrEqual(
        3,
      );
    }
  });
});
