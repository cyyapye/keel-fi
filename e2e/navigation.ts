import type { Locator, Page } from "@playwright/test";

export async function openPrimaryNavigation(
  page: Page,
  mobile: boolean,
): Promise<Locator> {
  if (mobile) {
    await page.getByRole("button", { name: "Open navigation menu" }).click();
  }

  return page.getByRole("navigation", {
    name: mobile ? "Mobile navigation" : "Primary navigation",
  });
}

export async function navigateToScreen(
  page: Page,
  mobile: boolean,
  name: string | RegExp,
) {
  const navigation = await openPrimaryNavigation(page, mobile);
  await navigation.getByRole("button", { name }).click();
}
