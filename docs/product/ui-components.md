# Shared UI catalogue

The source-owned library lives in `packages/ui`. Its normal primitives are
exported from `@keel/ui`; domain calculations and source selection stay in the
application. The approved holding proposal v10 introduces the following reusable
pattern.

## ChoiceGroup

Use when choosing a result requires seeing alternatives and their consequences
together. Provide an accessible group label, a stable value, and each option's
short name and supporting content. Use ordinary radios when no comparison is
needed. Do not put links or nested controls inside an option.

```tsx
<ChoiceGroup
  label="Choose the valuation shown for this holding"
  value={method}
  onValueChange={setMethod}
  options={[
    { value: "total", label: "Reported by GP", content: reportedAmount },
    {
      value: "shares",
      label: "Calculated from your shares",
      content: calculation,
    },
  ]}
/>
```

Native radios provide Tab, arrow-key and Space behavior. The entire option is
clickable; the selected outline and checked radio both indicate selection.
Options sit side by side on desktop and stack at 640px. Long content wraps and
mobile targets exceed 44px. `disabled` disables the group during saving;
`option.disabled` disables an unavailable alternative. The owning form keeps
input and selection on failure and places actionable error text by its action.
Loading belongs to the source/form, not to an empty selectable card.

Rendered desktop/mobile states and keyboard selection are exercised in
`e2e/purchase-details.visual.spec.ts`: comparison, selected alternative,
after-carry mismatch, save/reopen and retained failed inputs. The v10 proposal
records the approved interaction, including ordinary states where identical
comparable results require no choice.

## DataList rows

`<DataList layout="rows">` places each `DataItem` label beside its value using
body typography, consistent spacing and wrapping. It suits readable facts; the
default layout remains available for compact metrics. The mobile columns shrink
together, with long values wrapping inside their own column. Holding summary,
calculation and unpaid-payment browser states cover this layout.
