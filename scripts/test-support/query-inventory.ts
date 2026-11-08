import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

export type QuerySource = {
  file: string;
  line: number;
  method: string;
  sql: string;
};

export function productionSourceFiles(): string[] {
  const visit = (directory: string): string[] =>
    readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? visit(join(directory, entry.name))
        : /\.tsx?$/u.test(entry.name) && !/\.test\.tsx?$/u.test(entry.name)
          ? [join(directory, entry.name)]
          : [],
    );
  return ["apps/api/src", "packages/database/src"].flatMap(visit).sort();
}

/** Discover call sites, rather than maintaining a handpicked list that can drift. */
export function productionQueries(): QuerySource[] {
  return queriesForSources(
    productionSourceFiles().map((file) => ({
      file,
      contents: readFileSync(file, "utf8"),
    })),
  );
}

function isUnchangedPrepareForwarder(node: ts.CallExpression): boolean {
  const wrapper = node.parent;
  const arrow = wrapper.parent;
  if (
    !ts.isCallExpression(wrapper) ||
    wrapper.arguments.length !== 1 ||
    wrapper.arguments[0] !== node ||
    !ts.isArrowFunction(arrow) ||
    arrow.body !== wrapper ||
    arrow.parameters.length !== 1 ||
    !ts.isPropertyAssignment(arrow.parent) ||
    arrow.parent.initializer !== arrow ||
    !ts.isIdentifier(arrow.parent.name) ||
    arrow.parent.name.text !== "prepare" ||
    node.arguments.length !== 1
  )
    return false;
  const parameter = arrow.parameters[0]!;
  const argument = node.arguments[0]!;
  return (
    ts.isIdentifier(parameter.name) &&
    parameter.type?.kind === ts.SyntaxKind.StringKeyword &&
    parameter.initializer === undefined &&
    parameter.dotDotDotToken === undefined &&
    ts.isIdentifier(argument) &&
    argument.text === parameter.name.text
  );
}

export function sourceQueries(file: string, contents: string): QuerySource[] {
  return queriesForSources([{ file, contents }]);
}

function queriesForSources(
  sources: readonly { file: string; contents: string }[],
): QuerySource[] {
  const queries: QuerySource[] = [];
  for (const { file, contents } of sources) {
    const source = ts.createSourceFile(
      file,
      contents,
      ts.ScriptTarget.Latest,
      true,
    );
    const declarations = new Map<string, ts.VariableDeclaration[]>();
    const collect = (node: ts.Node) => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer
      ) {
        const entries = declarations.get(node.name.text) ?? [];
        entries.push(node);
        declarations.set(node.name.text, entries);
      }
      ts.forEachChild(node, collect);
    };
    collect(source);
    // Nullability may choose finite SQL fragments; arbitrary strings must never
    // become SQL. Opaque values support only null/undefined comparisons.
    const absent = Symbol("undefined");
    const nullableNull = Symbol("null");
    const presentString = Symbol("opaque string");
    type Value = string | boolean | undefined | symbol;
    const evaluate = (
      node: ts.Node,
      values: Record<string, Value>,
      seen = new Set<string>(),
    ): Value => {
      if (ts.isStringLiteralLike(node)) return node.text;
      if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
      if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
      if (node.kind === ts.SyntaxKind.NullKeyword) return nullableNull;
      if (ts.isAsExpression(node) || ts.isParenthesizedExpression(node))
        return evaluate(node.expression, values, seen);
      if (ts.isIdentifier(node)) {
        if (node.text === "undefined") return absent;
        if (node.text in values) return values[node.text];
        if (seen.has(node.text)) return undefined;
        const entries = declarations.get(node.text) ?? [];
        if (entries.length === 1 && entries[0]?.initializer)
          return evaluate(
            entries[0].initializer,
            values,
            new Set([...seen, node.text]),
          );
      }
      if (ts.isBinaryExpression(node)) {
        const left = evaluate(node.left, values, seen),
          right = evaluate(node.right, values, seen);
        if (left === undefined || right === undefined) return undefined;
        if (node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken) {
          if (
            (left === presentString &&
              right !== absent &&
              right !== nullableNull) ||
            (right === presentString &&
              left !== absent &&
              left !== nullableNull)
          )
            return undefined;
          return left === right;
        }
        if (
          node.operatorToken.kind === ts.SyntaxKind.PlusToken &&
          typeof left === "string" &&
          typeof right === "string"
        )
          return left + right;
      }
      if (ts.isConditionalExpression(node)) {
        const condition = evaluate(node.condition, values, seen);
        return typeof condition === "boolean"
          ? evaluate(condition ? node.whenTrue : node.whenFalse, values, seen)
          : undefined;
      }
      if (ts.isTemplateExpression(node)) {
        let result = node.head.text;
        for (const span of node.templateSpans) {
          const value = evaluate(span.expression, values, seen);
          if (typeof value !== "string") return undefined;
          result += value + span.literal.text;
        }
        return result;
      }
      // The only variable-length SQL fragments are bound IN-list placeholders.
      // Validate the actual map body and separator before representing one item.
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === "join" &&
        ts.isCallExpression(node.expression.expression)
      ) {
        const map = node.expression.expression;
        const callback = map.arguments[0];
        if (
          ts.isPropertyAccessExpression(map.expression) &&
          map.expression.name.text === "map" &&
          callback &&
          ts.isArrowFunction(callback) &&
          evaluate(callback.body, values, seen) === "?" &&
          node.arguments[0] &&
          evaluate(node.arguments[0], values, seen) === ", "
        )
          return "?";
      }
      return undefined;
    };
    const visit = (node: ts.Node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === "prepare" &&
        node.arguments[0]
      ) {
        let owner: ts.Node | undefined = node.parent;
        while (
          owner &&
          !ts.isMethodDeclaration(owner) &&
          !ts.isFunctionDeclaration(owner)
        )
          owner = owner.parent;
        const method =
          owner && "name" in owner && owner.name && ts.isIdentifier(owner.name)
            ? owner.name.text
            : "module";
        const line =
          source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
        const variants = new Set<string>();
        let unresolvedVariant = false;
        const direct = evaluate(node.arguments[0], {});
        if (typeof direct === "string") variants.add(direct);
        else {
          // Evaluate the finite parameter types declared by the SQL factory.
          const parameters =
            owner &&
            (ts.isMethodDeclaration(owner) || ts.isFunctionDeclaration(owner))
              ? owner.parameters
              : [];
          let bindings: Record<string, Value>[] = [{}];
          for (const parameter of parameters) {
            if (!ts.isIdentifier(parameter.name)) continue;
            const name = parameter.name.text;
            const type = parameter.type;
            const choices: Value[] =
              type?.kind === ts.SyntaxKind.BooleanKeyword ||
              (parameter.initializer &&
                typeof evaluate(parameter.initializer, {}) === "boolean")
                ? [true, false]
                : type && ts.isUnionTypeNode(type)
                  ? type.types.flatMap<Value>((item) =>
                      ts.isLiteralTypeNode(item) &&
                      ts.isStringLiteral(item.literal)
                        ? [item.literal.text]
                        : ts.isLiteralTypeNode(item) &&
                            item.literal.kind === ts.SyntaxKind.NullKeyword
                          ? [nullableNull]
                          : item.kind === ts.SyntaxKind.UndefinedKeyword
                            ? [absent]
                            : item.kind === ts.SyntaxKind.StringKeyword
                              ? [presentString]
                              : [],
                    )
                  : type?.kind === ts.SyntaxKind.StringKeyword &&
                      parameter.questionToken
                    ? [presentString]
                    : [];
            if (parameter.questionToken && choices.length) choices.push(absent);
            if (choices.length)
              bindings = bindings.flatMap((binding) =>
                choices.map((value) => ({ ...binding, [name]: value })),
              );
          }
          for (const binding of bindings) {
            const sql = evaluate(node.arguments[0], binding);
            if (typeof sql === "string") variants.add(sql);
            else unresolvedVariant = true;
          }
        }
        if (
          (variants.size === 0 || unresolvedVariant) &&
          !isUnchangedPrepareForwarder(node)
        )
          throw new Error(
            `Unaccounted SQL factory at ${file}:${line}: ${node.arguments[0].getText(source)}`,
          );
        for (const sql of variants) queries.push({ file, line, method, sql });
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return queries;
}

export function placeholderCount(sql: string): number {
  return (sql.replace(/'(?:''|[^'])*'/gu, "''").match(/\?/gu) ?? []).length;
}
