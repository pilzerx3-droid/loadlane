// Architecture rules (ADR 0001, ADR 0011): modules are separate parts of one application.
//  1. A module may use another module only through that module's index.ts.
//  2. The platform (cross-cutting code) never depends on a module.
//  3. Every module folder has an index.ts and a <name>.module.ts.
// Test files are exempt: end-to-end tests legitimately look across modules.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcRoot = fileURLToPath(new URL(".", import.meta.url));
const modulesRoot = join(srcRoot, "modules");
const platformRoot = join(srcRoot, "platform");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith(".ts") && !path.endsWith(".test.ts") ? [path] : [];
  });
}

/** Relative imports of a file, resolved to absolute paths. */
function relativeImports(file: string): string[] {
  const text = readFileSync(file, "utf8");
  const specifiers = [...text.matchAll(/(?:from|import)\s*\(?\s*["'](\.[^"']*)["']/g)].map(
    (match) => match[1] ?? "",
  );
  return specifiers.map((specifier) => resolve(dirname(file), specifier));
}

function moduleOf(path: string): string | undefined {
  const parts = relative(modulesRoot, path).split(sep);
  return parts[0] && !parts[0].startsWith("..") && parts.length > 1 ? parts[0] : undefined;
}

const moduleNames = readdirSync(modulesRoot).filter((name) =>
  statSync(join(modulesRoot, name)).isDirectory(),
);

describe("module boundaries", () => {
  it("finds the modules of the masterprompt", () => {
    expect(moduleNames.length).toBe(23);
    expect(moduleNames).toEqual(
      expect.arrayContaining([
        "authentication",
        "organizations",
        "users-permissions",
        "spot-freight",
      ]),
    );
  });

  it("gives every module an index.ts and a module class file", () => {
    for (const name of moduleNames) {
      expect(existsSync(join(modulesRoot, name, "index.ts")), `${name}/index.ts`).toBe(true);
      expect(
        existsSync(join(modulesRoot, name, `${name}.module.ts`)),
        `${name}/${name}.module.ts`,
      ).toBe(true);
    }
  });

  it("lets a module reach into another module only through its index.ts", () => {
    const violations: string[] = [];
    for (const file of sourceFiles(modulesRoot)) {
      const own = moduleOf(file);
      for (const target of relativeImports(file)) {
        const other = moduleOf(target);
        if (!other || other === own) continue;
        if (target !== join(modulesRoot, other, "index.ts")) {
          violations.push(`${relative(srcRoot, file)} imports ${relative(srcRoot, target)}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("keeps the platform independent of the modules", () => {
    const violations: string[] = [];
    for (const file of sourceFiles(platformRoot)) {
      for (const target of relativeImports(file)) {
        if (target.startsWith(modulesRoot)) {
          violations.push(`${relative(srcRoot, file)} imports ${relative(srcRoot, target)}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
