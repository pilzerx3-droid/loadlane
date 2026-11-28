import { describe, expect, it } from "vitest";
import { isActive, NAV_ITEMS, navigationFor } from "./navigation";

const labels = (permissions: string[]) => navigationFor(permissions).map((item) => item.label);

describe("navigationFor", () => {
  it("shows only the overview to someone without permissions", () => {
    expect(labels([])).toEqual(["Overview"]);
  });

  it("adds pages as the permissions grow", () => {
    expect(labels(["organization:read"])).toEqual(["Overview", "Settings"]);
    expect(labels(["member:read"])).toEqual(["Overview", "Members"]);
    expect(labels(["member:read", "organization:read"])).toEqual([
      "Overview",
      "Members",
      "Settings",
    ]);
  });

  it("shows the master data pages the permissions allow", () => {
    expect(labels(["customer:read", "location:read"])).toEqual([
      "Overview",
      "Customers",
      "Locations",
    ]);
    expect(labels(["carrier:read"])).toEqual(["Overview", "Carriers"]);
    expect(labels(["customer:manage"])).toEqual(["Overview"]);
  });

  it("shows transports to people who may read them", () => {
    expect(labels(["transport:read"])).toEqual(["Overview", "Transports", "Alerts"]);
    expect(labels(["transport:manage"])).toEqual(["Overview"]);
  });

  it("ignores permissions it does not know", () => {
    expect(labels(["spot:award", "nonsense"])).toEqual(["Overview"]);
  });

  it("matches what each role gets in the role catalog (admin sees everything, carrier user only settings)", () => {
    const admin = [
      "organization:read",
      "organization:manage",
      "member:read",
      "member:manage",
      "audit:read",
    ];
    expect(labels(admin)).toEqual(["Overview", "Members", "Activity", "Settings"]);
    expect(labels(["organization:read"])).toEqual(["Overview", "Settings"]);
  });

  it("lists only pages that exist", () => {
    expect(NAV_ITEMS.map((item) => item.href)).toEqual([
      "/",
      "/transports",
      "/alerts",
      "/calculations",
      "/tariffs",
      "/quotes",
      "/spot",
      "/reports",
      "/customers",
      "/carriers",
      "/locations",
      "/members",
      "/activity",
      "/settings",
    ]);
  });
});

describe("isActive", () => {
  it.each([
    ["/", "/", true],
    ["/", "/members", false],
    ["/members", "/members", true],
    ["/members", "/members/42", true],
    ["/members", "/membership", false],
    ["/settings", "/", false],
  ])("link %s on page %s is active: %s", (href, pathname, expected) => {
    expect(isActive(href, pathname)).toBe(expected);
  });
});
