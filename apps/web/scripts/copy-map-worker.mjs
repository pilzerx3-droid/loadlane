// Copies the MapLibre worker next to the app so the browser loads it from our own origin. Bundlers
// rewrite the worker's address and break it, and the Content Security Policy only allows 'self'.
// Runs before `dev` and `build`; the copy is not committed.
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const packageRoot = dirname(require.resolve("maplibre-gl/package.json"));
const target = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "maplibre");
mkdirSync(target, { recursive: true });
copyFileSync(
  join(packageRoot, "dist", "maplibre-gl-worker.mjs"),
  join(target, "maplibre-gl-worker.mjs"),
);
