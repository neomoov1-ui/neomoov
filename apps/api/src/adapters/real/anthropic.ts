/**
 * Modèles de langage réels : API Claude par le SDK officiel `@anthropic-ai/sdk` (section 5.16). Raisonnement adaptatif,
 * effort par agent (`output_config.effort`), prompt système mis en cache, sorties structurées validées par Zod
 * (`messages.parse` et `betaZodOutputFormat`), boucle d'outils (`betaZodTool` et `toolRunner`), repli côté serveur
 * (`fallbacks: "default"`) quand il est activé, erreurs typées du SDK traduites en `LlmError`. Ces options n'existent
 * que sur l'espace `beta` du SDK : toutes les requêtes y passent. La clé reste dans un champ privé, jamais journalisée.
 */
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat, betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { addUsage, EMPTY_USAGE, type LlmUsage } from '@neomoov/domain';
import {
  LlmError, type LlmCallOptions, type LlmMessage, type LlmProvider, type LlmStructuredRequest, type LlmStructuredResult, type LlmToolsRequest, type LlmToolsResult,
} from '../types.js';

/** Repli côté serveur sur le modèle recommandé par Anthropic quand le modèle demandé décline (classificateurs de sécurité). */
const SERVER_FALLBACK_BETA = 'server-side-fallback-2026-07-01';

export interface AnthropicOptions {
  /** Implémentation de fetch (tests : requêtes interceptées, aucun appel réseau). */
  fetch?: typeof fetch;
  timeoutMs?: number;
  maxRetries?: number;
  /** Repli côté serveur (`fallbacks: "default"`), actif par défaut ; `LLM_SERVER_FALLBACK=off` le coupe. */
  serverFallback?: boolean;
}

function usageOf(usage: Anthropic.Beta.BetaUsage): LlmUsage {
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadInputTokens: usage.cache_read_input_tokens ?? 0,
    cacheCreationInputTokens: usage.cache_creation_input_tokens ?? 0,
  };
}

function toParam(message: LlmMessage): Anthropic.Beta.BetaMessageParam {
  if (!message.attachments?.length) return { role: message.role, content: message.content };
  const blocks: Anthropic.Beta.BetaContentBlockParam[] = message.attachments.map((a): Anthropic.Beta.BetaContentBlockParam =>
    a.kind === 'pdf'
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: a.dataBase64 } }
      : { type: 'image', source: { type: 'base64', media_type: a.mediaType as 'image/jpeg' | 'image/png' | 'image/webp', data: a.dataBase64 } });
  blocks.push({ type: 'text', text: message.content });
  return { role: message.role, content: blocks };
}

/** Erreurs typées du SDK, de la plus précise à la plus générale ; le message de l'API n'est jamais repris tel quel. */
export function mapAnthropicError(error: unknown): LlmError {
  if (error instanceof LlmError) return error;
  if (error instanceof Anthropic.RateLimitError) return new LlmError('rate_limited', 'Limite de débit de l\'API Claude atteinte', true);
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) return new LlmError('authentication', `Clé de l'API Claude refusée (${error.status})`);
  if (error instanceof Anthropic.BadRequestError || error instanceof Anthropic.NotFoundError || error instanceof Anthropic.UnprocessableEntityError) {
    return new LlmError('bad_request', `Requête refusée par l'API Claude (${error.status})`);
  }
  if (error instanceof Anthropic.InternalServerError) return new LlmError('unavailable', `API Claude indisponible (${error.status})`, true);
  if (error instanceof Anthropic.APIConnectionError) return new LlmError('unavailable', 'API Claude injoignable ou délai dépassé', true);
  if (error instanceof Anthropic.APIError) return new LlmError('unavailable', `Erreur de l'API Claude (${error.status ?? 'réseau'})`, true);
  // Erreur du SDK hors HTTP (sortie structurée illisible ou non conforme au schéma).
  return new LlmError('invalid_output', 'Sortie du modèle illisible ou non conforme au schéma');
}

export class AnthropicLlmProvider implements LlmProvider {
  readonly name = 'anthropic';
  readonly #client: Anthropic;
  readonly #serverFallback: boolean;

  constructor(apiKey: string, options: AnthropicOptions = {}) {
    this.#client = new Anthropic({ apiKey, timeout: options.timeoutMs ?? 120_000, maxRetries: options.maxRetries ?? 2, ...(options.fetch ? { fetch: options.fetch } : {}) });
    this.#serverFallback = options.serverFallback ?? true;
  }

  toJSON() {
    return { name: this.name, configured: true };
  }

  /** Paramètres communs : raisonnement adaptatif, effort de l'agent, prompt système mis en cache, repli côté serveur. */
  private base(request: LlmCallOptions) {
    return {
      model: request.model,
      max_tokens: request.maxTokens,
      thinking: { type: 'adaptive' as const },
      system: [{ type: 'text' as const, text: request.system, cache_control: { type: 'ephemeral' as const } }],
      messages: request.messages.map(toParam),
      ...(this.#serverFallback ? { betas: [SERVER_FALLBACK_BETA], fallbacks: 'default' as const } : {}),
    };
  }

  async structured<T>(request: LlmStructuredRequest<T>): Promise<LlmStructuredResult<T>> {
    let response;
    try {
      response = await this.#client.beta.messages.parse({ ...this.base(request), output_config: { effort: request.effort, format: betaZodOutputFormat(request.schema) } });
    } catch (error) {
      throw mapAnthropicError(error);
    }
    if (response.stop_reason === 'refusal') throw new LlmError('refused', `Demande déclinée par le modèle (${response.stop_details?.category ?? 'sans catégorie'})`);
    if (response.stop_reason === 'max_tokens') throw new LlmError('truncated', 'Réponse coupée (max_tokens)');
    if (response.parsed_output === null || response.parsed_output === undefined) throw new LlmError('invalid_output', 'Aucune sortie structurée');
    return { output: response.parsed_output as T, model: response.model, usage: usageOf(response.usage), stopReason: response.stop_reason };
  }

  async runTools(request: LlmToolsRequest): Promise<LlmToolsResult> {
    const tools = request.tools.map((tool) =>
      betaZodTool({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema, run: async (input) => JSON.stringify(await tool.run(input as Record<string, unknown>)) }));
    const runner = this.#client.beta.messages.toolRunner({ ...this.base(request), output_config: { effort: request.effort }, tools, max_iterations: request.maxIterations });
    let usage = EMPTY_USAGE;
    let last: Anthropic.Beta.BetaMessage | null = null;
    let iterations = 0;
    try {
      for await (const message of runner) {
        usage = addUsage(usage, usageOf(message.usage));
        last = message;
        iterations += 1;
      }
    } catch (error) {
      throw mapAnthropicError(error);
    }
    if (!last) throw new LlmError('unavailable', 'Aucune réponse du modèle');
    if (last.stop_reason === 'refusal') throw new LlmError('refused', `Demande déclinée par le modèle (${last.stop_details?.category ?? 'sans catégorie'})`);
    const text = last.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('\n').trim();
    return { text, model: last.model, usage, stopReason: last.stop_reason, iterations };
  }

  /** Appel simple hors agents : texte libre, ou objet JSON conforme à `jsonSchema`. */
  async complete(input: { system: string; messages: LlmMessage[]; jsonSchema?: Record<string, unknown>; effort?: 'low' | 'medium' | 'high'; maxTokens?: number }) {
    let response;
    try {
      response = await this.#client.beta.messages.create({
        ...this.base({ model: 'claude-opus-5-5', effort: input.effort ?? 'low', system: input.system, messages: input.messages, maxTokens: input.maxTokens ?? 16_000 }),
        output_config: { effort: input.effort ?? 'low', ...(input.jsonSchema ? { format: { type: 'json_schema' as const, schema: input.jsonSchema } } : {}) },
      });
    } catch (error) {
      throw mapAnthropicError(error);
    }
    if (response.stop_reason === 'refusal') throw new LlmError('refused', 'Demande déclinée par le modèle');
    const text = response.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('\n').trim();
    let json: unknown;
    if (input.jsonSchema) {
      try {
        json = JSON.parse(text);
      } catch {
        throw new LlmError('invalid_output', 'Sortie JSON illisible');
      }
    }
    return { text, ...(json === undefined ? {} : { json }), inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens };
  }
}
