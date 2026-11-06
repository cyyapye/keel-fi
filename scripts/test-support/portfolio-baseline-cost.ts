import { D1InvestmentExposureViewRepository } from "../../packages/database/src/exposure-read-model";
import { D1PortfolioBaselineRepository } from "../../packages/database/src/portfolio-baseline";

export function baselineCostRepositories(
  database: D1Database,
  missingPosition: () => boolean,
) {
  const exposures = new D1InvestmentExposureViewRepository(database);
  const baseline = new D1PortfolioBaselineRepository(database, {
    list: async (subject) => {
      const view = await exposures.list(subject);
      return {
        ...view,
        positions: missingPosition() ? view.positions.slice(1) : view.positions,
      };
    },
  });
  return { exposures, baseline };
}
