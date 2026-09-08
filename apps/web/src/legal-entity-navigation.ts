export const reviewTabs = [
  "identity",
  "investment",
  "documents",
  "ownership",
] as const;
export type EntityReviewTab = (typeof reviewTabs)[number];
export type EntityReviewTarget = {
  kind: "holding_position" | "ownership_container" | "entity" | "new";
  id: string;
};

export function entityReviewLocation(search: string): {
  target: EntityReviewTarget | null;
  tab: EntityReviewTab;
} {
  const params = new URLSearchParams(search);
  const review = params.get("review") ?? "";
  const separator = review.indexOf(":");
  const kind = review.slice(0, separator);
  const id = review.slice(separator + 1);
  const tab = params.get("tab");
  return {
    target:
      separator > 0 &&
      id.length > 0 &&
      ["holding_position", "ownership_container", "entity", "new"].includes(
        kind,
      )
        ? { kind: kind as EntityReviewTarget["kind"], id }
        : null,
    tab: reviewTabs.includes(tab as EntityReviewTab)
      ? (tab as EntityReviewTab)
      : "identity",
  };
}

export function entityReviewUrl(
  target: EntityReviewTarget | null,
  tab: EntityReviewTab = "identity",
): string {
  if (target === null) return "/holdings/entities";
  return `/holdings/entities?${new URLSearchParams({ review: `${target.kind}:${target.id}`, tab })}`;
}
