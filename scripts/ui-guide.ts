import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { groups } from "../e2e/ui-catalogue/catalogue-manifest";
import {
  guidance,
  compositionGuidance,
  type Guidance,
} from "../e2e/ui-catalogue/agent-guidance";

const repository = resolve(import.meta.dirname, "..");
const contractPath = "docs/product/ui-library.md";
const cataloguePath = "e2e/ui-catalogue/keel-ui-catalogue.tsx";
const candidatesPath = "e2e/ui-catalogue/keel-ui-candidates.tsx";
const exportsPath = "packages/ui/src/index.tsx";

function parse(path: string, root: string) {
  return ts.createSourceFile(
    path,
    readFileSync(join(root, path), "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
}
function location(file: ts.SourceFile, node: ts.Node) {
  return {
    path: file.fileName,
    line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1,
  };
}

export function readUiExports(root = repository) {
  const file = parse(exportsPath, root);
  return file.statements.flatMap((statement) => {
    if (
      !ts.isExportDeclaration(statement) ||
      statement.isTypeOnly ||
      !statement.exportClause ||
      !ts.isNamedExports(statement.exportClause) ||
      !statement.moduleSpecifier ||
      !ts.isStringLiteral(statement.moduleSpecifier)
    )
      return [];
    const path = relative(
      root,
      resolve(
        root,
        dirname(exportsPath),
        `${statement.moduleSpecifier.text}.tsx`,
      ),
    );
    const source = parse(path, root);
    return statement.exportClause.elements
      .filter((element) => !element.isTypeOnly)
      .map((element) => {
        const name = element.name.text;
        const localName = element.propertyName?.text ?? name;
        const declaration = source.statements.find((node) =>
          ts.isFunctionDeclaration(node)
            ? node.name?.text === localName
            : ts.isVariableStatement(node) &&
              node.declarationList.declarations.some(
                (item) => item.name.getText(source) === localName,
              ),
        );
        if (!declaration)
          throw new Error(`Missing API declaration for ${name}`);
        const signature =
          ts.isFunctionDeclaration(declaration) && declaration.body
            ? source.text
                .slice(
                  declaration.getStart(source),
                  declaration.body.getStart(source),
                )
                .trim()
            : declaration.getText(source);
        return {
          name,
          ...location(source, declaration),
          signature,
          types: source.statements
            .filter(
              (node) =>
                ts.isTypeAliasDeclaration(node) ||
                ts.isInterfaceDeclaration(node),
            )
            .map((node) => node.getText(source)),
        };
      });
  });
}

function readExample(spec: Guidance["examples"][number], root: string) {
  const file = parse(
    spec.file === "catalogue" ? cataloguePath : candidatesPath,
    root,
  );
  const owner = file.statements.find(
    (node): node is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(node) && node.name?.text === spec.symbol,
  );
  if (!owner) throw new Error(`Missing example ${spec.symbol}`);
  let selected: ts.Node | undefined = spec.title ? undefined : owner;
  function visit(node: ts.Node) {
    if (
      ts.isJsxAttribute(node) &&
      node.name.getText(file) === "title" &&
      node.initializer &&
      ts.isStringLiteral(node.initializer) &&
      node.initializer.text === spec.title
    ) {
      let parent: ts.Node = node;
      while (parent !== owner) {
        if (
          ts.isJsxElement(parent) &&
          ["Example", "section"].includes(
            parent.openingElement.tagName.getText(file),
          )
        ) {
          selected = parent;
          break;
        }
        parent = parent.parent;
      }
    }
    ts.forEachChild(node, visit);
  }
  if (spec.title) visit(owner);
  if (!selected)
    throw new Error(`Missing example ${spec.symbol}: ${spec.title}`);
  return {
    ...location(file, selected),
    owner: spec.symbol,
    ownerLine: location(file, owner).line,
    kind: selected === owner ? "function" : "jsx-fragment",
    code: selected.getText(file),
  };
}

function readRule(heading: string, root: string) {
  const source = readFileSync(join(root, contractPath), "utf8");
  const marker = `## ${heading}\n`;
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`Missing UI rule: ${heading}`);
  const end = source.indexOf("\n## ", start + marker.length);
  return {
    path: contractPath,
    heading,
    line: source.slice(0, start).split("\n").length,
    text: source.slice(start + marker.length, end < 0 ? undefined : end).trim(),
  };
}

/** Fresh on every invocation/build: no generated API snapshots to go stale. */
export function buildUiGuide(root = repository) {
  const exports = readUiExports(root);
  const names = Object.values(groups).flatMap((group) => group.names);
  if (
    new Set(names).size !== names.length ||
    exports.some((item) => !names.includes(item.name)) ||
    names.some((name) => !exports.some((item) => item.name === name))
  )
    throw new Error("Catalogue export coverage has drifted.");
  if (
    Object.keys(groups).some((id) => !guidance[id]) ||
    Object.keys(guidance).some((id) => !groups[id])
  )
    throw new Error("Agent guidance and catalogue groups have drifted.");
  const entries = Object.entries({ ...guidance, ...compositionGuidance }).map(
    ([id, entry]) => {
      const group = groups[id];
      return {
        id,
        kind: group ? "components" : "composition",
        names: group?.names ?? [],
        useWhen: entry.useWhen,
        preview: `/ui/#${group?.page ?? "compositions"}`,
        reference: `/ui/reference/${id}.json`,
        states:
          group?.states ??
          "See the live composition's state controls and browser assertions.",
        rules: entry.rules.map((heading) => readRule(heading, root)),
        api: exports.filter((item) => group?.names.includes(item.name)),
        examples: entry.examples.map((spec) => readExample(spec, root)),
        verification: [
          "e2e/ui-catalogue.visual.spec.ts",
          "scripts/shared-ui-usage.test.ts",
        ],
      };
    },
  );
  return {
    schemaVersion: 1,
    theme: "packages/ui/src/styles.css",
    contracts: [contractPath, "docs/product/ui-and-copy.md"],
    usage:
      "Query by component, composition or task. Read the selected rules and API before coding; examples are the actual typechecked browser fixtures. JSX fragments depend on their owner function's state/imports. Adapt shared controls, never copy demo data, preview-state controls or fixture-only CSS into the app. Inspect rendered desktop/mobile states and run native checks; this index does not prove design quality.",
    entries,
  };
}

export function searchUiGuide(query: string, guide = buildUiGuide()) {
  const words = query.toLowerCase().trim().split(/\s+/u).filter(Boolean);
  if (!words.length) return guide.entries;
  const exact = guide.entries.filter((entry) =>
    [entry.id, ...entry.names].some(
      (name) => name.toLowerCase() === query.toLowerCase().trim(),
    ),
  );
  if (exact.length) return exact;
  return guide.entries.filter((entry) => {
    const haystack = [entry.id, ...entry.names, entry.useWhen, entry.states]
      .join(" ")
      .toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

export function guideIndex(guide = buildUiGuide()) {
  return {
    ...guide,
    entries: guide.entries.map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      names: entry.names,
      useWhen: entry.useWhen,
      preview: entry.preview,
      reference: entry.reference,
      states: entry.states,
      verification: entry.verification,
      rules: entry.rules.map((rule) => ({
        path: rule.path,
        heading: rule.heading,
        line: rule.line,
      })),
    })),
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const guide = buildUiGuide();
  const query =
    process.env.UI_QUERY?.trim() ?? process.argv.slice(2).join(" ").trim();
  const entries = searchUiGuide(query, guide);
  if (!entries.length) {
    console.error(
      `No UI guide match for ${JSON.stringify(query)}. Run make ui-guide for the index.`,
    );
    process.exitCode = 1;
  } else {
    console.log(
      JSON.stringify(
        query ? { ...guide, entries } : guideIndex(guide),
        null,
        2,
      ),
    );
  }
}
