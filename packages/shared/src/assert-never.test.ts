import { describe, expect, it } from "vitest";
import { assertNever } from "./assert-never.ts";

describe("assertNever", () => {
  it("throws with the offending value in the message", () => {
    expect(() => assertNever("oops" as never)).toThrow('Unexpected value: "oops"');
  });

  it("uses a custom message when given", () => {
    expect(() => assertNever(42 as never, "Unknown status")).toThrow("Unknown status: 42");
  });
});
