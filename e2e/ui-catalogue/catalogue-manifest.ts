export const pages = [
  { id: "foundations", index: "01", label: "Foundations" },
  { id: "compositions", index: "02", label: "Compositions" },
  { id: "interactions", index: "03", label: "Interactions" },
  { id: "forms", index: "04", label: "Forms & actions" },
  { id: "display", index: "05", label: "Data & layout" },
  { id: "collection-loading", index: "06", label: "Collection loading" },
  { id: "inventory", index: "07", label: "Component index" },
] as const;
export type Page = (typeof pages)[number]["id"];
export const groups: Record<
  string,
  { page: Page; names: string[]; states: string }
> = {
  Choices: {
    page: "forms",
    names: ["Checkbox", "RadioGroup", "FieldGroup"],
    states: "Selection, group semantics, disabled and keyboard states",
  },
  Loading: {
    page: "forms",
    names: ["LoadingStatus", "Spinner"],
    states: "Pending, failure, retry and reduced motion",
  },
  Collections: {
    page: "collection-loading",
    names: ["CollectionFooter"],
    states: "Manual and automatic loading; unknown total, failure, retry, end",
  },
  Records: {
    page: "compositions",
    names: ["RecordItem", "RecordGroup", "RecordRow"],
    states:
      "Wrapping title, detail, provenance and actions; alternating rows with multiple, single, unavailable and empty records",
  },
  Typography: {
    page: "foundations",
    names: ["Text"],
    states: "Primary, body, supporting and small text roles",
  },
  Shell: {
    page: "interactions",
    names: ["AppShell", "BrandMark", "Screen", "PageHeader"],
    states: "Desktop sidebar; mobile menu and Escape dismissal",
  },
  Disclosure: {
    page: "interactions",
    names: [
      "Collapsible",
      "CollapsibleTrigger",
      "CollapsibleContent",
      "DisclosureIndicator",
    ],
    states: "Closed, expanded, disabled; nested source details",
  },
  Select: {
    page: "interactions",
    names: [
      "Select",
      "SelectTrigger",
      "SelectValue",
      "SelectContent",
      "SelectItem",
    ],
    states: "Placeholder, selected, open, disabled; keyboard selection",
  },
  SearchSelect: {
    page: "interactions",
    names: ["SearchSelect"],
    states: "Search, selected, empty result, disabled",
  },
  InfoTip: {
    page: "interactions",
    names: ["InfoTip"],
    states: "Open by mouse, keyboard or tap; Escape; disabled",
  },
  DatePicker: {
    page: "interactions",
    names: ["DatePicker"],
    states:
      "Selected, clear, open calendar, date bounds, disabled, field error",
  },
  Tabs: {
    page: "interactions",
    names: ["Tabs", "TabsList", "TabsTrigger", "TabsContent"],
    states: "Default and line variants; active panel; keyboard navigation",
  },
  Actions: {
    page: "forms",
    names: ["Button", "ButtonLink", "TextLink", "ActionGroup"],
    states: "All button tones and sizes; disabled; save, failure and retry",
  },
  Fields: {
    page: "forms",
    names: ["Field", "Input", "InputGroup", "Textarea"],
    states: "Line and filled; editable, disabled, read-only; inline validation",
  },
  Search: {
    page: "forms",
    names: ["SearchField", "SearchHighlight"],
    states: "Matches, highlights, no matches, clear and Escape",
  },
  ChoiceGroup: {
    page: "forms",
    names: ["ChoiceGroup"],
    states: "Selected, unselected, unavailable option; mobile stacking",
  },
  Feedback: {
    page: "forms",
    names: ["Badge", "Notice", "FormMessage", "EmptyState"],
    states:
      "All badge tones; empty result; error, neutral and success messages",
  },
  Layout: {
    page: "display",
    names: ["Panel", "SectionHeader"],
    states: "Title, action and content composition",
  },
  Values: {
    page: "display",
    names: ["DataList", "DataItem", "Stat", "StatGroup", "MetricCard"],
    states:
      "Rows and compact facts; values first; static and interactive metrics",
  },
  SectionNavigation: {
    page: "interactions",
    names: ["SectionNavigation"],
    states: "Desktop tabs; mobile select; completion status",
  },
  Chart: {
    page: "display",
    names: ["ChartContainer", "ChartTooltipContent"],
    states: "Responsive chart and source-owned tooltip",
  },
  Carousel: {
    page: "display",
    names: [
      "Carousel",
      "CarouselContent",
      "CarouselItem",
      "CarouselDots",
      "CarouselNext",
      "CarouselPrevious",
    ],
    states:
      "Homepage composition: dots, swipe and arrow keys. Previous/Next remain optional exports, not used in this pattern.",
  },
};
