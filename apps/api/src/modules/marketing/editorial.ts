/**
 * Lignes éditoriales de l'agent contenu : le fichier versionné `docs/marketing/lignes-editoriales.md` du dépôt (même
 * mécanisme que les prompts de `docs/agents`), remplacé par le réglage `marketing.editorial_lines_override` quand il est
 * renseigné dans My Hub. Une image sans la documentation et sans réglage arrête l'agent avec une erreur visible.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/app-error.js';
import { SettingsService } from '../../common/settings.service.js';

/** Même profondeur depuis `src/modules/marketing` et `dist/modules/marketing`. */
export const EDITORIAL_LINES_PATH = fileURLToPath(new URL('../../../../../docs/marketing/lignes-editoriales.md', import.meta.url));

@Injectable()
export class EditorialLinesService {
  private cached: { text: string; loadedAt: number } | null = null;

  constructor(private readonly settings: SettingsService) {}

  async load(): Promise<string> {
    const override = await this.settings.string('marketing.editorial_lines_override', '');
    if (override.trim()) return override.trim();
    if (this.cached && Date.now() - this.cached.loadedAt < 300_000) return this.cached.text;
    if (!existsSync(EDITORIAL_LINES_PATH)) throw new AppError('EDITORIAL_LINES_MISSING', 'Lignes éditoriales absentes : docs/marketing/lignes-editoriales.md introuvable et réglage marketing.editorial_lines_override vide', 500);
    const text = readFileSync(EDITORIAL_LINES_PATH, 'utf8').replace(/\r\n/g, '\n').trim();
    this.cached = { text, loadedAt: Date.now() };
    return text;
  }
}
