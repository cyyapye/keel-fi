# Owner question evals

The [question bank](../../examples/api/evals/cases.json) pairs each owner prompt
with expected facts, required evidence and a prose rubric. Amounts in the answer
key are USD cents. The fixture uses two successive states of one disposable
synthetic household. The read-only agent sees HTTP responses. The fixture
separately records reviews and accepts baselines.

| Question                                                                | What a correct answer should establish                                                                                                                                                                              |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| How far short are my saved goals?                                       | FI is $1.425m short and the house fund is $950k short. Neither goal has both a deadline and a matching forecast.                                                                                                    |
| Can you project my net worth from these incomplete records?             | With no accepted baseline or reviewed debt, both horizons are unknown.                                                                                                                                              |
| Will the cash reserve last a year?                                      | The July 1 plan ends at $1.333m against a $103k reserve with $41k monthly burn. There are no reviewed debt payments in this scenario.                                                                               |
| What if a $1.3m capital call is due now?                                | Cash ends at $33k, leaving a $70k reserve gap. The monthly spending cut needed is $5,833.34. Cite the first breach date.                                                                                            |
| Did my home target change?                                              | The history has one revision. There is no recorded target increase.                                                                                                                                                 |
| With a reviewed baseline and debt, how am I doing at one and ten years? | $120,001.20 tracked wealth. Flat net growth gives gaps of $1,998.80 to $122k and $29,998.80 to $150k. The one-year break-even increase is $1,998.80.                                                                |
| Is my SPV marked to market?                                             | The baseline carries $1,000.01. A later provider snapshot reports $1,000.02 with the same observation date. The public source reports company financing. There is no accepted share quote or reviewed GP valuation. |
| Can Keel read the GP email and agreement and book the terms?            | The API identifies a membership interest. Email coverage and reviewed terms are unavailable. The v1 contract exposes no operation for reconciliation or mark acceptance.                                            |
| Did the accepted paper gain extend runway?                              | Across 120 interests, tracked wealth rose $1.20 while projected ending cash changed by $0.                                                                                                                          |

## Rerun the checks

Run `pnpm eval:owner` after changing calculations, evidence selection, schemas,
grants, seeds, documentation generation, or the question bank. It exercises
actual Worker handlers against a fresh local D1 and checks the numbers,
unknowns, evidence links, preview write count and generated docs. These tests
also run under `pnpm test`.

To evaluate an agent's answers or compare model, prompt, documentation or skill
changes:

1. Run `pnpm eval:owner:packet`. It writes `.keel-local/owner-eval/packet.json`
   after the financial cases pass. It contains the questions, output fields and
   labeled API evidence. The packet uses a fixed evaluation date and includes
   selected response fields. Fixture record IDs can differ between runs.
2. Give **only that packet** to a fresh agent. Ask it to follow the instructions
   in the packet and return the JSON array. Keep the same packet for both sides
   of a comparison. Save the response as `.keel-local/owner-eval/answers.json`.
3. Run `pnpm eval:owner:grade .keel-local/owner-eval/answers.json`. It exits
   nonzero for wrong or missing facts, missing answers, or missing required
   citation labels. Then compare **each written answer** to its `review`
   criterion in the bank. Wrong units, an unsupported access claim, a misleading
   financial conclusion or a citation that doesn't support it fails that case
   even if the structured fields pass.
4. Record the git revision, packet checksum, agent/model, instructions, any
   skill version, and per-case facts/citations/prose results in the local run
   notes. To test tool discovery, use the
   [local quickstart](README.md#try-it-locally) with only the origin and a
   question. A packet replay tests interpretation of supplied evidence. A
   live-agent run also tests which calls it chooses.

## Useful questions to add next

- **Which underlying company is my largest exposure across direct holdings and
  SPVs?** Include two vehicles with the same company, a partly mapped fund and
  an unknown allocation. Score known exposure and unquantified exposure
  separately.
- **What changed since my last review?** Separate contributions, distributions,
  debt, valuation changes and revisions to the goal. Require an explicit
  remainder when the records cannot explain the total.
- **Which capital calls are committed but absent from the cash plan?** Test an
  agreement, an amended notice and a payment that is already included. The
  current preview takes an owner-supplied outflow.
- **Two GP documents disagree about carry or share class. Which terms apply?**
  Once ingestion exists, test document dates, vehicle identity, superseded terms
  and a proposed correction with its evidence and decision authority.

A first owner skill worth testing would cover one portfolio review across goals,
liquidity and SPV evidence. Use the same questions with and without the skill.
Ship it when it corrects repeatable mistakes in tool choice or interpretation
without introducing new ones.
