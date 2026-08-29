import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const webSourceDirectory = resolve(import.meta.dirname, "../apps/web/src");

function reactSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return reactSourceFiles(path);
    }
    return entry.isFile() && /\.tsx$/u.test(entry.name) ? [path] : [];
  });
}

describe("shared UI usage", () => {
  it("keeps native interactive elements inside @keel/ui", () => {
    const violations = reactSourceFiles(webSourceDirectory).flatMap((path) => {
      const source = readFileSync(path, "utf8");
      const matches = source.match(/<(?:a|button|input|select|textarea)\b/gu);
      return matches === null
        ? []
        : [`${relative(webSourceDirectory, path)}: ${matches.join(", ")}`];
    });

    expect(violations).toEqual([]);
  });
});
