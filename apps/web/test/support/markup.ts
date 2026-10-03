/**
 * Tests de rendu sans navigateur : rendu statique d'un composant avec les fournisseurs du web (requêtes, traductions,
 * marque), et contrôles d'accessibilité simples sur le balisage obtenu, faute d'outil comme axe dans le dépôt : nom
 * accessible de chaque champ, bouton et lien ; références `aria-*` et `for` résolues ; identifiants uniques ; images
 * avec texte de remplacement ; aucun `tabindex` positif.
 */
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { HubUserContext } from '../../src/components/hub/common';
import { Providers } from '../../src/components/providers';
import type { Language } from '../../src/lib/i18n-resources';
import type { HubUser } from '../../src/lib/server/gateway';

export const ADMIN: HubUser = { id: '00000000-0000-4000-8000-000000000001', firstName: 'Ana', lastName: 'Test', email: 'ana@example.com', roles: ['admin'] } as HubUser;

export function render(node: ReactNode, options: { language?: Language; user?: HubUser } = {}): string {
  const inner = options.user ? createElement(HubUserContext.Provider, { value: options.user }, node) : node;
  return renderToStaticMarkup(createElement(Providers, { language: options.language ?? 'fr-CA' }, inner));
}

interface Tag { name: string; attrs: Record<string, string>; inLabel: boolean }

function parseAttrs(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const m of source.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:="([^"]*)")?/g)) attrs[m[1]!.toLowerCase()] = m[2] ?? '';
  return attrs;
}

/** Balises ouvrantes dans l'ordre, avec l'indication « dans un libellé ». */
export function tags(html: string): Tag[] {
  const out: Tag[] = [];
  let labels = 0;
  for (const m of html.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>/g)) {
    const closing = m[1] === '/';
    const name = m[2]!.toLowerCase();
    if (name === 'label') labels += closing ? -1 : 1;
    if (!closing) out.push({ name, attrs: parseAttrs(m[3] ?? ''), inLabel: labels > (name === 'label' ? 1 : 0) });
  }
  return out;
}

const textOf = (inner: string) => inner.replace(/<[^>]+>/g, '').replace(/&[a-z#0-9]+;/gi, 'x').trim();

/** Problèmes d'accessibilité trouvés dans le balisage ; vide quand tout passe. */
export function a11yIssues(html: string): string[] {
  const issues: string[] = [];
  const all = tags(html);
  const ids = new Map<string, number>();
  for (const t of all) if (t.attrs['id']) ids.set(t.attrs['id'], (ids.get(t.attrs['id']) ?? 0) + 1);
  for (const [id, n] of ids) if (n > 1) issues.push(`identifiant en double : ${id}`);
  const labelled = new Set(all.filter((t) => t.name === 'label' && t.attrs['for']).map((t) => t.attrs['for']!));
  for (const t of all) {
    for (const ref of ['aria-describedby', 'aria-labelledby', 'aria-controls', 'for']) {
      const value = t.attrs[ref];
      if (value === undefined || (ref === 'for' && t.name !== 'label')) continue;
      for (const id of value.split(/\s+/).filter(Boolean)) if (!ids.has(id)) issues.push(`${t.name}[${ref}] vers un identifiant absent : ${id}`);
    }
    if (Number(t.attrs['tabindex'] ?? 0) > 0) issues.push(`${t.name} avec tabindex positif`);
    if (t.name === 'img' && t.attrs['alt'] === undefined) issues.push('image sans texte de remplacement');
    const control = (t.name === 'input' && !['hidden', 'submit', 'button'].includes(t.attrs['type'] ?? 'text')) || t.name === 'select' || t.name === 'textarea';
    if (control) {
      const named = t.inLabel || t.attrs['aria-label'] || t.attrs['aria-labelledby'] || (t.attrs['id'] && labelled.has(t.attrs['id']));
      if (!named) issues.push(`${t.name}${t.attrs['name'] ? `[name=${t.attrs['name']}]` : ''} sans libellé`);
    }
  }
  for (const m of html.matchAll(/<(button|a)\b([^>]*)>([\s\S]*?)<\/\1>/g)) {
    const attrs = parseAttrs(m[2] ?? '');
    if (!textOf(m[3] ?? '') && !attrs['aria-label'] && !attrs['aria-labelledby']) issues.push(`${m[1]} sans nom accessible`);
  }
  return issues;
}
