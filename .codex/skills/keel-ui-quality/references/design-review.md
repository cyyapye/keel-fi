# Design delivery and independent review

Use for a material UI task or a requested rendered-design review. Mechanical
spelling/punctuation corrections keep the skill's focused path. Backend-only and
contributor-documentation changes do not need a UI packet.

## 1. Discover the project

Read `.tugling/ui.json`: it identifies the theme, component exports, catalogue,
contracts, reference screens and native commands. Inspect the relevant sources
and current render. Query the adapter's agent guide for relevant controls,
compositions, usage rules and examples before selecting components. Pick a
reference because it solves the same presentation problem; do not make every
screen look like the same example. Reuse this adapter on subsequent tasks,
checking affected paths for drift.

## 2. Define the design

Write a brief with the user task, domain meaning, approved pattern (or exact
proposal approval reference), components and required states. Describe the
primary answer/action, related facts and supporting detail before selecting
containers. Include the smallest ordinary scenario and an incomplete/exception
case when its meaning affects the design. New concepts still follow the product
contract's proposal approval boundary; a packet or judge response is not
approval.

Required states follow the change: a disclosure repair may need closed/open; a
form needs ordinary, invalid, saving, failure and saved readback; a collection
needs empty, loading, failure/retry and end behavior. Do not require irrelevant
states or treat an initial-view review as verification of the entire workflow.

## 3. Implement with the approved library

Compose `@keel/ui` and its tokens. The catalogue demonstrates the component
contract, while the application owns domain meaning and request behavior. Add
only a missing approved pattern to the library. Run the existing shared-usage
checks; do not install another style library as a substitute for visual review.

## 4. Verify behavior and capture evidence

Use native tests, including existing geometry, accessibility and domain
assertions. Capture current-run desktop/mobile images for each required state.
Use approved reference screenshots for comparison. Keep the check log and state
names with the images. Follow visual-verification.md for baseline changes and
the material handoff gate. Do not regenerate a baseline to hide a failed
assertion.

Run
`make ui-review-prepare BRIEF=/absolute/brief.json OUT=/absolute/new-packet`.
See [the workflow guide](../../../../docs/engineering/ui-design-workflow.md) for
the brief shape. The helper copies evidence and binds it to the current source;
it does not render screenshots, execute checks or decide design quality.

## 5. Challenge the rendered result independently

Delegate a fresh-context review using only the packet's `reviewer.md`, brief,
images, project contracts and native evidence. This is a separate reviewer from
the implementer; do not send expected findings, the author's justification or
previous review conclusions. The reviewer must open each image, explain what the
user can infer, compare the approved reference, and cite a visible location for
each finding. A score or checklist without inspection is insufficient.

Start with `first-look.json` and the current screen images only. Record what
each state communicates before seeing the brief, references or later states.
Then compare those unaided observations with the intended meaning. An open
disclosure cannot compensate for missing scope needed to understand an action in
the closed state; the reviewer must not supply that meaning from the brief.

If independent review is unavailable, report it as unrun; self-review is useful
but is not an independent pass. Never manufacture a reviewer response.

Adjudicate findings against the contract and user task. Fix valid defects within
the authorized scope. Preserve essential financial qualifications and useful
cross-context repetition. For a disputed finding, retain it and explain the
evidence; do not silently change the review to acceptable. Material ambiguity
requires resolution. Capture changed states again and request a fresh review.

Run `make ui-review-check PACKET=/absolute/packet REVIEW=/absolute/review.json`.
`REVIEW_COMPLETE` means only that the response covers the unchanged evidence and
reports no open issues. It cannot authenticate independence, human approval,
native test success or release readiness. Retain the actual reviewer
session/tool record and native results. A source/image/log change invalidates
the packet.

For a small repair use one bounded review. If two correction cycles still fail,
revisit the task/meaning/reference choice instead of making endless spacing
adjustments. Do not promise that this process eliminates all user corrections.
