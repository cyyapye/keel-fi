import type { BrowserWorker } from "@cloudflare/playwright";

export type Environment = "local" | "preview" | "production";

export interface Env {
  ACCESS_AUD?: string;
  ACCESS_TEAM_DOMAIN?: string;
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
  INGESTION_QUEUE: Queue;
  CONNECTOR_CREDENTIAL_KEY?: string;
  PLAID_CLIENT_ID?: string;
  PLAID_ENVIRONMENT?: string;
  PLAID_REDIRECT_URI?: string;
  PLAID_SECRET?: string;
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
