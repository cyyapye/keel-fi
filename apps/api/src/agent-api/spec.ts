import {
  goalResource,
  goalVersions,
  goalList,
  goalReceipt,
  newGoal,
  goalPatch,
} from "./goals";
import {
  positionPage,
  positionDetail,
  accountPage,
  account,
  liabilityPage,
  liability,
  baselineDetail,
  citation,
} from "./resources";
import { z } from "zod";
import { errorBody, marksPage, outlook, previewInput } from "./contract";

const ref = (name: string) => ({ $ref: "#/components/schemas/" + name });
function response(name: string, description: string) {
  return {
    description,
    content: { "application/json": { schema: ref(name) } },
  };
}
const errors = {
  "400": response("Error", "Invalid arguments"),
  "401": response("Error", "Missing or invalid authentication at the Worker"),
  "403": response("Error", "No matching household grant"),
  "503": response("Error", "Financial data could not be read"),
};
const cursor = {
  in: "query",
  name: "after",
  schema: { type: "string" },
  description:
    "Copy nextAfter from the previous response, including when a filtered page is empty.",
};
const idParam = (name: string) => ({
  in: "path",
  name,
  required: true,
  schema: { type: "string" },
});
function readOperation(
  operationId: string,
  summary: string,
  schema: string,
  parameters: object[],
) {
  return {
    operationId,
    summary,
    parameters,
    responses: {
      "200": response(schema, summary),
      "404": response("Error", "Resource missing or outside the household"),
      ...errors,
    },
  };
}
function goalMutation(create: boolean) {
  const code = create ? "201" : "200";
  return {
    operationId: create ? "createGoal" : "reviseGoal",
    summary: create
      ? "Save an owner-directed dated goal"
      : "Revise or archive a goal",
    parameters: [
      ...(create
        ? []
        : [
            idParam("goalId"),
            {
              in: "header",
              name: "If-Match",
              required: true,
              schema: { type: "string" },
              description: "ETag from the last read",
            },
          ]),
      {
        in: "header",
        name: "Idempotency-Key",
        required: true,
        schema: { type: "string", minLength: 1, maxLength: 128 },
        description: "Reuse the same key and exact request on retry.",
      },
    ],
    requestBody: {
      required: true,
      content: {
        "application/json": { schema: ref(create ? "NewGoal" : "GoalPatch") },
      },
    },
    responses: {
      [code]: {
        ...response("GoalReceipt", "Committed goal revision and actor"),
        headers: {
          ETag: { schema: { type: "string" } },
          Location: { schema: { type: "string" } },
        },
      },
      "404": response("Error", "Goal not found"),
      "409": response(
        "Error",
        "Key reuse, archive, template or primary goal conflict",
      ),
      "412": response("Error", "Revision changed. Reread the goal."),
      "428": response("Error", "Missing revision precondition"),
      "413": response("Error", "Body exceeds 8 KiB"),
      ...errors,
    },
  };
}
const goalCursor = {
  in: "query",
  name: "afterGoal",
  required: false,
  schema: { type: "string", pattern: "^[1-9][0-9]{0,14}$" },
  description: "Copy nextAfterGoal to retrieve subsequent saved goals.",
};
const scenarios =
  "Uses the last recorded balances as starting values on evaluatedOn. USD integer cents. Constant net wealth change uses actual days / 365. Net change includes all gains, losses, income and spending. Liquidity uses constant household and business burn, reviewed debt payment treatments, no future inflows or private exits. An immediate outflow is a liquidity stress only. A missing measure is null.";
type OpenApiDocument = {
  openapi: string;
  info: object;
  servers: { url: string }[];
  security: object[];
  components: {
    securitySchemes: Record<string, object>;
    schemas: Record<string, unknown>;
  };
  paths: Record<string, Record<string, object>>;
};
let document: OpenApiDocument | undefined;
export function openApi() {
  if (document) return document;
  document = {
    openapi: "3.1.0",
    info: {
      title: "Keel owner outlook API",
      version: "1.0.0",
      description: scenarios,
    },
    servers: [{ url: "/api/v1" }],
    security: [{ accessClientId: [], accessClientSecret: [] }],
    components: {
      securitySchemes: {
        accessClientId: {
          type: "apiKey",
          in: "header",
          name: "CF-Access-Client-Id",
        },
        accessClientSecret: {
          type: "apiKey",
          in: "header",
          name: "CF-Access-Client-Secret",
        },
      },
      schemas: Object.fromEntries(
        Object.entries({
          Outlook: outlook,
          Preview: previewInput,
          Marks: marksPage,
          Goal: goalResource,
          GoalPage: goalList,
          GoalVersions: goalVersions,
          GoalReceipt: goalReceipt,
          NewGoal: newGoal,
          GoalPatch: goalPatch,
          PositionPage: positionPage,
          Position: positionDetail,
          AccountPage: accountPage,
          Account: account,
          Liability: liability,
          LiabilityPage: liabilityPage,
          Baseline: baselineDetail,
          Evidence: citation,
          Error: errorBody,
        }).map(([name, schema]) => [
          name,
          z.toJSONSchema(schema, { target: "draft-2020-12" }),
        ]),
      ),
    },
    paths: {
      "/goals": {
        get: readOperation("listGoals", "List saved goals", "GoalPage", [
          cursor,
          {
            in: "query",
            name: "status",
            schema: { type: "string", enum: ["active", "archived"] },
          },
        ]),
        post: goalMutation(true),
      },
      "/goals/{goalId}": {
        get: {
          ...readOperation(
            "getGoal",
            "Read current goal and revision",
            "Goal",
            [idParam("goalId")],
          ),
          responses: {
            "200": {
              ...response("Goal", "Saved goal"),
              headers: { ETag: { schema: { type: "string" } } },
            },
            "404": response("Error", "Unknown goal"),
            ...errors,
          },
        },
        patch: goalMutation(false),
      },
      "/goals/{goalId}/versions": {
        get: readOperation(
          "listGoalVersions",
          "Read goal revisions in order",
          "GoalVersions",
          [idParam("goalId"), cursor],
        ),
      },
      "/accounts": {
        get: readOperation(
          "listAccounts",
          "List account records and accepted cash balances",
          "AccountPage",
          [
            cursor,
            {
              in: "query",
              name: "baselineId",
              schema: { type: "string" },
              description: "Restrict to cash items in a pinned baseline.",
            },
          ],
        ),
      },
      "/accounts/{accountId}": {
        get: readOperation("getAccount", "Read an account", "Account", [
          idParam("accountId"),
        ]),
      },
      "/positions": {
        get: readOperation(
          "listPositions",
          "List recorded positions, quantities and cost bases, including closed positions",
          "PositionPage",
          [cursor],
        ),
      },
      "/positions/{positionId}": {
        get: readOperation(
          "getPosition",
          "Read position quantity, cost basis, terms, exposures and dated valuations",
          "Position",
          [
            idParam("positionId"),
            {
              in: "query",
              name: "afterExposure",
              schema: { type: "string" },
              description:
                "Copy nextAfterExposure to read the next page of underlying exposures.",
            },
          ],
        ),
      },
      "/liabilities": {
        get: readOperation(
          "listLiabilities",
          "List reviewed obligations",
          "LiabilityPage",
          [cursor],
        ),
      },
      "/liabilities/{liabilityId}": {
        get: readOperation(
          "getLiability",
          "Read a reviewed obligation",
          "Liability",
          [idParam("liabilityId")],
        ),
      },
      "/baselines/{baselineId}": {
        get: readOperation(
          "getBaseline",
          "Read accepted wealth components and supporting records",
          "Baseline",
          [idParam("baselineId")],
        ),
      },
      "/evidence/{evidenceId}": {
        get: readOperation(
          "getEvidence",
          "Read source metadata for an outlook citation",
          "Evidence",
          [idParam("evidenceId")],
        ),
      },
      "/openapi.json": {
        get: {
          operationId: "describeApi",
          summary: "Discover the owner API contract",
          responses: { "200": { description: "OpenAPI contract" }, ...errors },
        },
      },
      "/outlook": {
        get: {
          operationId: "getOutlook",
          summary:
            "Read saved goal gaps, tracked wealth and a 365-day liquidity scenario",
          description: scenarios,
          parameters: [goalCursor],
          responses: {
            "200": response(
              "Outlook",
              "Current accepted record and unsaved outlook",
            ),
            ...errors,
          },
        },
      },
      "/outlook/preview": {
        post: {
          operationId: "previewOutlook",
          summary:
            "Compare dated net-worth targets and test a reserve through a date without saving",
          description:
            scenarios +
            " Supply annualNetWorthChangeMinor to model a dated result. requiredAnnualNetIncreaseMinor is a break-even rate of change, not an expected return. Only set assumeNoDebt if the owner explicitly authorizes that scenario assumption.",
          parameters: [goalCursor],
          requestBody: {
            required: true,
            content: { "application/json": { schema: ref("Preview") } },
          },
          responses: {
            "200": response("Outlook", "Unsaved scenario"),
            "413": response("Error", "Body exceeds 8 KiB"),
            ...errors,
          },
        },
      },
      "/marks": {
        get: {
          operationId: "listBaselineMarks",
          summary:
            "Inspect values in one accepted baseline, subsequent provider observations, reviewed marks and public evidence",
          description:
            "A source capture date is distinct from a mark date. Public signals are company observations. Membership and baseline values are immutable. Later evidence is current at each page read. Prices use millionths of USD per share. Email coverage is unavailable.",
          parameters: [
            {
              name: "baselineId",
              in: "query",
              required: true,
              schema: { type: "string" },
              description: "Use baseline.id from the outlook.",
            },
            {
              name: "after",
              in: "query",
              schema: { type: "string" },
              description:
                "Copy nextAfter. Each page contains up to 50 positions.",
            },
          ],
          responses: {
            "200": response("Marks", "Baseline positions and source evidence"),
            "404": response("Error", "Unknown or inaccessible baseline"),
            ...errors,
          },
        },
      },
    },
  };
  return document;
}
