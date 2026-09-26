import { describe, expect, it } from 'vitest';
import { invitationCreateSchema, membershipUpdateSchema, organizationCreateSchema, roleCreateSchema } from '../src/index.js';

const ROLE = '00000000-0000-4000-8000-000000000001';

describe('schémas des accès (étape 19)', () => {
  it('invitation : courriel ou téléphone, 7 jours par défaut, portée « organisation »', () => {
    expect(invitationCreateSchema.parse({ roleId: ROLE, phone: '+15145550142' })).toMatchObject({ scope: 'organization', expiresInDays: 7 });
    expect(invitationCreateSchema.parse({ roleId: ROLE, email: 'Agent@Exemple.ca' }).email).toBe('agent@exemple.ca');
    expect(invitationCreateSchema.safeParse({ roleId: ROLE }).success).toBe(false);
    expect(invitationCreateSchema.safeParse({ roleId: ROLE, phone: '+15145550142', expiresInDays: 31 }).success).toBe(false);
  });
  it('adhésion : au moins un changement', () => {
    expect(membershipUpdateSchema.safeParse({}).success).toBe(false);
    expect(membershipUpdateSchema.parse({ status: 'suspended' }).status).toBe('suspended');
  });
  it('sous-organisation : jamais une seconde plateforme ; codes normalisés', () => {
    expect(organizationCreateSchema.safeParse({ parentId: ROLE, code: 'flotte-a', name: 'Flotte A', type: 'platform' }).success).toBe(false);
    expect(organizationCreateSchema.parse({ parentId: ROLE, code: 'Flotte-A', name: 'Flotte A', type: 'fleet' }).code).toBe('flotte-a');
    expect(roleCreateSchema.safeParse({ organizationId: ROLE, code: 'r', name: 'Rôle', level: 0, permissions: ['rides.read'] }).success).toBe(false);
  });
});
