# Keel UI library

`@keel/ui` owns reusable control behavior and the current ink/canvas theme. The
executable catalogue imports those same sources; its synthetic state lives only
in `e2e/ui-catalogue`. Open **Reference → UI catalogue** in the desktop sidebar
or mobile menu, or `/ui/` on the local/preview origin. **Back to Keel** returns
to the application. The page is a separate static reference bundle, makes no
portfolio API requests, and uses only synthetic browser fixtures. Preview's
existing access policy still applies. `make ui-catalogue` remains available as a
standalone server; rebuild/restart that server after changing shared sources.

## Agent entry point

Run `make ui-guide` for the searchable index, then
`make ui-guide UI_QUERY=RecordGroup` (or `UI_QUERY='infinite scroll'`) for the
relevant APIs, usage rules, required states, example code and verification
paths. The same index ships at `/ui/agent-index.json`; each entry links to a
focused JSON reference. Compositions such as history, import, progress and
recovery are indexed alongside components and are explicitly marked as
application recipes.

The generator reads current exports and declarations, canonical rules from this
document, and the actual typechecked catalogue examples. JSX fragments include
the owning function location for state/import context; they are not standalone
copy-paste components. Demo state and fixture-only CSS stay in browser tests.
Use the current theme tokens and check the rendered result. Export coverage and
source freshness do not establish visual quality or complete state coverage.

## Maintain the guide with UI changes

The agent changing a shared component, approved composition or usage rule owns
the affected guide inputs in the same change. The generated JSON is build
output; never edit it directly.

| Input                                           | Update when                                                                                       |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `packages/ui/src`                               | The shared API, behavior or theme changes.                                                        |
| This document and `docs/product/ui-and-copy.md` | An approved usage or design rule changes. Keep each rule in its canonical location.               |
| `e2e/ui-catalogue/catalogue-manifest.ts`        | Exports, grouping, catalogue destinations or required states change.                              |
| `e2e/ui-catalogue/agent-guidance.ts`            | When-to-use guidance or rule/example references change.                                           |
| `e2e/ui-catalogue/*.tsx`                        | A component or composition needs a new or corrected rendered example. Synthetic state stays here. |

Renaming or removing a control includes migrating its inventory, guidance and
example references. Read the affected prose against actual behavior: a valid
link does not establish that a recommendation is still correct. Reusing an
existing pattern without changing its contract needs no guide edit.

Query the affected entry with `make ui-guide UI_QUERY=...`, inspect its matching
catalogue example when appearance or behavior changed, and run the relevant
checks below. In particular, `make test TEST_ARGS=scripts/ui-guide.test.ts`
checks export coverage and rule/example references. Keep the UI skill's existing
scope rules for mechanical corrections and material changes. The handoff names
the updated inputs and checks, or explains why no guide update was needed.

## Approved design and scope

The current-theme catalogue revision v2 was approved on 2026-10-23. Its scope
includes disabled controls, tab styling, typography hierarchy, components and
compositions, borderless failures, concise save errors and the two
collection-loading modes. This does not adopt the earlier alternate theme v3.

The corresponding examples are retained in the repository catalogue. Shared
controls include Checkbox, RadioGroup, LoadingStatus, Spinner, CollectionFooter,
Field/FieldGroup, RecordItem and Text. Generic tabs and disabled states now use
the approved styles. Current palette and spacing tokens remain authoritative in
`packages/ui/src/styles.css`.

History/change/citation, import review, measured progress, provider reconnect
and route recovery remain compositions. Their examples use shared controls;
their financial meaning, accepted decisions, provider policies, authentication,
validation and navigation belong to the application. There is no generic Table,
provider controller, financial history model or form state engine in the
library.

## Type and spacing hierarchy

Use `SectionHeader` for sibling groups with the same visual role; select its
heading level for document structure. Use `Text variant="primary"` for the
principal fact within a group, ordinary `Text` for related values,
`variant="supporting"` for provenance/help and `variant="small"` for compact
secondary tokens. Primary facts are 14px/600, body 14px/400, supporting text
13px/400 and small text 12px. Page/section headings retain the current theme.

Use 8px within related facts, 12px after a compact group heading and 24px
between sibling groups. These roles express relationships, not a rule that every
heading must dominate the primary financial answer. Show each fact once. Omit
labels when the value and surrounding context establish meaning; keep explicit
labels in forms. RecordItem supplies a wrapping title, related detail, optional
source metadata, trailing action and optional expanded content without a card
border.

Use natural phrases for simple counts, such as “2 linked sources · 1 reviewed
change”. Reserve DataList label/value rows for relationships that need the
label, such as previous versus accepted names. In a compact identity summary,
keep the name prominent, related company at body size, investor at the
supporting role, and formation date/place with a masked identifier on one small
muted line. Let that line wrap naturally on mobile. Do not repeat “held by”,
“formed” or “ending” when the context and values already establish the meaning.

Stat supplies block layout and 8px between value, label and detail; inline stats
keep the same separation horizontally. Existing domain compositions may override
that rhythm. MetricCard eyebrows use the same faint tone as Keel's other
eyebrows. The catalogue reuses the homepage statistic and carousel compositions:
an ink background, padded slides, clear title/detail hierarchy and dot controls.
Swipe and keyboard navigation remain available; this featured-item pattern has
no arrow buttons or automatic rotation. Previous/Next remain optional low-level
exports, not a recommendation to add them to the homepage pattern.

The line-chart example follows Keel's existing chart treatment: 2.5px line,
outlined points, readable ticks and hover/tap/keyboard details. ChartContainer
provides the shared surface and tooltip; chart-specific marks remain composition
properties rather than changing every chart type globally.

## Alternating record rows

`RecordGroup` distinguishes related records with alternating row backgrounds;
`RecordRow` supplies title, related detail, value, metadata and action slots.
Odd rows use the light ink wash and even rows show the canvas, without
additional row dividers. Each row has 16px inner padding. The title is 14px/600,
value 16px/650, and supporting text 13px/400. A narrow row keeps the value
beside its identity and the action beside its supporting facts. At 600px of
available group width, the action occupies a trailing column. In Holdings, a
position name and its amount are paired primary facts. Both use 14px/600 and
share a first baseline even when the supporting details wrap. The detail chevron
stays in a trailing column on narrow screens.

Use this composition inside an expanded disclosure when its records belong to
one parent, including a single record. Keep parent-level copy, sharing,
pagination and other sections outside the group. A single record uses the first
shaded row; each group starts its alternation again. Do not apply this treatment
to every disclosure. Use the existing `RecordItem` for standalone records with
richer expanded content.

Within a public exposure, promote the account name and show a shared dated price
once. Keep legal vehicles distinct in private or combined exposures. Unavailable
values and estimates retain their visible qualifications; label a partial total
as known value. The application owns arithmetic, source dates, allocation
meaning, navigation and collection limits. The catalogue covers multiple rows, a
single row, long names, unavailable values and empty state.

## Controls and form feedback

Choose the field surface by editing context, consistently within a form. Line
fields suit compact inline edits to short record values. Quiet filled fields
suit dedicated forms and longer entry. Textareas always use the filled surface
and 12px inner padding so their editable area is visible. Surface treatment does
not encode editable versus read-only state; present non-editable facts as text.

Quiet buttons are low-emphasis, link-like actions with the same horizontal
padding as other buttons of their size. Use TextLink when the action belongs
inline with prose; do not shrink a button's padding to imitate a text link.
Plain buttons inherit surrounding typography and preserve any assigned type size
and weight on hover.

EmptyState children are the inline description rendered as a paragraph, with
inline links when they form part of that prose. Put standalone controls and
ActionGroup in its `actions` prop. The separate slot keeps block controls
outside the paragraph and retains the shared text sizing and spacing.

Checkbox carries its own visible label, optional description and disabled/mixed
states. Use `accessibleLabel` when a short visible label needs record context
for assistive technology. Keep the domain's actual boolean decision in the
caller. RadioGroup is for compact exclusive choices; ChoiceGroup remains the
larger comparison pattern. Both keep disabled options and keyboard operation
explicit.

Field's existing children API remains valid. Use its render function to
associate a control with its label, description and error without including
helper text in the accessible name:

```tsx
<Field
  label="Source name"
  description="Use the name on the document."
  error={error}
>
  {(control) => <Input {...control} value={draft} onChange={updateDraft} />}
</Field>
```

Spread these props onto the actual control, including SelectTrigger when using a
select. FieldGroup supplies a fieldset and legend for related controls. Field
validation is presentation; the owning form and server remain authoritative.

Use DatePicker for date selection in application forms. Input with `type="date"`
uses the browser's native calendar and bypasses the shared calendar behavior.
Compose DatePicker with Field's render function so the trigger retains the
visible label, description and error associations:

```tsx
<Field
  label="Investment date"
  description="Leave blank if unknown."
  error={error}
>
  {(control) => (
    <DatePicker
      {...control}
      aria-label="Investment date"
      value={date}
      onValueChange={setDate}
      max={latestDate}
      disabled={saving}
    />
  )}
</Field>
```

The form owns date requirements and validation. DatePicker's `required` option
also removes the clear action. Keep optional dates clearable, including when a
related amount requires a date before saving. Preserve the task's bounds and
disabled state when replacing a native date field.

Show a Spinner with meaningful pending text on the action being performed.
LoadingStatus supplies one polite status announcement. Disable duplicate
submission, keep the draft after a failed save and disable unchanged
resubmission. Routine failures use body-size text at weight 500 beside the
action, without a surrounding box. State the failure and provide a retry when
useful; omit “your edit is still here” when the retained draft is already
visible. Do not add a success banner that duplicates the visible result.

## Selection and responsive navigation

Selected, unselected, disabled and focused are distinct states. A selected tab
identifies the visible panel; a disabled tab cannot be selected. The keyboard
focus outline identifies where the next key press goes and can coexist with
either selected or unselected styling. An ordinary primary action's dark fill
indicates importance, not selection. Only toggle actions have a persistent
pressed state. The catalogue's foundation demo uses manual tab activation so
focus movement and selection can be inspected separately; see the
[WAI-ARIA tabs pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/).

The shared keyboard-focus fallback uses a crisp outline, without a blurred
shadow. It does not decorate headings or other non-interactive navigation
targets with `tabindex="-1"`. Interactive controls retain their visible
keyboard-focus treatment, including controls using roving tab order.

Use tabs for related alternate views with one panel visible. Keep a short tab
set only while full labels and usable touch targets fit without wrapping,
truncation or horizontal scrolling. For crowded section navigation, use the
existing SectionNavigation dropdown. Its default presentation switches at 700px
or less of viewport or container width, preserving the chosen section. The
explicit mobile-tabs variant remains available for existing task-specific
layouts; verify its labels and targets at the narrowest supported width.

Use visible sections when information is needed together for comparison, and
disclosures for optional supporting detail. A screen being mobile does not by
itself require tabs to become disclosures.

Catalogue examples live in their permanent categories: choice and form controls
under Forms & actions, responsive navigation under Interactions, and both
collection modes under Collection loading. The former additions URL opens Forms
& actions for compatibility.

Separate application reference links from core task navigation with a labeled
Reference group, including in the mobile menu. Keep them reachable by keyboard
and allow the menu/sidebar to scroll on short screens.

The Component index is permanent navigation and export coverage, not a claim
that every state has been verified. Keep its links and documented states
current. The [initial adoption audit](ui-adoption-audit.md) is historical
documentation; it no longer appears in the catalogue. Its old URL opens the
component index.

## Collection loading

CollectionFooter is one count/loading/retry/end presentation with two modes:

- **Automatic:** the collection is the main page content and no meaningful
  section or page footer follows it. Load near the end of the visible rows.
- **Manual:** another section/footer follows or the task needs an explicit
  stopping point. Keep that content reachable with Load more.

Both modes retain a keyboard-accessible button, support unknown totals and stop
on a failure until explicit retry. Automatic appends must not move focus or
reset scroll. A manual request should focus the first new record once it is
rendered. The catalogue demonstrates that focus policy in the owning collection.

Supply `shown`, optional `total`, `hasMore`, `busy`, optional `error`, and a
stable `onLoadMore(source)` callback. `source` distinguishes automatic from
manual activation. Automatic observation disconnects after one activation; the
owner updates the count/pending/error state. Always set `busy` synchronously
when starting asynchronous work and guard duplicate requests in the data owner.

The application owns cursors, cancellation, filtering, scroll restoration,
request budgets and bounded DOM/windowing. Infinite loading is not permission
for unbounded rows or requests. Numbered pages are appropriate only when a task
needs addressable pages or direct jumps. The catalogue is capped at 15 synthetic
rows; it is not a production-scale proof.

## Verification and enforcement

`make lint` enforces `keel-ui/shared-controls` and
`keel-ui/no-inline-control-restyle` in `apps/web/src/**/*.tsx`. Native links,
buttons, inputs, selects, textareas and disclosures belong in `@keel/ui`. Named,
aliased and namespace imports from that library use its documented variants for
appearance. Consumer inline styles may set explicit margins, grid/flex placement
and widths; `ChartContainer` also accepts runtime height dimensions. Visual
properties, opaque style objects and spreads inside the style object are
rejected. Shared implementations retain their styling ownership. This is JSX
enforcement: CSS selectors, forwarded prop spreads and app-local compositions
still require the existing browser checks and rendered review.

The review profile tracks lint, dependency, bundler and browser configuration.
Source roots include all regular files, including image/font assets and expected
browser images; symlinks and nonregular entries fail closed. A source or asset
change after capture invalidates its review packet.

The setup assessment retained the current controls, tokens and catalogue. The
approved source-update flow composes those controls with app-local policy and
decision ownership; it does not need a new public provider component. Broader
extraction candidates remain in `ui-refactor-targets.md` and are not
prerequisites for this workflow.

`e2e/ui-catalogue.visual.spec.ts` exercises the production controls at desktop
and mobile sizes: keyboard selection, disabled styles, help/error associations,
failed-save draft preservation, retry/end states, automatic loading failure
suspension, focus preservation and reduced motion. The catalogue fails on an
uncatalogued export. API requests in this test use the existing fail-closed
mocked fixture; the catalogue itself makes none.

`make typecheck` includes the catalogue's strict TypeScript project. Existing
shared-usage guards and app-specific browser tests remain required. Run focused
catalogue tests through `make e2e`, inspect changed PNGs, replay without
snapshot updates and finish with `make verify`. Do not treat catalogue
screenshots as proof of backend persistence or of an application flow not
exercised by them.

## Brokerage update composition

The application-local `PublicSourceUpdate` composes `Button`, `TextLink`,
`SearchSelect`, `RecordGroup`, `RecordRow`, `Collapsible` and `FormMessage`. It
owns the source comparison, exact accepted-total effects, report-scoped ignores,
saved decision history and bounded activity. Verified inventories reuse the same
rows for closures, share changes, returns and reported cash. Pagination renders
at most 20 activity records, and one earlier report at a time; historical rows
use immutable reported values and have no financial actions. Keep those
financial and acceptance rules in the application and source-update policy.
Existing control variants, placement, keyboard behavior and catalogue states
apply; no new provider abstraction or shared control API is introduced. The real
API/D1 browser flow covers automatic matching, selected corrections, failed
saves and status checks on desktop/mobile. Generated component guidance stays
unchanged because the reused control contracts are unchanged.

## Journey references

The synthetic `/ui/#journeys` reference surface sits alongside the existing
component examples. `e2e/ui-catalogue/journey-spec.ts` owns versioned stable
step IDs, action edges, source references and component names, separate from the
shared component catalogue manifest. The first journey follows portfolio →
company exposure → holding position → reported activity/tax lots → company.
Adjacent product areas are orientation-only, not audited cross-area workflows.

Journey examples import `@keel/ui`; they do not call portfolio APIs or edit
application state. Current ownership, source-reported activity and remaining
lots remain distinct. Unknown lots are not zero holdings. The reference's hash
routes are not promises of production tab deep links or scroll restoration.

When a PR changes an affected screen/action boundary, update the journey source
reference and its trigger/result/context together, or explain why the reference
is unchanged. Component references must resolve to existing example cards and
have reverse journey links. Keep the reference-contract test and the lean
catalogue round-trip regression current; reuse product journey tests for
financial semantics rather than duplicating them in the catalogue.

The owner approved the exact synthetic Journeys v1 proposal on 2026-11-14,
SHA-256 `2f8bf2dcf1620fc6fb3e36463f3890fc08912e5e631a3bfced2b607c4a341e9a`, for
implementation with existing Keel components and principles. This approval
covers the reference-only journey and its reviewed scenarios, not product
navigation, financial semantics, publication or deployment. Material departures
require renewed design review under the interface contract.

## Row navigation and actions

Follow the canonical row-navigation rule in
[Interface and copy contract](ui-and-copy.md#row-navigation-and-actions). The
**Drill into details** composition demonstrates it with `RecordItem`, `TextLink`
and the existing `DisclosureIndicator` rotated right, not a new shared
component. The catalogue-local helper provides a descriptive accessible name and
44 × 44px focusable target. Right chevrons navigate into an unambiguous row's
details; in-place expansion remains a disclosure, and distinct actions keep
meaningful text. Do not append decorative → suffixes to link/button labels;
meaningful transitions in flow diagrams retain arrows.

## Manual import reference approval

The owner approved synthetic Import v2, SHA-256
`5a6ae46f36a03309e890fa6220c8c5521c6ef2a3a51a42ba3818b612af7b861e`, for
catalogue-only implementation. Eligible ready rows start included, with opt-out
and one explicit batch Apply. Identity exceptions remain excluded until source
review confirms the match; invalid and unchanged rows are not applied. Known
failures retain choices. An unknown outcome locks editing, reset and repreview
until status is resolved, preventing duplicate attempts. This manual reference
does not require a second Apply for policy-accepted provider updates. The
example reads no file contents and makes no writes or network calls. This
approval does not authorize product import changes or deployment.

## Current-state task walkthroughs

`task-journey-spec.ts` records five additional independent paths for planning,
Watch/evidence, obligations, source exceptions, and app access, alongside the
existing detailed Holdings fixture. Each step names its product route, source
owner, inspected revision, action, result, carried context and alternate
boundary. Manual main-navigation transitions are explicitly distinguished from
product redirects and in-memory selections. These paths cover the nine major
areas, not every possible product edge case.

`task-journeys.tsx` reuses the approved task cards, ordered step navigation,
inline source treatment and shared reference controls. Except for the approved
Planning slice below, these are read-only walkthroughs, not simulated save or
authorization forms. Their links only move between catalogue reference screens.
There are no network requests, file-content reads, external links, writes,
credentials or clipboard actions. Further interactive scenarios or redesigned
flows still require exact-version design review. This reference expansion does
not change production behavior or the separately approved manual-import example.

For a source citation inside an expanded history entry, keep the citation inline
with a differentiated Source heading and supporting evidence. The Collapsible
reference uses one outer Sources & history disclosure, not a nested Source
details toggle. Do not copy a nested disclosure merely to hide a short citation.

The owner approved the full-row detail target proposal, SHA-256
`98c450945b8be7df68d4f63dc95b406bf4e8bc2dfbba7e290452bae2ffd47412`. In
Alternating record rows, the existing native detail button covers its actionable
position row, with one keyboard stop and an aria-hidden chevron. The action and
synthetic selection are unchanged. This approval does not cover the separate
landing-hierarchy proposal. Planning has its own exact approval below.

For an unambiguous record with exactly one detail destination, make its existing
native link/button cover the row: one action and one keyboard stop, with an
aria-hidden trailing chevron. Keep real destinations as links and local demo
actions as buttons. The catalogue demonstrates this in Portfolio exposure,
Brokerage A, Drill into details, and Alternating record rows. Do not extend this
treatment to context-only records, inline expansion, multiple independent
actions, or distinct Review sources and Activity/Tax lots controls.

### Approved Planning screen walkthrough

The owner approved polished Planning, SHA-256
`0669c4ab3aa530ae5d898d973de19a2c842703bdc09240b00c89757fe6284f67`, plus
token-based spacing above the Scenario excerpt's closing note.
`planning-walkthrough.tsx` uses Keel's goal hero, goal-edit grid, preview,
scenario metrics and history rail within the journey-first catalogue shell. The
local synthetic editor supports name, measure label, optional nonnegative
safe-integer target in months, and required change note. It deliberately saves
an immutable demonstration receipt; failure retains the draft for retry. Current
runway is a separate fixed synthetic fact (9 months), not the target. Paired
Current/Target metrics and an accessible noninteractive meter show the draft in
Goals and saved goal in Overview. The meter caps at target and is omitted for
blank, invalid or zero targets; actual values remain visible. Saving stays in
Goals. Scenarios and History require explicit navigation. Scenario outputs
remain fixed, timing-adjusted liquidity is not cash in hand, and no forecast
calculation, scenario editor, restore or product write is added. State lives
only in the mounted fixture; cold deep links start at baseline. No APIs, storage
or credentials are involved. Shared controls are reused unchanged. Other
journeys, full-row links and inline Source treatments remain.
