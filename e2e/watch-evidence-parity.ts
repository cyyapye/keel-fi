import { expect, type Page } from "@playwright/test";
import {
  clinicReport,
  financingReport,
} from "./ui-catalogue/watch-evidence-reports";

/** Both the shipped app and its catalogue capture must focus the chosen event
 * among two reports about the same company, with the choices for its claim. */
export async function expectSelectedFinancingReport(page: Page) {
  const news = page.locator(`[id="evidence-${clinicReport.id}"]`);
  const selected = page.locator(`[id="evidence-${financingReport.id}"]`);
  await expect(
    news.getByRole("heading", { name: clinicReport.headline }),
  ).toBeVisible();
  await expect(selected).toBeFocused();
  await expect(
    selected.getByRole("heading", { name: financingReport.headline }),
  ).toBeVisible();
  await expect(
    selected.getByText("Company terms do not set this holding’s value."),
  ).toBeVisible();
  await expect(
    selected.getByRole("button", { name: "Reject", exact: true }),
  ).toBeEnabled();
  await expect(
    selected.getByRole("button", { name: "Scenario only", exact: true }),
  ).toBeEnabled();
  await selected
    .getByRole("button", { name: "Accept evidence", exact: true })
    .click();
  await expect(
    selected.getByText("No holding mark or forecast changes."),
  ).toBeVisible();
  await expect(
    selected.getByRole("button", {
      name: /confirm & apply|accept without applying/i,
    }),
  ).toHaveCount(0);
  await selected.getByRole("button", { name: "Cancel", exact: true }).click();
  return selected;
}
