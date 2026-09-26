/**
 * Client TypeScript de l'API Neomoov (section 7.1 du cahier des charges), partagé par `apps/web`,
 * `apps/mobile-client` et `apps/mobile-driver`. La description OpenAPI dont il dérive est dans `src/openapi.json`
 * (`pnpm --filter @neomoov/api-client generate` la régénère). Les méthodes par ressource (`client.rides.get`…) sont typées
 * par les schémas de `@neomoov/domain`, les mêmes que ceux qui valident l'API.
 */
export { ApiClient, createApiClient } from './client.js';
export type { ApiClientOptions, HttpMethod, Language, Query, QueryValue, RequestOptions, TokenProvider } from './client.js';
export type { AuditEntryView } from './admin-resources.js';
export { ApiError } from './errors.js';
export { OfflineQueue } from './offline.js';
export type { EnqueueResult, FlushReport, OfflineStorage, QueuedWrite } from './offline.js';
export type { Transport } from './resources.js';
export type { UrlTransport } from './invoicing-resources.js';
export type { ApiErrorBody, CheckStatus, HealthCheck, HealthReport, QueueStats } from './types.js';
