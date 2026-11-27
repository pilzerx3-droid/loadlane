// Fails when the Drizzle schema and the committed SQL migrations disagree.
// 1. `drizzle-kit check` validates the migration history (snapshots, journal, collisions).
// 2. `drizzle-kit generate` must not produce a new migration; if it does, the schema has
//    changes without a committed migration. The generated files are left in place for review.
import { spawnSync } from "node:child_process";

function run(command: string, args: string[]): { status: number; stdout: string } {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return { status: result.status ?? 1, stdout: result.stdout ?? "" };
}

const check = run("pnpm", ["exec", "drizzle-kit", "check"]);
if (check.status !== 0) {
  console.error("\nDrift check failed: drizzle-kit check reported problems.");
  process.exit(1);
}

const generate = run("pnpm", ["exec", "drizzle-kit", "generate", "--name=drift_check"]);
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
