import { loadSandboxConfig } from "./pdf-sandbox";
import { scannerMaintenanceStatus } from "./pdf-scanner-maintenance";
async function main() {
  const args = process.argv.slice(2);
  if (
    process.platform !== "darwin" ||
    process.env.CI ||
    process.env.KEEL_PDF_SANDBOX_CONFIG ||
    args.length > 1 ||
    (args[0] !== undefined && args[0] !== "--reconcile")
  )
    throw new Error(
      "Local default runtime only; use no arguments or --reconcile.",
    );
  console.log(
    await scannerMaintenanceStatus(
      await loadSandboxConfig("scanner"),
      args[0] === "--reconcile",
    ),
  );
}
main().catch(() => {
  console.error(
    "Scanner maintenance status unavailable; no bindings or scanner ownership were changed.",
  );
  process.exitCode = 1;
});
