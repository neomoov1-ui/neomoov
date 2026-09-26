import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { Logger } from 'pino';
import { AppModule } from './app.module.js';
import { AppExceptionFilter } from './common/app-exception.filter.js';
import { correlationMiddleware } from './common/correlation.middleware.js';
import { createLogger, currentCorrelationId, PinoNestLogger } from './common/logger.js';
import type { AppEnv } from './config/env.js';
import { assertRoutePolicies } from './modules/auth/route-policies.js';
import { AppIoAdapter } from './common/app-io.adapter.js';
import { REDIS } from './infra/redis.module.js';
import type { Redis } from 'ioredis';

const documents = new WeakMap<object, OpenAPIObject>();

/** Origines autorisées par CORS : `CORS_ORIGINS` (séparées par des virgules), sinon l'adresse du web. */
export function corsOrigins(env: Pick<AppEnv, 'CORS_ORIGINS' | 'WEB_BASE_URL'>): string[] {
  const listed = (env.CORS_ORIGINS ?? '').split(',').map((o) => o.trim().replace(/\/+$/, '')).filter(Boolean);
  return listed.length ? listed : [env.WEB_BASE_URL.replace(/\/+$/, '')];
}

/** Description OpenAPI d'une application créée par `createApp` (servie sur `/v1/docs/openapi.json`, exportée pour le client). */
export function getOpenApiDocument(app: INestApplication): OpenAPIObject {
  const document = documents.get(app);
  if (!document) throw new Error("Document OpenAPI absent : l'application n'a pas été créée par createApp");
  return document;
}

/** Construit l'application HTTP (utilisé par `main.ts` et par les tests d'intégration). */
export async function createApp(env: AppEnv, logger: Logger = createLogger('api')): Promise<NestExpressApplication> {
  // Corps brut conservé : la signature des webhooks de paiement porte sur les octets reçus (prompt 07).
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(env, logger), { logger: new PinoNestLogger(logger), rawBody: true });
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(correlationMiddleware);
  app.use(
    pinoHttp({
      logger,
      autoLogging: env.NODE_ENV !== 'test',
      customProps: () => ({ correlationId: currentCorrelationId() }),
      customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
    }),
  );
  app.setGlobalPrefix('v1');
  // Le web (My Hub, réservation) appelle l'API depuis le navigateur sur une autre origine ; les mobiles n'ont pas de CORS.
  app.enableCors({ origin: corsOrigins(env), credentials: true, exposedHeaders: ['x-correlation-id'], maxAge: 600 });
  app.useGlobalFilters(new AppExceptionFilter(logger));
  app.enableShutdownHooks();
  // Temps réel : mêmes origines CORS que le HTTP ; avec Redis, les salles Socket.IO sont partagées entre les instances.
  const adapter = new AppIoAdapter(app, corsOrigins(env), app.get<Redis | null>(REDIS));
  await adapter.connect();
  app.useWebSocketAdapter(adapter);

  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder().setTitle('Neomoov API').setDescription('API de la plateforme Neomoov (Groupe NSK Inc.). Préfixe /v1.').setVersion('1.0').addBearerAuth().build(),
  );
  SwaggerModule.setup('v1/docs', app, document, { jsonDocumentUrl: 'v1/docs/openapi.json' });
  documents.set(app, document);
  // Refus par défaut : toute route déclare sa politique d'accès, sinon l'API ne démarre pas (prompt 03).
  assertRoutePolicies(app);
  return app;
}
