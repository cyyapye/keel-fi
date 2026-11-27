import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, expect, it } from "vitest";

const script = resolve(import.meta.dirname, "lint-ui-css.mjs");
const ledger = "docs/engineering/ui-style-debt.md";
const fixtures: string[] = [];
afterEach(() => {
  for (const root of fixtures.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function fixture(oldEntries: string[] = []) {
  const root = mkdtempSync(join(tmpdir(), "keel-css-"));
  fixtures.push(root);
  const write = (file: string, source: string) => {
    mkdirSync(join(root, dirname(file)), { recursive: true });
    writeFileSync(join(root, file), source);
  };
  const lint = (...args: string[]) =>
    spawnSync(process.execPath, [script, ...args], {
      cwd: root,
      encoding: "utf8",
    });
  const theme =
    readFileSync(
      resolve(import.meta.dirname, "../packages/ui/src/styles.css"),
      "utf8",
    ).split("\n}")[0] + "\n}";
  write("packages/ui/src/styles.css", theme);
  mkdirSync(join(root, "apps/web"), { recursive: true });
  mkdirSync(join(root, "e2e/ui-catalogue"), { recursive: true });
  write(ledger, ["```text", ...oldEntries, "```", ""].join("\n"));
  return { root, write, lint };
}

it("rejects new spacing and typography drift across app, catalogue and shared CSS", () => {
  const { root, write, lint } = fixture();
  write(
    "apps/web/src/route.css",
    `
    .route { gap: 0.75rem var(--space-2); margin-inline: -4px auto; padding: 0; width: 19px; }
    .text-role--supporting > .child:focus, :not(.text-role--supporting), .text-role--supporting::before { font-size: 14px; }
    .compact .text-role--supporting { font-size: 0.8125rem; font-weight: 400; }
  `,
  );
  expect(lint("--prune").status).toBe(0);
  expect(lint().status).toBe(0);
  write(
    "apps/web/src/nested/new.css",
    ".row { padding-block: 8px 19px; --text-body: 9px; }",
  );
  write(
    "e2e/ui-catalogue/new.css",
    `
    @media (width < 600px) { .cash { font-size: var(--text-unknown); font-weight: 550; } }
    .catalogue-group-stack { gap: var(--space-2); }
    .step .text-role--supporting { font-size: 14px; }
    .text-role--supporting:hover { font-size: 14px; }
    .catalogue-fact-group[data-state="open"] { gap: 24px; }
    .text-role--primary.emphasis { font-weight: 400; }
    :where(.text-role--supporting):focus { font-size: 14px; }
  `,
  );
  write(
    "packages/ui/src/new.css",
    ".extra { gap: var(--space-2, 19px); margin: calc(1rem + 7px); font: 9px fantasy; }",
  );
  const failed = lint();
  expect(failed.status).toBe(1);
  expect(failed.stderr).toContain("13 new off-scale declaration(s)");
  expect(failed.stderr).toContain("padding-block: 8px 19px");
  expect(failed.stderr).toContain(
    "@media (width < 600px) › .cash | font-weight: 550",
  );
  expect(lint("--report", "group-stack").stdout.trim()).toMatch(
    /^e2e\/ui-catalogue\/new\.css:3 .*gap: var\(--space-2\)$/u,
  );
  const themeFile = "packages/ui/src/styles.css";
  const theme = readFileSync(join(root, themeFile), "utf8");
  write(themeFile, theme.replace("--space-3: 12px", "--space-3: 11px"));
  expect(lint().stderr).toContain("--space-3: 11px");
  write(themeFile, theme.replace("--text-body: 14px", "--text-body: 9px"));
  expect(lint().stderr).toContain("--text-body must be 14px");
});

it("retires repaired debt without transferring allowances between declarations or breakpoints", () => {
  const file = "apps/web/src/cash.css";
  const key = `${file} | .cash-accounts__review | gap: 42px`;
  const legacy = ".cash-accounts__review { gap: 42px; }";
  const { root, write, lint } = fixture([key, key]);
  write(file, legacy + "\n" + legacy);
  expect(lint("--prune").status).toBe(0);
  const before = readFileSync(join(root, ledger), "utf8");
  write(file, "\n\n" + legacy + "\n" + legacy);
  expect(lint().status).toBe(0);
  for (const changed of [
    legacy + legacy + legacy,
    legacy.replace("42px", "43px"),
    legacy.replace("__review", "__other"),
    `@media (max-width: 600px) { ${legacy} }`,
  ]) {
    write(file, changed);
    expect(lint("--prune").status).toBe(1);
    expect(readFileSync(join(root, ledger), "utf8")).toBe(before);
  }
  write(file, legacy);
  expect(lint().stderr).toContain("inventory is stale");
  expect(lint("--prune").status).toBe(0);
  expect(lint().status).toBe(0);
  write(file, legacy + legacy);
  expect(lint().stderr).toContain("1 new off-scale declaration(s)");
});
