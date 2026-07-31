# ADR 001: Cloudflare private-alpha platform

- Status: Accepted
- Date: 2026-07-28

## Context

Keel needs a small, private, single-user deployment with an explicit identity
boundary, a relational source of truth, private source-document storage, and a
path to background ingestion. The public code must remain separate from all user
data and secrets.

## Decision

Use:

- Cloudflare Workers for the Hono API and Vite static assets;
- Cloudflare D1 as the canonical relational database;
- private Cloudflare R2 for source documents;
- Cloudflare Access for identity and authentication; and
- a Queues-compatible message contract for asynchronous ingestion.

Production starts fail-closed. Requests without a successfully verified Access
JWT issuer, audience, signature, and subject receive `401`. Local bypass exists
only in Wrangler's explicit `local` environment.

## Consequences

Positive:

- few always-on components for a private alpha;
- identity enforcement at the edge and application layer;
- local D1 parity through Wrangler;
- private object storage with short-lived access; and
- straightforward append-only forecast records.

Tradeoffs:

- D1 and Workers impose platform-specific runtime and migration constraints;
- Access key discovery is an external dependency during JWT validation;
- D1 backup and recovery need tested export procedures; and
- future multi-household operation requires continued authorization tests, not
  only schema-level household columns.

## Alternatives considered

A conventional server and managed PostgreSQL would provide richer transactional
features but add operational surface for the first private alpha. A browser-only
database would weaken the canonical-record and backup boundaries. Embedding
documents in D1 would make private binary handling and retention more difficult.
