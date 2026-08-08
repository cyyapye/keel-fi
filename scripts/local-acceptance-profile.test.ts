import { describe, expect, it } from "vitest";

import {
  buildApplySql,
  LOCAL_ACCEPTANCE_PERSIST_DIRECTORY,
  parseAcceptanceProfile,
  resolveAcceptancePersistRoot,
} from "./local-acceptance-profile";

const profile = parseAcceptanceProfile({
  version: 1,
  companies: [
    {
      companyId: "co_harbor",
      legalName: "Public Example Two",
      homepageUrl: "https://news-two.example/",
    },
    {
      companyId: "co_lattice",
      legalName: "Public Example Three",
      homepageUrl: "https://news-three.example/",
    },
    {
      companyId: "co_northstar",
      legalName: "Public Example One",
      homepageUrl: "https://news-one.example/",
    },
  ],
});
const rawCompanies = profile.companies.map((company) => ({
  companyId: company.companyId,
  legalName: company.legalName,
  homepageUrl: company.homepageUrl,
}));

describe("local acceptance profile", () => {
  it("accepts one to three fixed synthetic companies and normalizes hostnames", () => {
    expect(profile.companies.map((company) => company.companyId)).toEqual([
      "co_northstar",
      "co_harbor",
      "co_lattice",
    ]);
    expect(profile.companies[0]?.websiteHost).toBe("news-one.example");
    expect(() =>
      parseAcceptanceProfile({
        version: 1,
        companies: [...rawCompanies.slice(0, 2), rawCompanies[1]],
      }),
    ).toThrow("only once");
    expect(
      parseAcceptanceProfile({
        version: 1,
        companies: [rawCompanies[0]],
      }).companies,
    ).toHaveLength(1);
  });

  it("delegates homepage validation to the official-company policy and rejects extra fields", () => {
    expect(() =>
      parseAcceptanceProfile({
        version: 1,
        companies: rawCompanies.map((company, index) =>
          index === 0
            ? { ...company, homepageUrl: "https://user@news-one.example/" }
            : company,
        ),
      }),
    ).toThrow();
    expect(() =>
      parseAcceptanceProfile({
        version: 1,
        companies: rawCompanies.map((company, index) =>
          index === 0 ? { ...company, portfolioValue: 1 } : company,
        ),
      }),
    ).toThrow();
  });

  it("removes only fixed pending demo proposals and never mutates financial records", () => {
    const apply = buildApplySql(profile);

    expect(apply).toContain("BEGIN IMMEDIATE");
    expect(apply).toContain("COMMIT");
    expect(apply).toContain("UPDATE companies");
    expect(apply).toContain("'co_northstar'");
    expect(apply).toContain("'co_harbor'");
    expect(apply).toContain("'co_lattice'");
    expect(apply).toContain("DELETE FROM evidence_claims");
    expect(apply).toContain("DELETE FROM evidence_events");
    expect(apply).toContain("'evt_northstar_round'");
    expect(apply).not.toContain("DELETE FROM source_documents");
    expect(apply).not.toContain("value_minor");
    expect(apply).not.toContain("asset_lots");
    expect(apply).not.toContain("forecast_snapshots");
  });

  it("uses one exact ignored persistence root", () => {
    expect(LOCAL_ACCEPTANCE_PERSIST_DIRECTORY).toBe(".keel-local/acceptance");
    expect(resolveAcceptancePersistRoot("/tmp/keel")).toBe(
      "/tmp/keel/.keel-local/acceptance",
    );
  });
});
