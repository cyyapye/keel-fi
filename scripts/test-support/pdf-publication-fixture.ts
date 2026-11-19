import { mkdir, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach } from "vitest";

/** Coordinate only fixtures exercising the real per-user publication lock. */
export function coordinatePdfPublicationFixture() {
  const path = join(tmpdir(), `keel-pdf-publication-test-${process.getuid!()}`);
  let owned = false;
  beforeEach(async () => {
    const deadline = Date.now() + 10_000;
    while (!owned) {
      try {
        await mkdir(path, { mode: 0o700 });
        owned = true;
      } catch (error) {
        if (
          (error as NodeJS.ErrnoException).code !== "EEXIST" ||
          Date.now() >= deadline
        )
          throw error;
        await new Promise((done) => setTimeout(done, 20));
      }
    }
  });
  afterEach(async () => {
    if (owned) {
      owned = false;
      await rmdir(path);
    }
  });
}
