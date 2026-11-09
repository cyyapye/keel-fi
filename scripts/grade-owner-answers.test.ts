import { expect, it } from "vitest";
import cases from "../examples/api/evals/cases.json";
import { gradeAnswers } from "./grade-owner-answers";

it("rejects invented wealth, omitted citations, and duplicate or missing answers", () => {
  const answers = cases.map((c) => ({
    id: c.id,
    answer: "Synthetic scorer control.",
    facts: { ...c.facts },
    sources: [...c.sources],
  }));
  expect(gradeAnswers(answers)).toEqual([]);
  const wrong = answers.map((a) =>
    a.id === "incomplete-wealth"
      ? {
          ...a,
          facts: { ...a.facts, trackedWealthCents: 0 },
          sources: ["madeUp"],
        }
      : a,
  );
  expect(gradeAnswers([...wrong.slice(0, -1), wrong[0]])).toEqual(
    expect.arrayContaining([
      "incomplete-wealth: incorrect or missing facts",
      "incomplete-wealth: missing or unknown citation",
      "saved-goals: expected one answer; found 2",
      "paper-vs-cash: expected one answer; found 0",
    ]),
  );
});
