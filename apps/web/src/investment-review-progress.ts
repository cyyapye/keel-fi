import type { InvestmentReviewContext } from "@keel/domain/investment-review";
import { legalReviewIssues } from "@keel/domain/automatic-investment-review";
import type { EntityReviewTab } from "./legal-entity-navigation";

export function isCompanyConfirmed(
  context: InvestmentReviewContext | null,
): boolean {
  return (
    !context?.automaticReview?.issues.some(
      (issue) => issue.section === "company",
    ) &&
    (context?.automaticReview?.resolved.includes("company") === true ||
      (context?.mappings.some(
        (mapping) =>
          mapping.status === "active" &&
          mapping.companyId !== null &&
          (mapping.decisionSource === "review" ||
            context.companyReceipt?.mappingId === mapping.id),
      ) ??
        false))
  );
}

export function investmentReviewSections(
  context: InvestmentReviewContext | null,
  identitySaved: boolean,
) {
  const companyConfirmed = isCompanyConfirmed(context);
  const investmentReviewed =
    context?.automaticReview?.resolved.includes("participation") === true ||
    (context?.review !== null &&
      context?.review !== undefined &&
      context.review.participationStatus !== "unknown");
  const documents = context?.documents ?? [];
  const assignments = new Map(
    context?.review?.documentAssignments.map((item) => [
      item.documentId,
      item,
    ]) ?? [],
  );
  const unassigned = documents.filter(
    (doc) =>
      !assignments.has(doc.id) ||
      assignments.get(doc.id)?.relationship === "unassigned",
  );
  const names = new Set(
    unassigned.flatMap(
      (doc) => doc.citations?.map((citation) => citation.legalName) ?? [],
    ),
  );
  const documentConflict = names.size > 1;
  const assignmentNeeded =
    documentConflict || (assignments.size > 0 && unassigned.length > 0);
  const documentCheckNeeded = documents.some(
    (doc) => doc.scan?.outcome === "blocked",
  );
  const documentsReviewed =
    context !== null &&
    !assignmentNeeded &&
    !legalReviewIssues(context?.automaticReview).some(
      (issue) => issue.section === "documents",
    ) &&
    documents.every(
      (doc) =>
        doc.scan?.outcome === "clean" &&
        ((assignments.has(doc.id) &&
          assignments.get(doc.id)?.relationship !== "unassigned") ||
          (identitySaved &&
            !assignments.has(doc.id) &&
            !documentConflict &&
            (doc.citations?.length ?? 0) > 0)),
    );
  const ownershipRecorded =
    (context?.review?.ownershipObservations.length ?? 0) > 0;
  return [
    {
      value: "identity",
      label: "Identity",
      status: !identitySaved
        ? "Confirm name"
        : !companyConfirmed
          ? "Confirm company"
          : !investmentReviewed
            ? "Confirm status"
            : "Reviewed",
      complete: identitySaved && companyConfirmed && investmentReviewed,
      next: !identitySaved
        ? "Confirm the legal name"
        : !companyConfirmed
          ? "Confirm the underlying company"
          : !investmentReviewed
            ? "Confirm this investment’s status"
            : null,
    },
    {
      value: "documents",
      label: "Documents",
      status: documentCheckNeeded
        ? "Check needed"
        : assignmentNeeded
          ? "Assign agreements"
          : documentsReviewed
            ? "Reviewed"
            : documents.length === 0
              ? "Not available"
              : "Available",
      complete: documentsReviewed,
      next: documentCheckNeeded
        ? "Check document access"
        : assignmentNeeded
          ? "Assign agreements to their investments"
          : null,
    },
    {
      value: "ownership",
      label: "Ownership",
      status: ownershipRecorded ? "Recorded" : "Optional",
      complete: ownershipRecorded,
      next: null,
    },
  ].map((item) => ({
    ...item,
    value: item.value as EntityReviewTab,
    status:
      context === null && item.value !== "ownership" ? "Loading…" : item.status,
  }));
}

/** Suggest only an exact, unambiguous name reported by the selected documents. */
export function selectedDocumentName(
  context: InvestmentReviewContext,
  ids: readonly string[],
): string {
  const names = new Set(
    context.documents
      .filter((doc) => ids.includes(doc.id) && doc.scan?.outcome === "clean")
      .flatMap(
        (doc) => doc.citations?.map((citation) => citation.legalName) ?? [],
      ),
  );
  return names.size === 1 ? [...names][0]! : "";
}

export function initialCompanyChoice(context: InvestmentReviewContext): string {
  const acceptedChoice =
    context.companyReceipt?.basis === "document_choice" ||
    context.companyReceipt?.basis === "document_link"
      ? context.companyChoices.findIndex(
          (choice) =>
            choice.documentId ===
              context.companyReceipt?.citation?.documentId &&
            choice.sha256 === context.companyReceipt.citation.sha256 &&
            choice.companyName ===
              context.companyReceipt.citation.companyName &&
            choice.page === context.companyReceipt.citation.page,
        )
      : -1;
  if (acceptedChoice >= 0) return acceptedChoice.toString();
  const names = new Set(
    context.companyChoices.map((choice) => choice.companyName),
  );
  // An existing reviewed mapping takes precedence over a new source suggestion.
  if (
    context.mappings.some(
      (mapping) => mapping.status === "active" && mapping.companyId !== null,
    )
  )
    return "manual";
  return names.size === 1 ? "0" : "manual";
}
