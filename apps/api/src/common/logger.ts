import { AsyncLocalStorage } from 'node:async_hooks';
import { REDACTED, REDACTED_KEYS } from '@neomoov/domain';
import type { LoggerService } from '@nestjs/common';
import { nanoid } from 'nanoid';
import { pino, type DestinationStream, type Logger, type LoggerOptions } from 'pino';
import type { Options as HttpLoggerOptions } from 'pino-http';

export const correlationStore = new AsyncLocalStorage<{ correlationId: string }>();

export function currentCorrelationId(): string | undefined {
  return correlationStore.getStore()?.correlationId;
}

/** Identifiant de corrélation accepté d'un client ou d'une tâche : 8 à 64 caractères sûrs (lettres, chiffres, « _ », « - »). */
export const CORRELATION_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

export function isValidCorrelationId(value: unknown): value is string {
  return typeof value === 'string' && CORRELATION_ID_PATTERN.test(value);
}

export function newCorrelationId(): string {
  return nanoid(16);
}

/**
 * Exécute `fn` avec cet identifiant de corrélation (repris s'il est valide, sinon créé) : chaque ligne de journal écrite
 * pendant l'exécution, même après des attentes, le porte (AsyncLocalStorage).
 */
export function runWithCorrelation<T>(correlationId: unknown, fn: () => T): T {
  return correlationStore.run({ correlationId: isValidCorrelationId(correlationId) ? correlationId : newCorrelationId() }, fn);
}

/**
 * En-têtes jamais journalisés (revue du 2 octobre 2026, sécurité 3) : authentification, clés et secrets de webhooks
 * (Vapi, Stripe, Square, Twilio, Meta), adresses d'origine. `serializeRequest` ne les copie déjà pas ; la liste masque
 * aussi tout objet `req` journalisé par un autre chemin.
 */
export const REDACTED_REQUEST_HEADERS: readonly string[] = [
  'authorization', 'cookie', 'x-api-key', 'x-vapi-secret', 'stripe-signature', 'x-square-hmacsha256-signature', 'x-twilio-signature', 'x-hub-signature-256', 'x-forwarded-for', 'x-real-ip',
  // Jeton du défi anti-robots (revue Q1 du 3 octobre 2026).
  'x-turnstile-token',
];

/**
 * Chemins masqués par le journal : en-têtes sensibles, chaîne de requête et adresse d'origine d'une requête, puis chaque
 * clé sensible (secrets et données personnelles, liste partagée avec le suivi des erreurs dans `@neomoov/domain`) au
 * premier et au deuxième niveau. (`code` et `key` ne sont pas masqués : err.code (SQLSTATE, code AppError) et
 * settings.key doivent rester lisibles.)
 */
export const LOG_REDACT_PATHS: string[] = [
  ...REDACTED_REQUEST_HEADERS.map((header) => `req.headers["${header}"]`), 'req.query', 'req.remoteAddress', 'res.headers["set-cookie"]',
  ...REDACTED_KEYS.flatMap((key) => [key, `*.${key}`]),
];

/** Chemin d'une adresse sans sa chaîne de requête (jeton de session de carte, de suivi, code à usage unique). */
export function pathWithoutQuery(url: string | undefined): string | undefined {
  return url?.replace(/[?#].*$/, '');
}

/**
 * Requête HTTP telle que journalisée : identifiant, méthode et chemin, rien d'autre (ni en-têtes, ni paramètres, ni
 * adresse d'origine : revue du 2 octobre 2026, sécurité 3).
 */
export function serializeRequest(req: { id?: unknown; method?: string | undefined; url?: string | undefined }): { id: unknown; method: string | undefined; url: string | undefined } {
  return { id: req.id, method: req.method, url: pathWithoutQuery(req.url) };
}

/** Options du journal HTTP de l'API (pino-http) : sérialiseur de requête réduit, niveau selon le statut de la réponse. */
export function httpLoggerOptions(logger: Logger, autoLogging: boolean): HttpLoggerOptions {
  return {
    logger,
    autoLogging,
    serializers: { req: serializeRequest },
    customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
  };
}

/** Journal structuré JSON ; les champs sensibles sont masqués (section 8) ; chaque ligne porte l'identifiant de corrélation. */
export function createLogger(name: string, level = process.env['LOG_LEVEL'] ?? 'info', destination?: DestinationStream): Logger {
  const options: LoggerOptions = {
    name,
    level,
    redact: { paths: LOG_REDACT_PATHS, censor: REDACTED },
    // Un identifiant déjà présent dans la ligne (filtre d'exceptions, tâches) n'est pas répété.
    mixin: (mergeObject: object) => {
      const id = currentCorrelationId();
      return id && !('correlationId' in mergeObject) ? { correlationId: id } : {};
    },
  };
  return destination ? pino(options, destination) : pino(options);
}

/** Adaptateur pino pour le journal interne de NestJS. */
export class PinoNestLogger implements LoggerService {
  constructor(private readonly logger: Logger) {}
  log(message: unknown, context?: string) {
    this.logger.info({ context }, String(message));
  }
  error(message: unknown, trace?: string, context?: string) {
    this.logger.error({ context, trace }, String(message));
  }
  warn(message: unknown, context?: string) {
    this.logger.warn({ context }, String(message));
  }
  debug(message: unknown, context?: string) {
    this.logger.debug({ context }, String(message));
  }
  verbose(message: unknown, context?: string) {
    this.logger.trace({ context }, String(message));
  }
}

export const APP_LOGGER = Symbol('APP_LOGGER');
