import { describe, expect, it, vi } from "vitest";
import { redirectHome, withAuthDeps } from "./route-helpers";
import { makeDeps } from "../testing/helpers";

describe("withAuthDeps", () => {
  it("passes the dependencies to the handler", async () => {
    const deps = makeDeps();
    const handler = vi.fn(() => Promise.resolve(new Response("ok")));
    const response = await withAuthDeps(
      new Request("http://x/"),
      handler,
      redirectHome,
      () => deps,
    );
    expect(await response.text()).toBe("ok");
    expect(handler).toHaveBeenCalledWith(expect.any(Request), deps);
  });

  it("answers with the fallback instead of failing when the configuration is invalid", async () => {
    const handler = vi.fn(() => Promise.resolve(new Response("ok")));
    const failing = () => {
      throw new Error("Invalid web configuration");
    };
    const response = await withAuthDeps(new Request("http://x/"), handler, redirectHome, failing);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/");
    expect(handler).not.toHaveBeenCalled();
  });
});
