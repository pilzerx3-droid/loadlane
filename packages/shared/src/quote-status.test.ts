import { describe, expect, it } from "vitest";
import {
  QUOTE_STATUSES,
  canQuoteTransition,
  isQuoteEditable,
  isQuoteExpired,
  isQuoteStatus,
  nextQuoteStatuses,
} from "./quote-status.ts";

describe("quote status model", () => {
  it("moves draft -> sent -> accepted or rejected", () => {
    expect(canQuoteTransition("draft", "sent")).toBe(true);
    expect(canQuoteTransition("sent", "accepted")).toBe(true);
    expect(canQuoteTransition("sent", "rejected")).toBe(true);
  });

  it("does not skip steps or go back", () => {
    expect(canQuoteTransition("draft", "accepted")).toBe(false);
    expect(canQuoteTransition("sent", "draft")).toBe(false);
    expect(canQuoteTransition("accepted", "rejected")).toBe(false);
  });

  it("has no way out of a final status", () => {
    for (const status of ["accepted", "rejected", "cancelled"] as const) {
      expect(nextQuoteStatuses(status)).toEqual([]);
    }
  });

  it("can be cancelled while draft or sent only", () => {
    expect(QUOTE_STATUSES.filter((s) => canQuoteTransition(s, "cancelled"))).toEqual([
      "draft",
      "sent",
    ]);
  });

  it("only a draft is editable", () => {
    expect(QUOTE_STATUSES.filter(isQuoteEditable)).toEqual(["draft"]);
  });

  it("recognizes statuses", () => {
    expect(isQuoteStatus("sent")).toBe(true);
    expect(isQuoteStatus("expired")).toBe(false);
  });
});

describe("isQuoteExpired", () => {
  it("is derived from the date for sent quotes only", () => {
    expect(isQuoteExpired("sent", "2030-01-01", "2030-01-02")).toBe(true);
    expect(isQuoteExpired("sent", "2030-01-01", "2030-01-01")).toBe(false);
    expect(isQuoteExpired("draft", "2020-01-01", "2030-01-01")).toBe(false);
    expect(isQuoteExpired("accepted", "2020-01-01", "2030-01-01")).toBe(false);
  });
});
