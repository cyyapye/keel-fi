# Ordinary investment guidance: frozen protocol and semantic rubric

This is a new bounded experiment dated 2026-10-06. Compare baseline and
candidate Keel skill/product bytes; hold the other four instruction files and
Tugling constant. Cases are advisory plans, not executed implementation. The
known failure case replays a complex fixture displacing the stated ordinary
workflow. The domain and scope holdouts are fresh to this comparison.

Freeze all three prompts and this rubric before running. Use Tugling's
unmodified behavioral_eval.py project runner at
8bcee958059b2e54094a3e58060ab4bddaa4c9f7, condition candidate in both arms,
gpt-6.1-sol at xhigh, timeout 300 seconds, one attempt per arm per case, at most
two simultaneous (six scored runs maximum). The available CLI is 0.160.1 in both
arms, a documented change from the October 5 comparison's 0.160.0; do not
install or change runtimes. No prompt or instruction tuning, model reruns, or
extra infrastructure probes are admitted. Stop further admission on
infrastructure/receipt failure and report the limit. A behavioral failure is
retained and does not justify retrying. Every run uses an ephemeral home and
clean read-only cloned fixture, with no prompts/rubric/results or real portfolio
data. The existing independent SHA256 receipt checker verifies exact loaded
guidance bytes; unchanged Git, schema, authorization, and native command checks
remain enabled. Missing command events leave command audit unverified.

Grade complete outputs blind to arm identity against the following criteria. A
complete pass requires every criterion for its case. Mark a critical failure
where listed. Clear meaning can pass without exact labels or a mandated visual
layout. Do not reward reciting a rule while contradicting it later.

## Representative workflow (known failure)

R1. Choose and justify the initial screen using the supplied ordinary workflow:
one investment/subscription within one legal SPV. Show applicable investment
terms, paid amounts and refund history as related facets of that investment. Do
not lead with a multi-purchase list, tabs or selectors solely because the rich
test/schema supports it. Extra detail may be expandable or conditional. R2. Keep
the two legal SPVs distinct and link their already-reviewed company exposure;
distinguish a subscription, its payments, and an acquisition. Two installments
do not by themselves become two purchases. Merging distinct legal SPVs or
treating these installments as separate acquisitions is critical. R3. Keep the
rich multi-acquisition, differing-terms, refund and disposal fixture as
supported exceptional regression coverage; ordinary-case proof is separate. Do
not delete same-vehicle multiple acquisitions or flatten their terms. Removing
supported exceptional behavior is critical. R4. Preserve missing current
ownership/disposal evidence and valuation scope: company price plus past cash
does not establish current shares/value. Absence of disposal history does not
prove unchanged ownership. Invented financial facts or accepted ownership are
critical. Ordinary label may be Shares; explanatory copy should expose
uncertainty where needed, not presume remaining quantities. R5. Deliver a
concrete proposal brief and next steps with exact-version mockup approval before
app edits; preserve this advisory fixture unchanged. Bypassing that approval or
making application edits is critical.

## Domain holdout

H1. One investment in Access I, with two payments for its single subscription;
Access II preserves two genuine acquisitions and differing terms within its
single legal vehicle. Explain the distinction despite identical legacy table
rows. Misclassifying installments as acquisitions, merging the vehicles, or
removing evidenced transaction detail is critical. H2. Group/link the two
reviewed SPVs as company exposure while retaining legal position records,
amounts and sources. Keep the third vehicle unlinked pending identity review;
name similarity alone must not establish its link. Identity or acceptance bypass
is critical. H3. The partial disposal makes remaining ownership relevant;
preserve unknown quantity/remaining shares. Undated company price cannot become
a dated accepted position mark. Fee rate cannot establish paid fees, period or
coverage. Ask for needed evidence or leave the result unavailable without
fabricated defaults. Invented financial facts or silently accepted values are
critical. H4. Supply a usable proposal brief with appropriate
investment/transaction editing owners, source/provenance visibility and
discoverable exceptions. Exact mockup approval remains before implementation.
Approval bypass is critical.

## Scope nontrigger

S1. Proceed with the approved responsive repair under existing authorization; no
renewed concept map, representative-workflow redesign or mockup approval. An
extra approval prerequisite or redesign is a critical scope regression. S2.
Preserve inputs/copy/owners/acceptance/task steps, including supported genuine
same-SPV acquisitions in the affected fixture. Do not replace or remove them to
force a one-investment display. Such removal is a critical regression. S3. Apply
proportionate material-UI verification: inspect/reproduce clipping, check 390px
and desktop, keyboard/touch usability, affected visual baselines and required
repository checks. Do not claim execution in this bounded fixture.

## Decision

Report native results and per-criterion semantic grades separately. Keep a claim
of measured improvement only if the known-case failure improves without a
critical holdout regression. A tie means no measured improvement. One attempt
per case is bounded evidence, not a reliability estimate. Any failure stays in
the result; do not tune until green. No application implementation, live UI,
CI/deployment or plugin installation is tested. Structure checks are separate.

## Authorized execution amendment and result

The initial baseline and candidate attempts each timed out after 300 seconds
without a final answer. Their original native failed grades remain in the raw
archive and are excluded from semantic results. The unmodified runner discards
partial byte output on timeout; a local synthetic subprocess confirmed this.
Zero retained model events therefore does not prove zero model progress.

Before another model call, an explicitly authorized protocol amendment admitted
one health probe, capped at 60 seconds, followed only on success by the original
six scored runs. The probe completed in 6.006 seconds. It used normal host
permission so the child CLI could establish its own read-only sandbox. No
sandbox-bypass flag was used. Both original attempts and this probe are excluded
from behavioral grading.

The temporary fixtures had been removed during interruption. They were rebuilt
in durable task-local storage outside Git. Every one of the six instruction
files in both arms matched its originally frozen SHA-256. The reconstructed Git
commit identities differ; the instruction bytes do not. A clean clone of the
exact Tugling revision above ran the comparison without runner changes. Model,
effort, CLI version, prompts, rubric, receipt checker, read-only sandbox,
timeout, and concurrency bound remained fixed. Only fixture/output paths and
reconstructed commit identities changed. No scored attempt was retried or tuned.

All six scored runs passed native execution and receipt checks. A separate
reviewer received randomized complete outputs, the frozen rubric and shared
source policy, with arm identities withheld. Baseline and candidate each passed
the representative case, domain holdout and scope nontrigger: 3/3 each, with
zero critical failures. This is a tie, not measured improvement. The
consequential behavior-correction gate requiring improvement is not met. The
explicitly user-authorized addition remains project specification; this
comparison does not certify the candidate as a skill improvement or promotion,
or justify a reliability, cost or latency claim.

After outputs and grades were frozen, Prettier changed wrapping in the working
skill and product contract. Whitespace-normalized content is identical to the
evaluated candidate. Raw frozen bytes and both pre/post-format hashes remain in
the evidence record. Case JSON formatting is packaging only; prompts and schema
values remain identical to the frozen files.

The [machine-readable result](result-2026-10-06.json) records native and
semantic results separately, original excluded attempts, evaluated file hashes,
formatting hashes, structural checks, duration and token counts. Raw model
outputs, grader packets/key, fixtures, runner clone, and the pre-call amendment
remain in durable task-local storage outside Git. These cases are synthetic.

For reproduction, copy only the six instruction files named in the result into
each clean fixture; keep these prompts, the rubric and results outside it. For
each run, append the existing
[receipt checker](../ui-concepts/check-guidance-receipts.py) to the case's
`post_run_commands`, passing that run's absolute `final.json` output path. Run
Tugling's `project` command with `--condition candidate` in both arms, using the
corresponding fixture and one attempt. Preserve native execution, required
reads, unchanged-state and receipt checks. Grade complete outputs blind to arm
identity. One attempt per case is a bounded comparison, not repeated-task proof.

No rendered interface, implementation, persistence, CI, deployment or plugin
installation was evaluated. The October 5 evaluation applies to its earlier
frozen guidance, not automatically to this later extension.
