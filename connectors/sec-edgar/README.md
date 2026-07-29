# SEC EDGAR connector

Planned deterministic connector for public regulatory filings. It will emit
source documents and proposed evidence events through `@keel/connectors`; it
will never update holdings or marks directly.

The first bootstrap defines the shared ingestion boundary only. Network fetching
and filing-specific parsing are intentionally deferred.
