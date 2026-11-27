# UI spacing and typography debt

Existing off-scale CSS declarations, grouped by selector family. Shared rules
can affect several screens. Each entry identifies its stylesheet, conditional
context, selector and declaration. Repeated entries represent distinct
occurrences.

Run `pnpm lint:css --report` for live source lines, optionally followed by a
screen name or selector fragment. After a repair, run `pnpm lint:css --prune`
and commit the reduced inventory with the stylesheet. See the
[type and spacing contract](../product/ui-library.md#type-and-spacing-hierarchy).

Tracked declarations: 1135.

- [App access (2)](#app-access)
- [Cash accounts and baseline (107)](#cash-accounts-and-baseline)
- [Evidence and decisions (70)](#evidence-and-decisions)
- [Forecast history (8)](#forecast-history)
- [Holdings and position details (277)](#holdings-and-position-details)
- [Holdings sources and imports (91)](#holdings-sources-and-imports)
- [Legal entities and ownership (54)](#legal-entities-and-ownership)
- [Obligations (53)](#obligations)
- [Other and shared app layouts (71)](#other-and-shared-app-layouts)
- [Overview and portfolio summaries (39)](#overview-and-portfolio-summaries)
- [Planning and goals (141)](#planning-and-goals)
- [Portfolio Watch (56)](#portfolio-watch)
- [Scenarios (27)](#scenarios)
- [Shared UI components and shell (102)](#shared-ui-components-and-shell)
- [Startup (4)](#startup)
- [UI catalogue compositions and journey candidates (4)](#ui-catalogue-compositions-and-journey-candidates)
- [UI catalogue foundations and walkthroughs (12)](#ui-catalogue-foundations-and-walkthroughs)
- [UI catalogue planning journey (17)](#ui-catalogue-planning-journey)

## App access

0 spacing, 2 typography.

```text
apps/web/src/app-access.css | .app-access__copy input | font-family: monospace
apps/web/src/app-access.css | .app-access__permissions h3 | font-size: 18px
```

## Cash accounts and baseline

64 spacing, 43 typography.

```text
apps/web/src/cash-holdings.css | .cash-history__recent li + li | margin-top: 15px
apps/web/src/cash-holdings.css | .cash-holdings > .section-heading h2 | font-size: 34px
apps/web/src/cash-holdings.css | .cash-holdings > .section-heading | margin-bottom: 28px
apps/web/src/cash-holdings.css | .cash-holdings | padding: 34px 0
apps/web/src/cash-holdings.css | .cash-holdings__group + .cash-holdings__group | margin-top: 28px
apps/web/src/cash-holdings.css | .cash-holdings__group-heading h3 | font-size: 17px
apps/web/src/cash-holdings.css | .cash-holdings__group-heading p | margin: 2px 0 0
apps/web/src/cash-holdings.css | @media (max-width: 600px) › .cash-holdings__account-summary | padding: 16px 10px
apps/web/src/styles.css | .baseline-cash-context | font-size: 9px
apps/web/src/styles.css | .baseline-cash-context | font-weight: 650
apps/web/src/styles.css | .baseline-changes > header h3 | font-weight: 650
apps/web/src/styles.css | .baseline-changes | gap: 14px
apps/web/src/styles.css | .baseline-changes__more | font-size: 9px
apps/web/src/styles.css | .baseline-changes__more | gap: 18px
apps/web/src/styles.css | .baseline-impact > p:not(.eyebrow) | font-size: 9px
apps/web/src/styles.css | .baseline-impact span | font-size: 8px
apps/web/src/styles.css | .baseline-impact | padding: 26px 28px
apps/web/src/styles.css | .baseline-liquid-composition__field | gap: 5px
apps/web/src/styles.css | .baseline-liquid-composition__field | padding: 15px 0
apps/web/src/styles.css | .baseline-liquid-composition__row span | font-size: 8px
apps/web/src/styles.css | .baseline-liquid-composition__row | padding: 15px 0
apps/web/src/styles.css | .baseline-liquid-composition__total strong | font-size: 16px
apps/web/src/styles.css | .baseline-policy-grid | gap: 64px
apps/web/src/styles.css | .baseline-policy-input | gap: 28px
apps/web/src/styles.css | .baseline-position-list article small | font-size: 8px
apps/web/src/styles.css | .baseline-position-list article small | font-weight: 700
apps/web/src/styles.css | .baseline-position-list article small | margin-top: 6px
apps/web/src/styles.css | .baseline-position-list article span | font-size: 8px
apps/web/src/styles.css | .baseline-position-list article strong | font-size: 11px
apps/web/src/styles.css | .baseline-position-list article | padding: 17px 0
apps/web/src/styles.css | .baseline-position-list__header | font-size: 8px
apps/web/src/styles.css | .baseline-position-list__header | padding: 13px 0
apps/web/src/styles.css | .baseline-position-list__header, .baseline-position-list article | gap: 28px
apps/web/src/styles.css | .baseline-review-actions p | font-size: 9px
apps/web/src/styles.css | .cash-accounts | padding: 30px 0
apps/web/src/styles.css | .cash-accounts__accepted | gap: 42px
apps/web/src/styles.css | .cash-accounts__accepted | margin-top: 26px
apps/web/src/styles.css | .cash-accounts__accepted | padding-top: 22px
apps/web/src/styles.css | .cash-accounts__accepted-account > .cash-accounts__accepted-value | font-size: 15px
apps/web/src/styles.css | .cash-accounts__accepted-account > .cash-accounts__accepted-value | font-weight: 680
apps/web/src/styles.css | .cash-accounts__accepted-account | gap: 18px
apps/web/src/styles.css | .cash-accounts__accepted-list small, .cash-accounts__connection small | font-size: 8px
apps/web/src/styles.css | .cash-accounts__accepted-list small, .cash-accounts__connection small | margin-top: 5px
apps/web/src/styles.css | .cash-accounts__accepted-list | gap: 16px 34px
apps/web/src/styles.css | .cash-accounts__connection | gap: 26px
apps/web/src/styles.css | .cash-accounts__connection | padding: 15px 0
apps/web/src/styles.css | .cash-accounts__connections | margin-top: 22px
apps/web/src/styles.css | .cash-accounts__cost-note | font-size: 8px
apps/web/src/styles.css | .cash-accounts__cost-note | margin-top: 18px
apps/web/src/styles.css | .cash-accounts__heading h2, .cash-review__heading h3 | font-size: clamp(20px, 2.4vw, 28px)
apps/web/src/styles.css | .cash-accounts__heading h2, .cash-review__heading h3 | font-weight: 630
apps/web/src/styles.css | .cash-accounts__heading | gap: 44px
apps/web/src/styles.css | .cash-accounts__identity-heading h3 | font-weight: 650
apps/web/src/styles.css | .cash-accounts__identity-heading h3 | margin-bottom: 7px
apps/web/src/styles.css | .cash-accounts__identity-heading p | font-size: 9px
apps/web/src/styles.css | .cash-accounts__identity-list small | font-size: 8px
apps/web/src/styles.css | .cash-accounts__identity-list small | margin-top: 5px
apps/web/src/styles.css | .cash-accounts__identity-review | gap: 42px
apps/web/src/styles.css | .cash-accounts__identity-review | margin-top: 22px
apps/web/src/styles.css | .cash-accounts__identity-review | padding-top: 22px
apps/web/src/styles.css | .cash-accounts__setup, .cash-accounts__notice, .cash-accounts__error | margin-top: 18px
apps/web/src/styles.css | .cash-accounts__total span | font-size: 8px
apps/web/src/styles.css | .cash-accounts__total span | margin-bottom: 7px
apps/web/src/styles.css | .cash-accounts__total strong | font-size: 24px
apps/web/src/styles.css | .cash-accounts__total strong | font-weight: 620
apps/web/src/styles.css | .cash-review | gap: 26px
apps/web/src/styles.css | .cash-review | margin-top: 30px
apps/web/src/styles.css | .cash-review | padding-top: 30px
apps/web/src/styles.css | .cash-review__actions | padding-top: 18px
apps/web/src/styles.css | .cash-review__decision label | font-size: 9px
apps/web/src/styles.css | .cash-review__decision label | font-weight: 700
apps/web/src/styles.css | .cash-review__decision label | margin-top: 10px
apps/web/src/styles.css | .cash-review__issue | font-size: 8px
apps/web/src/styles.css | .cash-review__issue | margin: -10px 0 0
apps/web/src/styles.css | .cash-review__rows article | gap: 26px
apps/web/src/styles.css | .cash-review__rows article | padding: 18px 0
apps/web/src/styles.css | .cash-review__rows small, .cash-review__decision > span | font-size: 8px
apps/web/src/styles.css | .cash-review__rows small, .cash-review__decision > span | margin-top: 5px
apps/web/src/styles.css | .cash-review__rows strong | font-size: 11px
apps/web/src/styles.css | .cash-review__rows strong | margin-top: 5px
apps/web/src/styles.css | .cash-review__totals span | font-size: 8px
apps/web/src/styles.css | .cash-review__totals strong | font-size: 17px
apps/web/src/styles.css | .cash-review__totals | gap: 22px
apps/web/src/styles.css | .cash-review__totals | padding: 18px 0
apps/web/src/styles.css | .cash-review__type | font-size: 8px
apps/web/src/styles.css | .portfolio-baseline | gap: 42px
apps/web/src/styles.css | .portfolio-baseline | padding: 30px 0
apps/web/src/styles.css | .portfolio-baseline-review | gap: 34px
apps/web/src/styles.css | .portfolio-baseline-review | padding: 10px 0 30px
apps/web/src/styles.css | .portfolio-baseline__heading .portfolio-baseline__error | font-weight: 700
apps/web/src/styles.css | .portfolio-baseline__heading .portfolio-baseline__error | margin-top: 10px
apps/web/src/styles.css | .portfolio-baseline__heading h2, .portfolio-baseline--error h2, .portfolio-baseline-review__heading h2 | font-size: clamp(22px, 2.8vw, 34px)
apps/web/src/styles.css | .portfolio-baseline__heading h2, .portfolio-baseline--error h2, .portfolio-baseline-review__heading h2 | font-weight: 630
apps/web/src/styles.css | .portfolio-baseline__summary span | font-size: 8px
apps/web/src/styles.css | .portfolio-baseline__summary strong | font-size: 16px
apps/web/src/styles.css | .portfolio-baseline__summary strong | font-weight: 650
apps/web/src/styles.css | .portfolio-baseline__summary strong | margin-bottom: 5px
apps/web/src/styles.css | @media (max-width: 620px) › .baseline-changes > header | gap: 6px
apps/web/src/styles.css | @media (max-width: 620px) › .baseline-impact | padding: 22px 20px
apps/web/src/styles.css | @media (max-width: 620px) › .baseline-policy-grid | gap: 34px
apps/web/src/styles.css | @media (max-width: 620px) › .cash-accounts__heading, .cash-accounts__accepted, .cash-accounts__identity-review | gap: 18px
apps/web/src/styles.css | @media (max-width: 620px) › .cash-review | gap: 22px
apps/web/src/styles.css | @media (max-width: 620px) › .cash-review__rows article | gap: 14px
apps/web/src/styles.css | @media (max-width: 620px) › .cash-review__totals strong | font-size: 15px
apps/web/src/styles.css | @media (max-width: 620px) › .cash-review__totals | gap: 10px
apps/web/src/styles.css | @media (max-width: 620px) › .portfolio-baseline, .portfolio-baseline--current | gap: 22px
apps/web/src/styles.css | @media (max-width: 620px) › .portfolio-baseline-review | gap: 28px
```

## Evidence and decisions

45 spacing, 25 typography.

```text
apps/web/src/styles.css | .decision-index | font-size: 11px
apps/web/src/styles.css | .decision-index | font-weight: 750
apps/web/src/styles.css | .decision-list article | gap: 18px
apps/web/src/styles.css | .decision-list article | padding: 17px 0
apps/web/src/styles.css | .decision-list h3 | margin-bottom: 5px
apps/web/src/styles.css | .evidence-apply-preview > div:first-child > p | font-size: 11px
apps/web/src/styles.css | .evidence-apply-preview > div:first-child > small | font-size: 8px
apps/web/src/styles.css | .evidence-apply-preview > div:first-child > small | margin-top: 6px
apps/web/src/styles.css | .evidence-apply-preview > div:first-child > span | font-size: 8px
apps/web/src/styles.css | .evidence-apply-preview > div:first-child > span | margin-bottom: 6px
apps/web/src/styles.css | .evidence-apply-preview > div:last-child | gap: 7px
apps/web/src/styles.css | .evidence-body > div | padding: 0 26px
apps/web/src/styles.css | .evidence-body small | font-size: 8px
apps/web/src/styles.css | .evidence-body span | font-size: 8px
apps/web/src/styles.css | .evidence-body span | margin-bottom: 11px
apps/web/src/styles.css | .evidence-body | padding: 22px 0
apps/web/src/styles.css | .evidence-card > footer .evidence-apply-preview | padding: 15px 17px
apps/web/src/styles.css | .evidence-card > footer > div | gap: 7px
apps/web/src/styles.css | .evidence-card > footer p | font-size: 8px
apps/web/src/styles.css | .evidence-card > footer | gap: 25px
apps/web/src/styles.css | .evidence-card > header | gap: 15px
apps/web/src/styles.css | .evidence-card > header | padding: 10px 0
apps/web/src/styles.css | .evidence-card h2 | font-size: 15px
apps/web/src/styles.css | .evidence-card header .eyebrow | margin-bottom: 5px
apps/web/src/styles.css | .evidence-icon | font-size: 11px
apps/web/src/styles.css | .evidence-list | gap: 42px
apps/web/src/styles.css | .evidence-reconciliation-order | font-size: 8px
apps/web/src/styles.css | .evidence-reconciliation-order | font-weight: 750
apps/web/src/styles.css | .evidence-reconciliation-order | margin: 0 0 5px
apps/web/src/styles.css | .evidence-source-link | font-size: 8px
apps/web/src/styles.css | .evidence-source-link | font-weight: 700
apps/web/src/styles.css | .proposed-change del, .proposed-change ins | font-weight: 750
apps/web/src/styles.css | .proposed-change del, .proposed-change ins | padding: 8px 10px
apps/web/src/styles.css | .reported-financing-terms .financing-ambiguity | font-weight: 650
apps/web/src/styles.css | .reported-financing-terms .financing-ambiguity | margin-top: 13px
apps/web/src/styles.css | .reported-financing-terms .financing-source-excerpt | font-size: 8px
apps/web/src/styles.css | .reported-financing-terms .financing-source-excerpt | margin-top: 5px
apps/web/src/styles.css | .reported-financing-terms > div + div | margin-top: 14px
apps/web/src/styles.css | .reported-financing-terms > strong | margin-bottom: 13px
apps/web/src/styles.css | .reported-financing-terms b | font-size: 11px
apps/web/src/styles.css | .signal-proposal > label | gap: 7px
apps/web/src/styles.css | .signal-proposal > small, .signal-proposal > .inline-error | margin: -10px 0 0
apps/web/src/styles.css | .signal-proposal p | margin: 7px 0 0
apps/web/src/styles.css | .signal-proposal small | font-size: 8px
apps/web/src/styles.css | .signal-proposal small | margin-top: 7px
apps/web/src/styles.css | .signal-proposal span, .signal-proposal label | font-size: 8px
apps/web/src/styles.css | .signal-proposal strong | margin-top: 7px
apps/web/src/styles.css | .signal-proposal | gap: 22px
apps/web/src/styles.css | .signal-proposal | padding-top: 22px
apps/web/src/styles.css | .signal-reconciliation-group > header h2 | font-size: 24px
apps/web/src/styles.css | .signal-reconciliation-group > header h2 | font-weight: 650
apps/web/src/styles.css | .signal-reconciliation-group > header h2 | margin-bottom: 7px
apps/web/src/styles.css | .signal-reconciliation-group | gap: 26px
apps/web/src/styles.css | .signal-reconciliation-group | padding-top: 25px
apps/web/src/styles.css | .signal-reconciliation-list > .section-heading > p | font-size: 9px
apps/web/src/styles.css | .signal-reconciliation-list > .section-heading h2 | font-size: 20px
apps/web/src/styles.css | .signal-reconciliation-list > .section-heading | gap: 50px
apps/web/src/styles.css | .signal-reconciliation-list | gap: 38px
apps/web/src/styles.css | .signal-reconciliation-reports .evidence-card + .evidence-card | padding-top: 26px
apps/web/src/styles.css | .signal-reconciliation-reports | gap: 26px
apps/web/src/styles.css | @media (max-width: 620px) › .evidence-body > div, .evidence-body > div:first-child, .evidence-body > div:last-child | margin-top: 18px
apps/web/src/styles.css | @media (max-width: 620px) › .evidence-body > div, .evidence-body > div:first-child, .evidence-body > div:last-child | padding: 18px 0 0
apps/web/src/styles.css | @media (max-width: 620px) › .evidence-body | padding: 22px 0
apps/web/src/styles.css | @media (max-width: 620px) › .evidence-card > footer > div | margin-top: 14px
apps/web/src/styles.css | @media (max-width: 620px) › .evidence-card > footer | padding: 17px 0
apps/web/src/styles.css | @media (max-width: 620px) › .evidence-card > header | padding: 10px 0
apps/web/src/styles.css | @media (max-width: 620px) › .signal-proposal > small, .signal-proposal > .inline-error | margin-top: -7px
apps/web/src/styles.css | @media (max-width: 620px) › .signal-proposal | gap: 18px
apps/web/src/styles.css | @media (max-width: 620px) › .signal-reconciliation-group > header h2 | font-size: 21px
apps/web/src/styles.css | @media (max-width: 620px) › .signal-reconciliation-group > header | gap: 14px
```

## Forecast history

5 spacing, 3 typography.

```text
apps/web/src/styles.css | .history-comparison > span:not(.arrow) | font-size: 8px
apps/web/src/styles.css | .history-comparison | margin-bottom: 10px
apps/web/src/styles.css | .history-comparison | padding: 13px 0
apps/web/src/styles.css | .history-content h2 | margin: 7px 0 0
apps/web/src/styles.css | .history-content time, .history-content > small | font-size: 8px
apps/web/src/styles.css | .history-content | padding: 2px 0 28px 8px
apps/web/src/styles.css | .history-rail span | font-size: 9px
apps/web/src/styles.css | @media (max-width: 620px) › .history-comparison | gap: 10px
```

## Holdings and position details

141 spacing, 136 typography.

```text
apps/web/src/styles.css | .distribution-amount .holding-metadata, .distribution-identity .holding-metadata | margin-top: 6px
apps/web/src/styles.css | .distribution-amount strong | font-size: 24px
apps/web/src/styles.css | .distribution-amount strong | font-weight: 650
apps/web/src/styles.css | .distribution-basis | margin-top: 28px
apps/web/src/styles.css | .distribution-identity h4 | font-size: 16px
apps/web/src/styles.css | .distribution-preview-amount | font-size: 28px
apps/web/src/styles.css | .distribution-preview-carry | font-size: 20px
apps/web/src/styles.css | .distribution-preview-values strong | font-weight: 650
apps/web/src/styles.css | .distribution-preview-values | gap: 20px 28px
apps/web/src/styles.css | .distribution-result-limit | font-weight: 500
apps/web/src/styles.css | .distribution-summary > .holding-metadata | margin-top: 10px
apps/web/src/styles.css | .distribution-summary-line | gap: 12px 28px
apps/web/src/styles.css | .exposure-group__identity strong | font-size: 16px
apps/web/src/styles.css | .exposure-group__indicator | margin-top: -6px
apps/web/src/styles.css | .exposure-group__market-meta | font-weight: 750
apps/web/src/styles.css | .exposure-group__performance | font-weight: 650
apps/web/src/styles.css | .exposure-group__value | font-size: 19px
apps/web/src/styles.css | .exposure-group__value | font-weight: 650
apps/web/src/styles.css | .exposure-groups .position-row--detail:has(.position-row__action) | padding-inline-end: 44px
apps/web/src/styles.css | .exposure-pagination span | font-size: 11px
apps/web/src/styles.css | .exposure-row | padding: 20px 44px 20px 16px
apps/web/src/styles.css | .exposure-row | row-gap: 2px
apps/web/src/styles.css | .holding-acquisition + .holding-acquisition | margin-top: 48px
apps/web/src/styles.css | .holding-choice-amount | font-size: 28px
apps/web/src/styles.css | .holding-detail-heading h2 | font-size: clamp(28px, 3.4vw, 36px)
apps/web/src/styles.css | .holding-detail-heading h2 | font-weight: 620
apps/web/src/styles.css | .holding-detail-heading h2 | margin-bottom: 9px
apps/web/src/styles.css | .holding-detail-records dl > div | gap: 18px
apps/web/src/styles.css | .holding-detail-records dt | font-size: 8px
apps/web/src/styles.css | .holding-detail-records | gap: 72px
apps/web/src/styles.css | .holding-detail-records | padding-top: 29px
apps/web/src/styles.css | .holding-detail-section [data-slot="collapsible-content"] | padding-bottom: 22px
apps/web/src/styles.css | .holding-detail-value > small | font-size: 8px
apps/web/src/styles.css | .holding-detail-value > small | margin-top: 10px
apps/web/src/styles.css | .holding-detail-value > span | font-size: 8px
apps/web/src/styles.css | .holding-detail-value > strong | font-size: clamp(20px, 2.5vw, 31px)
apps/web/src/styles.css | .holding-detail-value > strong | font-weight: 620
apps/web/src/styles.css | .holding-detail-value > strong | margin-top: 9px
apps/web/src/styles.css | .holding-detail-value > strong.is-not-set | font-size: 18px
apps/web/src/styles.css | .holding-detail-value > strong.is-not-set | font-weight: 550
apps/web/src/styles.css | .holding-detail-value | padding: 19px 0 12px
apps/web/src/styles.css | .holding-detail-values | gap: 28px
apps/web/src/styles.css | .holding-detail-values | margin-top: 18px
apps/web/src/styles.css | .holding-detail-workspace .position-valuation__toggle strong | font-size: 26px
apps/web/src/styles.css | .holding-detail-workspace h3 | font-size: 16px
apps/web/src/styles.css | .holding-detail-workspace | padding: 8px 3px 36px
apps/web/src/styles.css | .holding-detail-workspace--editing .holding-headline__values .stat__value, .holding-detail-workspace--editing .holding-headline__primary .stat__value | font-size: 22px
apps/web/src/styles.css | .holding-detail-workspace--editing .holding-headline__values | gap: 18px
apps/web/src/styles.css | .holding-detail-workspace--editing .holding-headline__values | margin-top: 22px
apps/web/src/styles.css | .holding-distributions .distribution-heading | margin: 28px 0 16px
apps/web/src/styles.css | .holding-distributions h4 | font-size: 16px
apps/web/src/styles.css | .holding-edit-purchases | margin-top: 60px
apps/web/src/styles.css | .holding-fields | gap: 20px 28px
apps/web/src/styles.css | .holding-form-fieldset > .holding-acquisition-actions | margin: 28px 0 36px
apps/web/src/styles.css | .holding-headline | margin-bottom: 26px
apps/web/src/styles.css | .holding-headline__primary strong | font-size: clamp(36px, 4.8vw, 48px)
apps/web/src/styles.css | .holding-headline__values .holding-headline__primary .stat__value | font-size: clamp(36px, 4.8vw, 48px)
apps/web/src/styles.css | .holding-headline__values .holding-headline__primary > strong | font-size: 36px
apps/web/src/styles.css | .holding-headline__values .stat__value | font-size: 26px
apps/web/src/styles.css | .holding-headline__values article > small | margin-top: 10px
apps/web/src/styles.css | .holding-headline__values article > strong | font-size: 28px
apps/web/src/styles.css | .holding-headline__values article > strong | margin-top: 10px
apps/web/src/styles.css | .holding-headline__values | gap: 28px
apps/web/src/styles.css | .holding-headline__values | margin-top: 28px
apps/web/src/styles.css | .holding-history-line | gap: 2px
apps/web/src/styles.css | .holding-impact-boundary strong | font-size: 22px
apps/web/src/styles.css | .holding-investment .data-list__value small, .holding-history .data-list__value small | margin-top: 5px
apps/web/src/styles.css | .holding-investment-details > .notice | margin: 0 0 22px
apps/web/src/styles.css | .holding-other-values | margin-top: -28px
apps/web/src/styles.css | .holding-planning .data-list, .holding-other-values .data-list, .holding-summary-details .data-list | gap: 18px
apps/web/src/styles.css | .holding-return strong | font-size: 18px
apps/web/src/styles.css | .holding-return-details | margin-bottom: 26px
apps/web/src/styles.css | .holding-return__amount, .holding-inline-date | margin-inline-start: 0.25em
apps/web/src/styles.css | .holding-reviewed-mark dl > div | gap: 7px
apps/web/src/styles.css | .holding-row-action i | font-size: 8px
apps/web/src/styles.css | .holding-row-action i | font-weight: 750
apps/web/src/styles.css | .holding-row-action i | margin-left: 18px
apps/web/src/styles.css | .holding-section-toggle > span | gap: 6px
apps/web/src/styles.css | .holding-section-toggle strong | font-size: 26px
apps/web/src/styles.css | .holding-summary | gap: 28px
apps/web/src/styles.css | .holding-valuation-editor | margin-top: 28px
apps/web/src/styles.css | .holding-valuation-section, .holding-payment-summary, .holding-investment, .holding-history | margin-top: 44px
apps/web/src/styles.css | .holding-value-amount | font-size: clamp(26px, 3vw, 36px)
apps/web/src/styles.css | .holding-value-metric .holding-metadata | margin-top: 14px
apps/web/src/styles.css | .holding-value-metric p | margin: 0 0 10px
apps/web/src/styles.css | .holding-value-summary | gap: 28px
apps/web/src/styles.css | .holding-value-summary | margin: 28px 0
apps/web/src/styles.css | .holding-welcome | padding-block: 52px
apps/web/src/styles.css | .holdings-navigation | margin-bottom: 28px
apps/web/src/styles.css | .investment-capital-totals .stat__value | font-size: clamp(20px, 2vw, 28px)
apps/web/src/styles.css | .investment-institution | padding: 26px 0
apps/web/src/styles.css | .investment-institution__account small, .investment-institution__coverage | font-size: 8px
apps/web/src/styles.css | .investment-institution__account strong | font-size: 11px
apps/web/src/styles.css | .investment-institution__account | gap: 18px
apps/web/src/styles.css | .investment-institution__account-value > strong | font-weight: 680
apps/web/src/styles.css | .investment-institution__account-value | gap: 5px
apps/web/src/styles.css | .investment-institution__confirm p | font-size: 9px
apps/web/src/styles.css | .investment-institution__coverage | gap: 5px
apps/web/src/styles.css | .investment-institution__details > .investment-institution__trigger | gap: 28px
apps/web/src/styles.css | .investment-institution__heading > span | gap: 10px
apps/web/src/styles.css | .investment-institution__heading h3 | font-size: 20px
apps/web/src/styles.css | .investment-institution__heading | gap: 7px
apps/web/src/styles.css | .investment-institution__meta small | font-size: 8px
apps/web/src/styles.css | .investment-institution__meta small | margin-bottom: 5px
apps/web/src/styles.css | .investment-institution__meta | gap: 18px
apps/web/src/styles.css | .investment-institution__reconnect p | font-size: 9px
apps/web/src/styles.css | .investment-institution__retry-note | font-size: 9px
apps/web/src/styles.css | .investment-institution__summary | font-size: 9px
apps/web/src/styles.css | .investment-institution__value | font-size: 18px
apps/web/src/styles.css | .investment-institution__value | font-weight: 680
apps/web/src/styles.css | .investment-institutions | gap: 28px 48px
apps/web/src/styles.css | .investment-institutions | padding: 34px 0
apps/web/src/styles.css | .investment-institutions__empty h3 | font-size: 16px
apps/web/src/styles.css | .investment-institutions__empty h3 | margin-bottom: 5px
apps/web/src/styles.css | .investment-institutions__error | font-weight: 700
apps/web/src/styles.css | .investment-institutions__heading h2, .investment-views__heading h2 | font-size: clamp(22px, 2.8vw, 34px)
apps/web/src/styles.css | .investment-institutions__heading h2, .investment-views__heading h2 | font-weight: 630
apps/web/src/styles.css | .investment-review .position-economics__heading h3 | font-size: 18px
apps/web/src/styles.css | .investment-review > h3 | font-size: 24px
apps/web/src/styles.css | .investment-review__amounts .data-list__value | margin-top: 6px
apps/web/src/styles.css | .investment-review__closure .data-list__value | margin-top: 6px
apps/web/src/styles.css | .investment-review__company-basis strong | font-size: 18px
apps/web/src/styles.css | .investment-review__document label | font-weight: 700
apps/web/src/styles.css | .investment-review__document-assignment label | gap: 10px
apps/web/src/styles.css | .investment-review__document-details | gap: 6px
apps/web/src/styles.css | .investment-review__document-details | padding-left: 28px
apps/web/src/styles.css | .investment-review__section .section-heading h3 | font-size: 18px
apps/web/src/styles.css | .investment-review__section > button | font-weight: 700
apps/web/src/styles.css | .investment-review__summary p | margin: 6px 0 0
apps/web/src/styles.css | .investment-terms .position-economics__fields + p | margin: 16px 0 28px
apps/web/src/styles.css | .investment-terms h4, .investment-calculation h4 | font-size: 16px
apps/web/src/styles.css | .investment-views | padding: 38px 0 12px
apps/web/src/styles.css | .investment-views__empty h3 | font-size: 18px
apps/web/src/styles.css | .investment-views__empty h3 | margin-bottom: 5px
apps/web/src/styles.css | .investment-views__error.notice | padding: 18px
apps/web/src/styles.css | .investment-views__heading h2 | font-size: 34px
apps/web/src/styles.css | .manual-holding-section h2 | font-size: 20px
apps/web/src/styles.css | .position-economics--review .position-economics__primary .is-not-set | font-size: 18px
apps/web/src/styles.css | .position-economics--review .position-economics__primary strong | font-size: clamp(22px, 2.5vw, 32px)
apps/web/src/styles.css | .position-economics--review .position-economics__secondary strong | font-size: 20px
apps/web/src/styles.css | .position-economics--review .position-economics__values span | font-size: 11px
apps/web/src/styles.css | .position-economics__fields | gap: 22px 28px
apps/web/src/styles.css | .position-economics__form, .position-economics__review | margin-top: 28px
apps/web/src/styles.css | .position-economics__heading h3 | margin-top: 3px
apps/web/src/styles.css | .position-economics__heading p:last-child | font-size: 9px
apps/web/src/styles.css | .position-economics__review > div:not(.position-economics__actions) | gap: 7px
apps/web/src/styles.css | .position-economics__review > small | font-size: 8px
apps/web/src/styles.css | .position-economics__review strong | font-size: 20px
apps/web/src/styles.css | .position-economics__rows > div | padding: 10px 0
apps/web/src/styles.css | .position-economics__rows strong, .position-economics__rows strong.is-not-set | font-weight: 550
apps/web/src/styles.css | .position-economics__rows | margin-top: 18px
apps/web/src/styles.css | .position-economics__values article, .holding-performance__values article | padding: 14px 0 8px
apps/web/src/styles.css | .position-economics__values small, .holding-performance__values small | font-size: 8px
apps/web/src/styles.css | .position-economics__values small, .holding-performance__values small | margin-top: 9px
apps/web/src/styles.css | .position-economics__values span, .holding-performance__values span, .position-economics__review span | font-size: 8px
apps/web/src/styles.css | .position-economics__values strong, .holding-performance__values strong | font-size: clamp(18px, 2vw, 25px)
apps/web/src/styles.css | .position-economics__values strong, .holding-performance__values strong | font-weight: 620
apps/web/src/styles.css | .position-economics__values strong.is-not-set, .holding-performance__values strong.is-not-set | font-size: 16px
apps/web/src/styles.css | .position-economics__values strong.is-not-set, .holding-performance__values strong.is-not-set | font-weight: 550
apps/web/src/styles.css | .position-economics__values, .holding-performance__values | gap: 28px
apps/web/src/styles.css | .position-economics__values, .holding-performance__values | margin-top: 18px
apps/web/src/styles.css | .position-links .data-list__label | font-size: 11px
apps/web/src/styles.css | .position-links .data-list__label | margin-bottom: 0.35rem
apps/web/src/styles.css | .position-links .data-list__value small | margin-top: 0.3rem
apps/web/src/styles.css | .position-links-heading h3 | font-size: 16px
apps/web/src/styles.css | .position-valuation__toggle > span:first-child | gap: 6px
apps/web/src/styles.css | .position-valuation__toggle > span:nth-child(2) | gap: 6px
apps/web/src/styles.css | .position-valuation__toggle strong | font-size: 16px
apps/web/src/styles.css | .position-value-adjustment > .form-message | margin: 14px 0 0
apps/web/src/styles.css | .position-value-adjustment, .holding-reviewed-mark | padding-top: 28px
apps/web/src/styles.css | .position-value-adjustment__fields | gap: 22px 28px
apps/web/src/styles.css | .position-value-adjustment__form, .position-value-adjustment__review | margin-top: 28px
apps/web/src/styles.css | .position-value-adjustment__heading h3, .holding-reviewed-mark h3 | margin-top: 3px
apps/web/src/styles.css | .position-value-adjustment__heading p:last-child | font-size: 9px
apps/web/src/styles.css | .position-value-adjustment__review .keel-link, .holding-reviewed-mark .keel-link | font-size: 9px
apps/web/src/styles.css | .position-value-adjustment__review .keel-link, .holding-reviewed-mark .keel-link | font-weight: 700
apps/web/src/styles.css | .position-value-adjustment__review > div:first-child | gap: 7px
apps/web/src/styles.css | .position-value-adjustment__review > small | font-weight: 500
apps/web/src/styles.css | .position-value-adjustment__review span, .position-value-adjustment__review small, .holding-reviewed-mark dt | font-size: 8px
apps/web/src/styles.css | .position-value-adjustment__review strong | font-size: 24px
apps/web/src/styles.css | .private-exposure-exact-batch > div | gap: 6px
apps/web/src/styles.css | .private-exposure-exact-batch h4 | font-size: 16px
apps/web/src/styles.css | .private-exposure-exact-batch p | font-size: 9px
apps/web/src/styles.css | .private-exposure-exact-batch | margin: 4px 0 10px
apps/web/src/styles.css | .private-exposure-exact-batch | padding: 22px 0
apps/web/src/styles.css | .private-exposure-review > p[role="alert"] | font-weight: 750
apps/web/src/styles.css | .private-exposure-review fieldset | gap: 10px
apps/web/src/styles.css | .private-exposure-review label small | font-weight: 500
apps/web/src/styles.css | .private-exposure-review label | font-size: 8px
apps/web/src/styles.css | .private-exposure-review label | gap: 6px
apps/web/src/styles.css | .private-exposure-review legend | font-size: 8px
apps/web/src/styles.css | .private-exposure-review legend | margin-bottom: 6px
apps/web/src/styles.css | .private-exposure-review | gap: 18px
apps/web/src/styles.css | .private-exposure-review | padding: 22px 0 26px 22px
apps/web/src/styles.css | .private-exposure-review__heading > p, .private-exposure-review > p, .private-exposure-review__notice | font-size: 9px
apps/web/src/styles.css | .private-exposure-review__heading h4 | font-size: 16px
apps/web/src/styles.css | .private-exposure-review__heading h4 | margin: 3px 0 0
apps/web/src/styles.css | .private-exposure-review__notice | font-weight: 750
apps/web/src/styles.css | .private-exposure-review__notice | padding: 16px 0 2px
apps/web/src/styles.css | .private-exposure-review__open.button | padding: 0 14px
apps/web/src/styles.css | .purchase-actions | margin-top: 28px
apps/web/src/styles.css | .purchase-benchmark strong small | font-size: 11px
apps/web/src/styles.css | .purchase-benchmark strong | font-size: 18px
apps/web/src/styles.css | .purchase-benchmark | margin-top: 28px
apps/web/src/styles.css | .purchase-benchmark__label | font-size: 11px
apps/web/src/styles.css | .purchase-benchmark__label | margin-bottom: 6px
apps/web/src/styles.css | .purchase-cost .stat__detail | font-size: 11px
apps/web/src/styles.css | .purchase-cost .stat__detail | margin-top: 10px
apps/web/src/styles.css | .purchase-cost .stat__label, .purchase-reported-terms .stat__label | font-weight: 500
apps/web/src/styles.css | .purchase-cost .stat__value | font-size: clamp(22px, 4.6cqi, 36px)
apps/web/src/styles.css | .purchase-cost .stat__value | font-weight: 550
apps/web/src/styles.css | .purchase-cost__operator | font-size: 22px
apps/web/src/styles.css | .purchase-cost__operator | font-weight: 300
apps/web/src/styles.css | .purchase-cost__operator | padding-top: 30px
apps/web/src/styles.css | .purchase-cost__total .stat__value | font-weight: 750
apps/web/src/styles.css | .purchase-coverage, .purchase-fields label:has(input[type="checkbox"]) | gap: 10px
apps/web/src/styles.css | .purchase-details .purchase-collection-heading | margin: 28px 0 20px
apps/web/src/styles.css | .purchase-details--summary .purchase-cost .stat__value | font-size: 26px
apps/web/src/styles.css | .purchase-details--summary .purchase-summary + .purchase-summary | padding-top: 18px
apps/web/src/styles.css | .purchase-details--summary .purchase-summary__layout | gap: 28px
apps/web/src/styles.css | .purchase-proxy-confirmation .stat__value | font-size: 32px
apps/web/src/styles.css | .purchase-reported-terms .stat__value | font-size: 23px
apps/web/src/styles.css | .purchase-reported-terms .stat__value | font-weight: 550
apps/web/src/styles.css | .purchase-reported-terms | gap: 10px
apps/web/src/styles.css | .purchase-summary .purchase-benchmark p | font-size: 11px
apps/web/src/styles.css | .purchase-summary .purchase-benchmark p | margin: 5px 0 0
apps/web/src/styles.css | .purchase-summary .purchase-summary__context p | font-size: 11px
apps/web/src/styles.css | .purchase-summary .purchase-summary__explanation | font-size: 11px
apps/web/src/styles.css | .purchase-summary__details .data-list__label | font-size: 16px
apps/web/src/styles.css | .purchase-summary__details .data-list__value | font-size: 16px
apps/web/src/styles.css | .purchase-summary__heading [data-slot="collapsible-trigger"] | font-size: 16px
apps/web/src/styles.css | .purchase-summary__layout | gap: 48px
apps/web/src/styles.css | .purchase-summary__layout | margin: 28px 0
apps/web/src/styles.css | .purchase-summary__terms small | font-size: 11px
apps/web/src/styles.css | .purchase-summary__terms small | margin-top: 3px
apps/web/src/styles.css | .purchase-summary__terms | gap: 10px
apps/web/src/styles.css | .purchase-valuation-prompt p | margin: 6px 0 0
apps/web/src/styles.css | .share-valuation form | gap: 28px
apps/web/src/styles.css | .share-valuation__prices h3 | font-size: 16px
apps/web/src/styles.css | .share-valuation__share-details h4 | font-size: 16px
apps/web/src/styles.css | .spv-holding h3, .brokerage-holding .holding-history h3 | font-size: 24px
apps/web/src/styles.css | .spv-holding h4 | font-size: 16px
apps/web/src/styles.css | .valuation-comparison tfoot | font-size: 18px
apps/web/src/styles.css | .valuation-comparison tfoot | font-weight: 650
apps/web/src/styles.css | @media (max-width: 620px) › .exposure-group__value | font-size: 17px
apps/web/src/styles.css | @media (max-width: 620px) › .exposure-row | column-gap: 14px
apps/web/src/styles.css | @media (max-width: 620px) › .holding-detail-heading h2 | font-size: 36px
apps/web/src/styles.css | @media (max-width: 620px) › .holding-detail-value > strong | font-size: 24px
apps/web/src/styles.css | @media (max-width: 620px) › .holding-detail-values | gap: 12px 22px
apps/web/src/styles.css | @media (max-width: 620px) › .holding-detail-workspace | gap: 44px
apps/web/src/styles.css | @media (max-width: 620px) › .holding-row-action i | font-size: 7px
apps/web/src/styles.css | @media (max-width: 620px) › .investment-institution | padding: 22px 0
apps/web/src/styles.css | @media (max-width: 620px) › .investment-institution__account | gap: 14px
apps/web/src/styles.css | @media (max-width: 620px) › .investment-institution__account | padding: 14px 0
apps/web/src/styles.css | @media (max-width: 620px) › .investment-institution__value | font-size: 15px
apps/web/src/styles.css | @media (max-width: 620px) › .investment-institutions | gap: 18px
apps/web/src/styles.css | @media (max-width: 620px) › .investment-institutions | padding: 26px 0
apps/web/src/styles.css | @media (max-width: 620px) › .investment-views | padding-top: 30px
apps/web/src/styles.css | @media (max-width: 620px) › .position-economics__heading | gap: 18px
apps/web/src/styles.css | @media (max-width: 620px) › .position-economics__values, .holding-performance__values | gap: 12px 22px
apps/web/src/styles.css | @media (max-width: 620px) › .position-value-adjustment__heading | gap: 18px
apps/web/src/styles.css | @media (max-width: 700px) › .manual-holding-form .input | font-size: 16px
apps/web/src/styles.css | @media (max-width: 760px) › .distribution-amount strong | font-size: 22px
apps/web/src/styles.css | @media (max-width: 760px) › .holding-investment, .holding-history | margin-top: 36px
apps/web/src/styles.css | @media (max-width: 760px) › .holding-value-summary | gap: 28px 20px
apps/web/src/styles.css | @media (max-width: 767px) › .holding-detail-workspace--editing .holding-headline__values .stat__value, .holding-detail-workspace--editing .holding-headline__primary .stat__value | font-size: clamp(14px, 4.6vw, 18px)
apps/web/src/styles.css | @media (max-width: 767px) › .holding-edit-purchases | margin: -10px 0 24px
apps/web/src/styles.css | @media (max-width: 767px) › .investment-calculation > .data-list | gap: 18px
apps/web/src/styles.css | @media (max-width: 767px) › .position-valuation__draft | margin-left: 28px
apps/web/src/styles.css | @media (max-width: 767px) › .purchase-cost .stat__value | font-size: 22px
apps/web/src/styles.css | @media (max-width: 767px) › .purchase-cost .stat__value | font-weight: 500
apps/web/src/styles.css | @media (max-width: 767px) › .purchase-cost | gap: 16px 10px
apps/web/src/styles.css | @media (max-width: 767px) › .purchase-cost__operator | font-size: 18px
apps/web/src/styles.css | @media (max-width: 767px) › .purchase-cost__operator | padding: 5px 0 0
apps/web/src/styles.css | @media (max-width: 767px) › .purchase-cost__total .stat__value | font-size: 28px
apps/web/src/styles.css | @media (max-width: 767px) › .purchase-cost__total .stat__value | font-weight: 750
apps/web/src/styles.css | @media (min-width: 768px) › .purchase-cost__operator | padding-top: 44px
```

## Holdings sources and imports

47 spacing, 44 typography.

```text
apps/web/src/styles.css | .angellist-handoff-input__status | font-size: 9px
apps/web/src/styles.css | .angellist-input-form > div | gap: 7px
apps/web/src/styles.css | .angellist-input-form input | padding: 0 11px
apps/web/src/styles.css | .angellist-input-form label > span | font-size: 9px
apps/web/src/styles.css | .angellist-input-form label > span | margin-bottom: 7px
apps/web/src/styles.css | .angellist-input-form | gap: 9px
apps/web/src/styles.css | .angellist-input-form | padding-top: 18px
apps/web/src/styles.css | .angellist-sign-in | gap: 48px
apps/web/src/styles.css | .angellist-sign-in__error | margin-left: 18px
apps/web/src/styles.css | .angellist-sign-in__heading h2 | font-size: clamp(20px, 2.4vw, 28px)
apps/web/src/styles.css | .angellist-sign-in__heading h2 | font-weight: 630
apps/web/src/styles.css | .angellist-sign-in__workflow | gap: 18px
apps/web/src/styles.css | .holding-import-loading | font-size: 11px
apps/web/src/styles.css | .holding-import-loading | padding: 36px 0
apps/web/src/styles.css | .holding-import-pending h2 | font-size: clamp(20px, 2.4vw, 28px)
apps/web/src/styles.css | .holding-import-pending h2 | font-weight: 630
apps/web/src/styles.css | .holding-import-pending | gap: 48px
apps/web/src/styles.css | .holding-import-pending__items > div | gap: 18px
apps/web/src/styles.css | .holding-import-pending__items small | font-size: 8px
apps/web/src/styles.css | .holding-import-pending__items small | margin-top: 5px
apps/web/src/styles.css | .holding-import-pending__items strong | font-size: 11px
apps/web/src/styles.css | .holding-import-workspace | gap: 34px
apps/web/src/styles.css | .holding-import-workspace | padding: 8px 3px 24px
apps/web/src/styles.css | .import-attention | margin: -7px 0 0
apps/web/src/styles.css | .import-confirmation .eyebrow | margin-bottom: 6px
apps/web/src/styles.css | .import-confirmation h3 | font-size: 15px
apps/web/src/styles.css | .import-confirmation p, .import-confirmation small | font-size: 9px
apps/web/src/styles.css | .import-confirmation small | margin-top: 7px
apps/web/src/styles.css | .import-confirmation | padding: 18px 20px
apps/web/src/styles.css | .import-currency-confirmation input | margin: 1px 0 0
apps/web/src/styles.css | .import-currency-confirmation | font-weight: 700
apps/web/src/styles.css | .import-currency-confirmation | gap: 10px
apps/web/src/styles.css | .import-footer span | font-size: 8px
apps/web/src/styles.css | .import-footer span | margin-top: 5px
apps/web/src/styles.css | .import-footer strong | font-size: 11px
apps/web/src/styles.css | .import-heading > p:last-child, .import-message > p | font-size: 11px
apps/web/src/styles.css | .import-heading h2, .import-message h2 | font-size: clamp(25px, 3vw, 34px)
apps/web/src/styles.css | .import-heading h2, .import-message h2 | font-weight: 630
apps/web/src/styles.css | .import-heading h2, .import-message h2 | margin-bottom: 11px
apps/web/src/styles.css | .import-message small | font-size: 9px
apps/web/src/styles.css | .import-message small | margin-top: 9px
apps/web/src/styles.css | .import-pagination > div | gap: 10px
apps/web/src/styles.css | .import-pagination | font-size: 8px
apps/web/src/styles.css | .import-pagination | font-weight: 750
apps/web/src/styles.css | .import-pagination | gap: 18px
apps/web/src/styles.css | .import-result small | font-size: 8px
apps/web/src/styles.css | .import-result small | margin-top: 7px
apps/web/src/styles.css | .import-row-decision | font-size: 8px
apps/web/src/styles.css | .import-row-decision | font-weight: 750
apps/web/src/styles.css | .import-row-decision | gap: 7px
apps/web/src/styles.css | .import-row-decision | margin-top: 7px
apps/web/src/styles.css | .import-summary span | font-size: 8px
apps/web/src/styles.css | .import-summary span | margin-top: 7px
apps/web/src/styles.css | .import-summary strong | font-size: clamp(28px, 3vw, 38px)
apps/web/src/styles.css | .import-summary strong | font-weight: 620
apps/web/src/styles.css | .import-summary | gap: 44px
apps/web/src/styles.css | .import-template-help small | font-size: 9px
apps/web/src/styles.css | .import-template-help | gap: 14px
apps/web/src/styles.css | .import-upload input[type="file"] | padding: 6px 0
apps/web/src/styles.css | .import-upload input[type="file"]::file-selector-button | margin-right: 13px
apps/web/src/styles.css | .import-upload input[type="file"]::file-selector-button | padding: 0 13px
apps/web/src/styles.css | .import-value--locked | font-weight: 700
apps/web/src/styles.css | .provider-agent-row__heading .provider-agent-row__meta | margin: 6px 0 0
apps/web/src/styles.css | .provider-agent-row__heading .provider-agent-row__status | font-weight: 500
apps/web/src/styles.css | .provider-agent-row__heading h3 | font-size: 16px
apps/web/src/styles.css | .provider-agent-row__heading h3 | font-weight: 650
apps/web/src/styles.css | .provider-agent-row__heading h3 | margin: 0 0 6px
apps/web/src/styles.css | .provider-agent-row__interval .select-trigger | font-weight: 700
apps/web/src/styles.css | .provider-agent-row__interval > span | font-size: 8px
apps/web/src/styles.css | .provider-agent-row__interval | gap: 7px
apps/web/src/styles.css | .provider-agent-row__setup code | font-size: 9px
apps/web/src/styles.css | .provider-agent-troubleshooting p, .provider-agent-troubleshooting .button, .provider-agent-troubleshooting code | margin-top: 6px
apps/web/src/styles.css | .provider-agent-troubleshooting__trigger | font-size: 9px
apps/web/src/styles.css | .provider-agent-troubleshooting__trigger | font-weight: 700
apps/web/src/styles.css | .provider-agents | gap: 64px
apps/web/src/styles.css | .provider-agents__heading h2 | font-size: clamp(20px, 2.4vw, 28px)
apps/web/src/styles.css | .provider-agents__heading h2 | font-weight: 630
apps/web/src/styles.css | .public-source-decision h3 | font-size: 22px
apps/web/src/styles.css | .public-source-decision h4 | font-weight: 500
apps/web/src/styles.css | .public-source-decision h4 | margin: 0 0 10px
apps/web/src/styles.css | .public-source-decision__compare p | margin: 6px 0
apps/web/src/styles.css | .source-update-screen .page-header h1 | font-size: clamp(32px, 4vw, 48px)
apps/web/src/styles.css | .source-update-screen .page-header | margin-bottom: 36px
apps/web/src/styles.css | @media (max-width: 620px) › .holding-import-workspace | gap: 28px
apps/web/src/styles.css | @media (max-width: 620px) › .import-confirmation | padding: 17px
apps/web/src/styles.css | @media (max-width: 620px) › .import-row-decision | font-size: 9px
apps/web/src/styles.css | @media (max-width: 620px) › .import-summary span | font-size: 7px
apps/web/src/styles.css | @media (max-width: 620px) › .import-summary strong | font-size: 28px
apps/web/src/styles.css | @media (max-width: 620px) › .import-summary | gap: 14px
apps/web/src/styles.css | @media (max-width: 620px) › .provider-agent-row | gap: 14px
apps/web/src/styles.css | @media (max-width: 620px) › .provider-agents | padding: 28px 0
```

## Legal entities and ownership

31 spacing, 23 typography.

```text
apps/web/src/styles.css | .company-names__suggestions, .company-names__review | margin-top: 3rem
apps/web/src/styles.css | .entity-review .page-intro h1 | font-size: clamp(28px, 4vw, 44px)
apps/web/src/styles.css | .entity-review--investment .page-intro h1 | font-size: clamp(28px, 3vw, 36px)
apps/web/src/styles.css | .entity-review__destination legend | font-weight: 700
apps/web/src/styles.css | .entity-review__panel | gap: 36px
apps/web/src/styles.css | .entity-review__panel | padding-block: 28px
apps/web/src/styles.css | .entity-review__profile .entity-review__ownership | font-size: clamp(20px, 2vw, 24px)
apps/web/src/styles.css | .entity-review__profile | gap: 28px
apps/web/src/styles.css | .legal-entities .section-heading h2 | font-size: clamp(24px, 3vw, 34px)
apps/web/src/styles.css | .legal-entities .section-heading h2 | font-weight: 620
apps/web/src/styles.css | .legal-entities .section-heading | gap: 8px 28px
apps/web/src/styles.css | .legal-entities__candidates > h2 > [data-slot="collapsible-trigger"] | font-size: 16px
apps/web/src/styles.css | .legal-entities__excluded > [data-slot="collapsible-trigger"] | font-size: 9px
apps/web/src/styles.css | .legal-entities__excluded > [data-slot="collapsible-trigger"] | font-weight: 750
apps/web/src/styles.css | .legal-entities__excluded | margin-top: 22px
apps/web/src/styles.css | .legal-entities__header h1 | font-size: clamp(32px, 4vw, 52px)
apps/web/src/styles.css | .legal-entities__loading | padding: 42px 0
apps/web/src/styles.css | .legal-entity-candidate h3 | font-size: 15px
apps/web/src/styles.css | .legal-entity-candidate h3, .legal-entity-export h3 | font-weight: 700
apps/web/src/styles.css | .legal-entity-candidate | gap: 24px 48px
apps/web/src/styles.css | .legal-entity-candidate__copy > div:first-child | gap: 10px
apps/web/src/styles.css | .legal-entity-candidate__copy p, .legal-entity-export__scope p, .legal-entity-editor__actions p, .legal-entity-export__actions p | font-size: 9px
apps/web/src/styles.css | .legal-entity-candidate__copy p, .legal-entity-export__scope p, .legal-entity-editor__actions p, .legal-entity-export__actions p | margin: 6px 0 0
apps/web/src/styles.css | .legal-entity-candidate__link .select-trigger | font-size: 9px
apps/web/src/styles.css | .legal-entity-candidate__link .select-trigger | padding: 0 26px 0 0
apps/web/src/styles.css | .legal-entity-candidate__link | gap: 10px
apps/web/src/styles.css | .legal-entity-documents | font-size: 11px
apps/web/src/styles.css | .legal-entity-documents--review article > .keel-link | font-size: 16px
apps/web/src/styles.css | .legal-entity-editor form | margin-top: 28px
apps/web/src/styles.css | .legal-entity-editor__actions | margin-top: 28px
apps/web/src/styles.css | .legal-entity-editor__fields | gap: 26px 30px
apps/web/src/styles.css | .legal-entity-exact-batch h3 | font-size: 16px
apps/web/src/styles.css | .legal-entity-exact-batch__summary | gap: 6px
apps/web/src/styles.css | .legal-entity-export, .legal-entity-editor | padding-top: 38px
apps/web/src/styles.css | .legal-entity-export__fields | margin-top: 28px
apps/web/src/styles.css | .legal-entity-export__scope | gap: 12px 28px
apps/web/src/styles.css | .legal-entity-export__scope | margin-top: 26px
apps/web/src/styles.css | .legal-entity-export__scope | padding: 18px 0
apps/web/src/styles.css | .legal-entity-row | padding-inline: var(--space-4) calc(44px + var(--space-2))
apps/web/src/styles.css | .legal-name-resolver h4 | font-size: 20px
apps/web/src/styles.css | .legal-name-resolver legend | font-weight: 700
apps/web/src/styles.css | .legal-name-resolver__choice input | margin-top: 2px
apps/web/src/styles.css | .legal-name-resolver__choice | padding: 14px 0
apps/web/src/styles.css | .ownership-evidence__source h4 | font-size: 16px
apps/web/src/styles.css | .ownership-evidence__source | gap: 6px
apps/web/src/styles.css | .ownership-evidence__values .data-list__value | font-size: 28px
apps/web/src/styles.css | .ownership-evidence__values .data-list__value | font-weight: 700
apps/web/src/styles.css | .ownership-evidence__values .data-list__value | margin-top: 6px
apps/web/src/styles.css | .ownership-evidence__values--k1 .data-list__value | font-size: 20px
apps/web/src/styles.css | @media (max-width: 620px) › .legal-entities .section-heading > .button | margin-top: 10px
apps/web/src/styles.css | @media (max-width: 620px) › .legal-entities | gap: 28px
apps/web/src/styles.css | @media (max-width: 620px) › .legal-entity-export, .legal-entity-editor | padding-top: 30px
apps/web/src/styles.css | @media (max-width: 620px) › .legal-entity-export__field-grid | column-gap: 18px
apps/web/src/styles.css | @media (max-width: 980px) › .legal-entity-candidate | gap: 22px
```

## Obligations

34 spacing, 19 typography.

```text
apps/web/src/styles.css | .manual-obligation footer, .obligation-review__actions | margin-top: 28px
apps/web/src/styles.css | .manual-obligation footer, .obligation-review__actions | padding-top: 18px
apps/web/src/styles.css | .manual-obligation form | margin-top: 26px
apps/web/src/styles.css | .manual-obligation h2, .obligation-review__heading h2, .obligations-pending h2, .reviewed-obligations h2, .obligation-sources h2 | font-size: clamp(21px, 2.4vw, 29px)
apps/web/src/styles.css | .manual-obligation h2, .obligation-review__heading h2, .obligations-pending h2, .reviewed-obligations h2, .obligation-sources h2 | font-weight: 630
apps/web/src/styles.css | .manual-obligation h2, .obligation-review__heading h2, .obligations-pending h2, .reviewed-obligations h2, .obligation-sources h2 | margin: 0 0 9px
apps/web/src/styles.css | .manual-obligation, .obligation-review, .obligations-pending, .reviewed-obligations, .obligation-sources | margin-top: 38px
apps/web/src/styles.css | .manual-obligation__fields | gap: 24px 34px
apps/web/src/styles.css | .obligation-review__decision .select-trigger | font-size: 9px
apps/web/src/styles.css | .obligation-review__decision label | font-size: 9px
apps/web/src/styles.css | .obligation-review__decision label | font-weight: 700
apps/web/src/styles.css | .obligation-review__decision | gap: 10px
apps/web/src/styles.css | .obligation-review__facts strong, .reviewed-obligations__list > article > div:nth-child(2) strong | margin-top: 6px
apps/web/src/styles.css | .obligation-review__facts, .reviewed-obligations__list > article > div:nth-child(2) | gap: 18px
apps/web/src/styles.css | .obligation-review__identity > p | font-size: 8px
apps/web/src/styles.css | .obligation-review__identity > p | margin: 9px 0 0
apps/web/src/styles.css | .obligation-review__identity > small, .reviewed-obligations__list > article > div:first-child > small | font-size: 8px
apps/web/src/styles.css | .obligation-review__identity > small, .reviewed-obligations__list > article > div:first-child > small | margin-top: 6px
apps/web/src/styles.css | .obligation-review__identity > span, .reviewed-obligations__list > article > div:first-child > span | font-size: 8px
apps/web/src/styles.css | .obligation-review__identity > strong, .reviewed-obligations__list > article > div:first-child > strong | margin-top: 6px
apps/web/src/styles.css | .obligation-review__impact i | font-size: 8px
apps/web/src/styles.css | .obligation-review__impact strong | font-size: 19px
apps/web/src/styles.css | .obligation-review__impact strong | margin: 8px 0 6px
apps/web/src/styles.css | .obligation-review__impact | margin-top: 26px
apps/web/src/styles.css | .obligation-review__note | margin-top: 28px
apps/web/src/styles.css | .obligation-review__rows article | padding: 22px 0
apps/web/src/styles.css | .obligation-review__rows | margin-top: 30px
apps/web/src/styles.css | .obligation-sources > div > div | gap: 9px
apps/web/src/styles.css | .obligation-sources em | margin-top: 10px
apps/web/src/styles.css | .obligation-sources__cost | font-size: 8px
apps/web/src/styles.css | .obligation-sources__cost | margin-top: 17px
apps/web/src/styles.css | .obligations-impact article | padding: 25px 22px 27px
apps/web/src/styles.css | .obligations-impact article:first-child | padding-left: 3px
apps/web/src/styles.css | .obligations-impact small | font-size: 8px
apps/web/src/styles.css | .obligations-impact span, .obligation-review__impact small, .obligation-review__facts small, .reviewed-obligations__list > article > div:nth-child(2) small | font-size: 8px
apps/web/src/styles.css | .obligations-impact strong | font-size: clamp(22px, 2.6vw, 32px)
apps/web/src/styles.css | .obligations-impact strong | font-weight: 620
apps/web/src/styles.css | .obligations-impact strong | margin: 11px 0 8px
apps/web/src/styles.css | .obligations-page__setup, .obligations-page__notice, .obligations-page__error | margin: -8px 3px 10px
apps/web/src/styles.css | .obligations-pending > div, .obligation-sources > div | gap: 28px
apps/web/src/styles.css | .obligations-pending > div, .obligation-sources > div | padding: 17px 0
apps/web/src/styles.css | .obligations-pending small, .obligation-sources small, .obligation-sources em | font-size: 8px
apps/web/src/styles.css | .obligations-pending small, .obligation-sources small, .obligation-sources em | margin-top: 5px
apps/web/src/styles.css | .obligations-pending strong, .obligation-sources strong | font-size: 11px
apps/web/src/styles.css | .reviewed-obligations > header > span | font-size: 8px
apps/web/src/styles.css | .reviewed-obligations__list > article | gap: 34px
apps/web/src/styles.css | .reviewed-obligations__list | margin-top: 18px
apps/web/src/styles.css | .reviewed-obligations__status small | font-size: 8px
apps/web/src/styles.css | .reviewed-obligations__status | gap: 7px
apps/web/src/styles.css | @media (max-width: 620px) › .manual-obligation, .obligation-review, .obligations-pending, .reviewed-obligations, .obligation-sources | margin-top: 30px
apps/web/src/styles.css | @media (max-width: 620px) › .manual-obligation, .obligation-review, .obligations-pending, .reviewed-obligations, .obligation-sources | padding-top: 26px
apps/web/src/styles.css | @media (max-width: 620px) › .obligation-review__impact > span | padding: 18px 14px
apps/web/src/styles.css | @media (max-width: 620px) › .obligations-pending > div, .obligation-sources > div | gap: 14px
```

## Other and shared app layouts

33 spacing, 38 typography.

```text
apps/web/src/styles.css | #fi-eligible-liquid-help | font-size: 9px
apps/web/src/styles.css | #fi-eligible-liquid-help | margin: -17px 0 0
apps/web/src/styles.css | .chart-axis-label | font-size: 8px
apps/web/src/styles.css | .chart-axis-label | font-weight: 700
apps/web/src/styles.css | .chart-instruction | font-size: 8px
apps/web/src/styles.css | .chart-instruction | margin: -4px 0 9px
apps/web/src/styles.css | .chart-kpis span | font-size: 8px
apps/web/src/styles.css | .chart-kpis strong | font-size: 24px
apps/web/src/styles.css | .chart-kpis strong | margin-top: 2px
apps/web/src/styles.css | .chart-kpis | gap: 38px
apps/web/src/styles.css | .chart-kpis | margin-bottom: -3px
apps/web/src/styles.css | .chart-label | font-size: 9px
apps/web/src/styles.css | .chart-label | font-weight: 700
apps/web/src/styles.css | .chart-legend span | gap: 5px
apps/web/src/styles.css | .chart-legend | font-size: 8px
apps/web/src/styles.css | .chart-legend | font-weight: 700
apps/web/src/styles.css | .chart-tooltip text | font-size: 9px
apps/web/src/styles.css | .chart-tooltip text | font-weight: 650
apps/web/src/styles.css | .data-table td | font-size: 11px
apps/web/src/styles.css | .data-table td | padding: 20px 18px
apps/web/src/styles.css | .data-table td:first-child span, .source-meta | font-size: 8px
apps/web/src/styles.css | .data-table td:first-child strong | margin-bottom: 5px
apps/web/src/styles.css | .data-table td:first-child | padding-left: 26px
apps/web/src/styles.css | .data-table th | font-size: 8px
apps/web/src/styles.css | .data-table th | padding: 0 18px
apps/web/src/styles.css | .data-table th:first-child | padding-left: 26px
apps/web/src/styles.css | .forecast-impact strong | font-size: 22px
apps/web/src/styles.css | .hero h1 | font-size: clamp(42px, 5vw, 64px)
apps/web/src/styles.css | .hero h1 | font-weight: 590
apps/web/src/styles.css | .hero h1 | margin-bottom: 18px
apps/web/src/styles.css | .hero | gap: 48px
apps/web/src/styles.css | .hero | padding: 42px 44px
apps/web/src/styles.css | .loading-brand | font-size: 22px
apps/web/src/styles.css | .loading-brand | font-weight: 650
apps/web/src/styles.css | .loading-card h1 | font-size: 28px
apps/web/src/styles.css | .loading-card p | font-size: 11px
apps/web/src/styles.css | .loading-shell, .fatal-error | padding: 35px
apps/web/src/styles.css | .panel-link | font-size: 9px
apps/web/src/styles.css | .panel-link | font-weight: 750
apps/web/src/styles.css | .panel-note | font-size: 9px
apps/web/src/styles.css | .panel-note | margin: 14px 0 0
apps/web/src/styles.css | .portfolio-access-detail | padding: 36px 0 28px
apps/web/src/styles.css | .portfolio-access-detail__heading h2 | font-size: clamp(22px, 2.8vw, 34px)
apps/web/src/styles.css | .portfolio-access-detail__heading h2 | font-weight: 630
apps/web/src/styles.css | .portfolio-access-detail__heading h2:focus-visible | padding-left: 10px
apps/web/src/styles.css | .portfolio-access-detail__more > span | font-size: 9px
apps/web/src/styles.css | .portfolio-access-detail__rows article | padding: 10px 0
apps/web/src/styles.css | .portfolio-access-detail__rows small | font-size: 8px
apps/web/src/styles.css | .portfolio-access-detail__rows strong | font-size: 11px
apps/web/src/styles.css | .portfolio-access-detail__total > span | font-size: 8px
apps/web/src/styles.css | .portfolio-access-detail__total > span | margin-top: 3px
apps/web/src/styles.css | .portfolio-access-detail__total small | font-size: 8px
apps/web/src/styles.css | .portfolio-access-detail__total strong | font-size: 18px
apps/web/src/styles.css | .portfolio-movers h3 | font-weight: 750
apps/web/src/styles.css | .portfolio-movers | gap: 48px
apps/web/src/styles.css | .portfolio-movers__empty | font-size: 9px
apps/web/src/styles.css | .portfolio-movers__empty | margin: 22px 0
apps/web/src/styles.css | .source-meta | margin-top: 7px
apps/web/src/styles.css | .zero-probabilities span | font-size: 8px
apps/web/src/styles.css | .zero-probabilities span | padding: 13px 10px
apps/web/src/styles.css | @media (max-width: 620px) › .data-table td, .data-table td:first-child | padding: 10px 7px
apps/web/src/styles.css | @media (max-width: 620px) › .data-table td::before | font-size: 7px
apps/web/src/styles.css | @media (max-width: 620px) › .data-table td::before | margin-bottom: 5px
apps/web/src/styles.css | @media (max-width: 620px) › .data-table td:first-child | padding-bottom: 14px
apps/web/src/styles.css | @media (max-width: 620px) › .data-table tr | padding: 18px 19px
apps/web/src/styles.css | @media (max-width: 620px) › .hero h1 | font-size: 42px
apps/web/src/styles.css | @media (max-width: 620px) › .portfolio-access-detail | padding-top: 30px
apps/web/src/styles.css | @media (max-width: 620px) › .portfolio-access-detail__heading | gap: 14px
apps/web/src/styles.css | @media (max-width: 620px) › .portfolio-movers | gap: 30px
apps/web/src/styles.css | @media (max-width: 620px) › .zero-probabilities span | padding: 9px 0
apps/web/src/styles.css | @media (max-width: 980px) › .hero | padding: 34px 30px
```

## Overview and portfolio summaries

24 spacing, 15 typography.

```text
apps/web/src/styles.css | .hero .keel-link.hero__action | margin-top: 22px
apps/web/src/styles.css | .hero-carousel__footer | padding: 0 44px 24px
apps/web/src/styles.css | .hero__measure-unit | font-size: 0.5em
apps/web/src/styles.css | .hero__runway > span | font-size: 8px
apps/web/src/styles.css | .hero__runway > span | font-weight: 750
apps/web/src/styles.css | .hero__runway small | font-size: 9px
apps/web/src/styles.css | .hero__runway strong | font-size: clamp(36px, 4vw, 56px)
apps/web/src/styles.css | .hero__runway strong | margin: 8px 0 5px
apps/web/src/styles.css | .hero__runway | padding: 30px 0 8px 33px
apps/web/src/styles.css | .hero__slide | gap: 48px
apps/web/src/styles.css | .hero__slide | padding: 42px 44px 14px
apps/web/src/styles.css | .portfolio-chart__value-label | font-size: 8px
apps/web/src/styles.css | .portfolio-chart__value-label | font-weight: 720
apps/web/src/styles.css | .portfolio-liquidity-chart | margin: 4px 0 10px
apps/web/src/styles.css | .portfolio-liquidity-legend small | margin-top: 3px
apps/web/src/styles.css | .portfolio-liquidity-legend strong | font-size: 11px
apps/web/src/styles.css | .portfolio-liquidity-legend__action | padding: 6px 0
apps/web/src/styles.css | .portfolio-outlook__base | margin-top: 30px
apps/web/src/styles.css | .portfolio-outlook__base-heading | margin-bottom: 18px
apps/web/src/styles.css | .portfolio-outlook__metric .stat__detail | margin-top: 9px
apps/web/src/styles.css | .portfolio-outlook__metric .stat__value | font-size: clamp(24px, 2.5vw, 34px)
apps/web/src/styles.css | .portfolio-snapshot > .section-heading h2 | font-size: clamp(28px, 3.4vw, 42px)
apps/web/src/styles.css | .portfolio-snapshot | padding: 38px 0 10px
apps/web/src/styles.css | .portfolio-snapshot__error | gap: 18px
apps/web/src/styles.css | .portfolio-snapshot__grid | gap: 0 48px
apps/web/src/styles.css | .portfolio-snapshot__metrics dd | font-size: clamp(22px, 2.7vw, 32px)
apps/web/src/styles.css | .portfolio-snapshot__metrics dd | font-weight: 620
apps/web/src/styles.css | .portfolio-snapshot__metrics dd | margin-top: 6px
apps/web/src/styles.css | .portfolio-snapshot__metrics dt, .portfolio-liquidity-legend__label, .portfolio-liquidity-legend small | font-size: 8px
apps/web/src/styles.css | .portfolio-snapshot__metrics | gap: 30px
apps/web/src/styles.css | .portfolio-snapshot__metrics | margin: 30px 0 0
apps/web/src/styles.css | .portfolio-snapshot__status, .portfolio-snapshot__error | margin: 26px 0 10px
apps/web/src/styles.css | .portfolio-snapshot__trust | font-size: 8px
apps/web/src/styles.css | @media (max-width: 620px) › .portfolio-snapshot | padding-top: 30px
apps/web/src/styles.css | @media (max-width: 620px) › .portfolio-snapshot__metrics dd | font-size: 23px
apps/web/src/styles.css | @media (max-width: 620px) › .portfolio-snapshot__metrics | gap: 20px 22px
apps/web/src/styles.css | @media (max-width: 980px) › .hero-carousel__footer | padding: 0 30px 26px
apps/web/src/styles.css | @media (max-width: 980px) › .hero__runway | padding: 22px 0 0
apps/web/src/styles.css | @media (max-width: 980px) › .hero__slide | padding: 34px 30px 12px
```

## Planning and goals

84 spacing, 57 typography.

```text
apps/web/src/styles.css | .cash-flow--error > .button | margin-top: 14px
apps/web/src/styles.css | .cash-flow__categories > header small | font-size: 8px
apps/web/src/styles.css | .cash-flow__categories > header | padding: 22px 0 12px
apps/web/src/styles.css | .cash-flow__category .select-trigger | font-size: 9px
apps/web/src/styles.css | .cash-flow__category .select-trigger | padding: 0 30px 0 10px
apps/web/src/styles.css | .cash-flow__category > span small | font-size: 8px
apps/web/src/styles.css | .cash-flow__category b | font-size: 11px
apps/web/src/styles.css | .cash-flow__category b | font-weight: 650
apps/web/src/styles.css | .cash-flow__comparison article | padding: 22px 18px
apps/web/src/styles.css | .cash-flow__comparison small | font-size: 8px
apps/web/src/styles.css | .cash-flow__comparison small | margin-top: 6px
apps/web/src/styles.css | .cash-flow__comparison span | font-size: 8px
apps/web/src/styles.css | .cash-flow__comparison strong | font-size: 24px
apps/web/src/styles.css | .cash-flow__comparison | gap: 1px
apps/web/src/styles.css | .cash-flow__comparison | margin: 8px 0 28px
apps/web/src/styles.css | .cash-flow__consent input | margin: 2px 0 0
apps/web/src/styles.css | .cash-flow__consent | font-size: 9px
apps/web/src/styles.css | .cash-flow__consent | gap: 10px
apps/web/src/styles.css | .cash-flow__copy | margin: -5px 0 20px
apps/web/src/styles.css | .cash-flow__heading > small | font-size: 8px
apps/web/src/styles.css | .cash-flow__months i | font-size: 8px
apps/web/src/styles.css | .cash-flow__months small | font-size: 8px
apps/web/src/styles.css | .cash-flow__months strong | font-size: 16px
apps/web/src/styles.css | .cash-flow__months strong | margin-top: 6px
apps/web/src/styles.css | .cash-flow__months | gap: 30px
apps/web/src/styles.css | .cash-flow__months | margin-bottom: 30px
apps/web/src/styles.css | .cash-flow__note | margin-top: 22px
apps/web/src/styles.css | .cash-flow__source > span small | font-size: 8px
apps/web/src/styles.css | .cash-flow__source > span small | margin-top: 5px
apps/web/src/styles.css | .cash-flow__source > span strong | font-size: 11px
apps/web/src/styles.css | .cash-flow__source-actions > small | font-size: 8px
apps/web/src/styles.css | .cash-flow__trust, .cash-flow__exclusions | font-size: 8px
apps/web/src/styles.css | .goal-edit-grid | gap: 64px
apps/web/src/styles.css | .goal-form__actions | margin-top: 26px
apps/web/src/styles.css | .goal-form__fields | gap: 21px 24px
apps/web/src/styles.css | .goal-form__panel > .panel__header | margin-bottom: 26px
apps/web/src/styles.css | .goal-preview > .panel__header | margin-bottom: 36px
apps/web/src/styles.css | .goal-preview__measure .metric-card__detail | font-size: 9px
apps/web/src/styles.css | .goal-preview__measure p, .goal-preview__signal span | font-size: 8px
apps/web/src/styles.css | .goal-preview__measure strong | font-size: clamp(35px, 4vw, 52px)
apps/web/src/styles.css | .goal-preview__measure strong | font-weight: 620
apps/web/src/styles.css | .goal-preview__measure strong | margin: 7px 0
apps/web/src/styles.css | .goal-preview__notice span | font-size: 9px
apps/web/src/styles.css | .goal-preview__notice strong | font-size: 11px
apps/web/src/styles.css | .goal-preview__notice | margin-top: 29px
apps/web/src/styles.css | .goal-preview__outcomes b | font-size: 11px
apps/web/src/styles.css | .goal-preview__outcomes b | margin-top: 5px
apps/web/src/styles.css | .goal-preview__outcomes span | font-size: 7px
apps/web/src/styles.css | .goal-preview__outcomes | gap: 9px
apps/web/src/styles.css | .goal-preview__outcomes | margin-top: 30px
apps/web/src/styles.css | .goal-preview__signal strong | font-size: 24px
apps/web/src/styles.css | .goal-preview__signal | gap: 15px
apps/web/src/styles.css | .goal-preview__signal | margin-top: 26px
apps/web/src/styles.css | .goal-selector > .panel__header | margin-bottom: 6px
apps/web/src/styles.css | .goal-selector__goal-header > span | font-size: 7px
apps/web/src/styles.css | .goal-selector__goal-header small | font-size: 8px
apps/web/src/styles.css | .goal-selector__goal-header strong | font-size: 11px
apps/web/src/styles.css | .goal-selector__goal-header | gap: 5px
apps/web/src/styles.css | .goal-selector__item | padding-block: 9px
apps/web/src/styles.css | .goal-selector__trigger | padding: 12px 13px
apps/web/src/styles.css | .goal-signal__body | gap: 44px
apps/web/src/styles.css | .goal-signal__readout .panel-note | margin-top: 26px
apps/web/src/styles.css | .goal-signal__stats .stat__detail | margin-top: 9px
apps/web/src/styles.css | .goal-signal__stats .stat__value | font-size: clamp(22px, 2.5vw, 32px)
apps/web/src/styles.css | .goal-signal__stats | gap: 44px
apps/web/src/styles.css | .goal-templates | padding: 0 0 38px
apps/web/src/styles.css | .goal-version-history > .panel__header | margin-bottom: 17px
apps/web/src/styles.css | .goal-version-history article small | font-size: 8px
apps/web/src/styles.css | .goal-version-history article | gap: 17px
apps/web/src/styles.css | .goal-version-history article | padding: 13px 0
apps/web/src/styles.css | .goal-version-history | margin-top: 38px
apps/web/src/styles.css | .goal-version-history__version | font-size: 9px
apps/web/src/styles.css | .goal-workspace | gap: 48px
apps/web/src/styles.css | .plan-inputs--error > .button | margin-top: 14px
apps/web/src/styles.css | .plan-inputs__context small, .plan-inputs__preview small, .plan-inputs__fields .field > small | font-size: 8px
apps/web/src/styles.css | .plan-inputs__context small, .plan-inputs__preview small, .plan-inputs__fields .field > small | margin-top: 6px
apps/web/src/styles.css | .plan-inputs__context span, .plan-inputs__preview span | font-size: 8px
apps/web/src/styles.css | .plan-inputs__context strong | font-size: 20px
apps/web/src/styles.css | .plan-inputs__context strong | margin-top: 7px
apps/web/src/styles.css | .plan-inputs__context | gap: 28px
apps/web/src/styles.css | .plan-inputs__context | padding: 0 0 27px
apps/web/src/styles.css | .plan-inputs__copy | margin: -5px 0 24px
apps/web/src/styles.css | .plan-inputs__fields .field__value input | font-size: 15px
apps/web/src/styles.css | .plan-inputs__fields .field__value input | font-weight: 650
apps/web/src/styles.css | .plan-inputs__fields | gap: 30px
apps/web/src/styles.css | .plan-inputs__form | padding-top: 28px
apps/web/src/styles.css | .plan-inputs__preview article | padding: 0 18px
apps/web/src/styles.css | .plan-inputs__preview strong | font-size: 24px
apps/web/src/styles.css | .plan-inputs__preview | gap: 30px
apps/web/src/styles.css | .plan-inputs__preview | margin-top: 30px
apps/web/src/styles.css | .plan-inputs__preview | padding: 25px 0
apps/web/src/styles.css | .plan-monitoring--error .button | margin-top: 14px
apps/web/src/styles.css | .plan-monitoring__copy | font-size: 11px
apps/web/src/styles.css | .plan-monitoring__coverage dd | font-size: 11px
apps/web/src/styles.css | .plan-monitoring__coverage dd | font-weight: 680
apps/web/src/styles.css | .plan-monitoring__coverage dt, .plan-monitoring__item-copy > span, .plan-monitoring__values dt, .plan-monitoring__deferred span | font-size: 8px
apps/web/src/styles.css | .plan-monitoring__deferred strong | font-size: 11px
apps/web/src/styles.css | .plan-monitoring__deferred strong | margin: 7px 0 5px
apps/web/src/styles.css | .plan-monitoring__details | padding: 18px 0 4px
apps/web/src/styles.css | .plan-monitoring__header h2 | font-size: clamp(20px, 2.2vw, 26px)
apps/web/src/styles.css | .plan-monitoring__header h2 | font-weight: 650
apps/web/src/styles.css | .plan-monitoring__header h2 | margin-bottom: 9px
apps/web/src/styles.css | .plan-monitoring__indicator | font-size: 8px
apps/web/src/styles.css | .plan-monitoring__indicator | gap: 6px
apps/web/src/styles.css | .plan-monitoring__item | gap: 34px
apps/web/src/styles.css | .plan-monitoring__item | padding: 30px 0
apps/web/src/styles.css | .plan-monitoring__item-copy h3 | font-size: 17px
apps/web/src/styles.css | .plan-monitoring__item-copy h3 | font-weight: 680
apps/web/src/styles.css | .plan-monitoring__item-copy h3 | margin: 7px 0 9px
apps/web/src/styles.css | .plan-monitoring__item-copy p | margin-bottom: 9px
apps/web/src/styles.css | .plan-monitoring__item-copy small, .plan-monitoring__deferred small | font-size: 8px
apps/web/src/styles.css | .plan-monitoring__notice | font-weight: 680
apps/web/src/styles.css | .plan-monitoring__notice | margin: 18px 0 0
apps/web/src/styles.css | .plan-monitoring__summary | gap: 30px
apps/web/src/styles.css | .plan-monitoring__summary-action | gap: 14px
apps/web/src/styles.css | .plan-monitoring__summary-main | gap: 5px
apps/web/src/styles.css | .plan-monitoring__summary-text strong | font-weight: 680
apps/web/src/styles.css | .plan-monitoring__summary-text | gap: 2px
apps/web/src/styles.css | .plan-monitoring__toggle-label | font-size: 9px
apps/web/src/styles.css | .plan-monitoring__toggle-label | font-weight: 700
apps/web/src/styles.css | .plan-monitoring__values dd | font-size: 18px
apps/web/src/styles.css | .plan-monitoring__values dd | font-weight: 650
apps/web/src/styles.css | .plan-monitoring__values dd | margin-top: 6px
apps/web/src/styles.css | .plan-monitoring__values | gap: 18px 22px
apps/web/src/styles.css | @media (max-width: 1180px) › .goal-edit-grid | gap: 44px
apps/web/src/styles.css | @media (max-width: 620px) › .cash-flow__comparison article | padding: 18px 16px
apps/web/src/styles.css | @media (max-width: 620px) › .cash-flow__comparison strong | font-size: 21px
apps/web/src/styles.css | @media (max-width: 620px) › .cash-flow__heading > small | margin: -9px 0 20px
apps/web/src/styles.css | @media (max-width: 620px) › .cash-flow__months | gap: 14px
apps/web/src/styles.css | @media (max-width: 620px) › .cash-flow__source | gap: 14px
apps/web/src/styles.css | @media (max-width: 620px) › .goal-version-history .badge | margin-top: 3px
apps/web/src/styles.css | @media (max-width: 620px) › .plan-inputs__context, .plan-inputs__preview | gap: 24px 18px
apps/web/src/styles.css | @media (max-width: 620px) › .plan-inputs__preview strong | font-size: 21px
apps/web/src/styles.css | @media (max-width: 620px) › .plan-monitoring__coverage | gap: 18px 22px
apps/web/src/styles.css | @media (max-width: 620px) › .plan-monitoring__item | gap: 22px
apps/web/src/styles.css | @media (max-width: 620px) › .plan-monitoring__item | padding: 26px 0
apps/web/src/styles.css | @media (max-width: 620px) › .plan-monitoring__summary | gap: 14px
apps/web/src/styles.css | @media (max-width: 620px) › .plan-monitoring__summary | padding: 9px 0
apps/web/src/styles.css | @media (max-width: 620px) › .plan-monitoring__summary-action | gap: 9px
apps/web/src/styles.css | @media (max-width: 620px) › .plan-monitoring__summary-main | gap: 5px
apps/web/src/styles.css | @media (max-width: 620px) › .plan-monitoring__summary-text | gap: 3px
```

## Portfolio Watch

34 spacing, 22 typography.

```text
apps/web/src/styles.css | .watch-activity-summary .watch-check-title | margin: 0 0 6px
apps/web/src/styles.css | .watch-activity-summary p | margin: 0 0 6px
apps/web/src/styles.css | .watch-company-trigger small | margin-top: 7px
apps/web/src/styles.css | .watch-company-trigger strong | font-size: 16px
apps/web/src/styles.css | .watch-control-panel h2 | font-size: 22px
apps/web/src/styles.css | .watch-control-panel h2 | font-weight: 650
apps/web/src/styles.css | .watch-control-panel h2 | margin-bottom: 10px
apps/web/src/styles.css | .watch-control-panel p | font-size: 11px
apps/web/src/styles.css | .watch-control-panel small | font-size: 8px
apps/web/src/styles.css | .watch-control-panel small | margin-top: 9px
apps/web/src/styles.css | .watch-control-panel | gap: 48px
apps/web/src/styles.css | .watch-control-panel | padding: 4px 3px 8px
apps/web/src/styles.css | .watch-news-row h3 | font-size: 19px
apps/web/src/styles.css | .watch-news-summary | margin: 0 0 10px
apps/web/src/styles.css | .watch-observation-body p | font-size: 11px
apps/web/src/styles.css | .watch-observation-body p | margin: 14px 0 18px
apps/web/src/styles.css | .watch-observation-body small | font-size: 8px
apps/web/src/styles.css | .watch-observation-body span, .watch-observation-list footer span | font-size: 8px
apps/web/src/styles.css | .watch-observation-body strong | font-size: clamp(24px, 3vw, 36px)
apps/web/src/styles.css | .watch-observation-body strong | font-weight: 620
apps/web/src/styles.css | .watch-observation-body strong | margin: 14px 0 10px
apps/web/src/styles.css | .watch-observation-body | gap: 48px
apps/web/src/styles.css | .watch-observation-body | margin-top: 38px
apps/web/src/styles.css | .watch-observation-list > article > footer | gap: 44px
apps/web/src/styles.css | .watch-observation-list > article > footer | margin-top: 42px
apps/web/src/styles.css | .watch-observation-list > article > header | gap: 28px
apps/web/src/styles.css | .watch-observation-list > article | padding: 10px 0 4px
apps/web/src/styles.css | .watch-observation-list footer p | margin: 9px 0
apps/web/src/styles.css | .watch-observation-list footer small | font-size: 8px
apps/web/src/styles.css | .watch-observation-list h2 | font-size: clamp(20px, 2.3vw, 28px)
apps/web/src/styles.css | .watch-observation-list h2 | font-weight: 630
apps/web/src/styles.css | .watch-observation-list h2 | margin-bottom: 9px
apps/web/src/styles.css | .watch-observation-list | gap: 64px
apps/web/src/styles.css | .watch-observation-list | margin-top: 26px
apps/web/src/styles.css | .watch-reported-financing .reported-financing-terms .financing-source-excerpt, .watch-reported-financing .reported-financing-terms .financing-ambiguity | font-size: 8px
apps/web/src/styles.css | .watch-reported-financing .reported-financing-terms > strong | font-size: clamp(20px, 2.4vw, 28px)
apps/web/src/styles.css | .watch-reported-financing .reported-financing-terms > strong | font-weight: 620
apps/web/src/styles.css | .watch-reported-financing .reported-financing-terms > strong | margin: 14px 0 13px
apps/web/src/styles.css | .watch-run-list h3 | font-size: 16px
apps/web/src/styles.css | .watch-run-list | gap: 28px
apps/web/src/styles.css | .watch-screen .section-heading h2 | font-size: 20px
apps/web/src/styles.css | .watch-screen .section-heading h2 | font-weight: 650
apps/web/src/styles.css | .watch-screen [data-slot="tabs-content"] | padding-top: 28px
apps/web/src/styles.css | .watch-source-detail | gap: 5px
apps/web/src/styles.css | .watch-source-detail | padding: 12px 0 22px 20px
apps/web/src/styles.css | .watch-target-grid article > span, .watch-target-grid article > small | font-size: 8px
apps/web/src/styles.css | .watch-target-grid article | padding: 10px 0 18px
apps/web/src/styles.css | .watch-target-grid | margin-top: 22px
apps/web/src/styles.css | .watch-updates-heading | gap: 14px
apps/web/src/styles.css | @media (max-width: 620px) › .watch-control-panel | padding: 0 3px
apps/web/src/styles.css | @media (max-width: 620px) › .watch-intro | gap: 22px
apps/web/src/styles.css | @media (max-width: 620px) › .watch-observation-body | gap: 34px
apps/web/src/styles.css | @media (max-width: 620px) › .watch-observation-list > article > footer | margin-top: 36px
apps/web/src/styles.css | @media (max-width: 620px) › .watch-screen | gap: 28px
apps/web/src/styles.css | @media (max-width: 700px) › .watch-news-row h3 | font-size: 18px
apps/web/src/styles.css | @media (max-width: 980px) › .watch-observation-body | gap: 38px
```

## Scenarios

13 spacing, 14 typography.

```text
apps/web/src/styles.css | .assumption-list label > span | gap: 15px
apps/web/src/styles.css | .assumption-list label > span | margin-bottom: 11px
apps/web/src/styles.css | .assumption-list label b | font-weight: 650
apps/web/src/styles.css | .assumption-list small | font-size: 8px
apps/web/src/styles.css | .assumption-list | gap: 25px
apps/web/src/styles.css | .probability-ring span | font-size: 8px
apps/web/src/styles.css | .probability-ring span | margin: 5px auto 0
apps/web/src/styles.css | .probability-ring strong | font-size: 31px
apps/web/src/styles.css | .probability-ring strong | font-weight: 650
apps/web/src/styles.css | .probability-ring | margin: 4px 0 21px
apps/web/src/styles.css | .scenario-actions | margin-top: 22px
apps/web/src/styles.css | .scenario-context .eyebrow | margin: 0 0 5px
apps/web/src/styles.css | .scenario-context small | font-size: 9px
apps/web/src/styles.css | .scenario-context small | margin-top: 5px
apps/web/src/styles.css | .scenario-context | padding: 15px 17px
apps/web/src/styles.css | .scenario-grid .field | margin-top: 28px
apps/web/src/styles.css | .scenario-summary > div p | margin-bottom: 11px
apps/web/src/styles.css | .scenario-summary > div span, .scenario-summary article span | font-size: 8px
apps/web/src/styles.css | .scenario-summary > i | font-size: 22px
apps/web/src/styles.css | .scenario-summary article small | font-size: 8px
apps/web/src/styles.css | .scenario-summary article small.scenario-summary__assumptions | font-size: 9px
apps/web/src/styles.css | .scenario-summary article small.scenario-summary__assumptions | font-weight: 700
apps/web/src/styles.css | .scenario-summary article strong | font-size: 36px
apps/web/src/styles.css | .scenario-summary article strong | margin: 7px 0
apps/web/src/styles.css | .scenario-tabs button | font-size: 9px
apps/web/src/styles.css | .scenario-tabs button | font-weight: 750
apps/web/src/styles.css | .scenario-workspace, .scenario-content | gap: 28px
```

## Shared UI components and shell

53 spacing, 49 typography.

```text
packages/ui/src/styles.css | .badge | padding: 4px 9px
packages/ui/src/styles.css | .brand small | font-size: 8px
packages/ui/src/styles.css | .brand small | font-weight: 700
packages/ui/src/styles.css | .brand small | margin-top: 2px
packages/ui/src/styles.css | .brand strong | font-size: 20px
packages/ui/src/styles.css | .brand strong | font-weight: 650
packages/ui/src/styles.css | .brand | gap: 11px
packages/ui/src/styles.css | .button | font-weight: 750
packages/ui/src/styles.css | .checkbox, .radio | margin-top: 2px
packages/ui/src/styles.css | .checkbox__mark | font-weight: 700
packages/ui/src/styles.css | .choice-control | padding: 10px 0
packages/ui/src/styles.css | .choice-group legend | font-size: 17px
packages/ui/src/styles.css | .choice-group__content | gap: 10px
packages/ui/src/styles.css | .choice-group__heading | gap: 10px
packages/ui/src/styles.css | .content | padding: 46px 46px 72px
packages/ui/src/styles.css | .data-list[data-layout="rows"] .data-list__label | font-size: 16px
packages/ui/src/styles.css | .data-list[data-layout="rows"] .data-list__value | font-size: 16px
packages/ui/src/styles.css | .data-list[data-layout="rows"] | gap: 14px
packages/ui/src/styles.css | .date-picker__day | font-weight: 650
packages/ui/src/styles.css | .empty-state :is(h2, h3, h4) | font-size: 20px
packages/ui/src/styles.css | .empty-state :is(h2, h3, h4) | margin: 12px 0 7px
packages/ui/src/styles.css | .empty-state > span | font-size: 28px
packages/ui/src/styles.css | .empty-state--compact > p, .empty-state--compact > .empty-state__actions | margin-top: 5px
packages/ui/src/styles.css | .eyebrow | margin-bottom: 10px
packages/ui/src/styles.css | .field .field-error, .field-error | font-weight: 500
packages/ui/src/styles.css | .form-message | margin: 0 0 15px
packages/ui/src/styles.css | .form-message.error | font-weight: 500
packages/ui/src/styles.css | .form-message.success | font-weight: 650
packages/ui/src/styles.css | .inline-error | font-weight: 500
packages/ui/src/styles.css | .keel-chart .recharts-cartesian-axis-tick-value | font-weight: 650
packages/ui/src/styles.css | .keel-chart-tooltip | padding: 12px 14px
packages/ui/src/styles.css | .keel-chart-tooltip__items | gap: 7px
packages/ui/src/styles.css | .keel-link | font-weight: 750
packages/ui/src/styles.css | .loading-status | gap: 10px
packages/ui/src/styles.css | .metric-card .metric-card__action | margin-top: 17px
packages/ui/src/styles.css | .metric-card p | margin-bottom: 11px
packages/ui/src/styles.css | .metric-card span | margin-top: 10px
packages/ui/src/styles.css | .metric-card strong | font-size: clamp(24px, 2.5vw, 34px)
packages/ui/src/styles.css | .metric-card | padding: 28px 0 30px
packages/ui/src/styles.css | .navigation-reference a | font-weight: 620
packages/ui/src/styles.css | .navigation-reference a | padding: 0 11px
packages/ui/src/styles.css | .navigation-reference__label | font-size: 11px
packages/ui/src/styles.css | .navigation-reference__label | padding: 0 11px
packages/ui/src/styles.css | .page-intro h1 | margin-bottom: 14px
packages/ui/src/styles.css | .page-intro | gap: 28px
packages/ui/src/styles.css | .page-intro | padding: 20px 4px 28px
packages/ui/src/styles.css | .panel | padding: 30px 0
packages/ui/src/styles.css | .panel__header h2 | font-size: 20px
packages/ui/src/styles.css | .panel__header h2 | font-weight: 670
packages/ui/src/styles.css | .record-row__value | font-size: 16px
packages/ui/src/styles.css | .record-row__value | font-weight: 650
packages/ui/src/styles.css | .search__field .input | font-size: 16px
packages/ui/src/styles.css | .search__field | padding: 0 4px 0 14px
packages/ui/src/styles.css | .search__status | margin: 10px 0 0
packages/ui/src/styles.css | .section-heading--with-stat > .stat .stat__value | font-size: 34px
packages/ui/src/styles.css | .select-item | font-weight: 650
packages/ui/src/styles.css | .select-item | padding: 0 10px
packages/ui/src/styles.css | .select-list | gap: 2px
packages/ui/src/styles.css | .sidebar .brand | padding: 0 8px 39px
packages/ui/src/styles.css | .sidebar nav button > b | font-size: 8px
packages/ui/src/styles.css | .sidebar nav button > b | padding: 0 5px
packages/ui/src/styles.css | .sidebar nav button > i | font-size: 8px
packages/ui/src/styles.css | .sidebar nav button > i | font-weight: 750
packages/ui/src/styles.css | .sidebar nav button > span | font-weight: 620
packages/ui/src/styles.css | .sidebar nav button | padding: 0 11px
packages/ui/src/styles.css | .sidebar nav | gap: 3px
packages/ui/src/styles.css | .sidebar | padding: 28px 20px 20px
packages/ui/src/styles.css | .sidebar__footer > i | font-size: 9px
packages/ui/src/styles.css | .sidebar__footer span | font-size: 8px
packages/ui/src/styles.css | .sidebar__footer span | margin-top: 2px
packages/ui/src/styles.css | .sidebar__footer strong | font-weight: 700
packages/ui/src/styles.css | .sidebar__footer | gap: 9px
packages/ui/src/styles.css | .sidebar__footer | padding: 18px 7px 2px
packages/ui/src/styles.css | .tabs-list:not(.section-navigation__tabs) > .tabs-trigger | padding: 10px 16px
packages/ui/src/styles.css | .topbar > div:first-child span | font-weight: 500
packages/ui/src/styles.css | .topbar | font-weight: 700
packages/ui/src/styles.css | .topbar | padding: 0 36px
packages/ui/src/styles.css | .topbar__title .brand-mark | margin-right: 7px
packages/ui/src/styles.css | .user-avatar | font-size: 9px
packages/ui/src/styles.css | .visually-hidden | margin: -1px
packages/ui/src/styles.css | :where(.data-list__label, .stat__label) | font-size: 8px
packages/ui/src/styles.css | :where(.stat__detail) | font-size: 8px
packages/ui/src/styles.css | @media (max-width: 1180px) › .content | padding: 36px 30px 60px
packages/ui/src/styles.css | @media (max-width: 620px) › .metric-card strong | font-size: 24px
packages/ui/src/styles.css | @media (max-width: 620px) › .metric-card | padding: 24px 0 26px
packages/ui/src/styles.css | @media (max-width: 620px) › .page-intro h1 | font-size: 42px
packages/ui/src/styles.css | @media (max-width: 620px) › .page-intro | padding: 10px 0 20px
packages/ui/src/styles.css | @media (max-width: 620px) › .screen-stack | gap: 28px
packages/ui/src/styles.css | @media (max-width: 700px) › .section-navigation--mobile-tabs .section-navigation__status | font-size: 11px
packages/ui/src/styles.css | @media (max-width: 980px) › .content | padding: 28px 20px 40px
packages/ui/src/styles.css | @media (max-width: 980px) › .mobile-menu-toggle | margin-right: -10px
packages/ui/src/styles.css | @media (max-width: 980px) › .mobile-nav .navigation-reference a | font-size: 15px
packages/ui/src/styles.css | @media (max-width: 980px) › .mobile-nav .navigation-reference a | font-weight: 650
packages/ui/src/styles.css | @media (max-width: 980px) › .mobile-nav .navigation-reference a | padding: 0 14px
packages/ui/src/styles.css | @media (max-width: 980px) › .mobile-nav .navigation-reference__label | padding: 0 14px
packages/ui/src/styles.css | @media (max-width: 980px) › .mobile-nav b | font-size: 9px
packages/ui/src/styles.css | @media (max-width: 980px) › .mobile-nav b | padding: 0 6px
packages/ui/src/styles.css | @media (max-width: 980px) › .mobile-nav button | padding: 0 14px
packages/ui/src/styles.css | @media (max-width: 980px) › .mobile-nav i | font-size: 9px
packages/ui/src/styles.css | @media (max-width: 980px) › .mobile-nav span | font-size: 15px
packages/ui/src/styles.css | @media (max-width: 980px) › .mobile-nav span | font-weight: 650
packages/ui/src/styles.css | @media (max-width: 980px) › .mobile-nav:not([hidden]) | padding: 20px max(20px, calc((100vw - 520px) / 2)) calc(20px + env(safe-area-inset-bottom))
```

## Startup

1 spacing, 3 typography.

```text
apps/web/src/startup.css | .startup-brand | font-size: 22px
apps/web/src/startup.css | .startup-brand | font-weight: 650
apps/web/src/startup.css | .startup-message h1 | font-size: 28px
apps/web/src/startup.css | .startup-shell | padding: 35px
```

## UI catalogue compositions and journey candidates

2 spacing, 2 typography.

```text
e2e/ui-catalogue/keel-ui-candidates.css | .candidate-choice-children | padding-left: 30px
e2e/ui-catalogue/keel-ui-candidates.css | .candidate-form .input[type="file"]::file-selector-button | padding: 10px 16px
e2e/ui-catalogue/keel-ui-candidates.css | .candidate-recovery .section-heading h3 | font-size: 18px
e2e/ui-catalogue/keel-ui-candidates.css | .candidate-table caption | font-size: 18px
```

## UI catalogue foundations and walkthroughs

3 spacing, 9 typography.

```text
e2e/ui-catalogue/keel-ui-catalogue.css | .catalogue-carousel-title | font-size: clamp(32px, 4vw, 56px)
e2e/ui-catalogue/keel-ui-catalogue.css | .catalogue-carousel-title | font-weight: 590
e2e/ui-catalogue/keel-ui-catalogue.css | .catalogue-carousel-title | margin: 0 0 18px
e2e/ui-catalogue/keel-ui-catalogue.css | .catalogue-chart .recharts-cartesian-axis-tick-value | font-weight: 500
e2e/ui-catalogue/keel-ui-catalogue.css | .catalogue-fact-group h3 | font-size: 18px
e2e/ui-catalogue/keel-ui-catalogue.css | .catalogue-foundations | gap: 48px
e2e/ui-catalogue/keel-ui-catalogue.css | .catalogue-inventory | gap: 28px
e2e/ui-catalogue/keel-ui-catalogue.css | .catalogue-record-summary > span:nth-child(2) | font-size: 19px
e2e/ui-catalogue/keel-ui-catalogue.css | .catalogue-record-summary | font-size: 16px
e2e/ui-catalogue/keel-ui-catalogue.css | .catalogue-surface strong | font-size: 20px
e2e/ui-catalogue/keel-ui-catalogue.css | .catalogue-type-label code | font-size: 11px
e2e/ui-catalogue/keel-ui-catalogue.css | .source-update-outcome .stat__value | font-size: 32px
```

## UI catalogue planning journey

9 spacing, 8 typography.

```text
e2e/ui-catalogue/keel-ui-candidates.css | .catalogue-planning .body | padding: 28px
e2e/ui-catalogue/keel-ui-candidates.css | .catalogue-planning .brand | font-size: 24px
e2e/ui-catalogue/keel-ui-candidates.css | .catalogue-planning .columns | gap: 36px
e2e/ui-catalogue/keel-ui-candidates.css | .catalogue-planning .hint | margin: 28px 0 0
e2e/ui-catalogue/keel-ui-candidates.css | .catalogue-planning nav .keel-link | padding: 10px
e2e/ui-catalogue/keel-ui-candidates.css | .planning-fixed-facts strong | font-size: 16px
e2e/ui-catalogue/keel-ui-candidates.css | .planning-fixed-facts strong | font-weight: 500
e2e/ui-catalogue/keel-ui-candidates.css | .planning-main-navigation | margin-top: 36px
e2e/ui-catalogue/keel-ui-candidates.css | .planning-polished .goal-edit-grid | margin-top: 28px
e2e/ui-catalogue/keel-ui-candidates.css | .planning-polished .goal-preview__measure strong small | font-size: 20px
e2e/ui-catalogue/keel-ui-candidates.css | .planning-polished .hero h1 | font-size: 40px
e2e/ui-catalogue/keel-ui-candidates.css | .runway-comparison .stat-group strong | font-size: 40px
e2e/ui-catalogue/keel-ui-candidates.css | @media (max-width: 650px) › .planning-polished .hero h1 | font-size: 30px
e2e/ui-catalogue/keel-ui-candidates.css | @media (max-width: 650px) › .planning-polished .hero | gap: 28px
e2e/ui-catalogue/keel-ui-candidates.css | @media (max-width: 650px) › .planning-polished .scenario-summary | gap: 28px
e2e/ui-catalogue/keel-ui-candidates.css | @media (max-width: 650px) › .planning-scenario-metrics | gap: 28px
e2e/ui-catalogue/keel-ui-candidates.css | @media (max-width: 650px) › .runway-comparison .stat-group strong | font-size: 32px
```
