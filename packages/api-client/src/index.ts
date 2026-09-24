/**
 * Client TypeScript de l'API Neomoov (section 7.1 du cahier des charges), partagé par `apps/web`,
 * `apps/mobile-client` et `apps/mobile-driver`. La description OpenAPI dont il dérive est dans `src/openapi.json`
 * (`pnpm --filter @neomoov/api-client generate` la régénère). Les types par ressource seront générés à l'étape 10.
 */
export { ApiClient, createApiClient } from './client.js';
export type { ApiClientOptions, HttpMethod, Language, Query, QueryValue, RequestOptions, TokenProvider } from './client.js';
export { ApiError } from './errors.js';
export type { ApiErrorBody, CheckStatus, HealthCheck, HealthReport, QueueStats } from './types.js';
