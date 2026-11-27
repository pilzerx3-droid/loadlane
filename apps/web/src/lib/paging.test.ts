import { describe, expect, it } from "vitest";
import { parsePage } from "./paging";

describe("parsePage", () => {
  it.each([
    ["1", 1],
    ["2", 2],
    ["37", 37],
    [undefined, 1],
    ["", 1],
    ["0", 1],
    ["-3", 1],
    ["abc", 1],
    ["1.5", 1],
    ["2e3", 1],
    ["99999999", 1],
    [["4", "5"], 4],
    [[], 1],
  ])("reads %j as page %i", (value, page) => {
    expect(parsePage(value)).toBe(page);
  });
});
