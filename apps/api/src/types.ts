export type Environment = "local" | "preview" | "production";

export interface Env {
  ACCESS_AUD?: string;
  ACCESS_TEAM_DOMAIN?: string;
  DB: D1Database;
  DOCUMENTS: R2Bucket;
  ENVIRONMENT: Environment;
  INGESTION_QUEUE: Queue;
}

export type AccessIdentity = {
  subject: string;
  email: string | null;
};
