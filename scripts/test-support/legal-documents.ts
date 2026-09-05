import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type {
  LegalDocumentScan,
  ProviderLegalDocumentCapture,
} from "../../packages/domain/src/provider-legal-documents";

export function syntheticDocumentScan(
  bytes: Uint8Array = syntheticAgreementPdf(),
  scannedAt = "2026-09-01T12:00:00.000Z",
): LegalDocumentScan {
  return {
    version: 1,
    engineVersion: "1.5.3",
    databaseVersion: 28000,
    databaseUpdatedAt: scannedAt,
    scannedAt,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    outcome: "clean",
  };
}

export function syntheticAgreementPdf(
  lines: readonly string[] = [
    "Subscription Agreement",
    "Issuer: Synthetic Atlas SPV LLC",
  ],
): Uint8Array<ArrayBuffer> {
  const stream = `BT /F1 12 Tf 50 750 Td ${lines.map((line, index) => `${index === 0 ? "" : "0 -20 Td "}(${line.replace(/[()\\]/gu, "\\$&")}) Tj`).join(" ")} ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream).toString()} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${(index + 1).toString()} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${offset.toString().padStart(10, "0")} 00000 n \n`)
    .join(
      "",
    )}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref.toString()}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

export function syntheticDocumentCapture(): ProviderLegalDocumentCapture {
  const bytes = syntheticAgreementPdf();
  return {
    version: 1,
    naturalKeySha256: "a".repeat(64),
    ownershipLabel: "Synthetic Family LLC",
    problem: null,
    documents: [
      {
        documentKey: "b".repeat(64),
        sha256: createHash("sha256").update(bytes).digest("hex"),
        fileName: "synthetic-agreement.pdf",
        byteSize: bytes.length,
        checkedAt: "2026-09-01T12:00:00.000Z",
        scan: syntheticDocumentScan(bytes),
        extraction: {
          version: 1,
          pageCount: 1,
          problem: null,
          citations: [
            {
              legalName: "Synthetic Atlas SPV LLC",
              page: 1,
              quote: "Issuer: Synthetic Atlas SPV LLC",
              role: "issuer",
            },
          ],
        },
      },
    ],
  };
}

class TestStatement {
  public constructor(
    private readonly database: DatabaseSync,
    public readonly sql: string,
    public readonly values: SQLInputValue[] = [],
  ) {}
  public bind(...values: SQLInputValue[]) {
    return new TestStatement(this.database, this.sql, values);
  }
  public first<T>(column?: string): Promise<T | null> {
    const row = this.database.prepare(this.sql).get(...this.values);
    return Promise.resolve(
      row === undefined
        ? null
        : ((column === undefined ? row : row[column]) as T),
    );
  }
  public all<T>() {
    return Promise.resolve({
      results: this.database.prepare(this.sql).all(...this.values) as T[],
    });
  }
  public run() {
    return Promise.resolve(this.execute());
  }
  public execute() {
    const result = this.database.prepare(this.sql).run(...this.values);
    return { success: true, meta: { changes: Number(result.changes) } };
  }
}
export class LegalDocumentTestD1 {
  public readonly queries: string[] = [];
  public readonly statements: TestStatement[] = [];
  public beforeBatch: (() => void) | null = null;
  public constructor(public readonly sqlite: DatabaseSync) {}
  public prepare(sql: string) {
    this.queries.push(sql);
    const statement = new TestStatement(this.sqlite, sql);
    this.statements.push(statement);
    return statement;
  }
  public batch(statements: TestStatement[]) {
    const before = this.beforeBatch;
    this.beforeBatch = null;
    before?.();
    this.sqlite.exec("BEGIN");
    try {
      const results = statements.map((statement) => statement.execute());
      this.sqlite.exec("COMMIT");
      return Promise.resolve(results);
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }
  public asD1() {
    return this as unknown as D1Database;
  }
}
export function legalDocumentTestDatabase() {
  const sqlite = new DatabaseSync(":memory:");
  const root = resolve(process.cwd(), "packages/database");
  for (const file of readdirSync(resolve(root, "migrations"))
    .filter((file) => /^\d{4}_.+\.sql$/u.test(file))
    .sort())
    sqlite.exec(readFileSync(resolve(root, "migrations", file), "utf8"));
  sqlite.exec(readFileSync(resolve(root, "seed/synthetic.sql"), "utf8"));
  return new LegalDocumentTestD1(sqlite);
}
