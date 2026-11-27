import { describe, expect, it } from "vitest";
import { clearCookie, cookieNames, readCookie, serializeCookie } from "./cookies";

describe("cookie names", () => {
  it("get the __Host- prefix over https only", () => {
    expect(cookieNames(false)).toEqual({ session: "ll_session", login: "ll_login" });
    expect(cookieNames(true)).toEqual({ session: "__Host-ll_session", login: "__Host-ll_login" });
  });
});

describe("serializeCookie", () => {
  it("is HttpOnly, SameSite=Lax and limited to the whole site", () => {
    expect(serializeCookie("a", "b", { maxAgeSeconds: 60, secure: false })).toBe(
      "a=b; Path=/; Max-Age=60; HttpOnly; SameSite=Lax",
    );
  });

  it("adds Secure when asked", () => {
    expect(serializeCookie("a", "b", { maxAgeSeconds: 60, secure: true })).toContain("; Secure");
  });

  it("encodes unsafe characters in the value", () => {
    expect(serializeCookie("a", "x y;z", { maxAgeSeconds: 1, secure: false })).toContain(
      "a=x%20y%3Bz;",
    );
  });

  it("clears a cookie with Max-Age=0", () => {
    expect(clearCookie("a", true)).toContain("Max-Age=0");
  });
});

describe("readCookie", () => {
  it("finds a cookie among several", () => {
    expect(readCookie("x=1; ll_session=abc; y=2", "ll_session")).toBe("abc");
  });

  it("does not match a longer cookie name", () => {
    expect(readCookie("my_ll_session=bad", "ll_session")).toBeUndefined();
  });

  it("returns undefined for a missing header, a missing cookie or a broken value", () => {
    expect(readCookie(null, "a")).toBeUndefined();
    expect(readCookie("b=1", "a")).toBeUndefined();
    expect(readCookie("a=%E0%A4%A", "a")).toBeUndefined();
  });
});
