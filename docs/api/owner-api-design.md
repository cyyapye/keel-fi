# Owner API design for review

All paths start with `/api/v1`. One credential selects one household. A goal
expresses what the owner wants. Accounts, positions and liabilities describe
what the household has. The outlook evaluates those records against the goals.
This proposal covers the HTTP API used by an external agent and, later, by
Keel's built-in agent.

## MVP route map

“Local” means implemented in the local branch. “Proposed” means the route is up
for design review. The [current API guide](owner-outlook-v1.md) describes the
runnable operations and their current response fields.

| Resource            | Method and path                                       | What the agent uses it for                                                                                                                            | State    |
| ------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| API contract        | `GET /openapi.json`                                   | Discover supported operations and schemas.                                                                                                            | Local    |
| Goals               | `POST /goals`                                         | Save a dated net-worth or liquidity target specified by the owner.                                                                                    | Proposed |
| Goals               | `GET /goals`                                          | Find saved targets. Default to active goals and support `?status=archived`.                                                                           | Proposed |
| Goal                | `GET /goals/{goalId}`                                 | Read the target, date, status and current revision, including after archive.                                                                          | Proposed |
| Goal                | `PATCH /goals/{goalId}`                               | Change the target or date, or archive with `{"status":"archived"}`. Return the new revision.                                                          | Proposed |
| Goal history        | `GET /goals/{goalId}/versions`                        | See when the owner changed a target and what it used to be.                                                                                           | Proposed |
| Accounts            | `GET /accounts` · `GET /accounts/{accountId}`         | Find cash and brokerage accounts, their balances, observation dates and evidence.                                                                     | Proposed |
| Positions           | `GET /positions` · `GET /positions/{positionId}`      | Inspect a public holding or an SPV interest, its legal vehicle, available terms, underlying exposures and valuation evidence.                         | Proposed |
| Liabilities         | `GET /liabilities` · `GET /liabilities/{liabilityId}` | Inspect reviewed balances and how each payment affects runway.                                                                                        | Proposed |
| Portfolio baseline  | `GET /baselines/{baselineId}`                         | Reopen the accepted asset totals used in an answer. Include dated component amounts, linked records where available, and any owner-entered aggregate. | Proposed |
| Valuation evidence  | `GET /marks?baselineId={baselineId}`                  | Page through the values used in that baseline alongside the latest recorded provider evidence and mapped public signals.                              | Local    |
| Evidence citation   | `GET /evidence/{evidenceId}`                          | Resolve a citation to its source type, reference, effective date and capture time. Missing dates are explicit.                                        | Proposed |
| Household outlook   | `GET /outlook`                                        | Answer “Where do I stand?” with tracked wealth, saved goals, shortfalls, the cash plan and its reserve.                                               | Local    |
| What-if calculation | `POST /outlook/preview`                               | Test a through-date, hypothetical targets, an assumed annual wealth change or a one-time cash outflow. Saving a goal is a separate operation.         | Local    |

The proposed reads use stable resource IDs and paginated collections. An SPV
position identifies the legal interest owned by the household. Two vehicles
holding the same company have separate position IDs. A current position or
account can change after a baseline is accepted. To explain an earlier answer,
use the value and evidence pinned to the baseline. Current liability detail
links to the reviewed decision used in the outlook. The proposed citation links
identify the specific source through a household-scoped ID. The API returns
unknowns when a recorded figure lacks supporting detail.

## Two calls an agent would make

An agent would use the proposed goal endpoint to save “reach $2 million by
November 2036.”

```http
POST /api/v1/goals
Idempotency-Key: synthetic-target-1
Content-Type: application/json

{"name":"Long-term target","metric":"net_worth","target":{"amountMinor":200000000,"currency":"USD"},"targetDate":"2036-11-08"}
```

The response returns `201`, a stable goal ID, a revision and an `ETag`. The
caller supplies the target. Keel calculates current progress from accepted
records and reports missing inputs. A proposed liquidity goal uses
`metric: "liquidity_through_date"` and `targetDate` to test the saved plan's
reserve on that date. Saving the goal leaves the cash plan under its existing
planning workflow.

An agent can already test whether a $50,000 capital call would put the reserve
at risk through November 2027.

```http
POST /api/v1/outlook/preview
Content-Type: application/json

{"through":"2027-11-08","immediateCashOutflowMinor":5000000}
```

The response gives the first day below reserve, the projected shortfall and the
monthly spending reduction needed under the stated assumptions. The agent can
explain that option and cite the plan. A private valuation increase affects
paper wealth. Cash starts contributing to runway when the plan recognizes it.

## Write contract proposed for goals

The read credential also covers unsaved previews. A separate household goal
write grant permits an owner-directed create, revision or archive. A write
returns the committed goal ID, revision and actor receipt. Use an
`Idempotency-Key` on every write. Replaying the same operation returns its
original receipt. Reusing the key with different inputs returns `409`. For a
`PATCH`, supply the goal's last `ETag` in `If-Match`. A missing precondition
returns `428` and a stale revision returns `412` with a link to reread the goal.
Archiving preserves its versions and removes it from the active outlook. A
primary-goal conflict returns `409` and identifies the required resolution.

## Subsequent SPV reconciliation routes

| Resource         | Proposed method and path                                        | Purpose                                                                                                                                                                        |
| ---------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Evidence         | `POST /evidence`                                                | Register an authorized GP message, agreement, provider report or public observation and return a source ID.                                                                    |
| Proposed changes | `POST /proposals`                                               | Propose adding a manual position or liability, correcting one, or revising an SPV term or mark. Identify the affected resource, source and expected revision where applicable. |
| Review queue     | `GET /proposals?status=pending` · `GET /proposals/{proposalId}` | Inspect the evidence, affected fields, proposed values and current review state.                                                                                               |
| Review decision  | `POST /proposals/{proposalId}/decisions`                        | Record acceptance or dismissal, the deciding person or policy, and the resulting revision. Decision authority has its own grant.                                               |

A routine GP update can proceed under a recorded deterministic policy. An
ambiguous vehicle match or a conflict between an agreement and a GP statement
remains reviewable. Both paths preserve the original evidence and prior accepted
records. Email ingestion and reconciliation are later rollout work.
