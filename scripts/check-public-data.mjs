import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { extname } from "node:path";

const forbiddenExtensions = new Set([
  ".csv",
  ".eml",
  ".key",
  ".msg",
  ".ofx",
  ".p12",
  ".pdf",
  ".pem",
  ".qfx",
  ".qif",
  ".xls",
  ".xlsx",
]);

const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[opusr]_[A-Za-z0-9_]{30,}\b/,
  /\bsk-[A-Za-z0-9]{32,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/,
  /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/,
];

const paths = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard"],
  { encoding: "utf8" },
)
  .split("\n")
  .filter(Boolean);

const findings = [];

for (const path of paths) {
  if (forbiddenExtensions.has(extname(path).toLowerCase())) {
    findings.push(`${path}: forbidden financial/source-document file type`);
    continue;
  }

  const contents = readFileSync(path);
  if (contents.includes(0)) {
    continue;
  }

  const text = contents.toString("utf8");
  for (const pattern of secretPatterns) {
    if (pattern.test(text)) {
      findings.push(`${path}: content resembles a secret or private key`);
      break;
    }
  }
}

if (findings.length > 0) {
  console.error("Public-data safety scan failed:");
  for (const finding of findings) {
    console.error(`- ${finding}`);
  }
  process.exitCode = 1;
} else {
  console.log(
    `Public-data safety scan passed for ${paths.length} repository files.`,
  );
}
