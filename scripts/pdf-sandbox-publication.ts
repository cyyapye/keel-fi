import { AsyncLocalStorage } from "node:async_hooks";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  realpath,
  type FileHandle,
} from "node:fs/promises";
import { fileURLToPath } from "node:url";

const ownership = new AsyncLocalStorage<{
  socket: string;
  fds: number[];
  active: boolean;
}>();

export function publicationChildOptions() {
  const state = ownership.getStore();
  if (!state?.active)
    return {
      env: {},
      stdio: ["inherit", "inherit", "inherit"] as ("inherit" | number)[],
    };
  return {
    env: { KEEL_PDF_PUBLICATION_FDS: "3,4" },
    stdio: ["inherit", "inherit", "inherit", ...state.fds] as (
      "inherit" | number
    )[],
  };
}

/** Only local macOS publication participates; scan admission is unchanged. */
export async function withPdfPublicationLock<T>(
  socket: string,
  action: () => Promise<T>,
): Promise<T> {
  if (process.platform !== "darwin" || process.env.CI) return action();
  const canonical = await realpath(socket).catch(() => {
    throw new Error("The configured PDF daemon socket is unavailable.");
  });
  const inherited = ownership.getStore();
  if (inherited?.active && inherited.socket === canonical) return action();
  if (inherited?.active)
    throw new Error("Cannot change daemon within publication");
  const root = `/tmp/keel-pdf-refresh-${process.getuid!()}`;
  await mkdir(root, { mode: 0o700, recursive: false }).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    },
  );
  const meta = await lstat(root);
  if (
    !meta.isDirectory() ||
    meta.uid !== process.getuid!() ||
    meta.mode & 0o077
  )
    throw new Error("Unsafe publication directory");
  const raw = process.env.KEEL_PDF_PUBLICATION_FDS;
  if (raw !== undefined && !/^[0-9]+,[0-9]+$/.test(raw))
    throw new Error("Invalid inherited publication descriptors");
  const descriptors = raw?.split(",").map(Number) ?? [];
  if (
    descriptors.some((fd) => !Number.isSafeInteger(fd) || fd < 3) ||
    (descriptors.length && descriptors[0] === descriptors[1])
  )
    throw new Error("Invalid inherited publication descriptors");
  const handles: FileHandle[] = [];
  try {
    if (!raw) {
      for (const name of [
        "publication.lock",
        createHash("sha256").update(canonical).digest("hex") + ".lock",
      ])
        handles.push(
          await open(
            `${root}/${name}`,
            constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW,
            0o600,
          ),
        );
    }
    const fds = raw ? descriptors : handles.map((handle) => handle.fd);
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        "python3",
        [
          fileURLToPath(
            new URL("./pdf-sandbox-publication-lock.py", import.meta.url),
          ),
          canonical,
          "--acquire-fds",
        ],
        {
          stdio: ["ignore", "ignore", "ignore", ...fds],
          env: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
        },
      );
      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, 5_000);
      child.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.once("close", (code) => {
        clearTimeout(timeout);
        if (!timedOut && code === 0) resolve();
        else reject(new Error("PDF publication lock unavailable"));
      });
    });
    // Inherited descriptors remain owned by the Python wrapper. They are not
    // closed here; only handles this invocation opened are ours to close.
    const state = { socket: canonical, fds, active: true };
    try {
      return await ownership.run(state, action);
    } finally {
      state.active = false;
    }
  } finally {
    await Promise.all(handles.map((handle) => handle.close()));
  }
}
