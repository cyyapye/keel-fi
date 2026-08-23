import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmod, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { createConnection, createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

import { ProviderPortfolioAgentProviderSchema } from "../packages/domain/src/index";
import { validateLinuxSystemdUser } from "./browser-agent-runtime";
import { z } from "zod";

const DISPLAY_CANDIDATES = Array.from({ length: 10 }, (_, index) => 90 + index);
const VNC_PORT_CANDIDATES = Array.from(
  { length: 11 },
  (_, index) => 5_900 + index,
);

const OptionsSchema = z
  .object({
    provider: z.enum(["angellist", "tokenfolio", "sydecar"]),
    keelOrigin: z
      .url()
      .transform((value) => new URL(value))
      .refine(
        (url) =>
          ["http:", "https:"].includes(url.protocol) &&
          url.username === "" &&
          url.password === "" &&
          url.pathname === "/" &&
          url.search === "" &&
          url.hash === "",
        "Keel URL must be an HTTP(S) origin.",
      ),
  })
  .strict();

function parseOptions(argv: readonly string[]) {
  const args = argv.filter((argument) => argument !== "--");
  const providerIndex = args.indexOf("--provider");
  const keelUrlIndex = args.indexOf("--keel-url");
  return OptionsSchema.parse({
    provider: providerIndex < 0 ? undefined : args[providerIndex + 1]?.trim(),
    keelOrigin: keelUrlIndex < 0 ? undefined : args[keelUrlIndex + 1]?.trim(),
  });
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function regularFile(file: string): Promise<boolean> {
  return stat(file)
    .then((metadata) => metadata.isFile())
    .catch(() => false);
}

async function requiredExecutable(name: "Xvfb" | "x11vnc" | "xauth") {
  for (const directory of ["/usr/bin", "/usr/local/bin", "/bin"]) {
    const candidate = path.join(directory, name);
    if (await regularFile(candidate)) {
      return candidate;
    }
  }
  throw new Error(
    `${name} is required for the private setup desktop. Install xvfb, x11vnc, and xauth, then rerun setup.`,
  );
}

async function availableDisplay(): Promise<number> {
  for (const display of DISPLAY_CANDIDATES) {
    const socket = `/tmp/.X11-unix/X${display.toString()}`;
    if (
      !(await stat(socket)
        .then(() => true)
        .catch(() => false))
    ) {
      return display;
    }
  }
  throw new Error("No private X display is available between :90 and :99.");
}

async function portAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolve(true));
    });
  });
}

async function availableVncPort(): Promise<number> {
  for (const port of VNC_PORT_CANDIDATES) {
    if (await portAvailable(port)) {
      return port;
    }
  }
  throw new Error("No private VNC port is available between 5900 and 5910.");
}

async function waitForFile(file: string, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error("The private X display stopped during startup.");
    }
    if (
      await stat(file)
        .then(() => true)
        .catch(() => false)
    ) {
      return;
    }
    await sleep(100);
  }
  throw new Error("The private X display did not start.");
}

async function waitForPort(port: number, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error("The private VNC server stopped during startup.");
    }
    const connected = await new Promise<boolean>((resolve) => {
      const socket = createConnection({ host: "127.0.0.1", port });
      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("error", () => resolve(false));
    });
    if (connected) {
      return;
    }
    await sleep(100);
  }
  throw new Error("The private VNC server did not start.");
}

async function stopChild(child: ChildProcess | null): Promise<void> {
  if (child === null || child.exitCode !== null) {
    return;
  }
  child.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolve) => child.once("exit", () => resolve())),
    sleep(3_000),
  ]);
  if (child.exitCode === null) {
    child.kill("SIGKILL");
  }
}

function vncServerArguments(
  display: number,
  xauthority: string,
  passwordFile: string,
  port: number,
): string[] {
  return [
    "-display",
    `:${display.toString()}`,
    "-auth",
    xauthority,
    "-localhost",
    "-forever",
    "-shared",
    "-passwdfile",
    passwordFile,
    "-rfbport",
    port.toString(),
  ];
}

function setupCommand(
  provider: "angellist" | "sydecar" | "tokenfolio",
  keelOrigin: URL,
  repositoryRoot: string,
  tsxCli: string,
): { arguments_: string[]; command: string } {
  const providerPortfolio =
    ProviderPortfolioAgentProviderSchema.safeParse(provider);
  const scriptPath = path.join(
    repositoryRoot,
    "scripts",
    provider === "angellist"
      ? "angellist-mac-agent.ts"
      : "provider-portfolio-mac-agent.ts",
  );
  return {
    command: process.execPath,
    arguments_: [
      tsxCli,
      scriptPath,
      "setup",
      ...(providerPortfolio.success
        ? ["--provider", providerPortfolio.data]
        : []),
      "--keel-url",
      keelOrigin.origin,
    ],
  };
}

async function waitForDesktopConnection(
  port: number,
  vncPassword: string,
): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Linux setup must run in an interactive SSH terminal.");
  }
  console.info(
    `Private setup desktop is listening only on the OVH loopback interface at port ${port.toString()}.`,
  );
  console.info(
    "On your Mac, open a second Terminal and keep this tunnel running:",
  );
  console.info(
    `ssh -N -L 5901:127.0.0.1:${port.toString()} <ovh-user>@<ovh-host>`,
  );
  console.info("Then open Finder → Go → Connect to Server and enter:");
  console.info("vnc://127.0.0.1:5901");
  console.info(`Use this one-time VNC password: ${vncPassword}`);
  const terminal = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    await terminal.question(
      "When the private desktop is visible on your Mac, press Enter here to open setup. ",
    );
  } finally {
    terminal.close();
  }
}

async function main(): Promise<void> {
  if (process.platform !== "linux" || process.getuid?.() === 0) {
    throw new Error(
      "Run this command on Linux as the dedicated non-root portfolio-agent user.",
    );
  }
  const options = parseOptions(process.argv.slice(2));
  validateLinuxSystemdUser();
  const tsxCli = fileURLToPath(import.meta.resolve("tsx/cli"));
  if (!(await regularFile(tsxCli))) {
    throw new Error(
      "Run make bootstrap in the Keel checkout, then retry setup.",
    );
  }
  const scriptPath = fileURLToPath(import.meta.url);
  const repositoryRoot = path.resolve(path.dirname(scriptPath), "..");
  const [xvfbPath, x11vncPath, xauthPath, display, vncPort] = await Promise.all(
    [
      requiredExecutable("Xvfb"),
      requiredExecutable("x11vnc"),
      requiredExecutable("xauth"),
      availableDisplay(),
      availableVncPort(),
    ],
  );
  const temporaryDirectory = await mkdtemp(
    path.join(os.tmpdir(), "keel-agent-desktop-"),
  );
  await chmod(temporaryDirectory, 0o700);
  const xauthority = path.join(temporaryDirectory, "Xauthority");
  const vncPasswordFile = path.join(temporaryDirectory, "vnc-password");
  let xvfb: ChildProcess | null = null;
  let x11vnc: ChildProcess | null = null;
  const cleanup = async () => {
    await stopChild(x11vnc);
    await stopChild(xvfb);
    await rm(temporaryDirectory, { force: true, recursive: true });
  };
  try {
    const cookie = randomBytes(16).toString("hex");
    const vncPassword = randomBytes(6).toString("base64url");
    await writeFile(vncPasswordFile, `${vncPassword}\n`, { mode: 0o600 });
    await chmod(vncPasswordFile, 0o600);
    const xauth = spawn(xauthPath, [
      "-f",
      xauthority,
      "add",
      `:${display.toString()}`,
      ".",
      cookie,
    ]);
    const xauthStatus = await new Promise<number | null>((resolve, reject) => {
      xauth.once("error", reject);
      xauth.once("exit", resolve);
    });
    if (xauthStatus !== 0) {
      throw new Error("Could not secure the private X display.");
    }
    await chmod(xauthority, 0o600);
    xvfb = spawn(
      xvfbPath,
      [
        `:${display.toString()}`,
        "-screen",
        "0",
        "1440x1000x24",
        "-nolisten",
        "tcp",
        "-auth",
        xauthority,
      ],
      { stdio: "ignore" },
    );
    await waitForFile(`/tmp/.X11-unix/X${display.toString()}`, xvfb);
    x11vnc = spawn(
      x11vncPath,
      vncServerArguments(display, xauthority, vncPasswordFile, vncPort),
      { stdio: "ignore" },
    );
    await waitForPort(vncPort, x11vnc);
    await waitForDesktopConnection(vncPort, vncPassword);

    const command = setupCommand(
      options.provider,
      options.keelOrigin,
      repositoryRoot,
      tsxCli,
    );
    const setup = spawn(command.command, command.arguments_, {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        DISPLAY: `:${display.toString()}`,
        XAUTHORITY: xauthority,
      },
      stdio: "inherit",
    });
    const setupStatus = await new Promise<number | null>((resolve, reject) => {
      setup.once("error", reject);
      setup.once("exit", resolve);
    });
    if (setupStatus !== 0) {
      throw new Error("Portfolio-agent setup did not finish.");
    }
  } finally {
    await cleanup();
  }
}

export const __linuxAgentSetupSessionTest = {
  parseOptions,
  setupCommand,
  vncServerArguments,
};

const entrypoint = process.argv[1];
if (
  entrypoint !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(entrypoint)).href
) {
  void main().then(
    () => process.exit(0),
    (error: unknown) => {
      console.error(
        error instanceof Error ? error.message : "Linux setup could not start.",
      );
      process.exit(1);
    },
  );
}
