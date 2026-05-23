/** Pinned ingestion stream constants — single source of truth for API receiver and worker (Plan 3). */

/** Redis stream key for the ingestion pipeline. */
export const INGESTION_STREAM = 'inference-logs';

/** Redis stream key for the dead-letter queue. */
export const INGESTION_DLQ = 'inference-logs-dlq';

/** Redis consumer group name for the ingestion worker pool. */
export const INGESTION_GROUP = 'ingestion-workers';

/** Single stream entry field name; value is JSON.stringify(InferenceLog). */
export const PAYLOAD_FIELD = 'payload';
