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
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(env, logger), { logger: new PinoNestLogger(logger) });
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

  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder().setTitle('Neomoov API').setDescription('API de la plateforme Neomoov (Groupe NSK Inc.). Préfixe /v1.').setVersion('1.0').addBearerAuth().build(),
  );
  SwaggerModule.setup('v1/docs', app, document, { jsonDocumentUrl: 'v1/docs/openapi.json' });
  documents.set(app, document);
  return app;
}
