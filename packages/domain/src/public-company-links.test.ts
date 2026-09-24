import { expect, it } from "vitest";
import { recommendPublicCompany } from "./public-company-links";
const companies = [
  {
    id: "co_one",
    name: "Demo Orbit",
    aliases: ["Demo Orbital Technologies Corporation"],
    websiteHost: "orbit.example",
  },
  {
    id: "co_two",
    name: "Demo Harbor",
    aliases: [],
    websiteHost: "harbor.example",
  },
];
it("recommends one accepted issuer alias while preserving instrument distinctions", () => {
  expect(
    recommendPublicCompany(
      "Demo Orbital Technologies Corp. - Ordinary Shares - Class A",
      companies,
    ),
  ).toMatchObject({
    status: "recommended",
    companyId: "co_one",
    sourceUrl: null,
  });
  expect(recommendPublicCompany("Demo Orbit ETF", companies).status).toBe(
    "no_match",
  );
  expect(recommendPublicCompany("DO", companies).status).toBe("no_match");
  expect(recommendPublicCompany("Demo Orbi", companies).status).toBe(
    "no_match",
  );
});
it("uses issuer evidence on an accepted company domain without guessing an unfamiliar brand", () => {
  const source = {
    title: "Demo Launch Technologies Inc. privacy policy",
    url: "https://orbit.example/privacy",
    description: "Demo Launch Technologies Inc. operates this website.",
  };
  expect(
    recommendPublicCompany(
      "Demo Launch Technologies Inc. - Ordinary Shares",
      companies,
      [source],
    ),
  ).toMatchObject({
    status: "recommended",
    companyId: "co_one",
    sourceUrl: source.url,
  });
  expect(
    recommendPublicCompany("Demo Launch Technologies Inc.", companies, [
      { ...source, url: "https://orbit.example.attacker.test/privacy" },
    ]).status,
  ).toBe("no_match");
  expect(
    recommendPublicCompany("Demo Launch Technologies Inc.", companies, [
      { ...source, url: "https://unknown.example/privacy" },
    ]).status,
  ).toBe("no_match");
  expect(
    recommendPublicCompany("Demo Launch Technologies Inc.", companies, [
      {
        ...source,
        title: "Our new customer",
        url: "https://orbit.example/news",
        description: "Demo Launch Technologies Inc. selected our services.",
      },
    ]).status,
  ).toBe("no_match");
});
it("keeps conflicting issuer identities unresolved and supports bounded company catalogs", () => {
  const many = Array.from({ length: 120 }, (_, i) => ({
    id: `company_${i}`,
    name: `Demo Issuer ${i}`,
    aliases: [],
    websiteHost: null,
  }));
  expect(recommendPublicCompany("Demo Issuer 119 Class A", many)).toMatchObject(
    { status: "recommended", companyId: "company_119" },
  );
  expect(
    recommendPublicCompany("Demo Orbit", [
      ...companies,
      { id: "other", name: "Demo Orbit Inc", aliases: [], websiteHost: null },
    ]).status,
  ).toBe("ambiguous");
});
