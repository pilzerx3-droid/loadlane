// Fails when the Drizzle schema and the committed SQL migrations disagree.
// 1. `drizzle-kit check` validates the migration history (snapshots, journal, collisions).
// 2. `drizzle-kit generate` must not produce a new migration; if it does, the schema has
//    changes without a committed migration. The generated files are left in place for review.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Run drizzle-kit's CLI with the current Node binary: no shell needed, works the same on all OSes.
// bin.cjs is not in the package's "exports", so it is addressed by path.
const DRIZZLE_KIT_BIN = fileURLToPath(
  new URL("../node_modules/drizzle-kit/bin.cjs", import.meta.url),
);

function drizzleKit(args: string[]): { status: number } {
  const result = spawnSync(process.execPath, [DRIZZLE_KIT_BIN, ...args], { encoding: "utf8" });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return { status: result.status ?? 1 };
}

const check = drizzleKit(["check"]);
if (check.status !== 0) {
  console.error("\nDrift check failed: drizzle-kit check reported problems.");
  process.exit(1);
}

const generate = drizzleKit(["generate", "--name=drift_check"]);
if (generate.status !== 0) {
  console.error("\nDrift check failed: drizzle-kit generate did not run cleanly.");
  process.exit(1);
}

const status = spawnSync("git", ["status", "--porcelain", "--", "migrations"], {
  encoding: "utf8",
});
if (status.status !== 0) {
  console.error("\nDrift check failed: could not read git status.", status.stderr);
  process.exit(1);
}
if (status.stdout.trim() !== "") {
  console.error(
    "\nDrift check failed: the schema has changes without a committed migration, or migration files are uncommitted:\n" +
      status.stdout +
      "\nReview the generated SQL, rename it to describe the change, and commit it.",
  );
  process.exit(1);
}

console.log("\nNo drift: schema and committed migrations match.");
