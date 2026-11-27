// Bundles the API into dist/main.js with esbuild.
// Third-party dependencies stay external (installed in node_modules at runtime); workspace packages
// (@loadlane/*) are bundled because they are published as TypeScript source.
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { build } from "esbuild";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
const external = Object.keys(pkg.dependencies ?? {}).filter(
  (name) => !name.startsWith("@loadlane/"),
);

await build({
  entryPoints: ["src/main.ts"],
  outfile: "dist/main.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node26",
  sourcemap: true,
  external,
  tsconfig: "tsconfig.json",
  logLevel: "info",
});
