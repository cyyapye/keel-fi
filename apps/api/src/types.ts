export type Environment = "local" | "preview" | "production";

export interface Env {
  ACCESS_AUD?: string;
  ACCESS_TEAM_DOMAIN?: string;
  CF_VERSION_METADATA?: WorkerVersionMetadata;
  DB: D1Database;
  DEPLOYED_GIT_SHA?: string;
  DEPLOYMENT_SMOKE_TOKEN?: string;
  DOCUMENTS: R2Bucket;
  ENVIRONMENT: Environment;
  INGESTION_QUEUE: Queue;
}

export type AccessIdentity = {
  subject: string;
  email: string | null;
};
