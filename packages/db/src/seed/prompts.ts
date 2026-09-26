/**
 * Prompts système des agents (section 5.16) : fichiers versionnés `docs/agents/*.md`, avec un en-tête (clé, agent,
 * version) suivi du texte du prompt. Lus par les données de départ et chargés dans `agent_prompts`.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface AgentPromptFile {
  key: string;
  agentCode: string;
  version: number;
  body: string;
  sha256: string;
}

/** Dossier `docs/agents` du dépôt (même profondeur depuis `src/seed` et `dist/seed`). */
export const AGENT_PROMPTS_DIR = fileURLToPath(new URL('../../../../docs/agents', import.meta.url));

/** Lit un fichier de prompt : en-tête `---` (clé, agent, version) puis le texte, fins de ligne normalisées. */
export function parseAgentPrompt(content: string, source = 'prompt'): AgentPromptFile {
  const text = content.replace(/\r\n/g, '\n');
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  if (!match) throw new Error(`${source} : en-tête --- absent`);
  const header = Object.fromEntries(match[1]!.split('\n').map((line) => line.split(':').map((part) => part.trim())).filter((kv) => kv.length === 2)) as Record<string, string>;
  const body = match[2]!.trim();
  const version = Number(header['version']);
  if (!header['key'] || !header['agent'] || !Number.isInteger(version) || version < 1 || !body) throw new Error(`${source} : clé, agent, version ou texte manquant`);
  if (header['key'] !== `${header['agent']}.v${version}`) throw new Error(`${source} : la clé doit valoir ${header['agent']}.v${version}`);
  return { key: header['key'], agentCode: header['agent'], version, body, sha256: createHash('sha256').update(body).digest('hex') };
}

/** Tous les prompts du dossier ; aucun si le dossier est absent (image de production sans la documentation). */
export function readAgentPrompts(dir = AGENT_PROMPTS_DIR): AgentPromptFile[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^[a-z0-9-]+\.v\d+\.md$/.test(f))
    .sort()
    .map((f) => parseAgentPrompt(readFileSync(join(dir, f), 'utf8'), f));
}
