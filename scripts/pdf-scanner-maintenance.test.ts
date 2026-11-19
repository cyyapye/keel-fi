import { coordinatePdfPublicationFixture } from "./test-support/pdf-publication-fixture";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { it, expect } from "vitest";
import {
  beginScannerMaintenance,
  finishScannerMaintenance,
  recordScannerBuildCompletion,
  scannerMaintenanceStatus,
} from "./pdf-scanner-maintenance";
import { withPdfPublicationLock } from "./pdf-sandbox-publication";

it.skipIf(process.platform !== "darwin" || Boolean(process.env.CI))(
  "unconfirmed completion is not cleared; confirmed non-adoption can be reconciled",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "maintenance-fixture-"));
    const config = {
      version: 1 as const,
      socket: root,
      image: `sha256:${"a".repeat(64)}`,
    };
    try {
      await withPdfPublicationLock(config.socket, async () => {
        const pending = await beginScannerMaintenance(
          config,
          join(root, "candidate"),
        );
        expect(await finishScannerMaintenance(pending)).toBe(false);
        await expect(
          beginScannerMaintenance(config, join(root, "second")),
        ).rejects.toThrow("reconciliation_required");
        await recordScannerBuildCompletion(config, join(root, "candidate"));
        expect(await finishScannerMaintenance(pending)).toBe(true);
      });
      expect(await scannerMaintenanceStatus(config)).toBe(
        "No pending scanner maintenance.",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

it.skipIf(process.platform !== "darwin" || Boolean(process.env.CI))(
  "a surviving completion record permits explicit non-destructive reconciliation",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "maintenance-fixture-"));
    const config = {
      version: 1 as const,
      socket: root,
      image: `sha256:${"b".repeat(64)}`,
    };
    try {
      await withPdfPublicationLock(config.socket, async () => {
        await beginScannerMaintenance(config, join(root, "candidate"));
        await recordScannerBuildCompletion(config, join(root, "candidate"));
      });
      expect(await scannerMaintenanceStatus(config)).toContain(
        "completion recorded",
      );
      expect(await scannerMaintenanceStatus(config, true)).toContain(
        "bindings were not changed",
      );
      expect(await scannerMaintenanceStatus(config)).toBe(
        "No pending scanner maintenance.",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

coordinatePdfPublicationFixture();
