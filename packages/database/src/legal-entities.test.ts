import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  DatabaseSync,
  type SQLInputValue,
  type StatementSync,
} from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  legalNameEvidenceRevision,
  LegalEntityTypeSchema,
  type LegalEntityProfileInput,
  type LegalNameResolutionInput,
} from "@keel/domain/legal-entities";
import type { InvestmentPositionView } from "@keel/domain/position-read-model";

import {
  D1LegalEntityRepository,
  LegalEntityRepositoryError,
} from "./legal-entities";

class TestD1Statement {
  private bindings: SQLInputValue[] = [];

  public constructor(
    private readonly statement: StatementSync,
    private readonly recordRoundTrip: () => void,
  ) {}

  public bind(...values: SQLInputValue[]): TestD1Statement {
    this.bindings = values;
    return this;
  }

  public first<T>(): Promise<T | null> {
    this.recordRoundTrip();
    const row = this.statement.get(...this.bindings);
    return Promise.resolve(row === undefined ? null : (row as T));
  }

  public all<T>(): Promise<{ results: T[] }> {
    this.recordRoundTrip();
    return Promise.resolve({
      results: this.statement.all(...this.bindings) as unknown as T[],
    });
  }

  public execute(): void {
    this.statement.run(...this.bindings);
  }
}

class TestD1Database {
  public roundTrips = 0;
  public readonly preparedSql: string[] = [];

  public constructor(private readonly database: DatabaseSync) {}

  public prepare(sql: string): TestD1Statement {
    this.preparedSql.push(sql);
    return new TestD1Statement(this.database.prepare(sql), () => {
      this.roundTrips += 1;
    });
  }

  public batch(statements: readonly TestD1Statement[]): Promise<void> {
    this.roundTrips += 1;
    this.database.exec("BEGIN");
    try {
      statements.forEach((statement) => statement.execute());
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return Promise.resolve();
  }
}

const emptyPositionView = {
  asOf: "2026-09-01T12:00:00.000Z",
  connections: [],
} satisfies InvestmentPositionView;

const profile = {
  legalName: "Synthetic Counsel Export LLC",
  entityType: "llc",
  relationship: "direct_interest",
  currentOwner: null,
  jurisdiction: null,
  formedOn: null,
  einLastFour: null,
  ownershipInterestPpm: null,
  interestStatus: "current",
  taxClassification: null,
  notes: null,
} satisfies LegalEntityProfileInput;

function createDatabase(lastMigration = Number.MAX_SAFE_INTEGER): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  const migrationDirectory = resolve(
    process.cwd(),
    "packages/database/migrations",
  );
  readdirSync(migrationDirectory)
    .filter(
      (file) =>
        /^\d{4}_.+\.sql$/u.test(file) &&
        Number(file.slice(0, 4)) <= lastMigration,
    )
    .sort((left, right) => left.localeCompare(right))
    .forEach((file) => {
      database.exec(readFileSync(resolve(migrationDirectory, file), "utf8"));
    });
  database.exec(
    readFileSync(
      resolve(process.cwd(), "packages/database/seed/synthetic.sql"),
      "utf8",
    ),
  );
  return database;
}

function addHousehold(
  database: DatabaseSync,
  input: { householdId: string; userId: string; accessSubject: string },
) {
  database
    .prepare(
      `INSERT INTO users (
         id, access_subject, email, display_name, created_at
       ) VALUES (?, ?, ?, 'Synthetic Reviewer', '2026-09-01T10:00:00.000Z')`,
    )
    .run(input.userId, input.accessSubject, `${input.userId}@example.invalid`);
  database
    .prepare(
      `INSERT INTO households (
         id, owner_user_id, name, base_currency, created_at
       ) VALUES (?, ?, 'Synthetic Household', 'USD',
         '2026-09-01T10:00:00.000Z')`,
    )
    .run(input.householdId, input.userId);
}

function addSourceContainer(
  database: DatabaseSync,
  input: {
    householdId: string;
    userId: string;
    connectionId: string;
    containerId: string;
    digit: string;
  },
) {
  database
    .prepare(
      `INSERT INTO investment_connections (
         id, household_id, adapter_type, protected_source_key,
         created_by_user_id, created_at, immutable
       ) VALUES (?, ?, 'manual', ?, ?, '2026-09-01T10:00:00.000Z', 1)`,
    )
    .run(
      input.connectionId,
      input.householdId,
      input.digit.repeat(64),
      input.userId,
    );
  database
    .prepare(
      `INSERT INTO ownership_containers (
         id, household_id, connection_id, protected_account_key,
         created_by_user_id, created_at, immutable
       ) VALUES (?, ?, ?, ?, ?, '2026-09-01T10:00:00.000Z', 1)`,
    )
    .run(
      input.containerId,
      input.householdId,
      input.connectionId,
      input.digit.repeat(64),
      input.userId,
    );
}

function positionViewForContainers(
  containers: ReadonlyArray<{ id: string; label: string }>,
): InvestmentPositionView {
  return {
    asOf: "2026-09-01T12:00:00.000Z",
    connections: [
      {
        id: "connection-view-synthetic",
        purpose: "source",
        adapterType: "manual",
        institutionKey: "manual-synthetic",
        institutionLabel: "Reviewed synthetic records",
        lifecycleState: "active",
        containers: containers.map((container) => ({
          id: container.id,
          label: container.label,
          kind: "entity",
          taxTreatment: "unknown",
          coverage: {
            completeness: "complete",
            observedAt: "2026-09-01T11:00:00.000Z",
            freshness: "current",
          },
          positions: [],
        })),
      },
    ],
  };
}

function positionViewForReportedNames(
  sources: ReadonlyArray<{
    id: string;
    legalName: string | null;
    displayName?: string;
  }>,
): InvestmentPositionView {
  return {
    asOf: "2026-09-01T12:00:00.000Z",
    connections: [
      {
        id: "connection-view-reported-names",
        purpose: "source",
        adapterType: "angellist-import",
        institutionKey: "angellist-synthetic",
        institutionLabel: "AngelList export",
        lifecycleState: "active",
        containers: [
          {
            id: "container-view-reported-names",
            label: "Reviewed synthetic investments",
            kind: "unresolved",
            taxTreatment: "unknown",
            coverage: {
              completeness: "complete",
              observedAt: "2026-09-01T11:00:00.000Z",
              freshness: "current",
            },
            positions: sources.map((source) => ({
              id: source.id,
              legalVehicleName:
                source.legalName ?? `Provider display for ${source.id}`,
              legalEntityNameEvidence:
                source.legalName === null
                  ? {
                      state: "unavailable" as const,
                      legalName: null,
                      sourceField: null,
                    }
                  : {
                      state: "provider_reported" as const,
                      legalName: source.legalName,
                      sourceField: "Fund Name",
                    },
              ownerLabel: "Synthetic Household",
              reportedExposureName: source.displayName ?? null,
              kind: "spv_interest",
              openedOn: null,
              reviewStatus: "accepted",
              acceptedAt: "2026-09-01T11:30:00.000Z",
              ownershipVersion: 1,
              ownershipBasis: "reviewed_import",
              source: {
                label: "AngelList export",
                effectiveDate: "2026-08-31",
                retrievedAt: "2026-09-01T11:00:00.000Z",
                freshness: "current",
              },
              snapshot: {
                id: `snapshot_${source.id}`,
                fingerprint: "a".repeat(64),
                observedAt: "2026-09-01T11:00:00.000Z",
                providerStatus: "live",
                investedMinor: 100_000,
                allocationMinor: 100_000,
                unrealizedValue: { state: "locked", minor: null },
                realizedValueMinor: 0,
                netValue: { state: "locked", minor: null },
                instrumentType: "SPV interest",
                currency: "USD",
                quantityMicros: null,
                ticker: null,
                costBasisMinor: null,
              },
            })),
          },
        ],
      },
    ],
  };
}

function addPositionSources(
  database: DatabaseSync,
  sources: ReadonlyArray<{ id: string; legalName: string | null }>,
) {
  const insert = database.prepare(
    `INSERT INTO holding_positions (
       id, household_id, provider, position_fingerprint, legal_vehicle_name,
       owner_label, position_kind, instrument_type, opened_on, currency,
       created_by, created_at
     ) VALUES (?, 'hh_demo', 'angellist', ?, ?, 'Synthetic Household',
       'spv_interest', 'SPV interest', NULL, 'USD', 'usr_demo',
       '2026-09-01T11:00:00.000Z')`,
  );
  database.exec("BEGIN");
  try {
    sources.forEach((source, index) => {
      insert.run(
        source.id,
        (index + 1).toString(16).padStart(64, "0"),
        source.legalName ?? `Provider display ${index + 1}`,
      );
    });
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function conflictView(database: DatabaseSync, count = 1) {
  const sources = Array.from({ length: count }, (_, index) => ({
    id: `position_conflict_${index}`,
    legalName: null,
  }));
  addPositionSources(database, sources);
  const view = positionViewForReportedNames(sources);
  const positions = view.connections[0]?.containers[0]?.positions;
  if (positions === undefined) throw new Error("Missing synthetic positions");
  for (const position of positions) {
    position.legalEntityNameEvidence = {
      state: "unavailable",
      legalName: null,
      sourceField: null,
      problem: "conflicting",
      documents: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          fileName: "subscription.pdf",
          sha256: "a".repeat(64),
          page: 1,
          quote: "Issuer: Synthetic Choice, LLC",
          citations: [
            {
              legalName: "Synthetic Choice, LLC",
              page: 1,
              quote: "Issuer: Synthetic Choice, LLC",
              role: "issuer",
            },
          ],
        },
        {
          id: "22222222-2222-4222-8222-222222222222",
          fileName: "operating.pdf",
          sha256: "b".repeat(64),
          page: 2,
          quote: "Fund: Synthetic Choice LLC",
          citations: [
            {
              legalName: "Synthetic Choice LLC",
              page: 2,
              quote: "Fund: Synthetic Choice LLC",
              role: "fund",
            },
          ],
        },
      ],
    };
  }
  const first = positions[0];
  if (first === undefined) throw new Error("Missing synthetic conflict");
  return { view, first };
}

async function nameChoice(
  view: InvestmentPositionView,
): Promise<LegalNameResolutionInput> {
  const position = view.connections[0]?.containers[0]?.positions[0];
  if (position === undefined) throw new Error("Missing synthetic conflict");
  return {
    kind: "document_choice",
    documentId: "11111111-1111-4111-8111-111111111111",
    legalName: "Synthetic Choice, LLC",
    page: 1,
    quote: "Issuer: Synthetic Choice, LLC",
    reason: null,
    expectedEvidenceRevision: await legalNameEvidenceRevision(
      position.legalEntityNameEvidence,
    ),
  };
}

async function repositoryError(
  promise: Promise<unknown>,
): Promise<LegalEntityRepositoryError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(LegalEntityRepositoryError);
    return error as LegalEntityRepositoryError;
  }
  throw new Error("Expected the repository operation to fail.");
}

describe("legal entity repository", () => {
  it("upgrades legacy structure receipts without rewriting decisions or weakening the rollout type fence", async () => {
    const prior = createDatabase(51);
    try {
      const priorRepository = new D1LegalEntityRepository(
        new TestD1Database(prior) as unknown as D1Database,
      );
      const { view, first } = conflictView(prior);
      const entity = await priorRepository.create(
        "synthetic-access-subject",
        {
          profile: { ...profile, entityType: "other" },
          source: null,
        },
        view,
      );
      const receipt = {
        kind: "document_entry",
        documentId: "11111111-1111-4111-8111-111111111111",
        legalName: profile.legalName,
        page: 1,
        quote: null,
        reason: null,
        fileName: "synthetic-compartment.pdf",
        sha256: "a".repeat(64),
        evidence: {
          state: "unavailable",
          legalName: null,
          sourceField: null,
          problem: "other_structure",
        },
      };
      const insert = (version: number, reviewedEntityType?: string) =>
        prior
          .prepare(
            `INSERT INTO legal_entity_source_decisions (
        id, household_id, source_kind, source_reference, source_name, source_label,
        source_as_of, relationship, interest_status, decision, legal_entity_id,
        version, supersedes_decision_id, decided_by_user_id, decided_at, immutable, name_resolution_json
      ) VALUES (?, 'hh_demo', 'holding_position', ?, 'Synthetic investment', 'Synthetic agreement',
        '2026-09-01', 'investment_vehicle', 'current', 'linked', ?, ?, ?, 'usr_demo',
        '2026-09-01T12:00:00.000Z', 1, ?)`,
          )
          .run(
            `legacy_structure_${version}`,
            first.id,
            entity.id,
            version,
            version === 1 ? null : `legacy_structure_${version - 1}`,
            JSON.stringify({
              ...receipt,
              ...(reviewedEntityType === undefined
                ? {}
                : { reviewedEntityType }),
            }),
          );
      insert(1);
      const before = prior
        .prepare("SELECT * FROM legal_entity_source_decisions ORDER BY id")
        .all();
      prior.exec(
        readFileSync(
          resolve(
            process.cwd(),
            "packages/database/migrations/0052_reviewed_structure_entity_type.sql",
          ),
          "utf8",
        ),
      );
      expect(
        prior
          .prepare("SELECT * FROM legal_entity_source_decisions ORDER BY id")
          .all(),
      ).toEqual(before);
      prior.exec(
        readFileSync(
          resolve(
            process.cwd(),
            "packages/database/migrations/0053_connected_investment_reviews.sql",
          ),
          "utf8",
        ),
      );
      prior.exec(
        readFileSync(
          resolve(
            process.cwd(),
            "packages/database/migrations/0062_reviewed_company_aliases.sql",
          ),
          "utf8",
        ),
      );
      const state = await priorRepository.getState(
        "synthetic-access-subject",
        view,
      );
      expect(
        state.entities.find((item) => item.id === entity.id)?.sources[0]
          ?.nameResolution,
      ).toEqual(receipt);
      insert(2); // An old API can still write an Other receipt after migration.
      await priorRepository.update("synthetic-access-subject", entity.id, {
        expectedVersionId: entity.versionId,
        profile: { ...profile, entityType: "llc" },
      });
      expect(() => insert(3)).toThrow("legal name resolution entity changed");
      expect(() => insert(3, "corporation")).toThrow(
        "legal name resolution entity changed",
      );
      insert(3, "llc"); // The new API must explicitly record the reviewed type.
      expect(
        prior
          .prepare(
            "SELECT name_resolution_json FROM legal_entity_source_decisions WHERE version = 1",
          )
          .get(),
      ).toEqual({ name_resolution_json: JSON.stringify(receipt) });
    } finally {
      prior.close();
    }
  });

  let sqlite: DatabaseSync;
  let d1: TestD1Database;
  let repository: D1LegalEntityRepository;

  it("fences an entity renamed between name validation and the source-decision commit", async () => {
    const { view, first } = conflictView(sqlite);
    const resolution = await nameChoice(view);
    const existing = await repository.create(
      "synthetic-access-subject",
      {
        profile: { ...profile, legalName: resolution.legalName },
        source: null,
      },
      view,
    );
    const originalBatch = d1.batch.bind(d1);
    vi.spyOn(d1, "batch").mockImplementationOnce(async (statements) => {
      await repository.update("synthetic-access-subject", existing.id, {
        expectedVersionId: existing.versionId,
        profile: { ...profile, legalName: "Synthetic Renamed LLC" },
      });
      await originalBatch(statements);
    });
    await expect(
      repository.reviewSource(
        "synthetic-access-subject",
        {
          source: { kind: "holding_position", id: first.id },
          expectedDecisionId: null,
          decision: { kind: "linked", legalEntityId: existing.id },
          nameResolution: resolution,
        },
        view,
      ),
    ).rejects.toMatchObject({ code: "stale" });
    expect(
      sqlite
        .prepare(
          "SELECT COUNT(*) AS count FROM legal_entity_source_decisions WHERE source_reference = ?",
        )
        .get(first.id),
    ).toEqual({ count: 0 });
  });

  it.each(["other", "llc"] as const)(
    "fences a structure target reclassified from %s between review validation and commit",
    async (entityType) => {
      const { view, first } = conflictView(sqlite);
      const document = first.legalEntityNameEvidence.documents![0]!;
      document.scan = {
        version: 2,
        sha256: document.sha256,
        outcome: "clean",
        findings: [],
        engineVersion: "1.4.3",
        databaseVersion: 100,
        databaseUpdatedAt: "2026-09-01T10:00:00.000Z",
        scannedAt: "2026-09-01T11:00:00.000Z",
      };
      first.legalEntityNameEvidence = {
        state: "unavailable",
        legalName: null,
        sourceField: null,
        problem: "other_structure",
        documents: [document],
      };
      const resolution: LegalNameResolutionInput = {
        ...(await nameChoice(view)),
        kind: "document_correction",
        reason: "Reviewed the structure in the executed agreement.",
      };
      const existing = await repository.create(
        "synthetic-access-subject",
        {
          profile: {
            ...profile,
            legalName: resolution.legalName,
            entityType,
          },
          source: null,
        },
        view,
      );
      const originalBatch = d1.batch.bind(d1);
      vi.spyOn(d1, "batch").mockImplementationOnce(async (statements) => {
        await repository.update("synthetic-access-subject", existing.id, {
          expectedVersionId: existing.versionId,
          profile: {
            ...profile,
            legalName: resolution.legalName,
            entityType: "corporation",
          },
        });
        await originalBatch(statements);
      });
      await expect(
        repository.reviewSource(
          "synthetic-access-subject",
          {
            source: { kind: "holding_position", id: first.id },
            expectedDecisionId: null,
            decision: { kind: "linked", legalEntityId: existing.id },
            nameResolution: resolution,
          },
          view,
        ),
      ).rejects.toMatchObject({ code: "stale" });
      expect(
        sqlite
          .prepare(
            "SELECT COUNT(*) AS count FROM legal_entity_source_decisions WHERE source_reference = ?",
          )
          .get(first.id),
      ).toEqual({ count: 0 });
      await repository.reviewSource(
        "synthetic-access-subject",
        {
          source: { kind: "holding_position", id: first.id },
          expectedDecisionId: null,
          decision: { kind: "linked", legalEntityId: existing.id },
          nameResolution: resolution,
        },
        view,
      );
      const reloaded = await repository.getState(
        "synthetic-access-subject",
        view,
      );
      expect(
        reloaded.entities.find((entity) => entity.id === existing.id)
          ?.sources[0]?.nameResolution?.reviewedEntityType,
      ).toBe("corporation");
    },
  );

  it("rolls back the losing entity when two name resolutions arrive together", async () => {
    const { view, first } = conflictView(sqlite);
    const resolution = await nameChoice(view);
    const input = {
      profile: { ...profile, legalName: resolution.legalName },
      source: {
        reference: { kind: "holding_position" as const, id: first.id },
        expectedDecisionId: null,
        nameResolution: resolution,
      },
    };
    const results = await Promise.allSettled([
      repository.create("synthetic-access-subject", input, view),
      repository.create("synthetic-access-subject", input, view),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      sqlite
        .prepare(
          "SELECT COUNT(*) AS count FROM legal_entity_versions WHERE legal_name = ?",
        )
        .get(resolution.legalName),
    ).toEqual({ count: 1 });
    expect(
      sqlite
        .prepare(
          "SELECT COUNT(*) AS count FROM legal_entity_source_decisions WHERE source_reference = ?",
        )
        .get(first.id),
    ).toEqual({ count: 1 });
  });

  it("saves a name choice with original evidence, survives later observations, and rejects duplicate review", async () => {
    const { view, first } = conflictView(sqlite);
    const nameResolution = await nameChoice(view);
    const beforeHoldings = sqlite
      .prepare("SELECT * FROM holding_positions ORDER BY id")
      .all();
    const input = {
      profile: { ...profile, legalName: nameResolution.legalName },
      source: {
        reference: { kind: "holding_position" as const, id: first.id },
        expectedDecisionId: null,
        nameResolution,
      },
    };
    const created = await repository.create(
      "synthetic-access-subject",
      input,
      view,
    );
    expect(created.sources[0]?.nameResolution).toMatchObject({
      kind: "document_choice",
      legalName: nameResolution.legalName,
      sha256: "a".repeat(64),
      evidence: {
        problem: "conflicting",
        documents: [
          { citations: [{ legalName: "Synthetic Choice, LLC" }] },
          { citations: [{ legalName: "Synthetic Choice LLC" }] },
        ],
      },
    });
    await expect(
      repository.create("synthetic-access-subject", input, view),
    ).rejects.toMatchObject({ code: "stale" });
    first.legalEntityNameEvidence = {
      state: "provider_reported",
      legalName: "Synthetic Later LLC",
      sourceField: "Fund Name",
    };
    const state = await repository.getState("synthetic-access-subject", view);
    expect(state.candidates).toHaveLength(0);
    expect(
      state.entities.find((entity) => entity.id === created.id),
    ).toMatchObject({
      legalName: nameResolution.legalName,
      sources: [{ nameResolution: created.sources[0]?.nameResolution }],
    });
    const absent = await repository.getState(
      "synthetic-access-subject",
      emptyPositionView,
    );
    expect(
      absent.entities.find((entity) => entity.id === created.id)?.sources[0]
        ?.nameResolution,
    ).toEqual(created.sources[0]?.nameResolution);
    expect(
      sqlite.prepare("SELECT * FROM holding_positions ORDER BY id").all(),
    ).toEqual(beforeHoldings);
    expect(
      sqlite
        .prepare("SELECT COUNT(*) AS count FROM legal_entity_source_decisions")
        .get(),
    ).toEqual({ count: 1 });
    expect(() =>
      sqlite
        .prepare(
          "UPDATE legal_entity_source_decisions SET name_resolution_json = NULL",
        )
        .run(),
    ).toThrow("immutable");
  });

  it("rejects an unselected conflict, a forged alternative, a foreign document, stale evidence and a blocked source", async () => {
    const countBefore = sqlite
      .prepare("SELECT COUNT(*) AS count FROM legal_entities")
      .get();
    const { view, first } = conflictView(sqlite);
    const resolution = await nameChoice(view);
    const source = {
      reference: { kind: "holding_position" as const, id: first.id },
      expectedDecisionId: null,
    };
    const save = (nameResolution?: LegalNameResolutionInput) =>
      repository.create(
        "synthetic-access-subject",
        {
          profile: {
            ...profile,
            legalName: nameResolution?.legalName ?? resolution.legalName,
          },
          source: {
            ...source,
            ...(nameResolution === undefined ? {} : { nameResolution }),
          },
        },
        view,
      );
    await expect(save()).rejects.toMatchObject({ code: "invalid_source" });
    await expect(
      save({
        ...resolution,
        kind: "document_entry",
        quote: null,
        reason: null,
      }),
    ).rejects.toMatchObject({ code: "invalid_source" });
    await expect(
      save({
        ...resolution,
        legalName: "Invented LLC",
        quote: "Issuer: Invented LLC",
      }),
    ).rejects.toMatchObject({ code: "invalid_source" });
    await expect(
      save({
        ...resolution,
        documentId: "33333333-3333-4333-8333-333333333333",
      }),
    ).rejects.toMatchObject({ code: "invalid_source" });
    await expect(
      save({ ...resolution, expectedEvidenceRevision: "f".repeat(64) }),
    ).rejects.toMatchObject({ code: "stale" });
    first.legalEntityNameEvidence = {
      ...first.legalEntityNameEvidence,
      state: "unavailable",
      legalName: null,
      sourceField: null,
      problem: "security_blocked",
    };
    await expect(
      save({
        ...resolution,
        expectedEvidenceRevision: await legalNameEvidenceRevision(
          first.legalEntityNameEvidence,
        ),
      }),
    ).rejects.toMatchObject({ code: "invalid_source" });
    expect(
      sqlite.prepare("SELECT COUNT(*) AS count FROM legal_entities").get(),
    ).toEqual(countBefore);
  });

  it.each(["name_not_found", "other_structure"] as const)(
    "resolves %s from a clean agreement while rejecting unscanned documents and representative choices",
    async (problem) => {
      const { view, first } = conflictView(sqlite);
      const document = first.legalEntityNameEvidence.documents![0]!;
      first.legalEntityNameEvidence = {
        state: "unavailable",
        legalName: null,
        sourceField: null,
        problem,
        documents: [document],
      };
      document.citations = [];
      const legalName =
        problem === "other_structure"
          ? "Synthetic Series VII"
          : "Synthetic Exact LLC";
      const quote =
        problem === "other_structure"
          ? "Synthetic Series VII, as a compartment of and duly represented by Synthetic Representative LLC, as Issuer."
          : "Issuer: Synthetic Exact LLC";
      if (problem === "other_structure")
        document.structure = {
          kind: "compartment",
          page: 1,
          quote,
          instrument: null,
          parties: [
            { legalName, role: "compartment", page: 1, quote },
            {
              legalName: "Synthetic Representative LLC",
              role: "representative",
              page: 1,
              quote,
            },
          ],
        };
      const resolution = async (): Promise<LegalNameResolutionInput> => ({
        kind:
          problem === "other_structure"
            ? "document_structure"
            : "document_entry",
        documentId: document.id,
        legalName,
        page: 1,
        quote: problem === "other_structure" ? quote : null,
        reason: null,
        expectedEvidenceRevision: await legalNameEvidenceRevision(
          first.legalEntityNameEvidence,
        ),
      });
      const save = async (
        override: Partial<LegalNameResolutionInput> = {},
        entityType: "other" | "llc" = problem === "other_structure"
          ? "other"
          : "llc",
      ) => {
        const nameResolution = { ...(await resolution()), ...override };
        return repository.create(
          "synthetic-access-subject",
          {
            profile: {
              ...profile,
              legalName: nameResolution.legalName,
              entityType,
            },
            source: {
              reference: { kind: "holding_position", id: first.id },
              expectedDecisionId: null,
              nameResolution,
            },
          },
          view,
        );
      };
      await expect(save()).rejects.toMatchObject({ code: "invalid_source" });
      document.scan = {
        version: 2,
        sha256: document.sha256,
        outcome: "clean",
        findings: [],
        engineVersion: "1.4.3",
        databaseVersion: 100,
        databaseUpdatedAt: "2026-09-01T10:00:00.000Z",
        scannedAt: "2026-09-01T11:00:00.000Z",
      };
      await expect(
        save({ expectedEvidenceRevision: "f".repeat(64) }),
      ).rejects.toMatchObject({ code: "stale" });
      if (problem === "other_structure") {
        await expect(
          save({ legalName: "Synthetic Representative LLC" }),
        ).rejects.toMatchObject({ code: "invalid_source" });
      }
      const result = await save();
      expect(result.sources[0]?.nameResolution).toMatchObject({
        legalName,
        quote: problem === "other_structure" ? quote : null,
        reason: null,
        documentId: document.id,
        fileName: document.fileName,
        sha256: document.sha256,
      });
      const reloaded = await repository.getState(
        "synthetic-access-subject",
        view,
      );
      expect(
        reloaded.entities.find((entity) => entity.id === result.id)?.sources[0]
          ?.nameResolution?.evidence,
      ).toEqual(first.legalEntityNameEvidence);
    },
  );

  it("records an explicitly document-backed correction when legacy extraction has no choices", async () => {
    const { view, first } = conflictView(sqlite);
    for (const document of first.legalEntityNameEvidence.documents ?? [])
      document.citations = [];
    const resolution: LegalNameResolutionInput = {
      ...(await nameChoice(view)),
      kind: "document_correction",
      legalName: "Synthetic Corrected LLC",
      quote: "Issuer: Synthetic Corrected LLC",
      reason: "The executed subscription identifies this vehicle.",
    };
    const entity = await repository.create(
      "synthetic-access-subject",
      {
        profile: { ...profile, legalName: resolution.legalName },
        source: {
          reference: { kind: "holding_position", id: first.id },
          expectedDecisionId: null,
          nameResolution: resolution,
        },
      },
      view,
    );
    expect(entity.sources[0]?.nameResolution).toMatchObject({
      kind: "document_correction",
      reason: resolution.reason,
      legalName: resolution.legalName,
    });
  });

  it.each(LegalEntityTypeSchema.options)(
    "stores a manually reviewed compartment type %s without changing its structure evidence",
    async (entityType) => {
      const { view, first } = conflictView(sqlite);
      const document = first.legalEntityNameEvidence.documents![0]!;
      document.citations = [];
      document.scan = {
        version: 2,
        sha256: document.sha256,
        outcome: "clean",
        findings: [],
        engineVersion: "1.4.3",
        databaseVersion: 100,
        databaseUpdatedAt: "2026-09-01T10:00:00.000Z",
        scannedAt: "2026-09-01T11:00:00.000Z",
      };
      document.structure = {
        kind: "compartment",
        page: 1,
        quote: "as a compartment of Synthetic Representative LLC",
        parties: [],
        instrument: null,
      };
      first.legalEntityNameEvidence = {
        state: "unavailable",
        legalName: null,
        sourceField: null,
        problem: "other_structure",
        documents: [document],
      };
      const resolution: LegalNameResolutionInput = {
        kind: "document_entry",
        documentId: document.id,
        legalName: "Synthetic Series IX",
        page: 2,
        quote: null,
        reason: null,
        expectedEvidenceRevision: await legalNameEvidenceRevision(
          first.legalEntityNameEvidence,
        ),
      };
      const entity = await repository.create(
        "synthetic-access-subject",
        {
          profile: { ...profile, legalName: resolution.legalName, entityType },
          source: {
            reference: { kind: "holding_position", id: first.id },
            expectedDecisionId: null,
            nameResolution: resolution,
          },
        },
        view,
      );
      const reloaded = await repository.getState(
        "synthetic-access-subject",
        view,
      );
      expect(
        reloaded.entities.find((item) => item.id === entity.id)?.sources[0]
          ?.nameResolution,
      ).toMatchObject({
        kind: "document_entry",
        legalName: resolution.legalName,
        page: 2,
        quote: null,
        reason: null,
        fileName: document.fileName,
        sha256: document.sha256,
        reviewedEntityType: entityType,
        evidence: first.legalEntityNameEvidence,
      });
      expect(
        reloaded.entities.find((item) => item.id === entity.id)?.entityType,
      ).toBe(entityType);
      expect(
        reloaded.entities.find((item) => item.id === entity.id)?.sources[0]
          ?.legalEntityNameEvidence,
      ).toEqual(first.legalEntityNameEvidence);
      await repository.update("synthetic-access-subject", entity.id, {
        expectedVersionId: entity.versionId,
        profile: {
          ...profile,
          legalName: resolution.legalName,
          entityType: entityType === "llc" ? "other" : "llc",
        },
      });
      const edited = await repository.getState(
        "synthetic-access-subject",
        view,
      );
      expect(
        edited.entities.find((item) => item.id === entity.id)?.sources[0]
          ?.nameResolution?.reviewedEntityType,
      ).toBe(entityType);
    },
  );

  it("rejects an unrelated saved entity for a found name and guards a rename during linking", async () => {
    const { view, first } = conflictView(sqlite);
    first.legalEntityNameEvidence = {
      state: "provider_reported",
      legalName: "Synthetic Found Vehicle LLC",
      sourceField: "Fund Name",
    };
    const existing = await repository.create(
      "synthetic-access-subject",
      { profile, source: null },
      view,
    );
    const input = {
      source: { kind: "holding_position" as const, id: first.id },
      expectedDecisionId: null,
      decision: { kind: "linked" as const, legalEntityId: existing.id },
    };
    await expect(
      repository.reviewSource("synthetic-access-subject", input, view),
    ).rejects.toMatchObject({ code: "invalid_source" });
    const matching = await repository.update(
      "synthetic-access-subject",
      existing.id,
      {
        expectedVersionId: existing.versionId,
        profile: { ...profile, legalName: "Synthetic Found Vehicle LLC" },
      },
    );
    const commit = d1.batch.bind(d1);
    vi.spyOn(d1, "batch").mockImplementationOnce(async (statements) => {
      await repository.update("synthetic-access-subject", existing.id, {
        expectedVersionId: matching.versionId,
        profile: { ...profile, legalName: "Synthetic Renamed Vehicle LLC" },
      });
      return commit(statements);
    });
    await expect(
      repository.reviewSource("synthetic-access-subject", input, view),
    ).rejects.toMatchObject({ code: "stale" });
    expect(
      sqlite
        .prepare(
          "SELECT COUNT(*) count FROM legal_entity_source_decisions WHERE source_reference = ?",
        )
        .get(first.id),
    ).toEqual({ count: 0 });
  });

  it("links a resolved name only to the exact household entity and protects its current name", async () => {
    const { view, first } = conflictView(sqlite);
    const resolution = await nameChoice(view);
    const existing = await repository.create(
      "synthetic-access-subject",
      { profile, source: null },
      view,
    );
    const input = {
      source: { kind: "holding_position" as const, id: first.id },
      expectedDecisionId: null,
      decision: { kind: "linked" as const, legalEntityId: existing.id },
      nameResolution: resolution,
    };
    await expect(
      repository.reviewSource("synthetic-access-subject", input, view),
    ).rejects.toMatchObject({ code: "invalid_source" });
    await expect(
      repository.reviewSource(
        "synthetic-access-subject",
        {
          ...input,
          decision: { kind: "linked", legalEntityId: "foreign-entity" },
        },
        view,
      ),
    ).rejects.toMatchObject({ code: "not_found" });
    await repository.update("synthetic-access-subject", existing.id, {
      expectedVersionId: existing.versionId,
      profile: { ...profile, legalName: resolution.legalName },
    });
    await repository.reviewSource("synthetic-access-subject", input, view);
    await expect(
      repository.reviewSource("synthetic-access-subject", input, view),
    ).rejects.toMatchObject({ code: "stale" });
    const state = await repository.getState("synthetic-access-subject", view);
    expect(
      state.entities.filter(
        (entity) => entity.legalName === resolution.legalName,
      ),
    ).toHaveLength(1);
    expect(
      state.entities.find((entity) => entity.id === existing.id)?.sources[0]
        ?.nameResolution?.legalName,
    ).toBe(resolution.legalName);
  });

  it("keeps 120 resolved source receipts on the four-query indexed read budget", async () => {
    const { view } = conflictView(sqlite, 120);
    const positions = view.connections[0]?.containers[0]?.positions ?? [];
    const resolution = await nameChoice(view);
    const existing = await repository.create(
      "synthetic-access-subject",
      {
        profile: { ...profile, legalName: resolution.legalName },
        source: null,
      },
      view,
    );
    for (const position of positions)
      await repository.reviewSource(
        "synthetic-access-subject",
        {
          source: { kind: "holding_position", id: position.id },
          expectedDecisionId: null,
          decision: { kind: "linked", legalEntityId: existing.id },
          nameResolution: resolution,
        },
        view,
      );
    d1.roundTrips = 0;
    d1.preparedSql.length = 0;
    const state = await repository.getState("synthetic-access-subject", view);
    expect(
      state.entities.find((entity) => entity.id === existing.id)?.sources,
    ).toHaveLength(120);
    expect(
      state.entities
        .find((entity) => entity.id === existing.id)
        ?.sources.every(
          (source) => source.nameResolution?.legalName === resolution.legalName,
        ),
    ).toBe(true);
    expect(d1.roundTrips).toBe(4);
    for (const sql of d1.preparedSql) {
      const plan = sqlite.prepare(`EXPLAIN QUERY PLAN ${sql}`).all("hh_demo");
      expect(plan.some((row) => /SCAN later/u.test(String(row.detail)))).toBe(
        false,
      );
    }
  });

  beforeEach(() => {
    sqlite = createDatabase();
    d1 = new TestD1Database(sqlite);
    repository = new D1LegalEntityRepository(d1 as unknown as D1Database);
  });

  afterEach(() => sqlite.close());

  it("appends reviewed profile versions and rejects stale edits", async () => {
    const created = await repository.create(
      "synthetic-access-subject",
      { profile, source: null },
      emptyPositionView,
    );
    expect(created).toMatchObject({
      legalName: "Synthetic Counsel Export LLC",
      version: 1,
      sources: [],
    });

    const updated = await repository.update(
      "synthetic-access-subject",
      created.id,
      {
        expectedVersionId: created.versionId,
        profile: {
          ...profile,
          currentOwner: "Demo Operator",
          jurisdiction: "Delaware, US",
          ownershipInterestPpm: 750_000,
        },
      },
    );
    expect(updated).toMatchObject({
      version: 2,
      currentOwner: "Demo Operator",
      ownershipInterestPpm: 750_000,
    });

    const stale = await repositoryError(
      repository.update("synthetic-access-subject", created.id, {
        expectedVersionId: created.versionId,
        profile,
      }),
    );
    expect(stale.code).toBe("stale");

    const versionCount = sqlite
      .prepare(
        `SELECT COUNT(*) AS count
         FROM legal_entity_versions
         WHERE legal_entity_id = ?`,
      )
      .get(created.id) as { count: number };
    expect(versionCount.count).toBe(2);
    expect(() =>
      sqlite
        .prepare("UPDATE legal_entity_versions SET legal_name = 'Changed'")
        .run(),
    ).toThrow("immutable");
  });

  it("requires exact, household-scoped source review decisions", async () => {
    addSourceContainer(sqlite, {
      householdId: "hh_demo",
      userId: "usr_demo",
      connectionId: "connection_demo_entity_sources",
      containerId: "container_demo_entity_candidate",
      digit: "a",
    });
    addSourceContainer(sqlite, {
      householdId: "hh_demo",
      userId: "usr_demo",
      connectionId: "connection_demo_excluded_sources",
      containerId: "container_demo_not_llc",
      digit: "b",
    });
    const positionView = positionViewForContainers([
      {
        id: "container_demo_entity_candidate",
        label: "Synthetic Candidate LLC",
      },
      { id: "container_demo_not_llc", label: "Synthetic Brokerage" },
    ]);

    const created = await repository.create(
      "synthetic-access-subject",
      {
        profile: { ...profile, legalName: "Synthetic Candidate LLC" },
        source: {
          reference: {
            kind: "ownership_container",
            id: "container_demo_entity_candidate",
          },
          expectedDecisionId: null,
        },
      },
      positionView,
    );
    const excluded = await repository.reviewSource(
      "synthetic-access-subject",
      {
        source: {
          kind: "ownership_container",
          id: "container_demo_not_llc",
        },
        expectedDecisionId: null,
        decision: { kind: "not_llc" },
      },
      positionView,
    );

    let state = await repository.getState(
      "synthetic-access-subject",
      positionView,
    );
    expect(state.candidates).toHaveLength(0);
    expect(
      state.entities.find((entity) => entity.id === created.id)?.sources,
    ).toMatchObject([
      {
        source: {
          kind: "ownership_container",
          id: "container_demo_entity_candidate",
        },
      },
    ]);
    expect(state.excludedCandidates).toMatchObject([
      { currentDecisionId: excluded.decisionId },
    ]);

    const stale = await repositoryError(
      repository.reviewSource(
        "synthetic-access-subject",
        {
          source: {
            kind: "ownership_container",
            id: "container_demo_not_llc",
          },
          expectedDecisionId: null,
          decision: { kind: "linked", legalEntityId: created.id },
        },
        positionView,
      ),
    );
    expect(stale.code).toBe("stale");

    await repository.reviewSource(
      "synthetic-access-subject",
      {
        source: {
          kind: "ownership_container",
          id: "container_demo_not_llc",
        },
        expectedDecisionId: excluded.decisionId,
        decision: { kind: "linked", legalEntityId: created.id },
      },
      positionView,
    );
    state = await repository.getState("synthetic-access-subject", positionView);
    expect(state.excludedCandidates).toHaveLength(0);
    expect(
      state.entities.find((entity) => entity.id === created.id)?.sources,
    ).toHaveLength(2);

    addHousehold(sqlite, {
      householdId: "hh_other_synthetic",
      userId: "usr_other_synthetic",
      accessSubject: "other-synthetic-subject",
    });
    addSourceContainer(sqlite, {
      householdId: "hh_other_synthetic",
      userId: "usr_other_synthetic",
      connectionId: "connection_other_entity_sources",
      containerId: "container_other_entity_candidate",
      digit: "c",
    });
    const foreignPositionView = positionViewForContainers([
      {
        id: "container_other_entity_candidate",
        label: "Other Household LLC",
      },
    ]);
    await expect(
      repository.create(
        "synthetic-access-subject",
        {
          profile: { ...profile, legalName: "Other Household LLC" },
          source: {
            reference: {
              kind: "ownership_container",
              id: "container_other_entity_candidate",
            },
            expectedDecisionId: null,
          },
        },
        foreignPositionView,
      ),
    ).rejects.toThrow("source container mismatch");
  });

  it("reviews only source-reported LLC and LP names together", async () => {
    const sources = [
      {
        id: "position_exact_existing",
        label: "Synthetic Existing LLC",
      },
      {
        id: "position_exact_lp_a",
        label: "Synthetic Seed Fund I, LP",
      },
      {
        id: "position_exact_lp_b",
        label: "Synthetic Seed Fund I, LP",
      },
      {
        id: "position_name_unavailable",
        label: "Synthetic Operating Account",
      },
    ] as const;
    const reportedPositionView = positionViewForReportedNames(
      sources.map((source) => ({
        id: source.id,
        legalName:
          source.id === "position_name_unavailable" ? null : source.label,
        displayName: `${source.label} investment`,
      })),
    );
    addPositionSources(
      sqlite,
      sources.map((source) => ({
        id: source.id,
        legalName:
          source.id === "position_name_unavailable" ? null : source.label,
      })),
    );
    const ownershipLabelView = positionViewForContainers([
      { id: "container_label_only", label: "Synthetic Label Only LLC" },
    ]);
    const positionView: InvestmentPositionView = {
      ...reportedPositionView,
      connections: [
        ...reportedPositionView.connections,
        ...ownershipLabelView.connections,
      ],
    };
    const existing = await repository.create(
      "synthetic-access-subject",
      {
        profile: { ...profile, legalName: "synthetic existing llc" },
        source: null,
      },
      positionView,
    );

    const pending = await repository.getState(
      "synthetic-access-subject",
      positionView,
    );
    expect(pending).toMatchObject({
      version: 3,
      exactBatch: {
        sourceCount: 3,
        entityCount: 2,
        existingEntityCount: 1,
        newEntityCount: 1,
        llcEntityCount: 1,
        limitedPartnershipEntityCount: 1,
        remainingCandidateCount: 2,
      },
    });

    const result = await repository.applyExactBatch(
      "synthetic-access-subject",
      { expectedRevision: pending.exactBatch.revision },
      positionView,
    );
    expect(result).toEqual({
      version: 1,
      reviewedSourceCount: 3,
      entityCount: 2,
      existingEntityCount: 1,
      createdEntityCount: 1,
      remainingCandidateCount: 2,
    });

    const state = await repository.getState(
      "synthetic-access-subject",
      positionView,
    );
    expect(
      state.candidates.map((candidate) => candidate.sourceDisplayName),
    ).toEqual([
      "Synthetic Label Only LLC",
      "Synthetic Operating Account investment",
    ]);
    expect(
      state.candidates.every(
        (candidate) =>
          candidate.legalEntityNameEvidence.state === "unavailable",
      ),
    ).toBe(true);
    expect(
      state.entities.find((entity) => entity.id === existing.id)?.sources,
    ).toHaveLength(1);
    const limitedPartnership = state.entities.find(
      (entity) => entity.legalName === "Synthetic Seed Fund I, LP",
    );
    expect(limitedPartnership).toMatchObject({
      entityType: "limited_partnership",
      jurisdiction: null,
      formedOn: null,
      einLastFour: null,
      ownershipInterestPpm: null,
      taxClassification: null,
      notes: null,
    });
    expect(limitedPartnership?.sources).toHaveLength(2);
    expect(
      sqlite
        .prepare(
          `SELECT COUNT(*) AS count
           FROM legal_entities entity
           JOIN legal_entity_versions version
             ON version.legal_entity_id = entity.id
           WHERE entity.household_id = 'hh_demo'
             AND lower(version.legal_name) = 'synthetic existing llc'`,
        )
        .get(),
    ).toEqual({ count: 1 });

    const decisionCount = sqlite
      .prepare(
        `SELECT COUNT(*) AS count
         FROM legal_entity_source_decisions
         WHERE source_reference IN (
           'position_exact_existing',
           'position_exact_lp_a',
           'position_exact_lp_b'
         )`,
      )
      .get();
    await expect(
      repository.applyExactBatch(
        "synthetic-access-subject",
        { expectedRevision: pending.exactBatch.revision },
        positionView,
      ),
    ).rejects.toMatchObject({ code: "stale" });
    expect(
      sqlite
        .prepare(
          `SELECT COUNT(*) AS count
           FROM legal_entity_source_decisions
           WHERE source_reference IN (
             'position_exact_existing',
             'position_exact_lp_a',
             'position_exact_lp_b'
           )`,
        )
        .get(),
    ).toEqual(decisionCount);
  });

  it("invalidates an exact-name batch when only its document evidence changes", async () => {
    const sources = [
      { id: "position_document_revision", legalName: "Synthetic Evidence LLC" },
    ];
    addPositionSources(sqlite, sources);
    const view = positionViewForReportedNames(sources);
    const position = view.connections[0]?.containers[0]?.positions[0];
    if (position === undefined) throw new Error("Synthetic position missing");
    const document = {
      id: "11111111-1111-4111-8111-111111111111",
      fileName: "synthetic-subscription.pdf",
      sha256: "b".repeat(64),
      page: 1,
      quote: "Issuer: Synthetic Evidence LLC",
    };
    position.legalEntityNameEvidence = {
      state: "document_reported",
      legalName: "Synthetic Evidence LLC",
      sourceField: "Agreement, page 1",
      documents: [document],
    };
    const initial = await repository.getState("synthetic-access-subject", view);
    position.legalEntityNameEvidence.documents = [
      {
        ...document,
        sha256: "c".repeat(64),
        quote: "Fund: Synthetic Evidence LLC",
      },
    ];
    const changed = await repository.getState("synthetic-access-subject", view);
    expect(changed.exactBatch.revision).not.toBe(initial.exactBatch.revision);
    await expect(
      repository.applyExactBatch(
        "synthetic-access-subject",
        {
          expectedRevision: initial.exactBatch.revision,
        },
        view,
      ),
    ).rejects.toMatchObject({ code: "stale" });
    expect(
      sqlite
        .prepare(
          "SELECT COUNT(*) AS count FROM legal_entity_source_decisions WHERE source_reference = ?",
        )
        .get(sources[0]?.id ?? ""),
    ).toEqual({ count: 0 });
  });

  it("reviews a 125-source queue in one fixed-round-trip batch", async () => {
    const sources = Array.from({ length: 125 }, (_, index) => {
      const suffix = String(index).padStart(3, "0");
      return {
        id: `position_exact_scale_${suffix}`,
        legalName:
          index < 55
            ? "A Synthetic Shared Fund, LP"
            : `Synthetic Batch ${suffix} LLC`,
      };
    });
    addPositionSources(sqlite, sources);
    const positionView = positionViewForReportedNames(sources);

    d1.roundTrips = 0;
    const pending = await repository.getState(
      "synthetic-access-subject",
      positionView,
    );
    expect(pending.candidates).toHaveLength(125);
    expect(pending.exactBatch).toMatchObject({
      sourceCount: 125,
      entityCount: 71,
      newEntityCount: 71,
      remainingCandidateCount: 0,
    });
    expect(d1.roundTrips).toBe(4);

    d1.roundTrips = 0;
    const result = await repository.applyExactBatch(
      "synthetic-access-subject",
      { expectedRevision: pending.exactBatch.revision },
      positionView,
    );
    expect(result).toMatchObject({
      reviewedSourceCount: 125,
      entityCount: 71,
      createdEntityCount: 71,
      remainingCandidateCount: 0,
    });
    expect(d1.roundTrips).toBe(5);

    const remaining = await repository.getState(
      "synthetic-access-subject",
      positionView,
    );
    expect(remaining.candidates).toHaveLength(0);
    expect(remaining.exactBatch).toMatchObject({
      sourceCount: 0,
      entityCount: 0,
      existingEntityCount: 0,
      newEntityCount: 0,
      remainingCandidateCount: 0,
    });
    expect(
      remaining.entities.find(
        (entity) => entity.legalName === "A Synthetic Shared Fund, LP",
      )?.sources,
    ).toHaveLength(55);

    const decisionPlan = sqlite
      .prepare(
        `EXPLAIN QUERY PLAN
         SELECT decision.id
         FROM legal_entity_source_decisions decision
         WHERE decision.household_id = ?
           AND NOT EXISTS (
             SELECT 1
             FROM legal_entity_source_decisions later
             WHERE later.supersedes_decision_id = decision.id
           )`,
      )
      .all("hh_demo") as Array<{ detail: string }>;
    expect(decisionPlan.some((row) => /SCAN later/u.test(row.detail))).toBe(
      false,
    );
    expect(
      decisionPlan.some(
        (row) =>
          /SEARCH later/u.test(row.detail) &&
          /supersedes_decision_id/u.test(row.detail),
      ),
    ).toBe(true);
  });

  it("starts the four projection reads without waiting for the position view", async () => {
    let resolveView!: (view: InvestmentPositionView) => void;
    const pendingView = new Promise<InvestmentPositionView>((resolve) => {
      resolveView = resolve;
    });
    d1.roundTrips = 0;
    const result = repository.getState("synthetic-access-subject", pendingView);
    await vi.waitFor(() => expect(d1.roundTrips).toBe(4));
    resolveView(emptyPositionView);
    await expect(result).resolves.toMatchObject({ candidates: [] });
    expect(d1.roundTrips).toBe(4);
  });

  it("reads more than 120 entities with a fixed round-trip budget and indexed supersession checks", async () => {
    const entityInsert = sqlite.prepare(
      `INSERT INTO legal_entities (
         id, household_id, created_by_user_id, created_at, immutable
       ) VALUES (?, 'hh_demo', 'usr_demo', ?, 1)`,
    );
    const versionInsert = sqlite.prepare(
      `INSERT INTO legal_entity_versions (
         id, household_id, legal_entity_id, version, legal_name, entity_type,
         relationship, current_owner, jurisdiction, formed_on, ein_last_four,
         ownership_interest_ppm, interest_status, tax_classification, notes,
         supersedes_version_id, recorded_by_user_id, recorded_at, immutable
       ) VALUES (?, 'hh_demo', ?, 1, ?, 'llc', 'direct_interest', NULL, NULL,
         NULL, NULL, NULL, 'current', NULL, NULL, NULL, 'usr_demo', ?, 1)`,
    );
    sqlite.exec("BEGIN");
    try {
      for (let index = 0; index < 125; index += 1) {
        const suffix = String(index).padStart(3, "0");
        const recordedAt = `2026-09-01T10:${String(index % 60).padStart(2, "0")}:00.000Z`;
        entityInsert.run(`legal_entity_scale_${suffix}`, recordedAt);
        versionInsert.run(
          `legal_entity_scale_version_${suffix}`,
          `legal_entity_scale_${suffix}`,
          `Synthetic Scale ${suffix} LLC`,
          recordedAt,
        );
      }
      sqlite.exec("COMMIT");
    } catch (error) {
      sqlite.exec("ROLLBACK");
      throw error;
    }

    d1.roundTrips = 0;
    d1.preparedSql.length = 0;
    const state = await repository.getState(
      "synthetic-access-subject",
      emptyPositionView,
    );
    expect(state.entities.length).toBeGreaterThanOrEqual(125);
    expect(d1.roundTrips).toBe(4);

    const plan = sqlite
      .prepare(
        `EXPLAIN QUERY PLAN
         SELECT entity.id
         FROM legal_entities entity
         JOIN legal_entity_versions version
           ON version.legal_entity_id = entity.id
          AND NOT EXISTS (
            SELECT 1
            FROM legal_entity_versions later
            WHERE later.supersedes_version_id = version.id
          )
         WHERE entity.household_id = ?`,
      )
      .all("hh_demo") as Array<{ detail: string }>;
    expect(plan.some((row) => /SCAN later/u.test(row.detail))).toBe(false);
    expect(
      plan.some(
        (row) =>
          /SEARCH later/u.test(row.detail) &&
          /supersedes_version_id/u.test(row.detail),
      ),
    ).toBe(true);
  });
});
