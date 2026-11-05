import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import {
  investmentReviewContext,
  documentedOwnershipReview,
  reviewAgreementSource,
} from "../../../e2e/investment-review-context";
import { OwnershipReview } from "./InvestmentReview";

test("renders a dated ownership observation with its exact document and one percentage", () => {
  const { doc: document, source } = reviewAgreementSource({ conflict: true });
  const context = investmentReviewContext(source, {
    documents: [...source.legalEntityNameEvidence.documents!].reverse(),
    review: documentedOwnershipReview(source.source.id, document),
  });
  const markup = renderToStaticMarkup(
    <OwnershipReview
      context={context}
      legalName={null}
      busy={false}
      save={() => Promise.resolve(true)}
    />,
  );
  const entries = markup.match(/<article\b[\s\S]*?<\/article>/gu) ?? [];
  expect(entries).toHaveLength(1);
  const entry = entries[0]!;
  expect(markup).not.toMatch(/<(?:ul|li)\b/u);
  expect(entry.split("12.5%")).toHaveLength(2);
  expect(entry).toContain("As of Aug 15, 2026");
  expect(entry).toContain("Document reviewed · page 2");
  expect(entry.split(document.fileName)).toHaveLength(2);
  expect(entry).not.toContain("demo-cancelled-subscription.pdf");
});
