import { describe, expect, it } from 'vitest';
import {
  API_KEY_SCOPES, apiKeyCreateSchema, consentInputSchema, dataRequestInputSchema, deviceInputSchema, meSchema, mfaBackupSchema, otpRequestSchema, otpVerifySchema, patchMeSchema,
  phoneE164, socialLoginResponseSchema, staffCreateSchema, tokensSchema,
} from '../src/index.js';

describe('schémas de l\'identité (prompt 03)', () => {
  it('valide les numéros E.164 et les codes à 6 chiffres', () => {
    expect(otpRequestSchema.parse({ phone: '+15145550142' })).toEqual({ phone: '+15145550142' });
    expect(otpRequestSchema.safeParse({ phone: '5145550142' }).success).toBe(false);
    expect(otpVerifySchema.safeParse({ phone: '+15145550142', code: '12345' }).success).toBe(false);
    expect(otpVerifySchema.parse({ phone: '+15145550142', code: '123456', acceptTerms: true, privacyPolicyVersion: ' 2026-09-01 ' }).privacyPolicyVersion).toBe('2026-09-01');
    expect(phoneE164.safeParse('+0123').success).toBe(false);
  });

  it('refuse une modification de profil vide et normalise le courriel', () => {
    expect(patchMeSchema.safeParse({}).success).toBe(false);
    expect(patchMeSchema.parse({ email: ' Sophie@Example.com ' })).toEqual({ email: 'Sophie@Example.com' });
    expect(patchMeSchema.parse({ email: null })).toEqual({ email: null });
    expect(patchMeSchema.safeParse({ language: 'es' }).success).toBe(false);
  });

  it('appareils, consentements et demandes de droits', () => {
    expect(deviceInputSchema.parse({ platform: 'ios', pushToken: 'ExponentPushToken[abc]' }).platform).toBe('ios');
    expect(deviceInputSchema.safeParse({ platform: 'windows' }).success).toBe(false);
    expect(consentInputSchema.parse({ purpose: 'geolocation', version: '1', granted: true }).source).toBe('app');
    expect(dataRequestInputSchema.parse({ type: 'access' }).type).toBe('access');
    // La suppression passe par DELETE /v1/me, pas par une demande.
    expect(dataRequestInputSchema.safeParse({ type: 'deletion' }).success).toBe(false);
  });

  it('personnel et clés de service', () => {
    expect(staffCreateSchema.safeParse({ phone: '+15145550100', email: 'a@b.ca', firstName: 'A', lastName: 'B', roles: ['admin'], password: 'court' }).success).toBe(false);
    expect(staffCreateSchema.parse({ phone: '+15145550100', email: 'a@b.ca', firstName: 'A', lastName: 'B', roles: ['finance', 'readonly'], password: 'Assez-long-1234' }).language).toBe('fr');
    expect(staffCreateSchema.safeParse({ phone: '+15145550100', email: 'a@b.ca', firstName: 'A', lastName: 'B', roles: ['client'], password: 'Assez-long-1234' }).success).toBe(false);
    expect(mfaBackupSchema.parse({ mfaToken: 'x'.repeat(20), backupCode: 'ABCD-2345' }).backupCode).toBe('ABCD-2345');
    expect(mfaBackupSchema.safeParse({ mfaToken: 'x'.repeat(20), backupCode: 'ABCD2345' }).success).toBe(false);
    expect(apiKeyCreateSchema.parse({ name: 'agent', scopes: ['agents:run'], agentCode: 'analytics' }).scopes).toEqual(['agents:run']);
    expect(apiKeyCreateSchema.safeParse({ name: 'agent', scopes: [] }).success).toBe(false);
    expect(API_KEY_SCOPES).toContain('tools:*');
  });

  it('contrat des réponses : jetons et liaison à un téléphone', () => {
    const user = {
      id: '00000000-0000-4000-8000-000000000001', phone: '+15145550142', email: null, firstName: null, lastName: null, language: 'fr', primaryRole: 'client', roles: ['client'],
      status: 'active', termsAcceptedAt: '2026-09-25T00:00:00.000Z', privacyPolicyVersion: '2026-09-01', privacyPolicyCurrentVersion: '2026-09-01', privacyPolicyAccepted: true,
      linkedProviders: [], mfaEnabled: false, createdAt: '2026-09-25T00:00:00.000Z',
    };
    expect(meSchema.parse(user).roles).toEqual(['client']);
    const tokens = { tokenType: 'Bearer', accessToken: 'a', expiresIn: 900, refreshToken: 'rt_b', created: true, user };
    expect(tokensSchema.parse(tokens).expiresIn).toBe(900);
    expect(socialLoginResponseSchema.parse({ status: 'phone_required', linkToken: 'l', email: null })).toMatchObject({ status: 'phone_required' });
    expect(socialLoginResponseSchema.parse(tokens)).toMatchObject({ tokenType: 'Bearer' });
  });
});
