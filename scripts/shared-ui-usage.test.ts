import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

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

describe("shared UI usage", () => {
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
    };
    const violations = reactSourceFiles(webSourceDirectory).flatMap((path) => {
      const relativePath = relative(webSourceDirectory, path);
      const emptyStateClasses = emptyStateClassesByFile[relativePath] ?? [];
      const source = readFileSync(path, "utf8");
      const elements = source.matchAll(
        /<([A-Za-z][\w.]*)\b[^>]*\bclassName="([^"]+)"/gsu,
      );
      return Array.from(elements).flatMap((match) => {
        const [, component = "", className = ""] = match;
        const isAuditedEmptyState = className
          .split(/\s+/u)
          .some((token) => emptyStateClasses.includes(token));
        return isAuditedEmptyState && component !== "EmptyState"
          ? [`${relativePath}: <${component} className="${className}">`]
          : [];
      });
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
