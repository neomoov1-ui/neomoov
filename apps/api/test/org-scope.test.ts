import 'reflect-metadata';
import type { Request } from 'express';
import { describe, expect, it } from 'vitest';
import { ORG_SCOPED_KEY, OrgScoped, type OrgScopedOptions } from '../src/modules/auth/actor.js';
import { OrgScopeGuard } from '../src/modules/auth/guards.js';

/** Étape 20 : résolution de l'organisation d'une route `@OrgScoped` (paramètre de route, sinon en-tête), sans base. */
const fakeRequest = (params: Record<string, string>, headers: Record<string, string> = {}) =>
  ({ params, header: (name: string) => headers[name.toLowerCase()] } as unknown as Request);

describe('routes d\'organisation : décorateur et résolution de l\'organisation', () => {
  it('@OrgScoped() : paramètre organizationId et en-tête X-Organization-Id par défaut, surcharge possible', () => {
    class Sample {
      @OrgScoped()
      byDefault() {}
      @OrgScoped({ param: 'orgId' })
      custom() {}
    }
    expect(Reflect.getMetadata(ORG_SCOPED_KEY, Sample.prototype.byDefault)).toEqual({ param: 'organizationId', header: 'x-organization-id' });
    expect(Reflect.getMetadata(ORG_SCOPED_KEY, Sample.prototype.custom)).toEqual({ param: 'orgId', header: 'x-organization-id' });
  });

  it('l\'identifiant vient du paramètre de route, sinon de l\'en-tête, sinon rien', () => {
    const options: OrgScopedOptions = { param: 'organizationId', header: 'x-organization-id' };
    expect(OrgScopeGuard.organizationIdOf(fakeRequest({ organizationId: 'org-param' }, { 'x-organization-id': 'org-header' }), options)).toBe('org-param');
    expect(OrgScopeGuard.organizationIdOf(fakeRequest({}, { 'x-organization-id': '  org-header  ' }), options)).toBe('org-header');
    expect(OrgScopeGuard.organizationIdOf(fakeRequest({ id: 'autre' }, {}), options)).toBeNull();
    expect(OrgScopeGuard.organizationIdOf(fakeRequest({}, { 'x-organization-id': '   ' }), options)).toBeNull();
  });
});
