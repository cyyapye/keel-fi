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
  const queries: QuerySource[] = [];
  for (const file of productionSourceFiles()) {
    const source = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
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
    type Value = string | boolean | undefined;
    const evaluate = (
      node: ts.Node,
      values: Record<string, Value>,
      seen = new Set<string>(),
    ): Value => {
      if (ts.isStringLiteralLike(node)) return node.text;
      if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
      if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
      if (ts.isAsExpression(node) || ts.isParenthesizedExpression(node))
        return evaluate(node.expression, values, seen);
      if (ts.isIdentifier(node)) {
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
        if (node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken)
          return left === right;
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
          owner &&
          "name" in owner &&
          owner.name &&
          ts.isIdentifier(owner.name as ts.Node)
            ? (owner.name as ts.Identifier).text
            : "module";
        const line =
          source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
        const variants = new Set<string>();
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
            const choices =
              type?.kind === ts.SyntaxKind.BooleanKeyword ||
              (parameter.initializer &&
                typeof evaluate(parameter.initializer, {}) === "boolean")
                ? [true, false]
                : type && ts.isUnionTypeNode(type)
                  ? type.types.flatMap((item) =>
                      ts.isLiteralTypeNode(item) &&
                      ts.isStringLiteral(item.literal)
                        ? [item.literal.text]
                        : [],
                    )
                  : [];
            if (choices.length)
              bindings = bindings.flatMap((binding) =>
                choices.map((value) => ({ ...binding, [name]: value })),
              );
          }
          for (const binding of bindings) {
            const sql = evaluate(node.arguments[0], binding);
            if (typeof sql === "string") variants.add(sql);
          }
        }
        if (variants.size === 0)
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
