import type { BrowserWorker } from "@cloudflare/playwright";

export type Environment = "local" | "preview" | "production";

export interface Env {
  AGENT_GOAL_WRITE_SERVICE_SUBJECT?: string;
  AGENT_GOAL_WRITE_HOUSEHOLD_ID?: string;
  AGENT_READ_SERVICE_SUBJECT?: string;
  AGENT_READ_HOUSEHOLD_ID?: string;
  ACCESS_AUD?: string;
  ACCESS_TEAM_DOMAIN?: string;
  BRAVE_SEARCH_API_KEY?: string;
  ANGELLIST_ACCESS_SUBJECT?: string;
  ANGELLIST_AUTOMATION?: KVNamespace;
  ANGELLIST_AUTOMATION_ENABLED?: string;
  ANGELLIST_BROWSER?: BrowserWorker;
  ANGELLIST_SESSION_KEY?: string;
  CF_VERSION_METADATA?: WorkerVersionMetadata;
  DB: D1Database;
  DEPLOYED_GIT_SHA?: string;
  DEPLOYMENT_SMOKE_TOKEN?: string;
  DOCUMENTS: R2Bucket;
  ENVIRONMENT: Environment;
  GOOGLE_SHEETS_CLIENT_ID?: string;
  INGESTION_QUEUE: Queue;
  INVESTMENTS_NEW_CONNECTIONS_ENABLED?: string;
  MAC_AGENT_API_ORIGIN?: string;
  CONNECTOR_CREDENTIAL_KEY?: string;
  PLAID_CLIENT_ID?: string;
  /** Operator-confirmed Plaid plan. Unknown values fail closed to paid limits. */
  PLAID_CASH_USAGE_PLAN?: string;
  PLAID_ENVIRONMENT?: string;
  PLAID_REDIRECT_URI?: string;
  PLAID_SECRET?: string;
  PLAID_WEBHOOK_URL?: string;
}

export type AccessIdentity =
  | {
      kind: "user";
      subject: string;
      email: string | null;
    }
  | {
      kind: "service";
      subject: string;
      email: null;
    };
