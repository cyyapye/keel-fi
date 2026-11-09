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
| What changed between two portfolio reviews?                             | Across 120 interests, the $1.20 increase in tracked wealth reconciles to $1.20 of private paper. Liquid assets, reviewed debt and projected ending cash changed by $0.                                              |

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

## After the first v1 rollout

1. **Explain the change since my last review.** The suite already supplies two
   outlooks and scores the component changes without telling the agent the
   cause. Next, try it from only the API origin. An accepted baseline can be
   reopened by ID, but v1 has no record of which outlook the owner last
   reviewed. Start by retaining the prior outlook and its evidence references in
   the client. Compare it to today's outlook. Test a missing prior review and a
   change that the evidence only partly explains. A
   $10,000 increase
   with $7,000 explained should leave $3,000 explicitly
   unexplained. Report goal edits separately from changes in wealth.
2. **Measure one company's exposure across direct holdings and SPVs.** Position
   detail exposes company mappings, but omits allocation weights. The next
   fixture should include $50,000 held directly, a $100,000 SPV with a
   documented 20% exposure by value, and a second SPV with unknown weight. On a
   common valuation date the supported exposure is $70,000 plus an unquantified
   interest. Use that case to design the allocation read.
3. **Find capital calls missing from the cash plan.** Schedule this with GP
   reconciliation. A caller can stress-test a known outflow today. To discover
   missing calls, Keel needs the obligation, latest notice, payment status and
   link to the plan. Test a $50,000 notice amended to $40,000, of which
   $10,000 was paid and $15,000 of the outstanding balance is already in the
   plan. Only $15,000 still needs to be added.

Related reconciliation case:

- **Two GP documents disagree about carry or share class. Which terms apply?**
  Once ingestion exists, test document dates, vehicle identity, superseded terms
  and a proposed correction with its evidence and decision authority.

A first owner skill worth testing would cover one portfolio review across goals,
liquidity and SPV evidence. Use the same questions with and without the skill.
Ship it when it corrects repeatable mistakes in tool choice or interpretation
without introducing new ones.
