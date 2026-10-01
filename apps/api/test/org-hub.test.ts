import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { afterScopeCommit, orgScopeStorage } from '../src/common/org-scope.context.js';
import { invitationTokenInResponse } from '../src/config/env.js';

/** Étape 21, sans base : traitements différés après la validation d'une transaction restreinte, réglage de développement. */
describe('étape 21 : traitements après la validation, jeton d\'invitation', () => {
  it('hors contexte : tout de suite ; dans une transaction restreinte : mis de côté jusqu\'à sa validation', async () => {
    const done: string[] = [];
    await afterScopeCommit(() => done.push('plateforme'));
    expect(done).toEqual(['plateforme']);
    const afterCommit: Array<() => unknown> = [];
    await orgScopeStorage.run({ organizationId: 'a', path: '/r/a/', tx: null, ended: false, parent: null, afterCommit }, async () => {
      await afterScopeCommit(() => done.push('organisation'));
    });
    expect(done).toEqual(['plateforme']);
    expect(afterCommit).toHaveLength(1);
    await afterCommit[0]!();
    expect(done).toEqual(['plateforme', 'organisation']);
  });

  it('jeton rendu à la personne qui invite : seulement sur demande, jamais en production', () => {
    expect(invitationTokenInResponse({ NODE_ENV: 'development', INVITATION_TOKEN_IN_RESPONSE: undefined })).toBe(false);
    expect(invitationTokenInResponse({ NODE_ENV: 'development', INVITATION_TOKEN_IN_RESPONSE: 'on' })).toBe(true);
    expect(invitationTokenInResponse({ NODE_ENV: 'test', INVITATION_TOKEN_IN_RESPONSE: 'off' })).toBe(false);
    expect(invitationTokenInResponse({ NODE_ENV: 'production', INVITATION_TOKEN_IN_RESPONSE: 'on' })).toBe(false);
  });
});
