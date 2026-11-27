import type { TaskJourney } from "./task-journey-spec";

export const holdingMaintenanceJourney: TaskJourney = {
  id: "holding-maintenance",
  title: "How do I maintain a holding?",
  areas: ["holdings"],
  steps: [
    {
      id: "maintenance-manual",
      title: "Add a holding",
      route: "/holdings/new",
      source: "apps/web/src/ManualHoldingEditor.tsx",
      owner:
        "The manual holding editor owns submission identity and uncertain-save recovery.",
      action: "Add a holding with its legal investment type and owner.",
      result: "Open the position identified by the saved receipt.",
      context: "Cash paid, company and valuation can remain unknown.",
      alternate:
        "After an uncertain save, check its submission before trying again.",
    },
    {
      id: "maintenance-links",
      title: "Link investment records",
      route: "/holdings?position=current",
      source: "apps/web/src/PositionLinksEditor.tsx",
      owner: "The selected position owns its linked investment records.",
      action:
        "Compare a second report of this investment or choose the earlier SPV it replaced.",
      result: "Reopen the saved relationship on the surviving position.",
      context:
        "Linked amounts are not added and replacement keeps historical records.",
      alternate: "Unlinking keeps the original records and their history.",
    },
    {
      id: "maintenance-investment",
      title: "Correct purchases and distributions",
      route: "/holdings?position=synthetic-holding",
      source: "apps/web/src/HoldingInvestment.tsx",
      owner:
        "HoldingInvestment and HoldingDistributions own the investment and distribution receipts.",
      action:
        "Edit an acquisition or review the distributions already received.",
      result: "Read the saved investment and remaining value after carry.",
      context:
        "Acquisitions and distributions belong to the selected position.",
      alternate:
        "When the distribution save succeeds but the holding read fails, reload the saved result.",
    },
    {
      id: "maintenance-terms",
      title: "Review fees and carry",
      route: "/holdings?position=holding_demo_spv",
      source: "apps/web/src/PositionEconomicsEditor.tsx",
      owner:
        "The SPV economics editor owns review and acceptance of reported terms.",
      action:
        "Review fees and carry against the imported capital and confirm the terms.",
      result: "Read the accepted terms on the same SPV.",
      context:
        "A carry rate is an agreed term. Charging carry requires a qualifying exit.",
      alternate: "Back preserves the draft for correction before acceptance.",
    },
  ],
};
