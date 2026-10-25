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
