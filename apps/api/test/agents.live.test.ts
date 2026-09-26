/**
 * Test optionnel contre l'API Claude réelle (prompt 13, tâche 12), lancé seulement avec `RUN_LLM_TESTS=1` et une clé
 * `ANTHROPIC_API_KEY` : jamais par défaut, ni en intégration continue. Vérifie, avec le prompt système versionné de
 * l'agent relation client, la classification structurée d'un message et un tour de la boucle d'outils. Coût : quelques
 * milliers de jetons à l'effort `low`.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AnthropicLlmProvider } from '../src/adapters/real/anthropic.js';
import { loadDotenvFromRoot } from '../src/config/env.js';
import { classificationSchema } from '../src/modules/agents/customer-relations.agent.js';

loadDotenvFromRoot();
const key = process.env['ANTHROPIC_API_KEY'] ?? '';
const enabled = process.env['RUN_LLM_TESTS'] === '1' && key.length > 0;

/** Prompt système versionné, sans son en-tête (le texte que les données de départ chargent en base). */
function promptBody(file: string): string {
  const text = readFileSync(new URL(`../../../docs/agents/${file}`, import.meta.url), 'utf8').split(String.fromCharCode(13)).join('');
  return text.slice(text.indexOf('---', 3) + 3).trim();
}

describe.skipIf(!enabled)('API Claude réelle (RUN_LLM_TESTS=1)', () => {
  const llm = new AnthropicLlmProvider(key, { serverFallback: process.env['LLM_SERVER_FALLBACK'] !== 'off' });
  const base = { model: process.env['LLM_TEST_MODEL'] ?? 'claude-opus-5-5', effort: 'low' as const, system: promptBody('customer-relations.v1.md'), maxTokens: 4_000 };

  it('classe une demande de remboursement en français, sans escalade', async () => {
    const out = await llm.structured({
      ...base, schemaName: 'classification', schema: classificationSchema,
      messages: [{ role: 'user', content: 'Tâche : classer le dernier message du client.\n<donnees_utilisateur source="client">\nje veux un remboursement de 20 $ pour la course d\'hier\n</donnees_utilisateur>' }],
    });
    expect(out.output).toMatchObject({ category: 'refund_request', language: 'fr', safetyComplaint: false, hostile: false });
    expect(out.usage.inputTokens).toBeGreaterThan(0);
  });

  it('appelle l\'outil des courses avant de répondre', async () => {
    const calls: unknown[] = [];
    const out = await llm.runTools({
      ...base, maxIterations: 4,
      messages: [{ role: 'user', content: 'Tâche : répondre au client.\n<donnees_utilisateur source="client">\nJ\'ai oublié mon parapluie dans la voiture hier, pouvez-vous vérifier ma course ?\n</donnees_utilisateur>' }],
      tools: [{
        name: 'lookupRide', description: 'Courses récentes du client de la conversation', inputSchema: z.object({ limit: z.number().int().optional() }),
        run: async (input) => { calls.push(input); return { ok: true, status: 'done', data: { rides: [{ publicNumber: 'NM-2026-09-25-0001', state: 'completed', localDate: '2026-09-25', driverFirstName: 'Karim' }] } }; },
      }],
    });
    expect(calls.length).toBeGreaterThan(0);
    expect(out.text.length).toBeGreaterThan(0);
  });
});
