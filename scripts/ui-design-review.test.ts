import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkReview, prepare } from "./ui-design-review";

const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "keel-design-review-"));
  roots.push(root);
  mkdirSync(join(root, ".tugling"));
  mkdirSync(join(root, "src"));
  writeFileSync(
    join(root, "src/component.tsx"),
    "export const component = 'synthetic';",
  );
  writeFileSync(join(root, "contract.md"), "Synthetic test contract");
  writeFileSync(
    join(root, ".tugling/ui.json"),
    JSON.stringify({
      schemaVersion: 1,
      project: "Synthetic test project",
      contracts: ["contract.md"],
      sourceRoots: ["src"],
      sourceFiles: ["contract.md"],
      theme: "contract.md",
      components: "src/component.tsx",
      catalogue: "src/component.tsx",
      references: { density: "Synthetic reference" },
      checks: { structure: ["test"] },
      criteria: [
        { id: "meaning", question: "Does the state preserve meaning?" },
      ],
    }),
  );
  // Unit-test bytes only; runtime evaluation uses real browser PNGs.
  writeFileSync(
    join(root, "render.png"),
    Buffer.from("89504e470d0a1a0a", "hex"),
  );
  writeFileSync(
    join(root, "native.log"),
    "Synthetic unit-test evidence, not a runtime pass",
  );
  const brief = {
    id: "synthetic-task",
    task: "Review synthetic state",
    meaning: "A record is distinct from its sources",
    scope: "review",
    patternBasis: "Synthetic reference",
    requiredStates: ["ordinary"],
    components: ["RecordItem"],
    checks: [{ command: "synthetic-test", evidence: "native.log" }],
    images: [
      {
        id: "wide",
        role: "screen",
        state: "ordinary",
        viewport: "desktop",
        path: "render.png",
      },
      {
        id: "narrow",
        role: "screen",
        state: "ordinary",
        viewport: "mobile",
        path: "render.png",
      },
      {
        id: "reference",
        role: "reference",
        state: "reference",
        viewport: "desktop",
        path: "render.png",
      },
    ],
  };
  const briefPath = join(root, "brief.json");
  writeFileSync(briefPath, JSON.stringify(brief));
  const output = join(root, "packet");
  const result = prepare(root, briefPath, output);
  const review = {
    packetFingerprint: result.fingerprint,
    reviewer: "synthetic unit-test reviewer",
    firstLook: brief.images
      .filter((i) => i.role === "screen")
      .map((i) => ({
        image: i.id,
        inference: "Synthetic unaided observation",
        questions: [],
      })),
    observations: brief.images.map((i) => ({
      image: i.id,
      observation: "Synthetic observation",
    })),
    criteria: [
      {
        id: "meaning",
        outcome: "acceptable",
        evidence: ["wide", "narrow"],
        explanation: "Synthetic explanation",
      },
    ],
    findings: [] as {
      criterion: string;
      image: string;
      location: string;
      severity: string;
      problem: string;
      correction: string;
    }[],
    questions: [] as string[],
  };
  const reviewPath = join(root, "review.json");
  const save = () => writeFileSync(reviewPath, JSON.stringify(review));
  save();
  return { root, output, brief, briefPath, review, reviewPath, save };
}
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("rendered design review evidence", () => {
  it.each([
    "first-look.json",
    "reviewer.md",
    "response-template.json",
    "review.schema.json",
  ])("rejects changed reviewer input %s", (name) => {
    const f = fixture();
    writeFileSync(join(f.output, name), "Changed reviewer input");
    expect(() => checkReview(f.root, f.output, f.reviewPath)).toThrow(
      "Changed reviewer input",
    );
  });
  it("accepts complete unchanged evidence without claiming native or human approval", () => {
    const f = fixture();
    expect(checkReview(f.root, f.output, f.reviewPath)).toMatchObject({
      status: "REVIEW_COMPLETE",
    });
    expect(checkReview(f.root, f.output, f.reviewPath).boundary).toContain(
      "not proof",
    );
  });
  it.each(["changed", "added", "deleted"])(
    "rejects %s source after capture",
    (kind) => {
      const f = fixture();
      const path = join(f.root, "src/component.tsx");
      if (kind === "changed") writeFileSync(path, "changed source");
      if (kind === "added")
        writeFileSync(join(f.root, "src/new.tsx"), "new source");
      if (kind === "deleted") rmSync(path);
      expect(() => checkReview(f.root, f.output, f.reviewPath)).toThrow();
    },
  );
  it.each(["images/wide.png", "check-1.log"])("rejects changed %s", (path) => {
    const f = fixture();
    writeFileSync(join(f.output, path), "changed evidence");
    expect(() => checkReview(f.root, f.output, f.reviewPath)).toThrow(
      "Changed evidence",
    );
  });
  it("rejects evidence replacement in the manifest", () => {
    const f = fixture();
    const path = join(f.output, "packet.json");
    const packet = JSON.parse(readFileSync(path, "utf8"));
    packet.images[0].sha256 = "replacement";
    writeFileSync(path, JSON.stringify(packet));
    expect(() => checkReview(f.root, f.output, f.reviewPath)).toThrow(
      "Changed packet",
    );
  });
  it("does not accept a review from another packet with the same source", () => {
    const f = fixture();
    f.brief.task = "A different task on the same source";
    writeFileSync(f.briefPath, JSON.stringify(f.brief));
    const other = join(f.root, "other-packet");
    prepare(f.root, f.briefPath, other);
    expect(() => checkReview(f.root, other, f.reviewPath)).toThrow(
      "Stale source evidence",
    );
  });
  it("requires every state at desktop and mobile plus an approved reference", () => {
    const f = fixture();
    f.brief.requiredStates.push("failed-save");
    writeFileSync(f.briefPath, JSON.stringify(f.brief));
    expect(() =>
      prepare(f.root, f.briefPath, join(f.root, "incomplete")),
    ).toThrow("failed-save/desktop");
    f.brief.requiredStates.pop();
    f.brief.images[2]!.role = "screen";
    writeFileSync(f.briefPath, JSON.stringify(f.brief));
    expect(() =>
      prepare(f.root, f.briefPath, join(f.root, "no-reference")),
    ).toThrow("Missing reference");
  });
  it.each(["omitted", "duplicate", "unknown"])(
    "rejects %s image inspection",
    (kind) => {
      const f = fixture();
      if (kind === "omitted") f.review.observations.pop();
      if (kind === "duplicate") f.review.observations[0]!.image = "narrow";
      if (kind === "unknown") f.review.observations[0]!.image = "unseen-image";
      f.save();
      expect(() => checkReview(f.root, f.output, f.reviewPath)).toThrow(
        "Image inspection",
      );
    },
  );
  it("keeps findings and missing evidence unresolved", () => {
    const f = fixture();
    f.review.criteria[0]!.outcome = "problem";
    f.save();
    expect(() => checkReview(f.root, f.output, f.reviewPath)).toThrow(
      "Problem requires a finding",
    );
    f.review.findings.push({
      criterion: "meaning",
      image: "wide",
      location: "record heading",
      severity: "material",
      problem: "Synthetic ambiguous count",
      correction: "Clarify the unit",
    });
    f.save();
    expect(checkReview(f.root, f.output, f.reviewPath).status).toBe(
      "CHANGES_REQUESTED",
    );
    f.review.questions.push("Missing native readback evidence");
    f.save();
    expect(checkReview(f.root, f.output, f.reviewPath).status).toBe(
      "INCOMPLETE",
    );
  });
  it("does not overwrite a previous review packet", () => {
    const f = fixture();
    expect(() => prepare(f.root, f.briefPath, f.output)).toThrow(
      "new output directory",
    );
  });
  it("requires unaided observations for every current screen", () => {
    const f = fixture();
    f.review.firstLook.pop();
    f.save();
    expect(() => checkReview(f.root, f.output, f.reviewPath)).toThrow(
      "First-look inspection",
    );
  });
});
