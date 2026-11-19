# UI design delivery

The approved theme and components are necessary but do not establish that a page
communicates the right thing. Keel uses five connected steps: project discovery,
a design brief, shared implementation, native verification, and an independent
review of the rendered result. The existing
[UI skill](../../.codex/skills/keel-ui-quality/SKILL.md) selects the appropriate
scope; its
[review procedure](../../.codex/skills/keel-ui-quality/references/design-review.md)
owns the steps. The [product contract](../product/ui-and-copy.md) remains
authoritative.

## Project-specific setup

[.tugling/ui.json](../../.tugling/ui.json) binds the workflow to Keel's real
theme, exports, catalogue, reference screens, commands and review criteria. It
is separate from Tugling's versioned project-adoption manifest. No installed
plugin or source pin changes. For another project, adapt these paths, visual
references, domain criteria and native checks; do not copy Keel's aesthetic or
financial rules into a generic skill.

The helper does not run commands from this JSON. Keep native enforcement in the
repository's normal tests and CI. Existing shared-component usage checks reject
bypasses; browser tests cover interaction and geometry; the reviewer challenges
meaning, repetition, composition and fidelity to approved references. An LLM
judgment supplements these checks and does not replace them.

## Choose evidence for the claim

The
[product contract](../product/ui-and-copy.md#verify-behavior-and-appearance-separately)
separates behavior and persistence proof from appearance review. Select direct
assertions, real synthetic API/D1 roundtrips and representative images according
to the changed behavior or visual meaning. Reuse approved component coverage.
Follow the
[visual verification procedure](../../.codex/skills/keel-ui-quality/references/visual-verification.md)
for renderer selection and deliberate baseline updates. Run the final broad gate
after implementation and review fixes settle, and report functional and
canonical pixel results separately.

## Discover components before coding

The adapter's `agentGuide` points to `make ui-guide`. Query a known component or
a task phrase to retrieve focused guidance; for example,
`make ui-guide UI_QUERY=RecordGroup` or `UI_QUERY='infinite scroll'`. Read the
actual API declaration, linked example context, canonical rules and required
states before selecting a control. Open the matching `/ui/#...` page to inspect
its rendering. The index is generated from current source during queries and web
builds, and native tests reject missing exports, examples and rules.

The Keel skill routes this lookup; Tugling does not crawl the human catalogue or
make a visual judgment from JSON. A screenshot review still checks meaning and
composition after implementation. Other projects provide their own guide paths
and design rules through their adapter.

## Prepare a review

Keep runtime packets under an ignored local directory or the task's artifact
directory. Use synthetic browser fixtures only. The following is the input
shape; paths are relative to the brief file or absolute. Replace the descriptive
values with evidence for the actual task:

```json
{
  "id": "legal-entity-triage",
  "task": "Identify the next legal-entity review action and inspect its scope.",
  "meaning": "Source records and distinct legal names are different counts.",
  "scope": "review",
  "patternBasis": "Existing legal-entity triage with approved Keel controls.",
  "requiredStates": ["initial", "details-open"],
  "components": ["SectionHeader", "Button", "Collapsible", "SearchField"],
  "checks": [
    {
      "command": "make e2e E2E_ARGS='e2e/legal-entities.visual.spec.ts --grep keeps'",
      "evidence": "browser.log"
    }
  ],
  "images": [
    {
      "id": "initial-wide",
      "role": "screen",
      "state": "initial",
      "viewport": "desktop",
      "path": "initial-wide.png"
    },
    {
      "id": "initial-narrow",
      "role": "screen",
      "state": "initial",
      "viewport": "mobile",
      "path": "initial-narrow.png"
    },
    {
      "id": "details-wide",
      "role": "screen",
      "state": "details-open",
      "viewport": "desktop",
      "path": "details-wide.png"
    },
    {
      "id": "details-narrow",
      "role": "screen",
      "state": "details-open",
      "viewport": "mobile",
      "path": "details-narrow.png"
    },
    {
      "id": "reference",
      "role": "reference",
      "state": "approved-density",
      "viewport": "desktop",
      "path": "reference.png"
    }
  ]
}
```

```sh
make ui-review-prepare BRIEF=/absolute/brief.json OUT=/absolute/new-packet
```

The packet includes copied images/logs, the task brief, source and evidence
hashes, a reviewer prompt and a response template. Freeze it after native checks
and source edits settle. A source, image or log change invalidates the packet.
This detects accidental staleness; it is not signed provenance and cannot prove
that arbitrary supplied screenshots were produced by the declared source.

For forms with conditional fields, include browser evidence of switching between
the relevant choices with supporting details both open and closed. Check the
active control's position, keyboard focus and draft retention. Separate settled
screenshots do not establish transition behavior. For calendar changes, open the
calendar and select and clear dates through its controls. Check bounds, disabled
state and field error associations. Directly filling a date value does not
establish calendar behavior. Include the affected open states in the desktop and
mobile images given to the reviewer.

Give a fresh reviewer the packet's `reviewer.md` and its raw evidence, without
the author's reasoning or expected findings. The reviewer starts with
`first-look.json`: inspect each screen and record its unaided meaning before
reading the brief, references or subsequent states. Then reconcile those notes
with the intended meaning. Supporting disclosures must not be used to excuse
missing context required to understand a closed state's primary action. Save the
actual response as `review.json`, then run:

```sh
make ui-review-check PACKET=/absolute/new-packet REVIEW=/absolute/review.json
```

The command rejects missing/duplicate image inspections, incomplete criterion
coverage, unknown evidence, inconsistent findings, and stale artifacts.
`CHANGES_REQUESTED` and `INCOMPLETE` return nonzero. `REVIEW_COMPLETE` records a
complete response with no reported open issues; it is not a design approval or
proof of native test success. Preserve reviewer identity and the actual session
record separately. Resolve valid findings, recapture, and re-review affected
states before handoff. Never edit a negative review into a passing result.

For a new concept, only the user's approval of the exact proposal satisfies the
existing approval boundary. For a material implementation, `make verify` remains
required. A small copy repair retains its focused verification path.

## Evaluate changes to the workflow

Use the cases in [ui-design-evaluation.md](ui-design-evaluation.md). Keep
expected findings out of reviewer input. Compare the same raw artifacts and task
under the existing and candidate guidance, with the same model/settings. Record
false positives and preserved caveats as well as defects found. One project
pilot is development evidence, not proof of universal improvement or one-shot
delivery. Portable setup/evidence handling can be tested separately for
configuration preservation, completeness and drift rejection. A change claiming
better reviewer decisions still requires a concrete behavioral advantage and
clean holdouts. Keep the current project adapter usable independently; a local
Tugling candidate is not an installed or release-certified change.

## Released project-native handoff

The material-UI handoff uses the accepted release in `.tugling/project.json`.
Reuse the existing native `TUGLING_PILOT_SOURCE` mechanism for a clean sibling
checkout of that exact revision. Without that variable, the UI commands use
`../tugling-candidate`, the same sibling layout used by native CI. Keep this
third-party dependency outside Keel's source tree so native test discovery does
not collect its own test suites. Local setup may populate the sibling from an
existing Tugling repository; verify its exact revision with
`make ui-evidence-source`. Missing, dirty, or mismatched sources fail visibly.
Do not substitute a personal plugin-cache path or an unreleased candidate.

Use fresh, immutable directories outside the configured source roots for each
run. The commands are:

```sh
make ui-evidence-checks CHECKS=/absolute/new-check-run
make ui-evidence-prepare BRIEF=/absolute/brief.json OUT=/absolute/new-packet
make ui-evidence-check PACKET=/absolute/new-packet REVIEW=/absolute/review.json
make ui-handoff PACKET=/absolute/new-packet REVIEW=/absolute/review.json CHECKS=/absolute/new-check-run REVIEW_RECORD=/absolute/reviewer-record.json
```

These entrypoints invoke the accepted release's `design_evidence.py` with its
`run-checks`, `prepare`, `check`, and `handoff` commands respectively. Inspect
the release's generated reviewer instructions and preserve the actual fresh
review, first-look notes, and session evidence. The author must not fabricate a
reviewer record. The brief must reference the exact resulting native logs and
their exact command strings, not an authored description of a passing check.

The existing `make ui-review-prepare` and `make ui-review-check` remain
compatible with their legacy packets and tests. Those packets lack the released
helper's identity and Git bindings and are not sufficient for `make ui-handoff`.
Prepare a new packet through `ui-evidence-prepare` for a material completion
handoff. This is one final UI gate, not a second set of UI design criteria.

The profile retains the project-owned criteria, `make lint`, the shared-usage
check, full `make e2e`, and full `make verify`. It hashes the gate,
instructions, source pin, workflow, UI inputs, and supporting configuration.
Never put these wrapper targets into the profile's underlying checks, which
would recurse. An unavailable PDF scanner or browser runtime remains a failed
required check; focused rendered checks do not replace it. Native commands,
review coverage, and platform-specific visual-baseline coverage must be reported
separately.

Before a user-facing material proposal (even in scratch space) or completion,
run the final gate on its exact current inputs. Missing/stale evidence, failed
native checks, or unresolved review findings block a verified handoff. Status
and blocked-result reports remain allowed. Test gate failures with disposable
synthetic fixtures; a passing fixture proves plumbing, not a Keel full pass.

Scratch prototypes must not hand off against unrelated catalogue hashes. Before
capture and native checks, bring their actual authored inputs into an approved
catalogue fixture under the profile's source roots, or obtain approval for exact
additional in-repository source coverage. Keep generated packets and captures
outside those roots. The handoff does not automatically discover arbitrary files
outside this project; a private scratch draft alone is not eligible.

The reviewer record is a JSON object with `packetFingerprint`, `reviewSha256`,
`authorSession`, `reviewerSession`, `firstLookNotes`, and `transcript`. Each of
`firstLookNotes` and `transcript` is
`{ "path": "relative-file", "sha256": "actual-file-hash" }`, resolved relative
to the record file. Use actual distinct session identities and preserved
reviewer artifacts. These bindings do not authenticate independence; the review
must actually be performed by a fresh reviewer who sees the rendered screens
before the brief and contracts.
