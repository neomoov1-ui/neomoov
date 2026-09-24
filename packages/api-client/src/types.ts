/** Corps d'erreur renvoyé par l'API (section 7.1 du cahier des charges : `{ code, message, details, correlationId }`). */
export interface ApiErrorBody {
  code: string;
  message: string;
  details?: unknown;
  correlationId?: string;
}

export type CheckStatus = 'ok' | 'error' | 'not_configured';

export interface HealthCheck {
  status: CheckStatus;
  latencyMs?: number;
  detail?: string;
}

export interface QueueStats {
  name: string;
  waiting: number;
  active: number;
  failed: number;
  /** Mode mémoire seulement : tâches perdues faute de traitement dans le processus. */
  dropped?: number;
}

/** Réponse de `GET /v1/health`. */
export interface HealthReport {
  status: 'ok' | 'degraded';
  version: string;
  uptimeSeconds: number;
  checks: {
    database: HealthCheck;
    redis: HealthCheck;
    queues: HealthCheck & { mode: 'redis' | 'memory'; stats: QueueStats[] };
  };
}
