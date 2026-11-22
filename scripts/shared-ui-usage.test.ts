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

function sourceFacts(source: string) {
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
    )
      continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const specifier of bindings.elements) {
        if ((specifier.propertyName ?? specifier.name).text === "Input")
          inputs.add(specifier.name.text);
      }
    } else if (bindings && ts.isNamespaceImport(bindings)) {
      inputs.add(`${bindings.name.text}.Input`);
    }
  }
  const elements: {
    component: string;
    attributes: Map<string, string>;
  }[] = [];
  const nativeDateInputs: { component: string; line: number }[] = [];
  let navigationIndicators = 0;
  const disclosureIndicatorCounts: number[] = [];
  function visit(node: ts.Node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const component = node.tagName.getText(file);
      if (component === "CollapsibleTrigger") {
        const trigger = ts.isJsxOpeningElement(node) ? node.parent : node;
        disclosureIndicatorCounts.push(
          trigger.getText(file).match(/<DisclosureIndicator\b/gu)?.length ?? 0,
        );
      }
      const attributes = new Map<string, string>();
      let nativeDate = false;
      for (const attribute of node.attributes.properties) {
        if (!ts.isJsxAttribute(attribute)) continue;
        const name = attribute.name.getText(file);
        const value = attribute.initializer;
        const expression =
          value && ts.isJsxExpression(value) ? value.expression : value;
        const literal =
          expression &&
          (ts.isStringLiteral(expression) ||
            ts.isNoSubstitutionTemplateLiteral(expression));
        attributes.set(
          name,
          value === undefined
            ? "true"
            : literal
              ? expression.text
              : (expression?.getText(file) ?? ""),
        );
        if (name === "type" && literal && expression.text === "date")
          nativeDate = true;
      }
      elements.push({ component, attributes });
      if (component === "DisclosureIndicator") {
        let container = node.parent;
        while (container && !ts.isJsxElement(container))
          container = container.parent;
        if (container) {
          const parent = container.openingElement;
          if (
            parent.tagName.getText(file) === "TextLink" &&
            parent.attributes.properties.some(
              (attribute) =>
                ts.isJsxAttribute(attribute) &&
                ["href", "onClick"].includes(attribute.name.getText(file)),
            )
          )
            navigationIndicators++;
        }
      }
      if (inputs.has(component) && nativeDate)
        nativeDateInputs.push({
          component,
          line:
            file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1,
        });
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return {
    elements,
    nativeDateInputs,
    navigationIndicators,
    disclosureIndicatorCounts,
  };
}

const webSources = reactSourceFiles(webSourceDirectory).map((path) => {
  const source = readFileSync(path, "utf8");
  return {
    relativePath: relative(webSourceDirectory, path),
    source,
    ...sourceFacts(source),
  };
});

describe("shared UI usage", () => {
  it("recognizes native dates through shared inputs without rejecting other controls", () => {
    for (const [source, component] of [
      ['import { Input } from "@keel/ui"; <Input type="date" />', "Input"],
      ['import { Input } from "@keel/ui"; <Input type={"date"} />', "Input"],
      [
        'import { Input as TextInput } from "@keel/ui"; <TextInput type="date" />',
        "TextInput",
      ],
      ['import * as Ui from "@keel/ui"; <Ui.Input type="date" />', "Ui.Input"],
      ['import { Input } from "@keel/ui"; <Input type={`date`} />', "Input"],
    ] as const) {
      expect(sourceFacts(source).nativeDateInputs, source).toEqual([
        { component, line: 1 },
      ]);
    }
    for (const source of [
      'import { DatePicker } from "@keel/ui"; <DatePicker value="" />',
      'import { Input } from "@keel/ui"; <Input />',
      'import { Input } from "@keel/ui"; <Input type="text" />',
      'import { Input as TextInput } from "@keel/ui"; <TextInput type="email" />',
      'import * as Ui from "@keel/ui"; <Ui.Input type="search" />',
      'import { Input } from "other-library"; <Input type="date" />',
      'function Input() {} <Input type="date" />',
      'import { Input } from "@keel/ui"; <Input type={date} />',
    ]) {
      expect(sourceFacts(source).nativeDateInputs, source).toEqual([]);
    }
  });

  it("routes app date selection through DatePicker", () => {
    const violations = webSources.flatMap(
      ({ relativePath, nativeDateInputs }) =>
        nativeDateInputs.map(
          ({ component, line }) =>
            `${relativePath}:${line}: ${component} type=date must use DatePicker`,
        ),
    );
    expect(violations).toEqual([]);
  });

  it("keeps the integrated catalogue controls in the shared library", () => {
    for (const name of ["LegalEntities.tsx", "HoldingImportOutcome.tsx"]) {
      const rawChoices = webSources
        .find(({ relativePath }) => relativePath === name)
        ?.elements.filter(
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

  it("routes app disclosures through the shared Collapsible composition", () => {
    const violations = webSources.flatMap(
      ({
        relativePath,
        source,
        navigationIndicators,
        disclosureIndicatorCounts,
      }) => {
        const disclosureCount = source.match(/<Collapsible\b/gu)?.length ?? 0;
        const triggerCount =
          source.match(/<CollapsibleTrigger\b/gu)?.length ?? 0;
        const contentCount =
          source.match(/<CollapsibleContent\b/gu)?.length ?? 0;
        const indicatorCount =
          (source.match(/<DisclosureIndicator\b/gu)?.length ?? 0) -
          navigationIndicators;
        const nativeDetailsCount = source.match(/<details\b/gu)?.length ?? 0;
        return disclosureCount === triggerCount &&
          triggerCount === contentCount &&
          indicatorCount === triggerCount &&
          disclosureIndicatorCounts.every((count) => count === 1) &&
          nativeDetailsCount === 0
          ? []
          : [
              `${relativePath}: ${disclosureCount} roots, ${triggerCount} triggers, ${contentCount} panels, indicators per trigger [${disclosureIndicatorCounts.join(", ")}], ${nativeDetailsCount} native details`,
            ];
      },
    );

    expect(violations).toEqual([]);
  });

  it("routes reusable action rows through ActionGroup", () => {
    const violations = webSources.flatMap(({ relativePath, source }) => {
      const elements = source.matchAll(
        /<([A-Za-z][\w.]*)\b[^>]*\bclassName="([^"]+)"/gsu,
      );
      return Array.from(elements).flatMap((match) => {
        const [, component = "", className = ""] = match;
        const isActionRow = className
          .split(/\s+/u)
          .some((token) => token.endsWith("actions"));
        return isActionRow && component !== "ActionGroup"
          ? [`${relativePath}: <${component} className="${className}">`]
          : [];
      });
    });

    expect(violations).toEqual([]);
  });

  it("keeps toggle filters from using link-styled buttons", () => {
    const violations = webSources.flatMap(({ relativePath, elements }) =>
      elements.flatMap(({ component, attributes }) =>
        component === "Button" &&
        attributes.has("aria-pressed") &&
        attributes.get("tone") === "quiet"
          ? [`${relativePath}: quiet toggle button`]
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
    const violations = webSources.flatMap(({ relativePath, source }) => {
      const structuralHeadingClasses =
        structuralHeadingClassesByFile[relativePath] ?? [];
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
    const violations = webSources.flatMap(({ relativePath, elements }) => {
      const emptyStateClasses = emptyStateClassesByFile[relativePath] ?? [];
      return elements.flatMap(({ component, attributes }) => {
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
      });
    });

    expect(violations).toEqual([]);
  });

  it("routes alert feedback through shared components", () => {
    const violations = webSources.flatMap(({ relativePath, source }) => {
      return source.includes('role="alert"') ? [relativePath] : [];
    });

    expect(violations).toEqual([]);
  });

  it("routes description lists through DataList", () => {
    const violations = webSources.flatMap(({ relativePath, source }) => {
      return source.includes("<dl") ? [relativePath] : [];
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
    const violations = webSources.flatMap(({ relativePath, source }) => {
      const elements = source.matchAll(
        /<([A-Za-z][\w.]*)\b[^>]*\bclassName="([^"]+)"/gsu,
      );
      return Array.from(elements).flatMap((match) => {
        const [, component = "", className = ""] = match;
        const isReusableMetricGroup = className
          .split(/\s+/u)
          .some((token) => reusableMetricGroups.includes(token));
        return isReusableMetricGroup && component !== "StatGroup"
          ? [`${relativePath}: <${component} className="${className}">`]
          : [];
      });
    });

    expect(violations).toEqual([]);
  });
});
