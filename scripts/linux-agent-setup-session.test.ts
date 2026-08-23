import { describe, expect, it } from "vitest";

import { __linuxAgentSetupSessionTest } from "./linux-agent-setup-session";

describe("Linux portfolio-agent setup session", () => {
  it.each(["angellist", "tokenfolio", "sydecar"] as const)(
    "parses the exact %s provider and Keel origin",
    (provider) => {
      expect(
        __linuxAgentSetupSessionTest.parseOptions([
          "--provider",
          provider,
          "--keel-url",
          "https://keel-preview.example.com",
        ]),
      ).toMatchObject({
        provider,
        keelOrigin: new URL("https://keel-preview.example.com"),
      });
    },
  );

  it("dispatches AngelList without a provider argument", () => {
    const command = __linuxAgentSetupSessionTest.setupCommand(
      "angellist",
      new URL("https://keel-preview.example.com"),
      "/srv/keel-fi",
      "/srv/keel-fi/node_modules/tsx/dist/cli.mjs",
    );
    expect(command.arguments_).toContain(
      "/srv/keel-fi/scripts/angellist-mac-agent.ts",
    );
    expect(command.arguments_).not.toContain("--provider");
    expect(command.arguments_).toContain("https://keel-preview.example.com");
  });

  it("dispatches provider templates with their exact provider scope", () => {
    const command = __linuxAgentSetupSessionTest.setupCommand(
      "sydecar",
      new URL("https://keel-preview.example.com"),
      "/srv/keel-fi",
      "/srv/keel-fi/node_modules/tsx/dist/cli.mjs",
    );
    expect(command.arguments_).toContain(
      "/srv/keel-fi/scripts/provider-portfolio-mac-agent.ts",
    );
    expect(command.arguments_).toContain("--provider");
    expect(command.arguments_).toContain("sydecar");
  });

  it("rejects unsupported providers and non-origin Keel URLs", () => {
    expect(() =>
      __linuxAgentSetupSessionTest.parseOptions([
        "--provider",
        "unknown",
        "--keel-url",
        "https://keel-preview.example.com",
      ]),
    ).toThrow();
    expect(() =>
      __linuxAgentSetupSessionTest.parseOptions([
        "--provider",
        "sydecar",
        "--keel-url",
        "https://keel-preview.example.com/holdings",
      ]),
    ).toThrow();
  });

  it("binds the temporary VNC desktop to loopback with a password file", () => {
    const arguments_ = __linuxAgentSetupSessionTest.vncServerArguments(
      97,
      "/tmp/private/Xauthority",
      "/tmp/private/vnc-password",
      5_907,
    );
    expect(arguments_).toContain("-localhost");
    expect(arguments_).toContain("-passwdfile");
    expect(arguments_).toContain("/tmp/private/vnc-password");
    expect(arguments_).toContain("5907");
    expect(arguments_).not.toContain("-nopw");
  });
});
