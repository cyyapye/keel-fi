/** Routing metadata only. APIs, examples and design rules are read from their owners. */
export type Guidance = {
  useWhen: string;
  rules: string[];
  examples: {
    file: "catalogue" | "candidates";
    symbol: string;
    title?: string;
  }[];
};

const controls = "Controls and form feedback";
export const consumerRules = [
  "Verification and enforcement",
  "Row navigation and actions",
];
const navigation = "Selection and responsive navigation";
const hierarchy = "Type and spacing hierarchy";
const example = (symbol: string, title?: string): Guidance["examples"] => [
  { file: "catalogue", symbol, ...(title ? { title } : {}) },
];
const composition = (symbol: string): Guidance["examples"] => [
  { file: "candidates", symbol },
];

export const guidance: Record<string, Guidance> = {
  Choices: {
    useWhen:
      "Independent checkbox choices or compact exclusive radio choices. Use ChoiceGroup for richer comparisons.",
    rules: [controls],
    examples: [
      ...composition("CheckboxExample"),
      ...composition("RadioExample"),
    ],
  },
  Loading: {
    useWhen:
      "A pending operation, local failure and explicit retry. Keep request policy in the caller.",
    rules: [controls],
    examples: composition("LoadingExample"),
  },
  Collections: {
    useWhen:
      "Paginated records, infinite scroll or Load more. Choose automatic only when nothing meaningful follows the collection.",
    rules: ["Collection loading"],
    examples: [
      ...composition("CollectionExample"),
      ...composition("CollectionLoading"),
    ],
  },
  Records: {
    useWhen:
      "Alternate related child records with RecordGroup rows, or use its disclosures layout for comparable expandable summaries.",
    rules: ["Alternating record rows", hierarchy],
    examples: [
      ...composition("DrillIntoDetailsExample"),
      ...composition("RecordGroupExample"),
      ...composition("AlternatingDisclosuresExample"),
      ...composition("RecordRowsExample"),
    ],
  },
  Typography: {
    useWhen:
      "Primary answers, related facts and muted supporting detail; omit redundant reading-view labels.",
    rules: [hierarchy],
    examples: example("Foundations", "Hierarchy within & between groups"),
  },
  Shell: {
    useWhen:
      "Application navigation and page structure, with a separate reference section on desktop and mobile.",
    rules: [navigation],
    examples: example("App"),
  },
  Disclosure: {
    useWhen:
      "Optional supporting detail. Information required together for comparison should stay visible.",
    rules: [navigation, "Alternating record rows"],
    examples: example("Interactions", "Collapsible"),
  },
  Select: {
    useWhen:
      "A compact dropdown with a manageable set of values; use SearchSelect when searching is needed.",
    rules: [controls, navigation],
    examples: example("Interactions", "Dropdown selection"),
  },
  SearchSelect: {
    useWhen:
      "Searchable dropdown choices with empty results and clear selection.",
    rules: [controls],
    examples: example("Interactions", "Searchable dropdown"),
  },
  InfoTip: {
    useWhen:
      "Optional explanation that is reachable by keyboard and touch. Keep essential meaning visible.",
    rules: [navigation],
    examples: example("Interactions", "Information popup"),
  },
  DatePicker: {
    useWhen: "A bounded date selection with a calendar and clearing behavior.",
    rules: [controls],
    examples: example("Interactions", "Date picker"),
  },
  Tabs: {
    useWhen:
      "Short alternate views whose full labels and targets fit. Use SectionNavigation when crowded.",
    rules: [navigation],
    examples: example("Interactions", "Tabs"),
  },
  Actions: {
    useWhen:
      "Actions, navigation links and wrapping action groups. Primary fill expresses importance, not selection.",
    rules: [controls, navigation],
    examples: example("Forms", "Buttons & links"),
  },
  Fields: {
    useWhen:
      "Labeled input with associated help/error. Line for compact inline edits; filled for dedicated forms; textarea always filled.",
    rules: [controls],
    examples: [
      ...example("Forms", "Fields & validation"),
      ...composition("FieldSaveExample"),
    ],
  },
  Search: {
    useWhen:
      "Filter a collection with clear, highlight and no-matches feedback. Caller owns filtering and request budgets.",
    rules: [controls, "Collection loading"],
    examples: example("Forms", "Search"),
  },
  ChoiceGroup: {
    useWhen:
      "Exclusive alternatives needing supporting comparison content. Use RadioGroup for compact choices.",
    rules: [controls],
    examples: example("Forms", "Visible alternatives"),
  },
  Feedback: {
    useWhen:
      "Meaningful status, empty results and local failures. EmptyState uses inline description children and a separate actions slot. Avoid boxes and redundant success/retained-draft copy.",
    rules: [controls],
    examples: example("Forms", "Feedback"),
  },
  Layout: {
    useWhen:
      "Sibling section headings and content grouping. Use a trailing Stat for a total that summarizes the section.",
    rules: [hierarchy],
    examples: [
      ...example("Display", "Reading view"),
      ...example("Display", "Section heading with total"),
    ],
  },
  Values: {
    useWhen:
      "Labeled relationships, headline statistics and metrics. Use natural phrases for simple counts.",
    rules: [hierarchy],
    examples: [
      ...example("Display", "Facts when labels add meaning"),
      ...example("Display", "Statistics & metrics"),
      ...example("Display", "Section heading with total"),
    ],
  },
  SectionNavigation: {
    useWhen:
      "Section switching that becomes a dropdown when labels no longer fit on narrow screens.",
    rules: [navigation],
    examples: example("ResponsiveSectionsExample"),
  },
  Chart: {
    useWhen:
      "Responsive quantitative charts with readable marks and hover, tap and keyboard details.",
    rules: [hierarchy],
    examples: example("Display", "Chart & tooltip"),
  },
  Carousel: {
    useWhen:
      "A small featured-item sequence using the homepage surface, hierarchy, dots, swipe and keyboard navigation.",
    rules: [hierarchy],
    examples: example("SourceCarousel"),
  },
};

export const compositionGuidance: Record<string, Guidance> = {
  History: {
    useWhen:
      "Changes and citations that preserve evidence and accepted-decision meaning. Domain state stays in the app.",
    rules: ["Approved design and scope", hierarchy],
    examples: composition("HistoryExample"),
  },
  Import: {
    useWhen:
      "File selection and import review with explicit row outcomes. This is a composition, not a generic Table export.",
    rules: ["Approved design and scope", controls],
    examples: composition("ImportExample"),
  },
  Progress: {
    useWhen:
      "Measured progress with known work counts. Use LoadingStatus when progress cannot be measured.",
    rules: ["Approved design and scope", controls],
    examples: composition("ProgressExample"),
  },
  Provider: {
    useWhen:
      "Provider status and reconnect. Authentication, retry policy and credentials remain application-owned.",
    rules: ["Approved design and scope", controls],
    examples: composition("ProviderExample"),
  },
  Recovery: {
    useWhen:
      "Route failure, retained content and a local retry. Keep ownership of fetching and errors in the app.",
    rules: ["Approved design and scope", controls],
    examples: composition("RecoveryExample"),
  },
};
