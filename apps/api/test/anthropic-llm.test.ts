import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AnthropicLlmProvider } from '../src/adapters/real/anthropic.js';
import { LlmError } from '../src/adapters/types.js';

/**
 * Adaptateur réel de l'API Claude, sans réseau : `fetch` intercepté. Vérifie la forme des requêtes (modèle, raisonnement
 * adaptatif, effort, prompt système mis en cache, sortie structurée, repli côté serveur), la boucle d'outils, la
 * traduction des erreurs typées et que la clé ne fuit jamais.
 */
const KEY = 'cle-de-test-factice-sans-valeur-0000';

interface Captured {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

function fakeFetch(responses: Array<{ status?: number; body: unknown }>) {
  const captured: Captured[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers as ConstructorParameters<typeof Headers>[0]).forEach((value, key) => { headers[key] = value; });
    captured.push({ url: String(url), headers, body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> });
    const next = responses.shift() ?? { status: 500, body: { type: 'error', error: { type: 'api_error', message: 'plus de réponse' } } };
    return new Response(JSON.stringify(next.body), { status: next.status ?? 200, headers: { 'content-type': 'application/json', 'request-id': 'req_test' } });
  }) as typeof fetch;
  return { fetchImpl, captured };
}

const message = (content: unknown[], extra: Record<string, unknown> = {}) => ({
  id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content, stop_reason: 'end_turn', stop_sequence: null, stop_details: null,
  usage: { input_tokens: 1_200, output_tokens: 300, cache_read_input_tokens: 800, cache_creation_input_tokens: 0 }, ...extra,
});

const base = { model: 'claude-opus-5-5', effort: 'low' as const, system: 'Tu es un agent de test.', maxTokens: 16_000 };

describe('adaptateur Claude réel (SDK officiel, fetch intercepté)', () => {
  it('sortie structurée : raisonnement adaptatif, effort, cache du prompt système, format JSON, repli côté serveur ; jetons rapportés', async () => {
    const { fetchImpl, captured } = fakeFetch([{ body: message([{ type: 'text', text: '{"category":"refund_request","hostile":false}' }]) }]);
    const llm = new AnthropicLlmProvider(KEY, { fetch: fetchImpl, maxRetries: 0 });
    const out = await llm.structured({ ...base, messages: [{ role: 'user', content: 'Bonjour' }], schemaName: 'classification', schema: z.object({ category: z.string(), hostile: z.boolean() }) });
    expect(out).toEqual({ output: { category: 'refund_request', hostile: false }, model: 'claude-opus-5-5', usage: { inputTokens: 1_200, outputTokens: 300, cacheReadInputTokens: 800, cacheCreationInputTokens: 0 }, stopReason: 'end_turn' });
    const [req] = captured;
    expect(req!.url).toContain('/v1/messages');
    expect(req!.body).toMatchObject({
      model: 'claude-opus-5-5', max_tokens: 16_000, thinking: { type: 'adaptive' }, fallbacks: 'default',
      system: [{ type: 'text', text: 'Tu es un agent de test.', cache_control: { type: 'ephemeral' } }],
      output_config: { effort: 'low', format: { type: 'json_schema' } },
      messages: [{ role: 'user', content: 'Bonjour' }],
    });
    expect(req!.headers['anthropic-beta']).toContain('server-side-fallback-2026-07-01');
    expect(req!.headers['x-api-key']).toBe(KEY);
  });

  it('pièce jointe (vision) : image en base64 avant le texte ; repli coupé sur demande', async () => {
    const { fetchImpl, captured } = fakeFetch([{ body: message([{ type: 'text', text: '{"ok":true}' }]) }]);
    const llm = new AnthropicLlmProvider(KEY, { fetch: fetchImpl, maxRetries: 0, serverFallback: false });
    await llm.structured({ ...base, messages: [{ role: 'user', content: 'Lis ce document', attachments: [{ kind: 'image', mediaType: 'image/png', dataBase64: 'aGVsbG8=' }, { kind: 'pdf', mediaType: 'application/pdf', dataBase64: 'JVBERi0=' }] }], schemaName: 'x', schema: z.object({ ok: z.boolean() }) });
    const body = captured[0]!.body as { messages: Array<{ content: Array<{ type: string }> }>; fallbacks?: unknown };
    expect(body.messages[0]!.content.map((b) => b.type)).toEqual(['image', 'document', 'text']);
    expect(body.fallbacks).toBeUndefined();
  });

  it('refus du modèle, sortie non conforme, limite de débit, clé refusée : erreurs typées, sans la clé', async () => {
    const schema = z.object({ ok: z.boolean() });
    const refusal = fakeFetch([{ body: message([], { stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'cyber', explanation: null } }) }]);
    await expect(new AnthropicLlmProvider(KEY, { fetch: refusal.fetchImpl, maxRetries: 0 }).structured({ ...base, messages: [{ role: 'user', content: 'x' }], schemaName: 'x', schema })).rejects.toMatchObject({ code: 'refused' });
    const invalid = fakeFetch([{ body: message([{ type: 'text', text: '{"ok":"oui"}' }]) }]);
    await expect(new AnthropicLlmProvider(KEY, { fetch: invalid.fetchImpl, maxRetries: 0 }).structured({ ...base, messages: [{ role: 'user', content: 'x' }], schemaName: 'x', schema })).rejects.toMatchObject({ code: 'invalid_output' });
    const limited = fakeFetch([{ status: 429, body: { type: 'error', error: { type: 'rate_limit_error', message: 'trop' } } }]);
    const rateError = await new AnthropicLlmProvider(KEY, { fetch: limited.fetchImpl, maxRetries: 0 }).structured({ ...base, messages: [{ role: 'user', content: 'x' }], schemaName: 'x', schema }).catch((e: unknown) => e);
    expect(rateError).toBeInstanceOf(LlmError);
    expect(rateError).toMatchObject({ code: 'rate_limited', retryable: true });
    const denied = fakeFetch([{ status: 401, body: { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } } }]);
    const authError = await new AnthropicLlmProvider(KEY, { fetch: denied.fetchImpl, maxRetries: 0 }).structured({ ...base, messages: [{ role: 'user', content: 'x' }], schemaName: 'x', schema }).catch((e: unknown) => e);
    expect(authError).toMatchObject({ code: 'authentication', retryable: false });
    expect(String((authError as Error).message)).not.toContain(KEY);
  });

  it('boucle d\'outils : l\'outil reçoit son entrée validée, le résultat revient au modèle, jetons cumulés', async () => {
    const { fetchImpl, captured } = fakeFetch([
      { body: message([{ type: 'tool_use', id: 'toolu_1', name: 'lookupRide', input: { limit: 2 } }], { stop_reason: 'tool_use' }) },
      { body: message([{ type: 'text', text: 'Votre course d\'hier est retrouvée.' }]) },
    ]);
    const llm = new AnthropicLlmProvider(KEY, { fetch: fetchImpl, maxRetries: 0 });
    const calls: unknown[] = [];
    const out = await llm.runTools({
      ...base, messages: [{ role: 'user', content: 'Ma course d\'hier ?' }], maxIterations: 5,
      tools: [{ name: 'lookupRide', description: 'Courses du client', inputSchema: z.object({ limit: z.number().int() }), run: async (input) => { calls.push(input); return { ok: true, rides: 1 }; } }],
    });
    expect(calls).toEqual([{ limit: 2 }]);
    expect(out).toMatchObject({ text: 'Votre course d\'hier est retrouvée.', iterations: 2, stopReason: 'end_turn', usage: { inputTokens: 2_400, outputTokens: 600, cacheReadInputTokens: 1_600 } });
    const second = captured[1]!.body as { messages: Array<{ role: string; content: unknown }>; tools: Array<{ name: string }>; output_config: { effort: string } };
    expect(second.tools.map((t) => t.name)).toEqual(['lookupRide']);
    expect(second.output_config.effort).toBe('low');
    expect(JSON.stringify(second.messages.at(-1))).toContain('tool_result');
    expect(JSON.stringify(second.messages.at(-1))).toContain('\\"rides\\":1');
  });

  it('la clé ne sort jamais : JSON, inspection, journalisation', () => {
    const llm = new AnthropicLlmProvider(KEY);
    expect(JSON.stringify(llm)).toBe('{"name":"anthropic","configured":true}');
    expect(inspect(llm, { depth: 5 })).not.toContain(KEY);
  });
});
