import type pg from "pg";
import { describe, expect, it, vi } from "vitest";
import { runRetentionOnce } from "./retention-job.ts";

const pool = {} as pg.Pool;

describe("runRetentionOnce", () => {
  it("logs the counts and returns the report", async () => {
    const log = vi.fn();
    const report = { organizations: 2, positionsDeleted: 5, lastPositionsDeleted: 1 };
    expect(await runRetentionOnce(pool, log, () => Promise.resolve(report))).toEqual(report);
    expect(log).toHaveBeenCalledWith("retention finished", report);
  });

  it("survives a failure and never logs its message", async () => {
    const log = vi.fn();
    const result = await runRetentionOnce(pool, log, () =>
      Promise.reject(new Error("password=secret at 32.1,-96.8")),
    );
    expect(result).toBeUndefined();
    expect(log).toHaveBeenCalledWith("retention failed", { error: "Error" });
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret");
  });
});
