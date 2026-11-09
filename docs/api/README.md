# Ask your portfolio a question

Keel's owner API answers questions about recorded wealth, savings goals, cash
runway and the evidence behind a holding. Start with a local synthetic
portfolio. The same requests work on a protected deployment with a household
read credential.

## Try it locally

1. From a bootstrapped Keel checkout, run `make dev`.
2. Copy the printed API origin, including its port. Drop the trailing
   `/api/alpha`.
3. Give an agent with local HTTP access the following prompt, replacing
   `<origin>`.

> Use Keel at `<origin>`. Discover its contract at `/api/v1/openapi.json`. Read
> my saved goals. Which one has the largest dollar shortfall? Which deadlines
> have enough evidence to assess my pace? Cite the records and their dates. Use
> only reads and unsaved previews.

For a terminal run, use `node examples/api/outlook.mjs <origin>`. The
[walkthrough](owner-outlook-v1.md) includes the scenario request body and
[protected-preview setup](owner-outlook-v1.md#enable-an-agent-in-protected-preview).

## Choose a question

| Ask                                                 | Start with                                                                | Follow the evidence                                                                                                                                                                |
| --------------------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Am I on track for my one-year and ten-year targets? | `GET /outlook` for saved targets or `POST /outlook/preview` for a what-if | Compare today's gap, the target-date gap under a stated assumption, and the required annual improvement. A missing baseline or debt review can leave all three unknown.            |
| Would a capital call force me below my reserve?     | `POST /outlook/preview` with a through-date and an immediate outflow      | Report the first breach, the shortfall, the maximum monthly spending, and the plan date.                                                                                           |
| Did this SPV's valuation change?                    | Use the baseline ID from `GET /outlook` in `GET /marks`                   | Compare the baseline, latest provider snapshot and reviewed valuation. Follow the position and evidence IDs. A company financing announcement alone cannot price the SPV interest. |
| Did I move the goalposts?                           | `GET /goals/{goalId}/versions`                                            | Compare recorded revisions and dates. Asset performance requires separate evidence.                                                                                                |

Paths in the table are relative to `/api/v1`. Amounts for these scenarios are
integer USD cents. Published share prices use millionths of a dollar per share.
The read credential permits unsaved previews. A separate goal-write credential
permits goal creation, revision and archive. Keep credentials with the calling
client.

## Reference and evaluation

- [Operation reference](reference.md) lists verbs, paths, inputs and purpose.
- [OpenAPI 3.1 JSON](openapi.json) supplies the machine-readable contract for
  this revision. On a running instance, discover its own version at
  `GET /api/v1/openapi.json`.
- [Resource design](owner-api-design.md) explains write preconditions,
  pagination and the planned SPV review workflow.
- [Owner question evals](owner-evals.md) gives the answer criteria and replay
  commands.

For a release, run `pnpm docs:api` and include the generated reference and JSON
in the same change as the API. The docs test checks both against the Worker
contract. The Markdown renders on GitHub and the JSON can be downloaded directly
from the matching tag. These public files contain schemas and synthetic
examples. Live portfolio responses stay behind the household grant.
