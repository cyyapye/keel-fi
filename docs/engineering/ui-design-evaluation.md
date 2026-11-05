# Design workflow evaluation cases

These are evaluation cases, not ordinary agent instructions. Do not give this
scorecard to a reviewer. Existing instruction-routing holdouts in
[agent-guidance-evaluation.md](agent-guidance-evaluation.md) still apply.

Generate the blinded catalogue stimuli for a design evaluation with
`KEEL_CAPTURE_DESIGN_VARIANTS=1 make e2e E2E_ARGS='e2e/ui-catalogue.visual.spec.ts --grep "captures blinded"'`.
Playwright writes the four images for each viewport to its test-results
directory.

## Cases fixed before the pilot

| Case                    | Request / evidence                                                                            | Observable requirement                                                                                                                                                                                |
| ----------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Actual screen           | Review the initial Legal entities triage and its open batch disclosure on desktop and mobile. | Inspect all current renders against an approved reference; distinguish source count from distinct-name count; cite actual locations. No assumption that the entire save/export workflow was verified. |
| Repeated status         | Synthetic browser variant repeats a review badge on every row under a review-only section.    | Identify redundant status and its hierarchy cost without removing a truly exceptional status in a mixed collection.                                                                                   |
| Unclear disabled        | Synthetic browser variant makes a disabled control look enabled.                              | Identify the misleading affordance using rendered evidence; retain the actual disabled behavior.                                                                                                      |
| Distinct but equal      | A comparison deliberately shows previous and accepted values with the same text.              | Preserve both labels because they distinguish semantic roles; do not deduplicate by string equality.                                                                                                  |
| Essential qualification | A displayed estimate includes a supported proxy/estimate qualification.                       | Retain the qualification even if it adds copy; never clean up an unsupported value into a reported fact.                                                                                              |
| Mechanical edit         | Change a punctuation glyph in an existing label.                                              | Focused checks and affected screenshot replay; no mandatory new design packet or full application startup.                                                                                            |
| New concept             | Introduce a new financial editor with different editing ownership.                            | Resolve meaning and obtain exact-version proposal approval before application implementation; no model-generated approval flag.                                                                       |
| Backend only            | Optimize a collection GET without changing UI.                                                | Skip UI review; preserve projection, scale and cost requirements.                                                                                                                                     |

## Comparison and decision

Give separate fresh reviewers the same task, raw images and native evidence. The
baseline gets existing Keel guidance; the candidate gets the packet review
procedure. Neither sees expected findings or the other's response. Do not
manufacture a baseline failure when both identify a defect. Keep a narrower
candidate only if it improves an observed decision without losing critical
holdouts. A structural validator pass alone is not behavioral proof.

Record actual results and remaining limitations after the run. Do not claim
cross-project certification from this development pilot. The generic Tugling
source and installed plugin remain unchanged until a separately evidenced
promotion is justified.

## Development pilot: 2026-10-24

The trial used current synthetic Legal entities triage screenshots on desktop
and mobile, plus browser-only control and content variants. Separate reviewers
received the same raw task and images with inherited model/settings. The
baseline used the existing Keel guidance; the candidate used the packet
procedure. Expected findings and the other reviewer's conclusions were withheld.
The repeated review badge was observed on the actual pilot screen, rather than
introduced as another synthetic variant.

| Case                                       | Existing guidance                                                             | Initial candidate                                                         | Revised first-look candidate                       |
| ------------------------------------------ | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------- |
| Closed batch scope                         | Flagged unclear relation between source and legal-name counts                 | Missed it, relying on the expanded disclosure and author-supplied meaning | Flagged the missing scope before reading the brief |
| Disabled appearance                        | Flagged the deliberately misleading enabled appearance                        | Flagged it                                                                | Flagged it                                         |
| Equal values with distinct roles           | Preserved both comparison labels; questioned a redundant explanatory sentence | Preserved both labels                                                     | Preserved both labels                              |
| Qualified estimate                         | Preserved proxy and before-carry qualifications                               | Preserved them                                                            | Preserved them                                     |
| Mechanical / new concept / backend routing | Focused checks / exact proposal approval / no UI review                       | Same boundaries                                                           | Same boundaries                                    |

The initial candidate did not outperform the baseline. Its miss led to the
two-stage review now in the project procedure: record each state's unaided
meaning before reading the brief, references or later states. The revised
candidate recovered the scope issue without losing the tested semantic or
routing boundaries. It did not independently report every minor copy issue the
baseline identified.

The pilot repair makes the ready and remaining source counts visible beside the
batch action, removes the generic review badge inside the review-only queue, and
replaces storage terminology in the disclosure. Exceptional statuses remain.
Native assertions cover the closed-state counts, badge removal, narrow viewport
and existing acceptance behavior. Reviewer artifacts and command receipts live
in the task's local evidence directory; they are not runtime inputs.

A fresh reviewer then inspected all eight repaired-screen and reference images.
Its preserved first-look notes correctly distinguished the batch from the whole
queue before reading the brief. It reported no findings or unresolved questions
for the bounded initial-triage, disclosure and collection-context task. The
source/evidence checker accepted that actual response. This rendered review
remains separate from native replay and the full material handoff gate.

This is one development trial with author-selected cases, not a held-out
benchmark or evidence that corrections have been eliminated. The first-look
change warrants keeping the local workflow usable; superiority over existing
guidance and transfer to other projects remain unproven. No generic Tugling
skill, plugin installation or source pin was changed or promoted.

## Portfolio Watch holdout: 2026-10-24

A second bounded trial used previously unreviewed Portfolio Watch states:
partial monitoring with unread news, a failed check with an empty unread inbox,
and an expanded unavailable source. Both desktop and mobile were captured from
the current browser run; the full Portfolio Watch spec initially passed all 22
cases, including the 120-company search/paging and recovery case.

The first-look candidate reported no findings. The product-guidance reviewer
recommended distinguishing a wholly failed check from partial success in the
headline. The subordinate counts already disclosed zero successful reads, so
this was a scanning/hierarchy improvement, not evidence of hidden failure. The
repair uses “Last check failed” and “Last check timed out”, while partial or
incomplete coverage remains “Monitoring limited”. Native assertions now require
these distinctions; request behavior and financial acceptance are unchanged.

The comparison is not a clean behavioral A/B result: the nominal baseline also
read the local design-review adapter through ambient project instructions.
Preserve both actual responses, but do not use them to rank the procedures.
Future comparisons must isolate accessible guidance, not merely tell reviewers
which procedure to use. The disagreement also illustrates why an LLM response is
advisory and needs adjudication against the task and product contract.

After the repair, the old packet was rejected as stale. This is direct evidence
of the deterministic guard working, separate from design judgment. Portable
setup and evidence handling are being extracted into a local Tugling candidate
with synthetic preservation, coverage and drift tests. This does not establish
improved LLM judgment, cross-project design quality or release certification;
the installed plugin and Keel's accepted source pin remain unchanged.

A later rendered review questioned synthetic failure/timeout states whose last
successful-read timestamp matched the failed attempt. The browser fixture now
keeps a prior success and distinct later failed/timed-out runs, with assertions
for both timestamps and schema validation of the mocked state sequence. This
changes test evidence, not production monitoring or retry behavior. The initial
incomplete review is retained separately from the corrected-state review.

Independent forward-testing also found that the first-look image mapping could
be edited without invalidating a packet. Both the local and portable helpers now
derive and verify every generated reviewer input. Tampered or missing input
files reject rather than silently altering what a reviewer sees.
