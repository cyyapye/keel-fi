import { ESLint, type Linter } from "eslint";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import tseslint from "typescript-eslint";
import { expect, it } from "vitest";

type Plugin = NonNullable<Linter.Config["plugins"]>[string];
const { default: plugin } = (await import(
  pathToFileURL(resolve(import.meta.dirname, "eslint-keel-ui.mjs")).href
)) as { default: Plugin };
const lint = new ESLint({
  overrideConfigFile: true,
  overrideConfig: [
    {
      files: ["**/*.tsx"],
      languageOptions: { parser: tseslint.parser },
      plugins: { "keel-ui": plugin },
      rules: {
        "keel-ui/shared-controls": "error",
        "keel-ui/no-inline-control-restyle": "error",
      },
    },
  ],
});
async function messages(source: string) {
  const [result] = await lint.lintText(source, { filePath: "consumer.tsx" });
  return result!.messages;
}

it("rejects native interactive controls in application consumers", async () => {
  const result = await messages(
    "export const view = <><a /><button /><input /><select /><textarea /><details /></>;",
  );
  expect(result.map((message) => message.ruleId)).toEqual(
    Array(6).fill("keel-ui/shared-controls"),
  );
});

it("rejects appearance overrides through renamed and namespace UI imports", async () => {
  for (const source of [
    'import { Button as Save } from "@keel/ui"; <Save style={{ color: "var(--ink)" }} />;',
    'import * as UI from "@keel/ui"; <UI.Input style={{ fontSize: 24 }} />;',
    'import { Button } from "@keel/ui"; <Button style={{ ["color"]: "red" }} />;',
    'import { Button } from "@keel/ui"; <Button style={{ ...appearance }} />;',
    'import { Button } from "@keel/ui"; <Button style={appearance} />;',
  ]) {
    expect(
      (await messages(source)).map((message) => message.ruleId),
      source,
    ).toEqual(["keel-ui/no-inline-control-restyle"]);
  }
});

it("preserves documented variants, consumer placement and chart dimensions", async () => {
  expect(
    await messages(`
      import { Button, ChartContainer } from "@keel/ui";
      <><Button tone="primary" className="page-action" style={{ gridColumn: "1 / -1", marginInlineStart: 8, width: "100%" }} />
      <ChartContainer style={{ height: height, width: "100%" }} />
      <div style={{ color: "var(--ink)", "--ratio": ratio }} /></>;
    `),
  ).toEqual([]);
});

it("does not claim styling ownership of unrelated or shadowed local components", async () => {
  expect(
    await messages(`
      import { Button } from "other-library";
      <Button style={{ color: "red" }} />;
    `),
  ).toEqual([]);
  expect(
    await messages(`
      import { Button } from "@keel/ui";
      function local(Button) { return <Button style={{ color: "red" }} />; }
    `),
  ).toEqual([]);
});
