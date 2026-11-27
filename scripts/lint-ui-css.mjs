import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import postcss from "postcss";
import parseSelector from "postcss-selector-parser";

const roots = ["apps/web", "packages/ui", "e2e/ui-catalogue"];
const themeFile = "packages/ui/src/styles.css";
const inventoryFile = "docs/engineering/ui-style-debt.md";
const excludedDirs = new Set(["node_modules", "dist", "coverage", ".wrangler"]);
const spacing =
  /^(?:(?:grid-)?(?:row-|column-)?gap|(?:margin|padding)(?:-(?:top|bottom|left|right|(?:block|inline)(?:-start|-end)?))?)$/u;
const oneLine = (text) => text.trim().replace(/\s*\n\s*/gu, " ");

function* stylesheets(root, dir) {
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    const file = `${dir}/${entry.name}`;
    if (entry.isDirectory() && !excludedDirs.has(entry.name))
      yield* stylesheets(root, file);
    if (entry.isFile() && entry.name.endsWith(".css")) yield file;
  }
}

function themeScale(css) {
  const scale = { space: new Map(), text: new Map(), family: "" };
  for (const rule of css.nodes) {
    if (rule.type !== "rule" || rule.selector !== ":root") continue;
    for (const decl of rule.nodes) {
      if (decl.type !== "decl") continue;
      if (decl.prop === "font-family") scale.family = oneLine(decl.value);
      for (const family of ["space", "text"]) {
        if (decl.prop.startsWith(`--${family}-`))
          scale[family].set(decl.prop, oneLine(decl.value));
      }
    }
  }
  if (!scale.space.size || !scale.text.size || !scale.family)
    throw new Error(`Missing canonical spacing or typography in ${themeFile}`);
  // Keep the public theme aligned with the catalogue's fixed roles and 4px scale.
  for (const [name, size] of scale.space) {
    const steps = /^--space-(\d+)$/u.exec(name);
    if (!steps || size !== `${Number(steps[1]) * 4}px`)
      throw new Error(
        `${themeFile}: ${name}: ${size} is outside the catalogue’s 4px spacing scale`,
      );
  }
  for (const [name, pixels] of Object.entries({
    "--text-xs": 10,
    "--text-sm": 12,
    "--text-supporting": 13,
    "--text-body": 14,
  })) {
    if (scale.text.get(name) !== `${pixels}px`)
      throw new Error(`${themeFile}: ${name} must be ${pixels}px`);
  }
  return scale;
}

function scaleValue(value, tokens, negative = false) {
  const variable = /^var\((.*)\)$/iu.exec(value);
  if (variable) {
    const [name, fallback, ...extra] = postcss.list.comma(variable[1]);
    return (
      tokens.has(name) &&
      !extra.length &&
      (fallback === undefined || scaleValue(fallback, tokens, negative))
    );
  }
  if (negative && /^calc\(-1\s*\*\s*var\(--space-[\w-]+\)\)$/u.test(value)) {
    return tokens.has(value.match(/--space-[\w-]+/u)[0]);
  }
  const length = /^(-?(?:\d*\.)?\d+)(px|rem)$/iu.exec(value);
  if (length) {
    const pixels =
      Number(length[1]) * (length[2].toLowerCase() === "rem" ? 16 : 1);
    value = `${negative ? Math.abs(pixels) : pixels}px`;
  }
  return [...tokens.values()].includes(value);
}

// These explicitly named text and grouping roles have narrower contracts than the scale.
const roles = new Map([
  ["text-role--primary", { "font-size": "--text-body", "font-weight": "600" }],
  ["text-role--body", { "font-size": "--text-body", "font-weight": "400" }],
  [
    "text-role--supporting",
    { "font-size": "--text-supporting", "font-weight": "400" },
  ],
  ["text-role--small", { "font-size": "--text-sm" }],
  ["catalogue-fact-values", { gap: "--space-2" }],
  ["catalogue-fact-group", { gap: "--space-3" }],
  ["catalogue-group-stack", { gap: "--space-6" }],
]);

// Only the selector subject receives the declaration. An ancestor, a negated
// role or the originating element of a pseudo-element does not receive it.
function* subjectRoles(selector) {
  for (const node of selector.nodes.toReversed()) {
    if (node.type === "combinator") break;
    if (node.type === "pseudo") {
      if (
        node.value.startsWith("::") ||
        [":before", ":after", ":first-line", ":first-letter"].includes(
          node.value,
        )
      )
        break;
      if ([":is", ":where"].includes(node.value))
        for (const option of node.nodes) yield* subjectRoles(option);
    }
    if (node.type === "class" && roles.has(node.value))
      yield roles.get(node.value);
  }
}

const ruleRoles = new WeakMap();
function matchesRole(decl, prop, value, scale) {
  const rule = decl.parent;
  if (rule.type !== "rule") return true;
  let targeted = ruleRoles.get(rule);
  if (!targeted) {
    targeted = parseSelector()
      .astSync(rule.selector)
      .nodes.flatMap((branch) => [...subjectRoles(branch)]);
    ruleRoles.set(rule, targeted);
  }
  return targeted.every((role) => {
    const expected = role[prop.endsWith("gap") ? "gap" : prop];
    if (!expected) return true;
    if (prop === "font-weight")
      return (value === "normal" ? "400" : value) === expected;
    const values = prop.endsWith("gap") ? postcss.list.space(value) : [value];
    const tokens = prop.endsWith("gap") ? scale.space : scale.text;
    const required = new Map([[expected, tokens.get(expected)]]);
    return values.every((part) => scaleValue(part, required));
  });
}

function approved(decl, file, scale) {
  const prop = decl.prop.toLowerCase();
  const value = oneLine(decl.value);
  if (/^--(?:space|text)-/u.test(decl.prop)) {
    return (
      file === themeFile &&
      decl.parent.selector === ":root" &&
      decl.parent.parent.type === "root"
    );
  }
  if (
    (prop === "font-size" || prop === "font-weight" || prop.endsWith("gap")) &&
    !matchesRole(decl, prop, value, scale)
  )
    return false;
  if (value === "inherit") return true;
  if (spacing.test(prop)) {
    const margin = prop.startsWith("margin");
    return postcss.list
      .space(value)
      .every(
        (part) =>
          /^(?:0|0px|0rem)$/u.test(part) ||
          (margin && part === "auto") ||
          (prop.endsWith("gap") && part === "normal") ||
          scaleValue(part, scale.space, margin),
      );
  }
  if (prop === "font-size") return scaleValue(value, scale.text);
  // The catalogue also shows its 10px field-label treatment at weight 800.
  if (prop === "font-weight")
    return ["normal", "400", "600", "800"].includes(value);
  if (prop === "font-family") return value === scale.family;
  // A font shorthand sets family, size and weight together.
  return prop !== "font";
}

// These selector families organize the repair queue; they never grant exceptions.
const appAreas = [
  [
    "Cash accounts and baseline",
    /\.(?:cash-(?:accounts|review)|baseline-|portfolio-baseline)/u,
  ],
  ["Planning and goals", /\.(?:plan-|goal-|cash-flow|observed-|runway-)/u],
  [
    "Holdings sources and imports",
    /\.(?:provider-|angellist-|import-|holding-import|source-update|public-source)/u,
  ],
  [
    "Legal entities and ownership",
    /\.(?:legal-|entity-|ownership-|company-names)/u,
  ],
  [
    "Holdings and position details",
    /\.(?:holdings?[-_]|investment-|position-|purchase-|spv-|exposure-|private-exposure|unallocated-|share-valuation|valuation-|distribution-|manual-holding|brokerage-)/u,
  ],
  ["Obligations", /\.(?:(?:manual-|reviewed-)?obligation)/u],
  ["Portfolio Watch", /\.watch-/u],
  [
    "Evidence and decisions",
    /\.(?:evidence-|signal-|decision-|proposed-change|reported-financing)/u,
  ],
  ["Scenarios", /\.(?:scenario-|assumption-|probability-)/u],
  ["Forecast history", /\.(?:history-|forecast-history)/u],
  [
    "Overview and portfolio summaries",
    /\.(?:hero[-_]|portfolio-(?:outlook|chart|snapshot|liquidity)|liquidity-)/u,
  ],
];

function area(file, selector) {
  if (file.startsWith("packages/ui/")) return "Shared UI components and shell";
  if (file.startsWith("e2e/")) {
    if (/\.(?:catalogue-planning|planning-|runway-comparison)/u.test(selector))
      return "UI catalogue planning journey";
    if (file.endsWith("keel-ui-candidates.css"))
      return "UI catalogue compositions and journey candidates";
    return "UI catalogue foundations and walkthroughs";
  }
  if (file.endsWith("/startup.css")) return "Startup";
  if (file.endsWith("/app-access.css")) return "App access";
  if (file.endsWith("/cash-holdings.css")) return "Cash accounts and baseline";
  return (
    appAreas.find(([, match]) => match.test(selector))?.[0] ??
    "Other and shared app layouts"
  );
}

function scan(root) {
  const load = (file) =>
    postcss.parse(readFileSync(join(root, file), "utf8"), { from: file });
  const theme = load(themeFile);
  const scale = themeScale(theme);
  const issues = [];
  for (const dir of roots) {
    for (const file of stylesheets(root, dir)) {
      const sheet = file === themeFile ? theme : load(file);
      sheet.walkDecls((decl) => {
        if (approved(decl, file, scale)) return;
        const context = [];
        for (let node = decl.parent; node.type !== "root"; node = node.parent) {
          context.unshift(
            oneLine(
              node.type === "atrule"
                ? `@${node.name} ${node.params}`
                : node.selector,
            ),
          );
        }
        const property = decl.prop;
        const selector = context.join(" › ");
        const value =
          oneLine(decl.value) + (decl.important ? " !important" : "");
        const key = `${file} | ${selector} | ${property}: ${value}`;
        issues.push({
          file,
          line: decl.source.start.line,
          area: area(file, selector),
          key,
          property,
        });
      });
    }
  }
  return issues;
}

function inventory(issues) {
  const sections = Map.groupBy(issues, (issue) => issue.area);
  const lines = [
    "# UI spacing and typography debt",
    "",
    "Existing off-scale CSS declarations, grouped by selector family. Shared rules",
    "can affect several screens. Each entry identifies its stylesheet, conditional",
    "context, selector and declaration. Repeated entries represent distinct",
    "occurrences.",
    "",
    "Run `pnpm lint:css --report` for live source lines, optionally followed by a",
    "screen name or selector fragment. After a repair, run `pnpm lint:css --prune`",
    "and commit the reduced inventory with the stylesheet. See the",
    "[type and spacing contract](../product/ui-library.md#type-and-spacing-hierarchy).",
    "",
    `Tracked declarations: ${issues.length}.`,
    "",
  ];
  const names = [...sections.keys()].sort();
  for (const name of names) {
    lines.push(
      `- [${name} (${sections.get(name).length})](#${name.toLowerCase().replaceAll(" ", "-")})`,
    );
  }
  if (names.length) lines.push("");
  for (const name of names) {
    const entries = sections.get(name);
    const gaps = entries.filter(
      ({ property }) =>
        spacing.test(property.toLowerCase()) || property.startsWith("--space-"),
    ).length;
    lines.push(
      `## ${name}`,
      "",
      `${gaps} spacing, ${entries.length - gaps} typography.`,
      "",
      "```text",
      ...entries.map(({ key }) => key).sort(),
      "```",
      "",
    );
  }
  return lines.join("\n");
}

function newIssues(issues, previous) {
  const remaining = new Map();
  for (const block of previous.matchAll(/^```text\n([\s\S]*?)^```$/gmu)) {
    for (const key of block[1].trimEnd().split("\n"))
      remaining.set(key, (remaining.get(key) ?? 0) + 1);
  }
  return issues.filter(({ key }) => {
    const count = remaining.get(key) ?? 0;
    if (count === 0) return true;
    remaining.set(key, count - 1);
    return false;
  });
}

function location(issue) {
  return `${issue.file}:${issue.line} [${issue.area}] ${issue.key.slice(issue.file.length + 3)}`;
}

function main(args) {
  const [mode, filter = ""] = args;
  if (
    args.length > 2 ||
    (mode && !["--report", "--prune"].includes(mode)) ||
    (filter && mode !== "--report")
  )
    throw new Error(
      "Usage: pnpm lint:css [--report [screen or selector] | --prune]",
    );
  const root = process.cwd();
  const issues = scan(root);
  if (mode === "--report") {
    for (const issue of issues) {
      const entry = location(issue);
      if (entry.toLowerCase().includes(filter.toLowerCase()))
        console.log(entry);
    }
    return;
  }
  const path = join(root, inventoryFile);
  const previous = readFileSync(path, "utf8");
  const added = newIssues(issues, previous);
  if (added.length) {
    for (const issue of added) console.error(location(issue));
    throw new Error(
      `${added.length} new off-scale declaration(s). Use the shared theme or a documented component role.`,
    );
  }
  const current = inventory(issues);
  if (mode === "--prune") writeFileSync(path, current);
  else if (current !== previous)
    throw new Error(
      "UI debt inventory is stale. Run pnpm lint:css --prune and commit the removals.",
    );
  console.log(
    `UI CSS lint passed. ${issues.length} existing declarations tracked.`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
