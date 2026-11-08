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
const goalCursor = {
  in: "query",
  name: "afterGoal",
  required: false,
  schema: { type: "string", pattern: "^[1-9][0-9]{0,14}$" },
  description: "Copy nextAfterGoal to retrieve subsequent saved goals.",
};
const scenarios =
  "Uses the last recorded balances as starting values on evaluatedOn. USD integer cents. Constant net wealth change uses actual days / 365. Net change includes all gains, losses, income and spending. Liquidity uses constant household and business burn, reviewed debt payment treatments, no future inflows or private exits. An immediate outflow is a liquidity stress only. A missing measure is null.";
let document: object | undefined;
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
          Error: errorBody,
        }).map(([name, schema]) => [
          name,
          z.toJSONSchema(schema, { target: "draft-2020-12" }),
        ]),
      ),
    },
    paths: {
      "/openapi.json": {
        get: {
          operationId: "describeApi",
          summary: "Discover the supported read contract",
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
