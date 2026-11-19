import {
  beginScannerMaintenance,
  finishScannerMaintenance,
} from "./pdf-scanner-maintenance";
import { readScannerReceipt } from "./pdf-scanner-receipt";
import { spawn } from "node:child_process";
import {
  lstat,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadSandboxConfig,
  scanDocumentInSandbox,
  type PdfSandboxConfig,
} from "./pdf-sandbox";
import {
  checkPdfSandbox,
  registerPdfSandbox,
  sharedPdfSandboxPath,
} from "./pdf-sandbox-setup";
import {
  publicationChildOptions,
  withPdfPublicationLock,
} from "./pdf-sandbox-publication";
import type { LegalDocumentScan } from "../packages/domain/src/provider-legal-documents";

const MAX_AGE_MS = 72 * 60 * 60 * 1000;

async function command(
  program: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  timeout: number,
  inherited = false,
) {
  const lock = inherited ? publicationChildOptions() : { env: {}, stdio: [] };
  return new Promise<string>((done, fail) => {
    const child = spawn(program, args, {
      detached: true,
      env: {
        PATH: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin",
        HOME: process.env.HOME,
        ...env,
        ...lock.env,
      },
      stdio: ["ignore", "pipe", "ignore", ...lock.stdio.slice(3)],
    });
    let output = "";
    let failed = false;
    const stop = () => {
      if (child.pid !== undefined) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
        }
      }
    };
    const timer = setTimeout(() => {
      failed = true;
      stop();
    }, timeout);
    child.stdout!.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
      if (Buffer.byteLength(output) > 16384) {
        failed = true;
        stop();
      }
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      fail(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (!failed && code === 0) done(output);
      else fail(new Error("local_scanner_maintenance_unavailable"));
    });
  });
}

async function timestamp(config: PdfSandboxConfig) {
  const receipt = await readScannerReceipt(
    config,
    resolve(".keel-local/pdf-sandbox.json.scanner.receipt"),
  );
  return Date.parse(receipt.scan.databaseUpdatedAt);
}

async function privateBytes(file: string) {
  const meta = await lstat(file);
  if (
    !meta.isFile() ||
    meta.uid !== process.getuid!() ||
    meta.mode & 0o077 ||
    meta.size > 4096
  )
    throw new Error("unsafe_scanner_binding");
  return readFile(file, "utf8");
}

async function refresh(config: PdfSandboxConfig) {
  const base = resolve(".keel-local/pdf-sandbox.json");
  const parent = await lstat(dirname(base));
  if (
    !parent.isDirectory() ||
    parent.uid !== process.getuid!() ||
    parent.mode & 0o022
  )
    throw new Error("unsafe_scanner_directory");
  const files = [base, `${base}.probe`, `${base}.scanner`];
  const before = await Promise.all(files.map(privateBytes));
  const bindings = await checkPdfSandbox();
  if (
    bindings.scanner.image !== config.image ||
    bindings.scanner.socket !== config.socket
  )
    throw new Error("scanner_binding_changed");
  let registry: string | undefined;
  try {
    registry = await privateBytes(sharedPdfSandboxPath());
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const directory = await mkdtemp(resolve(dirname(base), "scanner-auto-"));
  let pending: Awaited<ReturnType<typeof beginScannerMaintenance>> | undefined;
  let completed = false;
  try {
    const candidate = resolve(directory, "pdf-sandbox.json");
    await writeFile(candidate, before[0]!, { mode: 0o600 });
    await writeFile(`${candidate}.probe`, before[1]!, { mode: 0o600 });
    pending = await beginScannerMaintenance(config, candidate);
    await command(
      process.execPath,
      ["--import", "tsx", "scripts/pdf-sandbox-build.ts", "--scanner-only"],
      {
        KEEL_PDF_SANDBOX_CONFIG: candidate,
        KEEL_PDF_SANDBOX_SOCKET: config.socket,
      },
      420_000,
      true,
    );
    const candidateBindings = await checkPdfSandbox({ configPath: candidate });
    await readScannerReceipt(
      candidateBindings.scanner,
      `${candidate}.scanner.receipt`,
    );
    const now = await lstat(dirname(base));
    if (
      now.dev !== parent.dev ||
      now.ino !== parent.ino ||
      !now.isDirectory() ||
      now.uid !== parent.uid ||
      now.mode & 0o022
    )
      throw new Error("scanner_directory_changed");
    const after = await Promise.all(files.map(privateBytes));
    if (after.some((value, index) => value !== before[index]))
      throw new Error("scanner_binding_changed");
    // Receipt first: a crash between files yields a mismatch, never auto eligibility.
    await rename(`${candidate}.scanner.receipt`, `${base}.scanner.receipt`);
    await rename(`${candidate}.scanner`, `${base}.scanner`);
    // Do not replace a registry deliberately pointing to another runtime.
    if (
      registry !== undefined &&
      JSON.stringify(JSON.parse(registry)) === JSON.stringify(bindings)
    )
      await registerPdfSandbox();
  } finally {
    if (pending) completed = await finishScannerMaintenance(pending);
    // Keep private proof/diagnostics when daemon completion is unconfirmed.
    if (!pending || completed)
      await rm(directory, { recursive: true, force: true });
  }
}

type Dependencies = {
  current: () => Promise<PdfSandboxConfig>;
  timestamp: (config: PdfSandboxConfig) => Promise<number>;
  lock: <T>(socket: string, action: () => Promise<T>) => Promise<T>;
  idle: (socket: string) => Promise<void>;
  refresh: (config: PdfSandboxConfig) => Promise<void>;
  scan: (bytes: Uint8Array) => Promise<LegalDocumentScan>;
  now: () => number;
};

/** One collector operation; the private receipt never overrides the worker's freshness check. */
export function scannerForLocalOperation(
  deps: Dependencies = {
    current: () => loadSandboxConfig("scanner"),
    timestamp,
    lock: withPdfPublicationLock,
    idle: async (socket) => {
      await command(
        "python3",
        [
          "-I",
          fileURLToPath(new URL("./pdf-scanner-idle.py", import.meta.url)),
          socket,
        ],
        {},
        15_000,
      );
    },
    refresh,
    scan: scanDocumentInSandbox,
    now: Date.now,
  },
) {
  let attempted = false;
  const stale = (time: number) => {
    const age = deps.now() - time;
    if (!Number.isFinite(time) || age < 0)
      throw new Error("invalid_vendor_timestamp");
    return age > MAX_AGE_MS;
  };
  return async (bytes: Uint8Array) => {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength > 8 * 1024 * 1024)
      throw new Error("invalid_scanner_input");
    const config = await deps.current();
    const time = await deps.timestamp(config);
    if (stale(time)) {
      await deps.lock(config.socket, async () => {
        const selected = await deps.current();
        if (selected.socket !== config.socket)
          throw new Error("scanner_runtime_changed");
        const checked = await deps.timestamp(selected);
        if (!stale(checked)) return;
        if (attempted) throw new Error("scanner_refresh_already_attempted");
        attempted = true;
        await deps.idle(selected.socket);
        await deps.refresh(selected);
      });
    }
    // No error from scanning triggers a refresh/retry. Ordinary admission and
    // the selected image's independent 72-hour worker gate remain authoritative.
    return deps.scan(bytes);
  };
}

export function localAutoRefreshEnabled(
  platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
) {
  return platform === "darwin" && !env.CI && !env.KEEL_PDF_SANDBOX_CONFIG;
}

export function localScannerForProviderOperation() {
  return localAutoRefreshEnabled() ? scannerForLocalOperation() : undefined;
}
