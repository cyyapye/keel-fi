import type { TaskJourney } from "./task-journey-spec";

export const holdingMaintenanceJourney: TaskJourney = {
  id: "holding-maintenance",
  title: "How do I maintain a holding?",
  areas: ["holdings"],
  steps: [
    {
      id: "maintenance-manual",
      components: [
        "ActionGroup",
        "Button",
        "Collapsible",
        "DatePicker",
        "Field",
        "Input",
        "Notice",
        "Select",
      ],
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
      components: ["ActionGroup", "Button", "DataList", "Select"],
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
      components: ["ActionGroup", "Button", "Field", "Input", "Notice"],
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
      components: [
        "ActionGroup",
        "Button",
        "DataList",
        "Field",
        "Input",
        "Select",
      ],
      title: "Correct fees and carry",
      route: "/holdings?position=synthetic-holding",
      source: "apps/web/src/HoldingInvestment.tsx",
      owner:
        "The position’s investment editor saves the acquisition fee, carry rate and carry basis in its purchase receipt.",
      action:
        "Open Edit investment and correct the paid fee and carry terms from the subscription amendment.",
      result:
        "Reopen the same position to inspect its saved fee, carry rate and basis.",
      context:
        "A paid fee belongs to its acquisition. Carry terms inform the estimate of remaining value after carry.",
      alternate: "Cancel returns to the last saved investment.",
    },
  ],
};
