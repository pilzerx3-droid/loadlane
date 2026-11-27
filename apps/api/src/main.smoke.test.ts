// Start-up smoke test: bundles the API like `pnpm build` does and starts the bundle with an invalid
// configuration. A correct bundle must stop at configuration validation, before it opens a database
// connection or a port. (This test exists because a bundled workspace package once ran its own
// command line code on import.)
import { spawn } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { build } from "esbuild";
import { afterAll, beforeAll, expect, it } from "vitest";

const outDirectory = new URL("../dist-smoke/", import.meta.url);
const bundle = new URL("main.js", outDirectory);
const apiRoot = new URL("../", import.meta.url);

beforeAll(async () => {
  const pkg = JSON.parse(readFileSync(new URL("package.json", apiRoot), "utf8")) as {
    dependencies?: Record<string, string>;
  };
  await build({
    entryPoints: [new URL("src/main.ts", apiRoot).pathname.replace(/^\/([A-Za-z]:)/, "$1")],
    outfile: bundle.pathname.replace(/^\/([A-Za-z]:)/, "$1"),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node26",
    // Same rule as build.mjs: third-party packages stay external, workspace packages are bundled.
    external: Object.keys(pkg.dependencies ?? {}).filter((name) => !name.startsWith("@loadlane/")),
    tsconfig: new URL("tsconfig.json", apiRoot).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
    logLevel: "silent",
  });
});

afterAll(() => {
  rmSync(outDirectory, { recursive: true, force: true });
});

it("the bundled API stops at configuration validation and does not run anything else", async () => {
  const child = spawn(process.execPath, [bundle.pathname.replace(/^\/([A-Za-z]:)/, "$1")], {
    // Explicit values win over a developer's .env file, so the outcome does not depend on it.
    env: {
      PATH: process.env["PATH"] ?? "",
      OIDC_ISSUER: "not-a-url",
      APP_DATABASE_URL: "postgres://nobody@127.0.0.1:1/none",
      OIDC_AUDIENCE: "x",
      API_PORT: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
  child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));

  const exitCode = await new Promise<number | null>((resolve) => {
    const timer = setTimeout(() => {
      child.kill();
      resolve(null);
    }, 15_000);
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });

  expect(output).toContain("Invalid API configuration");
  expect(output).not.toMatch(/Migration|migrat/i);
  expect(exitCode).not.toBe(0);
  expect(exitCode).not.toBeNull();
}, 30_000);
