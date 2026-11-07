import { randomUUID } from "node:crypto";
import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import {
  assertSandboxEngine,
  dockerCommand,
  PdfSandboxConfigSchema,
  sandboxConfigPath,
} from "./pdf-sandbox";

const profiles = ["probe", "scanner", "reader"] as const;
const bindingsSchema = z
  .object({
    version: z.literal(1),
    reader: PdfSandboxConfigSchema,
    scanner: PdfSandboxConfigSchema,
    probe: PdfSandboxConfigSchema,
  })
  .strict()
  .refine(
    (value) => new Set(profiles.map((key) => value[key].socket)).size === 1,
    "All PDF profiles must use the same daemon",
  )
  .refine(
    (value) => new Set(profiles.map((key) => value[key].image)).size === 3,
    "Reader, scanner and probe images must be distinct",
  );
type Bindings = z.infer<typeof bindingsSchema>;
type SetupOptions = {
  configPath?: string;
  sharedPath?: string;
  transport?: typeof dockerCommand;
};

export function sharedPdfSandboxPath() {
  return join(homedir(), ".config", "keel", "pdf-sandbox", "runtime.json");
}

function profilePath(configPath: string, profile: (typeof profiles)[number]) {
  return configPath + (profile === "reader" ? "" : `.${profile}`);
}

async function exists(file: string) {
  try {
    await lstat(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function privateFile(file: string, label: string) {
  if (!(await exists(file)))
    throw new Error(`Missing PDF ${label} configuration.`);
  const metadata = await lstat(file);
  if (
    !metadata.isFile() ||
    metadata.uid !== process.getuid?.() ||
    (metadata.mode & 0o077) !== 0 ||
    metadata.size > 4096
  )
    throw new Error(
      `PDF ${label} configuration must be bounded and owner-only.`,
    );
}

async function readConfig<T>(
  file: string,
  schema: z.ZodType<T>,
  label: string,
) {
  await privateFile(file, label);
  try {
    return schema.parse(JSON.parse(await readFile(file, "utf8")));
  } catch {
    throw new Error(`Invalid PDF ${label} configuration.`);
  }
}

async function readBindings(configPath: string): Promise<Bindings> {
  const [probe, scanner, reader] = await Promise.all(
    profiles.map((profile) =>
      readConfig(
        profilePath(configPath, profile),
        PdfSandboxConfigSchema,
        profile,
      ),
    ),
  );
  return bindingsSchema.parse({ version: 1, reader, scanner, probe });
}

async function checkRuntime(bindings: Bindings, transport = dockerCommand) {
  const socket = await stat(bindings.reader.socket).catch(() => null);
  if (!socket?.isSocket())
    throw new Error("The configured PDF daemon socket is unavailable.");
  const temporary = await mkdtemp(join(tmpdir(), "keel-pdf-check-"));
  try {
    const command = transport(bindings.reader.socket, temporary);
    const limits = { timeoutMs: 10_000, maxBytes: 128 * 1024 };
    const info = await command(
      ["info", "--format", "{{json .}}"],
      limits,
    ).catch(() => {
      throw new Error(
        "The PDF daemon cannot be inspected. Check its socket permissions.",
      );
    });
    if (info.code !== 0)
      throw new Error(
        "The PDF daemon is unreachable. Check its socket permissions.",
      );
    try {
      assertSandboxEngine(JSON.parse(info.output));
    } catch {
      throw new Error(
        "The PDF daemon does not meet the required rootless Linux policy.",
      );
    }
    const images = profiles.map((profile) => bindings[profile].image);
    const inspection = await command(
      ["image", "inspect", ...images],
      limits,
    ).catch(() => {
      throw new Error(
        "PDF runtime images cannot be inspected from this process.",
      );
    });
    let inspected: unknown;
    try {
      inspected = inspection.code === 0 ? JSON.parse(inspection.output) : null;
    } catch {
      inspected = null;
    }
    const parsed = z
      .array(z.object({ Id: PdfSandboxConfigSchema.shape.image }))
      .length(3)
      .safeParse(inspected);
    if (
      !parsed.success ||
      new Set(parsed.data.map(({ Id }) => Id)).size !== 3 ||
      images.some((image) => !parsed.data.some(({ Id }) => Id === image))
    )
      throw new Error(
        "PDF runtime images are missing. Run make pdf-sandbox-build.",
      );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

async function publish(bindings: Bindings, file: string, replace: boolean) {
  const directory = dirname(file);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const metadata = await lstat(directory);
  if (
    !metadata.isDirectory() ||
    metadata.uid !== process.getuid?.() ||
    (metadata.mode & 0o077) !== 0
  )
    throw new Error(
      "The shared PDF configuration directory must be owner-only.",
    );
  if (replace && (await exists(file)))
    await privateFile(file, "shared runtime");
  const temporary = join(directory, `${randomUUID()}.pending`);
  await writeFile(temporary, JSON.stringify(bindings, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  try {
    if (replace) await rename(temporary, file);
    else {
      try {
        await link(temporary, file);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
    }
  } finally {
    await rm(temporary, { force: true });
  }
}

async function bind(bindings: Bindings, configPath: string) {
  await mkdir(dirname(configPath), { recursive: true });
  const directory = await lstat(dirname(configPath));
  if (
    !directory.isDirectory() ||
    directory.uid !== process.getuid?.() ||
    (directory.mode & 0o022) !== 0
  )
    throw new Error(
      "The worktree PDF configuration directory must be owned and not writable by other users.",
    );
  for (const profile of profiles) {
    const file = profilePath(configPath, profile);
    if (await exists(file)) {
      const current = await readConfig(file, PdfSandboxConfigSchema, profile);
      if (JSON.stringify(current) !== JSON.stringify(bindings[profile]))
        throw new Error(
          `Existing PDF ${profile} binding differs. It was preserved.`,
        );
    }
  }
  for (const profile of profiles) {
    const file = profilePath(configPath, profile);
    try {
      await writeFile(file, JSON.stringify(bindings[profile], null, 2) + "\n", {
        mode: 0o600,
        flag: "wx",
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const current = await readConfig(file, PdfSandboxConfigSchema, profile);
      if (JSON.stringify(current) !== JSON.stringify(bindings[profile]))
        throw new Error(
          `Existing PDF ${profile} binding differs. It was preserved.`,
          { cause: error },
        );
    }
  }
}

export async function checkPdfSandbox(options: SetupOptions = {}) {
  const bindings = await readBindings(
    options.configPath ?? sandboxConfigPath(),
  );
  await checkRuntime(bindings, options.transport);
  return bindings;
}

export async function registerPdfSandbox(options: SetupOptions = {}) {
  const bindings = await checkPdfSandbox(options);
  await publish(bindings, options.sharedPath ?? sharedPdfSandboxPath(), true);
}

export async function bootstrapPdfSandbox(options: SetupOptions = {}) {
  const configPath =
    options.configPath ?? resolve(".keel-local/pdf-sandbox.json");
  const sharedPath = options.sharedPath ?? sharedPdfSandboxPath();
  const complete = (
    await Promise.all(
      profiles.map((profile) => exists(profilePath(configPath, profile))),
    )
  ).every(Boolean);
  if (complete) {
    const bindings = await checkPdfSandbox({ ...options, configPath });
    await publish(bindings, sharedPath, false);
  } else {
    const bindings = await readConfig(
      sharedPath,
      bindingsSchema,
      "shared runtime",
    );
    await checkRuntime(bindings, options.transport);
    await bind(bindings, configPath);
  }
}

async function main() {
  const [mode, ...extra] = process.argv.slice(2);
  if (extra.length || !["bootstrap", "check", "register"].includes(mode ?? ""))
    throw new Error("Usage: pdf-sandbox-setup.ts bootstrap|check|register");
  if (mode === "register") await registerPdfSandbox();
  else if (mode === "check" || process.env.KEEL_PDF_SANDBOX_CONFIG)
    await checkPdfSandbox();
  else await bootstrapPdfSandbox();
  console.log(
    mode === "register"
      ? "Registered the existing PDF runtime for future worktrees."
      : "PDF runtime bindings, rootless daemon and immutable images are available.",
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main().catch((error: unknown) => {
    console.error(
      error instanceof Error ? error.message : "PDF runtime setup failed.",
    );
    console.error(
      "Run make pdf-sandbox-register in a configured checkout, then make bootstrap. For a new host, follow docs/deployment/pdf-sandbox.md.",
    );
    process.exitCode = 1;
  });
