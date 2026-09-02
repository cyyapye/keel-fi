import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  DatabaseSync,
  type SQLInputValue,
  type StatementSync,
} from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { LegalEntityProfileInput } from "@keel/domain/legal-entities";
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

function createDatabase(): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  const migrationDirectory = resolve(
    process.cwd(),
    "packages/database/migrations",
  );
  readdirSync(migrationDirectory)
    .filter((file) => /^\d{4}_.+\.sql$/u.test(file))
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
  let sqlite: DatabaseSync;
  let d1: TestD1Database;
  let repository: D1LegalEntityRepository;

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
    expect(d1.roundTrips).toBe(3);

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
