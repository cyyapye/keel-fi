import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { isIPv4 } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.join(
  scriptsDirectory,
  "linux-agent-cloudflare-egress.sh",
);
const dropInPath = path.join(
  scriptsDirectory,
  "keel-agent-network-cloudflare-egress.conf",
);
const script = readFileSync(scriptPath, "utf8");
const dropIn = readFileSync(dropInPath, "utf8");

describe("Linux agent Cloudflare Tunnel egress", () => {
  it("is valid POSIX shell", () => {
    expect(() => execFileSync("/bin/sh", ["-n", scriptPath])).not.toThrow();
  });

  it("allows port 7844 only to Cloudflare's documented IPv4 endpoints", () => {
    const endpointBlock =
      /cloudflare_tunnel_endpoints='\n(?<endpoints>[\s\S]+?)\n'/u.exec(script)
        ?.groups?.endpoints;
    expect(endpointBlock).toBeDefined();
    const endpoints = endpointBlock?.trim().split(/\s+/u) ?? [];

    expect(endpoints).toHaveLength(20);
    expect(new Set(endpoints)).toHaveLength(20);
    expect(endpoints.every((endpoint) => isIPv4(endpoint))).toBe(true);
    expect(script).toContain('-d "$endpoint/32"');
    expect(script).toContain('-p "$protocol" --dport 7844 -j ACCEPT');
    expect(script).not.toContain(
      '-o "$external_interface" -p "$protocol" --dport 7844',
    );
    expect(script).not.toContain(
      '-o "$namespace_interface" -p "$protocol" --dport 7844',
    );
  });

  it("reinstalls and verifies both host and namespace rules at service start", () => {
    expect(dropIn).toContain(
      "ExecStartPre=/usr/local/libexec/keel-agent-cloudflare-egress host-start",
    );
    expect(dropIn).toContain(
      "ExecStartPost=/usr/local/libexec/keel-agent-cloudflare-egress namespace-start",
    );
    expect(dropIn).toContain(
      "ExecStartPost=/usr/local/libexec/keel-agent-cloudflare-egress verify",
    );
    expect(dropIn).toContain(
      "ExecStopPost=/usr/local/libexec/keel-agent-cloudflare-egress stop",
    );
  });
});
