import { z } from "zod";
import type { Hono } from "hono";
import { MarketDecisionInput } from "@keel/domain/market-close";
import {
  marketReviewDetail,
  decideMarketSource,
  listMarketReviews,
  setMarketNewsRead,
} from "@keel/database/market-close";
import type { AppEnvironment } from "./app";

export function registerMarketCloseRoutes(app: Hono<AppEnvironment>) {
  app.get("/api/exposure-closes", async (c) => {
    c.header("Cache-Control", "private, no-store");
    return c.json(await listMarketReviews(c.env.DB, c.get("identity").subject));
  });
  app.get("/api/exposure-closes/:id", async (c) => {
    c.header("Cache-Control", "private, no-store");
    const scope = z
      .literal("active")
      .optional()
      .safeParse(c.req.query("scope"));
    if (!scope.success)
      return c.json({ error: "Invalid valuation scope." }, 400);
    const review = await marketReviewDetail(
      c.env.DB,
      c.get("identity").subject,
      c.req.param("id"),
      scope.data,
    );
    return c.json(review ? [review] : []);
  });
  app.post("/api/exposure-closes/:id/read", async (c) => {
    const identity = c.get("identity");
    if (identity.kind !== "user")
      return c.json({ error: "Household access required." }, 403);
    const input = z
      .object({ read: z.boolean(), version: z.number().int().nonnegative() })
      .strict()
      .safeParse(await c.req.json().catch(() => null));
    if (!input.success) return c.json({ error: "Invalid read state." }, 400);
    return (await setMarketNewsRead(
      c.env.DB,
      identity.subject,
      c.req.param("id"),
      input.data.read,
      input.data.version,
    ))
      ? c.json({ saved: true })
      : c.json({ error: "Reload to see the latest update." }, 409);
  });
  app.post("/api/exposure-closes/:id/decision", async (c) => {
    const identity = c.get("identity");
    if (identity.kind !== "user")
      return c.json(
        { error: "A household member must review the valuation." },
        403,
      );
    const input = MarketDecisionInput.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!input.success)
      return c.json({ error: "Invalid valuation decision." }, 400);
    const saved = await decideMarketSource(
      c.env.DB,
      identity.subject,
      c.req.param("id"),
      input.data,
    );
    return saved
      ? c.json({ saved: true })
      : c.json(
          {
            error:
              "This valuation changed. Reload to review the latest figures.",
          },
          409,
        );
  });
}
