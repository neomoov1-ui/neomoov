import { describe, expect, it } from 'vitest';
import { AGENTS, SETTINGS } from '../src/seed/data.js';
import { parseAgentPrompt, readAgentPrompts } from '../src/seed/prompts.js';

describe('prompts système des agents (docs/agents)', () => {
  it('chaque agent qui en déclare un a son prompt versionné, en français, avec les règles de sécurité', () => {
    const prompts = readAgentPrompts();
    const keys = new Set(prompts.map((p) => p.key));
    for (const agent of AGENTS) if (agent.systemPromptKey) expect(keys.has(agent.systemPromptKey), agent.code).toBe(true);
    for (const p of prompts) {
      expect(p.body).toContain('donnée');
      expect(p.body).not.toContain('—');
      expect(p.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('en-tête obligatoire, clé cohérente avec l\'agent et la version', () => {
    expect(parseAgentPrompt('---\r\nkey: a.v2\r\nagent: a\r\nversion: 2\r\n---\r\nTexte\r\n')).toMatchObject({ key: 'a.v2', agentCode: 'a', version: 2, body: 'Texte' });
    expect(() => parseAgentPrompt('Texte sans en-tête')).toThrow('en-tête');
    expect(() => parseAgentPrompt('---\nkey: a.v1\nagent: a\nversion: 2\n---\nTexte')).toThrow('a.v2');
    expect(() => parseAgentPrompt('---\nkey: a.v1\nagent: a\nversion: 1\n---\n')).toThrow('manquant');
    expect(readAgentPrompts('dossier-absent')).toEqual([]);
  });

  it('réglages des agents : plafond de dépense, barème du modèle par défaut, plafonds des outils à 50 $', () => {
    const settings = new Map(SETTINGS.map((s) => [s.key, s.value]));
    expect(settings.get('agents.daily_budget_micros')).toBe(20_000_000);
    expect((settings.get('agents.llm_pricing') as Record<string, unknown>)['claude-opus-5-5']).toMatchObject({ inputMicrosPerMTok: 4_000_000, outputMicrosPerMTok: 20_000_000 });
    expect(settings.get('agents.max_refund_cents')).toBe(5_000);
    expect(settings.get('agents.max_credit_cents')).toBe(5_000);
    expect(AGENTS.every((a) => a.model === 'claude-opus-5-5')).toBe(true);
  });
});
