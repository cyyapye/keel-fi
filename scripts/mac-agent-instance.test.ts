import { describe, expect, it } from "vitest";

import {
  launchAgentTargetsInstance,
  macAgentInstanceId,
} from "./mac-agent-instance";

describe("Mac agent environment identity", () => {
  it("gives local and preview deterministic, distinct instance ids", () => {
    const local = new URL("http://127.0.0.1:5422");
    const preview = new URL("https://keel-preview.example.com");

    expect(macAgentInstanceId(local)).toBe(macAgentInstanceId(new URL(local)));
    expect(macAgentInstanceId(local)).not.toBe(macAgentInstanceId(preview));
    expect(macAgentInstanceId(local)).toBe("local");
    expect(macAgentInstanceId(new URL("http://127.0.0.1:4177"))).toBe("local");
    expect(macAgentInstanceId(preview)).toMatch(
      /^https-keel-preview-example-com-[a-f0-9]{16}$/u,
    );
  });

  it("matches a legacy plist only to its exact Keel origin", () => {
    const plist = `
      <string>once</string>
      <string>--keel-url</string>
      <string>https://keel-preview.example.com</string>
    `;

    expect(
      launchAgentTargetsInstance(
        plist,
        new URL("https://keel-preview.example.com"),
      ),
    ).toBe(true);
    expect(
      launchAgentTargetsInstance(plist, new URL("http://127.0.0.1:5422")),
    ).toBe(false);
  });

  it("treats changing loopback ports as the same local agent slot", () => {
    const plist = `
      <string>--keel-url</string>
      <string>http://127.0.0.1:4177</string>
    `;

    expect(
      launchAgentTargetsInstance(plist, new URL("http://localhost:5422")),
    ).toBe(true);
  });
});
