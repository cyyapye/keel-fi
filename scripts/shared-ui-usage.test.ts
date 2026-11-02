import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const webSourceDirectory = resolve(import.meta.dirname, "../apps/web/src");

function reactSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return reactSourceFiles(path);
    }
    return entry.isFile() && /\.tsx$/u.test(entry.name) ? [path] : [];
  });
}

function jsxElements(source: string) {
  const elements: {
    component: string;
    attributes: Map<string, string>;
  }[] = [];
  const file = ts.createSourceFile(
    "screen.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  function visit(node: ts.Node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const attributes = new Map<string, string>();
      for (const attribute of node.attributes.properties) {
        if (!ts.isJsxAttribute(attribute)) continue;
        const value = attribute.initializer;
        attributes.set(
          attribute.name.getText(file),
          value === undefined
            ? "true"
            : ts.isStringLiteral(value)
              ? value.text
              : ts.isJsxExpression(value)
                ? value.expression && ts.isStringLiteral(value.expression)
                  ? value.expression.text
                  : (value.expression?.getText(file) ?? "")
                : value.getText(file),
        );
      }
      elements.push({ component: node.tagName.getText(file), attributes });
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return elements;
}

function nativeDateInputs(source: string) {
  const file = ts.createSourceFile(
    "screen.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const inputs = new Set<string>();
  for (const statement of file.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== "@keel/ui"
    ) {
      continue;
    }
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const specifier of bindings.elements) {
        if ((specifier.propertyName ?? specifier.name).text === "Input") {
          inputs.add(specifier.name.text);
        }
      }
    } else if (bindings && ts.isNamespaceImport(bindings)) {
      inputs.add(`${bindings.name.text}.Input`);
    }
  }
  const violations: { component: string; line: number }[] = [];
  function visit(node: ts.Node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const component = node.tagName.getText(file);
      if (inputs.has(component)) {
        for (const attribute of node.attributes.properties) {
          const value = ts.isJsxAttribute(attribute)
            ? attribute.name.getText(file) === "type"
              ? attribute.initializer
              : undefined
            : undefined;
          const expression =
            value && ts.isJsxExpression(value) ? value.expression : value;
          if (
            expression &&
            (ts.isStringLiteral(expression) ||
              ts.isNoSubstitutionTemplateLiteral(expression)) &&
            expression.text === "date"
          ) {
            violations.push({
              component,
              line:
                file.getLineAndCharacterOfPosition(node.getStart(file)).line +
                1,
            });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return violations;
}

describe("shared UI usage", () => {
  it.each([
    ['import { Input } from "@keel/ui"; <Input type="date" />', "Input"],
    ['import { Input } from "@keel/ui"; <Input type={"date"} />', "Input"],
    [
      'import { Input as TextInput } from "@keel/ui"; <TextInput type="date" />',
      "TextInput",
    ],
    ['import * as Ui from "@keel/ui"; <Ui.Input type="date" />', "Ui.Input"],
  ])(
    "rejects a native date through a shared input in %s",
    (source, component) => {
      expect(nativeDateInputs(source)).toEqual([{ component, line: 1 }]);
    },
  );

  it.each([
    'import { DatePicker } from "@keel/ui"; <DatePicker value="" />',
    'import { Input } from "@keel/ui"; <Input />',
    'import { Input } from "@keel/ui"; <Input type="text" />',
    'import { Input as TextInput } from "@keel/ui"; <TextInput type="email" />',
    'import * as Ui from "@keel/ui"; <Ui.Input type="search" />',
    'import { Input } from "other-library"; <Input type="date" />',
    'function Input() {} <Input type="date" />',
  ])("accepts the supported control choice in %s", (source) => {
    expect(nativeDateInputs(source)).toEqual([]);
  });

  it("routes app date selection through DatePicker", () => {
    const violations = reactSourceFiles(webSourceDirectory).flatMap((path) =>
      nativeDateInputs(readFileSync(path, "utf8")).map(
        ({ component, line }) =>
          `${relative(webSourceDirectory, path)}:${line}: ${component} type=date must use DatePicker`,
      ),
    );
    expect(violations).toEqual([]);
  });

  it("keeps the integrated catalogue controls in the shared library", () => {
    for (const name of ["LegalEntities.tsx", "HoldingImportOutcome.tsx"]) {
      const source = readFileSync(join(webSourceDirectory, name), "utf8");
      const rawChoices = jsxElements(source).filter(
        ({ component, attributes }) =>
          component === "Input" &&
          ["checkbox", "radio"].includes(attributes.get("type") ?? ""),
      );
      expect(rawChoices, name).toEqual([]);
    }
    const examples = readFileSync(
      resolve(
        import.meta.dirname,
        "../e2e/ui-catalogue/keel-ui-candidates.tsx",
      ),
      "utf8",
    );
    expect(examples).not.toMatch(
      /function (?:Checkbox|RadioGroup|CollectionFooter|RecordItem|RecordGroup|RecordRow|Spinner|LoadingStatus)\(/u,
    );
    expect(examples).not.toContain("@base-ui/react");
  });

  it("keeps native interactive elements inside @keel/ui", () => {
    const violations = reactSourceFiles(webSourceDirectory).flatMap((path) => {
      const source = readFileSync(path, "utf8");
      const matches = source.match(/<(?:a|button|input|select|textarea)\b/gu);
      return matches === null
        ? []
        : [`${relative(webSourceDirectory, path)}: ${matches.join(", ")}`];
    });

    expect(violations).toEqual([]);
  });

  it("routes app disclosures through the shared Collapsible composition", () => {
    const violations = reactSourceFiles(webSourceDirectory).flatMap((path) => {
      const source = readFileSync(path, "utf8");
      const disclosureCount = source.match(/<Collapsible\b/gu)?.length ?? 0;
      const triggerCount = source.match(/<CollapsibleTrigger\b/gu)?.length ?? 0;
      const contentCount = source.match(/<CollapsibleContent\b/gu)?.length ?? 0;
      const indicatorCount =
        source.match(/<DisclosureIndicator\b/gu)?.length ?? 0;
      const nativeDetailsCount = source.match(/<details\b/gu)?.length ?? 0;
      return disclosureCount === triggerCount &&
        triggerCount === contentCount &&
        contentCount === indicatorCount &&
        nativeDetailsCount === 0
        ? []
        : [
            `${relative(webSourceDirectory, path)}: ${disclosureCount} roots, ${triggerCount} triggers, ${contentCount} panels, ${indicatorCount} indicators, ${nativeDetailsCount} native details`,
          ];
    });

    expect(violations).toEqual([]);
  });

  it("uses Base UI measured-height motion for shared disclosures", () => {
    const collapsibleSource = readFileSync(
      resolve(
        import.meta.dirname,
        "../packages/ui/src/components/collapsible.tsx",
      ),
      "utf8",
    );
    const sharedStyles = readFileSync(
      resolve(import.meta.dirname, "../packages/ui/src/styles.css"),
      "utf8",
    );

    expect(collapsibleSource).toContain('from "@base-ui/react/collapsible"');
    expect(sharedStyles).toContain("height: var(--collapsible-panel-height)");
    expect(sharedStyles).toContain("[data-ending-style]");
    expect(sharedStyles).toContain("prefers-reduced-motion: reduce");
  });

  it("uses DisclosureIndicator for the shared select popup", () => {
    const selectSource = readFileSync(
      resolve(import.meta.dirname, "../packages/ui/src/components/select.tsx"),
      "utf8",
    );

    expect(selectSource).toContain("<DisclosureIndicator");
    expect(selectSource).not.toMatch(
      /<svg\b[^>]*className="select-trigger__icon"/su,
    );
  });

  it("routes reusable action rows through ActionGroup", () => {
    const violations = reactSourceFiles(webSourceDirectory).flatMap((path) => {
      const source = readFileSync(path, "utf8");
      const elements = source.matchAll(
        /<([A-Za-z][\w.]*)\b[^>]*\bclassName="([^"]+)"/gsu,
      );
      return Array.from(elements).flatMap((match) => {
        const [, component = "", className = ""] = match;
        const isActionRow = className
          .split(/\s+/u)
          .some((token) => token.endsWith("actions"));
        return isActionRow && component !== "ActionGroup"
          ? [
              `${relative(webSourceDirectory, path)}: <${component} className="${className}">`,
            ]
          : [];
      });
    });

    expect(violations).toEqual([]);
  });

  it("keeps toggle filters from using link-styled buttons", () => {
    const violations = reactSourceFiles(webSourceDirectory).flatMap((path) =>
      jsxElements(readFileSync(path, "utf8")).flatMap(
        ({ component, attributes }) =>
          component === "Button" &&
          attributes.has("aria-pressed") &&
          attributes.get("tone") === "quiet"
            ? [`${relative(webSourceDirectory, path)}: quiet toggle button`]
            : [],
      ),
    );

    expect(violations).toEqual([]);
  });

  it("routes approved structural headings through SectionHeader", () => {
    const structuralHeadingClassesByFile: Record<string, readonly string[]> = {
      "InvestmentHoldings.tsx": [
        "cash-holdings__heading",
        "investment-institutions__heading",
        "investment-views__heading",
      ],
      "Obligations.tsx": ["obligation-review__heading"],
      "PlanActualMonitoring.tsx": ["plan-monitoring__header"],
      "RouteShells.tsx": ["investment-views__heading"],
    };
    const violations = reactSourceFiles(webSourceDirectory).flatMap((path) => {
      const relativePath = relative(webSourceDirectory, path);
      const structuralHeadingClasses =
        structuralHeadingClassesByFile[relativePath] ?? [];
      const source = readFileSync(path, "utf8");
      const elements = source.matchAll(
        /<([A-Za-z][\w.]*)\b[^>]*\bclassName="([^"]+)"/gsu,
      );
      return Array.from(elements).flatMap((match) => {
        const [, component = "", className = ""] = match;
        const isStructuralHeading = className
          .split(/\s+/u)
          .some((token) => structuralHeadingClasses.includes(token));
        return isStructuralHeading && component !== "SectionHeader"
          ? [`${relativePath}: <${component} className="${className}">`]
          : [];
      });
    });

    expect(violations).toEqual([]);
  });

  it("routes audited compact empty states through EmptyState", () => {
    const emptyStateClassesByFile: Record<string, readonly string[]> = {
      "InvestmentHoldings.tsx": [
        "investment-institution__empty",
        "investment-views__empty",
      ],
      "Obligations.tsx": ["reviewed-obligations__empty"],
      "PortfolioSnapshot.tsx": ["portfolio-movers__empty"],
      "PortfolioWatchMonitor.tsx": ["watch-updates-empty"],
    };
    const violations = reactSourceFiles(webSourceDirectory).flatMap((path) => {
      const relativePath = relative(webSourceDirectory, path);
      const emptyStateClasses = emptyStateClassesByFile[relativePath] ?? [];
      return jsxElements(readFileSync(path, "utf8")).flatMap(
        ({ component, attributes }) => {
          const className = attributes.get("className") ?? "";
          const isAuditedEmptyState = className
            .split(/\s+/u)
            .some((token) => emptyStateClasses.includes(token));
          return isAuditedEmptyState &&
            (component !== "EmptyState" ||
              attributes.get("compact") !== "true" ||
              attributes.get("icon") !== "null")
            ? [
                `${relativePath}: ${className} requires compact EmptyState without an icon`,
              ]
            : [];
        },
      );
    });

    expect(violations).toEqual([]);
  });

  it("routes alert feedback through shared components", () => {
    const violations = reactSourceFiles(webSourceDirectory).flatMap((path) => {
      const source = readFileSync(path, "utf8");
      return source.includes('role="alert"')
        ? [relative(webSourceDirectory, path)]
        : [];
    });

    expect(violations).toEqual([]);
  });

  it("routes description lists through DataList", () => {
    const violations = reactSourceFiles(webSourceDirectory).flatMap((path) => {
      const source = readFileSync(path, "utf8");
      return source.includes("<dl") ? [relative(webSourceDirectory, path)] : [];
    });

    expect(violations).toEqual([]);
  });

  it("routes reusable metric groups through StatGroup", () => {
    const reusableMetricGroups = [
      "cash-flow__comparison",
      "cash-flow__months",
      "cash-review__totals",
      "holding-detail-values",
      "holding-performance__values",
      "import-summary",
      "obligation-review__facts",
      "obligation-review__impact",
      "obligations-impact",
      "plan-inputs__context",
      "plan-inputs__preview",
      "position-economics__values",
      "scenario-summary",
    ];
    const violations = reactSourceFiles(webSourceDirectory).flatMap((path) => {
      const source = readFileSync(path, "utf8");
      const elements = source.matchAll(
        /<([A-Za-z][\w.]*)\b[^>]*\bclassName="([^"]+)"/gsu,
      );
      return Array.from(elements).flatMap((match) => {
        const [, component = "", className = ""] = match;
        const isReusableMetricGroup = className
          .split(/\s+/u)
          .some((token) => reusableMetricGroups.includes(token));
        return isReusableMetricGroup && component !== "StatGroup"
          ? [
              `${relative(webSourceDirectory, path)}: <${component} className="${className}">`,
            ]
          : [];
      });
    });

    expect(violations).toEqual([]);
  });
});
