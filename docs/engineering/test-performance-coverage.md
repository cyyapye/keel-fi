# Test performance and retained proof

The comparison starts at `525cfab1`, whose complete Linux run used 884.478 of
900 active seconds. That near-limit result is the baseline to improve. The
900-second gate, individual deadlines, worker limits, snapshot baselines and
platform exclusions remain unchanged.

## Work removed

| Change                        | Removed work                                                                     | Retained observable proof                                                                                                                                                                                                                                                                        |
| ----------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Share-price setup             | Host-to-D1 proxy traffic for three synthetic imports and watch-target setup      | The host still runs every measured valuation-evidence read, plan and budget assertion across 120 holdings, repeated history, 1,200 unrelated companies and empty results.                                                                                                                        |
| Reviewed-rename setup         | Host-to-D1 proxy traffic for accepted history imports and foreign staged imports | The host retains every positive, decision-history, tied-date source-history, projection, foreign and empty read and its original limits. Stage-only and accepted operations stay distinct.                                                                                                       |
| Migration preservation        | Eight duplicate full-table preservation invocations                              | Initial OLD-schema exact preservation still precedes measured migration. Every historical branch finishes with all three immutable-guard probes and complete preservation. Baseline evidence derives its counts from one final exact preservation. Both 12/24 cost and baseline profiles remain. |
| Expected fixture construction | Repeated foreign-key scans while building the Node SQLite oracle                 | Temporary child-key indexes accelerate only the expected fixture builder. The unchanged migration still runs, auxiliary indexes are removed, and complete fixture bytes match. Actual D1 amplification, correction and billing tests are unchanged.                                              |
| Holdings browser serving      | A development server required only by a direct source-module import              | A test-only route bundles the actual search module in memory. The browser still consumes all 60 search results, enforces the 50 ms p95 bound and verifies the 1,000-row DOM/read behavior. No fixture enters application output.                                                                 |
| Manual-holding geometry       | Twelve duplicated project/matrix identities                                      | Two project-owned journeys retain all six width/disclosure contexts. Mobile owns 412 px; desktop owns 838 and 1,280 px. Keyboard transitions, focus, the 0.5 px stationarity bound and unsaved values remain checked.                                                                            |

The twelve retired geometry identities match
`keeps type controls stationary at <width>px with details <state>` in both
projects. Their replacements are
`keeps type controls stationary across project-owned viewport and disclosure states`,
once in each project. The native inventory changes from 468 to 458 browser
identities. No other browser identity or exclusion changes. This retains six
selected CSS width/disclosure contexts with project ownership. It retires the
same-width device-emulation cross-product, including its different touch, DPR
and user-agent environments. The editor has no corresponding geometry branch.

The five browser lanes and four-browser admission limit remain. The lane named
`mocked-development` retains its historical identifier and scheduling but now
serves production assets. Moving its entire spec into one early serial lane was
rejected because the measured case work would overload that lane. The
development stateful lane still verifies development-only behavior.

## Why other expensive tests remain

All six provider-agent real-D1 days remain. Their measured traces contain
distinct binding, result and write-state domains. Keeping only idle,
intermittent renewal and revoked access would lose permanent-error and
typed-expiry transitions. Paired client mutations confirmed that dropping typed
failure metadata or successful verification metadata loses behavior not covered
by the proposed smaller matrix. Smaller case counts alone are insufficient
evidence.

Both populated OLD-schema history sizes remain. The larger original rebuild
measures historical foreign-key amplification; the indexed correction meters
preparation, migration and restoration separately. Neither an empty migration
replay nor post-migration query tests substitute for this proof.

Real PDF isolation, production browser/document capture, current authentication,
quota denial, stale/unknown evidence, uncertain replay, concurrency and owned
cleanup boundaries remain mandatory. No timer is increased to accept a faster
looking result.

## Equivalence and measurement

The setup comparison checks SQL operations and bindings, complete application
state and measured host results. Generated identifiers are normalized only in
private comparison evidence. Separate runs of SQLite trigger clocks naturally
differ; only their documented clock columns are normalized. Client-supplied
financial dates are retained exactly. Uncontrolled rename read counters can vary
by one row; every original bound remains, and exact billing equality is not
claimed from those uncontrolled runs.

Old and new migration postconditions are challenged with stored-row corruption,
extra/missing/changed schema, disabled immutable guards and a real foreign-key
violation. Browser controls challenge geometry, focus, unsaved drafts and a fast
search no-op. These are failure-detection checks, not screenshot updates.

Instrumented profiles diagnose the limiter and are excluded from timing samples.
Per-case work and concurrent flow durations are not added to claim elapsed time.
The final exact-revision CI receipt remains the end-to-end result; a local or
isolated gain does not establish tail reliability.
