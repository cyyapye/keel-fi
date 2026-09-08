import { describe, expect, it } from "vitest";
import {
  InvestmentReviewContextSchema,
  type InvestmentReviewContext,
} from "@keel/domain/investment-review";
import {
  initialCompanyChoice,
  investmentReviewSections,
  selectedDocumentName,
} from "./investment-review-progress";

const documentId = "11111111-1111-4111-8111-111111111111";
const sha256 = "a".repeat(64);
function context(): InvestmentReviewContext {
  return InvestmentReviewContextSchema.parse({
    positionId: "demo-position",
    positionLabel: "Demo Growth",
    holderLabel: "Demo Holder",
    snapshotId: null,
    committedMinor: null,
    fundedMinor: null,
    currency: "USD",
    economics: null,
    review: null,
    defaultParticipationStatus: "current",
    documents: [],
    evidenceRevision: sha256,
    companyChoices: [],
    companies: [],
    mappings: [],
    companyReceipt: null,
    otherPositions: [],
  });
}
function review(value: InvestmentReviewContext) {
  value.review = {
    id: "demo-review",
    positionId: value.positionId,
    version: 1,
    participationStatus: "current",
    ownershipObservations: [],
    documentAssignments: [],
    recordedAt: "2026-09-01T12:00:00.000Z",
  };
  return value.review;
}
function document(
  name = "Demo Growth LLC",
  id = documentId,
): InvestmentReviewContext["documents"][number] {
  return {
    id,
    sha256,
    fileName: "demo-agreement.pdf",
    page: 2,
    quote: `Fund: ${name}`,
    citations: [
      { legalName: name, page: 2, quote: `Fund: ${name}`, role: "fund" },
    ],
    scan: {
      version: 1,
      engineVersion: "1.5.3",
      databaseVersion: 28000,
      databaseUpdatedAt: "2026-09-01T10:00:00.000Z",
      scannedAt: "2026-09-01T11:00:00.000Z",
      sha256,
      outcome: "clean",
    },
  };
}
describe("review progress and source-only suggestions", () => {
  it("does not turn source defaults or tab visits into completed reviews", () => {
    const sections = investmentReviewSections(context(), false);
    expect(sections.every((section) => !section.complete)).toBe(true);
    expect(sections[0]?.status).toBe("Confirm name");
    expect(sections[1]?.status).toBe("Confirm status");
    expect(sections[3]).toMatchObject({ status: "Optional", next: null });
  });
  it("marks reviewed status complete without an ownership percentage or invented financial terms", () => {
    const value = context();
    review(value);
    value.economics = {
      snapshotId: "demo-snapshot",
      currency: "USD",
      committedMinor: 100_000,
      fundedMinor: 100_000,
      acceptedTerms: null,
      reportedTerms: null,
    };
    expect(investmentReviewSections(value, true)[1]).toMatchObject({
      complete: true,
      next: null,
    });
    expect(investmentReviewSections(value, true)[3]).toMatchObject({
      complete: false,
      next: null,
      status: "Optional",
    });
  });
  it("requires a reviewed company mapping, not a company label", () => {
    const value = context();
    value.mappings = [
      {
        id: "demo-mapping",
        companyId: "demo-company",
        companyName: "Demo Company",
        status: "active",
      },
    ];
    expect(investmentReviewSections(value, true)[0]?.complete).toBe(false);
    value.mappings[0]!.decisionSource = "review";
    expect(investmentReviewSections(value, true)[0]?.complete).toBe(true);
    expect(investmentReviewSections(value, false)[0]?.complete).toBe(false);
  });
  it("nudges conflicting agreements and never marks explicitly unassigned documents reviewed", () => {
    const value = context();
    value.documents = [
      document(),
      document("Demo Other LLC", "22222222-2222-4222-8222-222222222222"),
    ];
    expect(investmentReviewSections(value, true)[2]?.status).toBe(
      "Assign agreements",
    );
    value.documents = [document()];
    review(value).documentAssignments = [
      {
        documentId,
        sha256,
        relationship: "unassigned",
        targetPositionId: null,
      },
    ];
    expect(investmentReviewSections(value, true)[2]?.complete).toBe(false);
    expect(investmentReviewSections(value, true)[2]?.status).toBe(
      "Assign agreements",
    );
    value.review!.documentAssignments[0]!.relationship = "supports";
    expect(investmentReviewSections(value, true)[2]?.complete).toBe(true);
    value.documents.push(
      document("Demo Other LLC", "22222222-2222-4222-8222-222222222222"),
    );
    expect(investmentReviewSections(value, true)[2]).toMatchObject({
      status: "Assign agreements",
      complete: false,
      next: "Assign agreements to their investments",
    });
  });
  it("suggests only one distinct source-reported company and never overrides an existing mapping", () => {
    const value = context();
    value.companyChoices = [
      {
        documentId,
        sha256,
        companyName: "Demo Company",
        page: 2,
        quote: "Underlying Company: Demo Company",
      },
    ];
    expect(initialCompanyChoice(value)).toBe("0");
    value.companyChoices.push({
      ...value.companyChoices[0]!,
      companyName: "Demo Other Company",
    });
    expect(initialCompanyChoice(value)).toBe("manual");
    value.companyChoices.pop();
    value.mappings = [
      {
        id: "demo-mapping",
        companyId: "demo-old-company",
        companyName: "Demo Earlier Company",
        status: "active",
      },
    ];
    expect(initialCompanyChoice(value)).toBe("manual");
  });
  it("suggests exact legal names only from the selected clean documents", () => {
    const value = context();
    const secondId = "22222222-2222-4222-8222-222222222222";
    value.documents = [document(), document("Demo Other LLC", secondId)];
    expect(selectedDocumentName(value, [])).toBe("");
    expect(selectedDocumentName(value, [documentId])).toBe("Demo Growth LLC");
    expect(selectedDocumentName(value, [documentId, secondId])).toBe("");
    value.documents[0]!.scan!.outcome = "blocked";
    expect(selectedDocumentName(value, [documentId])).toBe("");
    expect(investmentReviewSections(value, true)[2]).toMatchObject({
      status: "Check needed",
      complete: false,
      next: "Check document access",
    });
  });
});
