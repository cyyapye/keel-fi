import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildUiGuide,
  guideIndex,
  readUiExports,
  searchUiGuide,
} from "./ui-guide";
import { catalogueAssets } from "./ui-catalogue-plugin";

const repository = resolve(import.meta.dirname, "..");
const temporary: string[] = [];
function sourceCopy() {
  const root = mkdtempSync(join(tmpdir(), "keel-ui-guide-"));
  temporary.push(root);
  for (const path of ["packages/ui/src", "e2e/ui-catalogue", "docs/product"])
    cpSync(join(repository, path), join(root, path), { recursive: true });
  return root;
}
afterEach(() => {
  for (const path of temporary.splice(0))
    rmSync(path, { recursive: true, force: true });
});

describe("agent UI guide", () => {
  it("routes actual exports and task phrases to current APIs, rules and live examples", () => {
    const guide = buildUiGuide();
    expect(guide.entries.flatMap((entry) => entry.names).sort()).toEqual(
      readUiExports()
        .map((item) => item.name)
        .sort(),
    );
    const records = searchUiGuide("RecordGroup", guide);
    expect(records).toHaveLength(1);
    expect(
      records[0]?.rules.some((rule) =>
        rule.text.includes("alternating row backgrounds"),
      ),
    ).toBe(true);
    expect(
      records[0]?.api.some(
        (api) => api.name === "RecordRow" && api.signature.includes("title"),
      ),
    ).toBe(true);
    expect(
      records[0]?.examples.some((example) =>
        example.code.includes("<RecordGroup"),
      ),
    ).toBe(true);
    expect(
      searchUiGuide("infinite scroll", guide).map((entry) => entry.id),
    ).toEqual(["Collections"]);
    expect(searchUiGuide("History", guide)[0]?.kind).toBe("composition");
    expect(searchUiGuide("not-a-component", guide)).toEqual([]);
    expect(JSON.stringify(guideIndex(guide))).not.toContain('"code"');
    expect(JSON.stringify(guide)).not.toContain(repository);
  });

  it("rejects a newly exported control without guidance", () => {
    const root = sourceCopy();
    const path = join(root, "packages/ui/src/index.tsx");
    writeFileSync(
      path,
      `${readFileSync(path, "utf8")}\nexport { Text as UncataloguedText } from "./components/text";\n`,
    );
    expect(() => buildUiGuide(root)).toThrow("export coverage has drifted");
  });

  it("rejects stale example and canonical rule references", () => {
    const root = sourceCopy();
    const path = join(root, "e2e/ui-catalogue/keel-ui-candidates.tsx");
    const source = readFileSync(path, "utf8");
    writeFileSync(
      path,
      source.replace("function RecordGroupExample", "function RenamedExample"),
    );
    expect(() => buildUiGuide(root)).toThrow(
      "Missing example RecordGroupExample",
    );
    writeFileSync(path, source);
    const rules = join(root, "docs/product/ui-library.md");
    writeFileSync(
      rules,
      readFileSync(rules, "utf8").replace(
        "## Alternating record rows",
        "## Renamed rules",
      ),
    );
    expect(() => buildUiGuide(root)).toThrow(
      "Missing UI rule: Alternating record rows",
    );
  });

  it("ships the same searchable guide and standalone catalogue in the preview asset set", async () => {
    const assets = await catalogueAssets();
    expect(assets.get("/ui/index.html")).toContain("Theme &amp; components");
    expect(JSON.parse(assets.get("/ui/agent-index.json")!)).toEqual(
      guideIndex(),
    );
    for (const entry of buildUiGuide().entries)
      expect(JSON.parse(assets.get(entry.reference)!)).toEqual(entry);
  });
});
