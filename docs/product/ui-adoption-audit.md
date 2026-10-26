# UI adoption audit — historical reference

This one-time audit informed the current-theme catalogue approved on 2026-10-23.
Its inventory and source line references describe c623786, before integration;
they are not a current backlog or current implementation status. Use
[UI library](ui-library.md) and the live Component index for current guidance.
The audit is intentionally absent from the catalogue navigation.

## Checkbox

Promote first · New shared control

14 JSX input sites across 8 files recreate selection labels, descriptions and
disabled states. Give independent choices one accessible, consistent control.
Keep acceptance policy in the owning form.

Historical evidence:

- LegalEntities.tsx:1984–2040 — export options and columns
- HoldingImportOutcome.tsx:137–157 — selected updates
- PositionPurchasesEditor.tsx:1970, 2198, 2271, 2337 — investment assertions
- ObservedCashFlow.tsx:549; Obligations.tsx:378;
  PositionShareValuationEditor.tsx:676; InvestmentReview.tsx:1439; App.tsx:5157

Acceptance considerations: Checked, unchecked, indeterminate only when needed,
disabled, invalid, Space activation, associated description, 44px label target;
preserve submitted boolean semantics.

- [Checkbox](https://ui.shadcn.com/docs/components/base/checkbox)

## RadioGroup

Promote first · Compact sibling to ChoiceGroup

6 JSX radio sites across 3 files need ordinary exclusive choices. ChoiceGroup
already serves visible comparisons; retain it for choices with substantial
supporting content.

Historical evidence:

- LegalNameResolver.tsx:216–278 — document-backed name choice
- InvestmentHoldings.tsx:1089–1128 — reviewed company or new company
- LegalEntities.tsx:1347–1363 — evidence/manual mode

Acceptance considerations: Single selection, label and legend, arrow keys,
disabled group and option, invalid feedback. Forms and financial decisions
remain app-owned.

- [Radio Group](https://ui.shadcn.com/docs/components/base/radio-group)

## LoadingStatus + Spinner

Promote first · New shared presentation

Loading/checking text occurs in 17 files; route loading, inline loading and
provider checks use several presentations. Standardize pending feedback without
moving request or retry policy into UI.

Historical evidence:

- RouteShells.tsx:55–64 — spinner with live status
- PlanActualMonitoring.tsx:210–226 — checking state
- HoldingHistory.tsx:50; PositionLinksEditor.tsx:312; CompanyNames.tsx:127 —
  inline loading
- App.tsx:3989, 4372 — provider checks

Acceptance considerations: One accessible status announcement, optional
decorative spinner, reduced motion, preserved existing content during refresh,
error/retry transition. Keep initial route shell dependency-light.

- [Spinner](https://ui.shadcn.com/docs/components/base/spinner)

## CollectionFooter

Promote first · Share the count and action shell

Holdings, legal entities and portfolio sources repeat “Showing n of total” with
a reveal action. Standardize this shell and its count/loading/retry/end states.
Use automatic loading when the collection is the main content with nothing after
it; use Load more when another section or footer follows. Keep cursors, batch
size, fetching and DOM bounds in the application.

Historical evidence:

- InvestmentHoldings.tsx:1534–1546, 1761–1773, 1789–1797, 1988–1996, 2020–2029
- LegalEntities.tsx:2053–2104 — ProgressiveRows
- App.tsx:6083–6100 — portfolio source rows

Acceptance considerations: Known/unknown total, pending, failed load/retry,
exhausted list, keyboard focus and polite appended-count feedback. Numbered page
links only when real page navigation exists.

- [Pagination](https://ui.shadcn.com/docs/components/base/pagination)

## Field + field groups

Extend existing · Extend the existing API

Field currently supplies a label and small description, but no shared error
association or fieldset/group contract. Multiple forms wire these independently.
Keep backward-compatible Field usage and add explicit description/error IDs and
group semantics.

Historical evidence:

- packages/ui/src/components/field.tsx:5–43
- App.tsx:1950–1990 — manual aria-describedby/aria-invalid
- LegalNameResolver.tsx:216 — fieldset and legend
- InvestmentReview.tsx:72–104; HoldingFields.tsx:48 — repeated select-field
  composition

Acceptance considerations: Error and help text announced with the control; group
legend; invalid and disabled states; no nested labels; no new validation
authority or invented required fields.

- [Field](https://ui.shadcn.com/docs/components/base/field)

## Text roles + SectionHeader

Extend existing · Define semantic hierarchy

The style scale does not fully specify how facts relate. Give sibling groups the
same heading role; distinguish the primary fact, related values, source metadata
and help. Heading level and visual role remain separate.

Historical evidence:

- packages/ui/src/components/layout.tsx:57–112 — SectionHeader supports h2/h3/h4
- styles.css:6109–6121 — legal-entity section overrides
- styles.css:6585–6601 — review subsection overrides
- docs/product/ui-and-copy.md — task priority and sibling heading rules

Acceptance considerations: Check grouped facts and long names at narrow width.
Keep important information body-sized, omit redundant labels, and preserve
heading order. Typeset is for prose/markdown; do not apply it globally to
dashboard UI.

- [Typeset](https://ui.shadcn.com/docs/typeset)

## Button + ActionGroup pending recipe

Extend existing · Compose existing components

Saving labels, disabled actions, retained drafts and local errors recur across
editors. Document one recipe around the existing Button, ActionGroup and
FormMessage; avoid another generic form controller.

Historical evidence:

- HoldingImportOutcome.tsx:185–210
- PositionPurchasesEditor.tsx — investment save flow
- App.tsx:7687–7710 — save read status
- packages/ui/src/components/button.tsx

Acceptance considerations: Idle, saving, failed, retry and unchanged state.
Prevent duplicate submission, preserve draft, keep the action in its section and
avoid duplicate success banners.

- [Spinner in buttons](https://ui.shadcn.com/docs/components/base/spinner)

## RecordItem / list row

Catalogue as compositions · Prototype a narrow layout recipe

Entity rows, watch articles and institution rows share a title, supporting
content and actions, but have different navigation and financial meaning. Borrow
Item’s slots for a candidate recipe before promoting a universal row API.

Historical evidence:

- LegalEntities.tsx:920 — EntityRow
- App.tsx:7591 — WatchNewsRow
- InvestmentHoldings.tsx:822 — InvestmentAccountRows
- Obligations.tsx — obligation collection

Acceptance considerations: Static, linked and actionable variants; no nested
click targets; title wrapping, trailing actions and metadata hierarchy on
mobile. No automatic border or card.

- [Item](https://ui.shadcn.com/docs/components/base/item)

## HistoryEntry + ChangeList + SourceCitation

Catalogue as compositions · Keep domain mapping app-local

These application-owned compositions are now demonstrated in the catalogue.
Reuse Collapsible, DataList and TextLink for timestamped changes, before/after
values and document excerpts. Acceptance decisions, evidence interpretation and
chronological ordering stay in Keel.

Historical evidence:

- HoldingHistory.tsx:52–119 — chronology and changed fields
- App.tsx:8755 — ForecastHistory
- InvestmentReview.tsx:1197 — citation excerpt
- LegalNameResolver.tsx:185–211 — document/page quotations

Acceptance considerations: Ordinary, initial record, no-change, long value,
cleared value, unavailable source and multiple sources. Summaries do not repeat
every expanded fact.

- [Collapsible](https://ui.shadcn.com/docs/components/base/collapsible)

## Import table + file input

Catalogue as compositions · Add examples; defer shared Table API

There are two tables, both in import, and one file input. The maintenance queue
already parks generic tables for this reason. Catalogue the current import
layout, native file selection and recovery states first.

Historical evidence:

- App.tsx:1976 — file input; 2085 — import exception table
- HoldingImportOutcome.tsx:102 — review table
- styles.css:1322–1380 — table styling
- docs/product/ui-refactor-targets.md — parked generic tables

Acceptance considerations: Caption/header relationships, row decisions, mobile
layout, bounded rendering, file type/size error, pending and retained selection.
Consider extraction when another independent workflow needs it; no TanStack
dependency yet.

- [Table](https://ui.shadcn.com/docs/components/base/table)
- [Data Table guide](https://ui.shadcn.com/docs/components/base/data-table)

## Progress

Catalogue as compositions · Style the existing measured-progress case

Portfolio Watch has a real completed/total count. Add that case to the catalogue
before a general export. Do not display an invented percentage when only a
pending state is known.

Historical evidence:

- PortfolioWatchMonitor.tsx:446–452 — sources checked
- styles.css:4251 — native progress styling

Acceptance considerations: Zero, partial, complete, failed/partial run and
unknown total. Separate count from success; 100% processed does not mean every
source succeeded.

- [Progress](https://ui.shadcn.com/docs/components/base/progress)

## Provider status + reconnect; route recovery

Catalogue as compositions · Keep application adapters

These workflows need catalogue recipes, but contain provider policy,
authentication and navigation. Consolidate their app-local controllers
separately; compose shared feedback and actions.

Historical evidence:

- App.tsx:3592 — ProviderReconnectControl; 4214 — ProviderPortfolioAgentRow
- AppRecovery.tsx:29,42 — app/portfolio recovery
- RouteShells.tsx:67 — HoldingsRouteShell
- docs/product/ui-refactor-targets.md — UI-07 provider controls

Acceptance considerations: Connecting, healthy, due, failed, recovery and
unavailable states with truthful next steps. Do not alter polling, retry,
authentication or accepted records during UI extraction.

## Other component decisions

### Adopt selected Base UI patterns

Checkbox, RadioGroup and Spinner first; extend Field. Adapt behavior and anatomy
to Keel’s CSS tokens and current @base-ui/react dependency. No second headless
stack or wholesale theme replacement.

[Original reference](https://ui.shadcn.com/docs/components/base/checkbox)

### Item, Pagination and Progress

Useful references for the recipes above. Item stays a narrow composition
candidate; pagination preserves Keel’s reveal/cursor behavior; Progress requires
a measured total.

[Original reference](https://ui.shadcn.com/docs/components/base/item)

### DropdownMenu

Defer until an approved row has secondary actions that genuinely need overflow.
It is an action menu; Select and SearchSelect choose a value. Keep the primary
action visible.

[Original reference](https://ui.shadcn.com/docs/components/base/dropdown-menu)

### Skeleton

Conditional: use only when a stable content shape and measured layout shift
justify it. Preserve existing content on refresh; never disguise empty, error or
unknown financial data as loading.

[Original reference](https://ui.shadcn.com/docs/components/base/skeleton)

### Dialog, AlertDialog, Sheet and Drawer

Defer. The audited flows primarily use inline edits and disclosures. Add a modal
only for a concrete irreversible/trust-sensitive action or a separately approved
flow.

[Original reference](https://ui.shadcn.com/docs/components)

### Command, ContextMenu, Menubar and NavigationMenu

No demonstrated need yet. Keep search, routes and explicit actions discoverable.
Hidden keyboard or right-click actions cannot be the only access path.

[Original reference](https://ui.shadcn.com/docs/components)

### Switch, Slider, Toast and InputOTP

No new default. Saved form choices use Checkbox/RadioGroup; precise financial
inputs use fields; durable failures stay inline. OTP behavior belongs to the
actual authentication flow.

[Original reference](https://ui.shadcn.com/docs/components)

### Typeset

Evaluate only for rendered source prose or markdown. It does not replace the
dashboard’s fact hierarchy, heading semantics or component styles.

[Original reference](https://ui.shadcn.com/docs/typeset)

### Already covered or not needed

Retain Keel’s Button, Badge, Panel, EmptyState, Select, SearchSelect,
DatePicker, Tabs, Collapsible, Chart, Carousel, AppShell and InfoTip. No
independent need found for avatars, aspect-ratio media, resizable panes, custom
scrollbars or the chat/AI component families.

[Original reference](https://ui.shadcn.com/docs/components)
