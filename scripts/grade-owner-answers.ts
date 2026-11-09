import { readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import cases from "../examples/api/evals/cases.json";

const answerSchema = z.array(
  z.strictObject({
    id: z.string(),
    answer: z.string().trim().min(1),
    facts: z.record(
      z.string(),
      z.union([z.string(), z.int(), z.boolean(), z.null()]),
    ),
    sources: z.array(z.string()).min(1),
  }),
);
export function gradeAnswers(input: unknown) {
  const answers = answerSchema.parse(input);
  const validIds = new Set(cases.map((c) => c.id));
  const evidenceLabels = new Set(cases.flatMap((c) => c.sources));
  const errors = answers
    .filter((a) => !validIds.has(a.id))
    .map((a) => "Unexpected case " + a.id);
  for (const c of cases) {
    const matches = answers.filter((a) => a.id === c.id);
    if (matches.length !== 1) {
      errors.push(c.id + ": expected one answer; found " + matches.length);
      continue;
    }
    const answer = matches[0]!;
    if (!isDeepStrictEqual(answer.facts, c.facts))
      errors.push(c.id + ": incorrect or missing facts");
    if (
      c.sources.some((source) => !answer.sources.includes(source)) ||
      answer.sources.some((source) => !evidenceLabels.has(source))
    )
      errors.push(c.id + ": missing or unknown citation");
  }
  return errors;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  if (process.argv.length !== 3)
    throw new Error("Usage: pnpm eval:owner:grade answers.json");
  const errors = gradeAnswers(
    JSON.parse(await readFile(process.argv[2]!, "utf8")),
  );
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exitCode = 1;
  } else
    console.log(
      "Facts and required citation labels passed for all " +
        cases.length +
        " questions. Review the prose against each case rubric.",
    );
}
