/**
 * Documentation OpenAPI à partir des schémas Zod (prompt 03 : « l'OpenAPI documente tous les endpoints avec les
 * schémas Zod »). Zod 4 produit le JSON Schema ; ces décorateurs le passent à @nestjs/swagger.
 */
import { applyDecorators } from '@nestjs/common';
import { ApiBody, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { errorSchema } from '@neomoov/domain';
import { z, type ZodType } from 'zod';

/** Type du schéma attendu par @nestjs/swagger (non exporté par le paquet : déduit des options de ApiResponse). */
type SchemaObject = Extract<Parameters<typeof ApiResponse>[0], { schema: unknown }>['schema'];

export function zodToOpenApi(schema: ZodType): SchemaObject {
  const json = z.toJSONSchema(schema, { target: 'openapi-3.0', unrepresentable: 'any', io: 'input' }) as Record<string, unknown>;
  delete json['$schema'];
  return json as SchemaObject;
}

const errorJson = zodToOpenApi(errorSchema);

/** Corps de requête décrit par un schéma Zod. */
export const ZodBody = (schema: ZodType, description?: string) => ApiBody({ schema: zodToOpenApi(schema), ...(description ? { description } : {}) });

/** Réponse décrite par un schéma Zod. */
export const ZodResponse = (status: number, schema: ZodType, description?: string) => ApiResponse({ status, schema: zodToOpenApi(schema), ...(description ? { description } : {}) });

/** Paramètres de requête (query) décrits par un objet Zod : une entrée ApiQuery par propriété. */
export function ZodQuery(schema: z.ZodObject) {
  const json = zodToOpenApi(schema) as { properties?: Record<string, SchemaObject>; required?: string[] };
  const decorators = Object.entries(json.properties ?? {}).map(([name, property]) =>
    ApiQuery({ name, required: json.required?.includes(name) ?? false, schema: property }),
  );
  return applyDecorators(...decorators);
}

const ERROR_DESCRIPTIONS: Record<number, string> = {
  400: 'Entrée invalide (VALIDATION_ERROR) ou règle métier refusée',
  401: 'Jeton absent, invalide ou expiré',
  403: 'Rôle ou portée insuffisants, ou ressource d\'un autre utilisateur',
  404: 'Ressource introuvable',
  409: 'Conflit avec l\'état courant',
  423: 'Compte verrouillé',
  429: 'Limite de débit atteinte (en-tête Retry-After)',
};

/** Réponses d'erreur au format unique `{ code, message, details, correlationId }` (section 7.1). */
export const ApiErrors = (...statuses: number[]) =>
  applyDecorators(...statuses.map((status) => ApiResponse({ status, description: ERROR_DESCRIPTIONS[status] ?? 'Erreur', schema: errorJson })));
