import { Button } from "@keel/ui";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { blockedAgreementSource } from "../../../e2e/agreement-security-fixtures";
import { AgreementEvidence } from "./LegalEntities";

function actionLabels(markup: string) {
  return Array.from(
    markup.matchAll(
      /<(button\b[^>]*|a\b[^>]*\bhref=[^>]*)>([\s\S]*?)<\/(?:button|a)>/gu,
    ),
    ([, tag, text]) =>
      tag!.match(/\baria-label="([^"]*)"/u)?.[1] ??
      text!.replace(/<[^>]+>/gu, "").trim(),
  );
}

test("explains each blocked agreement without exposing a download or an assignment", () => {
  const reasons = [
    [
      "scan_limit",
      "Heuristics.Limits.Exceeded.MaxFileSize",
      "This does not establish malware",
    ],
    ["encrypted", "Heuristics.Encrypted.PDF", "Request an unencrypted copy"],
    [
      "malware_signature",
      "Win.Test.EICAR_HDB-1",
      "Keep this agreement blocked",
    ],
  ] as const;
  for (const [reason, signature, explanation] of reasons) {
    const source = blockedAgreementSource(1, "Demo Climate", {
      reason,
      signature,
    });
    const document = source.legalEntityNameEvidence.documents![0]!;
    const render = (current: typeof document) =>
      renderToStaticMarkup(
        <AgreementEvidence
          sources={[source]}
          documents={[current]}
          assignment={() => <Button>Review details</Button>}
        />,
      );
    const blocked = render(document);
    expect(blocked).toContain(document.fileName);
    expect(blocked).toContain(explanation);
    expect(actionLabels(blocked).sort()).toEqual([
      "Recheck agreement",
      "Source evidence",
    ]);

    const cleared = render({
      ...document,
      scan: { ...document.scan!, version: 2, outcome: "clean", findings: [] },
    });
    expect(actionLabels(cleared)).toContain(document.fileName);
    expect(actionLabels(cleared)).toContain("Review details");
  }
});
