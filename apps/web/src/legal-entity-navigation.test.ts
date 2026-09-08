import { describe, expect, it } from "vitest";
import {
  entityReviewLocation,
  entityReviewUrl,
  reviewTabs,
} from "./legal-entity-navigation";

describe("entity review navigation", () => {
  it("round-trips an investment and each tab without interpreting a provider label as an ID", () => {
    for (const tab of reviewTabs) {
      const target = { kind: "holding_position" as const, id: "demo:id / + &" };
      const url = new URL(entityReviewUrl(target, tab), "http://localhost");
      expect(url.pathname).toBe("/holdings/entities");
      expect(entityReviewLocation(url.search)).toEqual({ target, tab });
    }
  });
  it("returns malformed and missing targets to the list and defaults unknown tabs", () => {
    for (const search of [
      "",
      "?review=unknown:demo",
      "?review=entity:",
      "?review=demo",
    ]) {
      expect(entityReviewLocation(search).target).toBeNull();
    }
    expect(entityReviewLocation("?review=entity:demo&tab=unknown").tab).toBe(
      "identity",
    );
    expect(entityReviewUrl(null)).toBe("/holdings/entities");
  });
});
