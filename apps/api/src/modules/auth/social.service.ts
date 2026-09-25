/**
 * Connexion Apple et Google (section 7.2) : le jeton d'identité reçu par l'application est vérifié côté serveur
 * (signature par les clés publiques du fournisseur, émetteur, audience, expiration, nonce). Simulé quand
 * SOCIAL_LOGIN_PROVIDER=mock : jeton « mock-apple:<sujet>:<courriel> ».
 */
import { Inject, Injectable } from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { AppError } from '../../common/app-error.js';
import { sha256Hex } from '../../common/crypto.js';
import { APP_ENV, type AppEnv } from '../../config/env.js';

export type SocialProvider = 'apple' | 'google';

export interface SocialIdentity {
  provider: SocialProvider;
  subject: string;
  email: string | null;
  emailVerified: boolean;
}

const PROVIDERS: Record<SocialProvider, { jwks: string; issuers: string[] }> = {
  apple: { jwks: 'https://appleid.apple.com/auth/keys', issuers: ['https://appleid.apple.com'] },
  google: { jwks: 'https://www.googleapis.com/oauth2/v3/certs', issuers: ['https://accounts.google.com', 'accounts.google.com'] },
};

@Injectable()
export class SocialService {
  private readonly jwks = new Map<SocialProvider, ReturnType<typeof createRemoteJWKSet>>();

  constructor(@Inject(APP_ENV) private readonly env: AppEnv) {}

  get mode(): 'mock' | 'real' {
    return this.env.SOCIAL_LOGIN_PROVIDER;
  }

  async verify(provider: SocialProvider, identityToken: string, nonce?: string): Promise<SocialIdentity> {
    if (this.mode === 'mock') return this.verifyMock(provider, identityToken);
    const audience = (provider === 'apple' ? this.env.APPLE_CLIENT_IDS : this.env.GOOGLE_CLIENT_IDS)?.split(',').map((s) => s.trim()).filter(Boolean) ?? [];
    if (!audience.length) throw new AppError('PROVIDER_NOT_CONFIGURED', `Connexion ${provider} non configurée (${provider === 'apple' ? 'APPLE_CLIENT_IDS' : 'GOOGLE_CLIENT_IDS'})`, 501);
    let jwks = this.jwks.get(provider);
    if (!jwks) {
      jwks = createRemoteJWKSet(new URL(PROVIDERS[provider].jwks));
      this.jwks.set(provider, jwks);
    }
    try {
      const { payload } = await jwtVerify(identityToken, jwks, { issuer: PROVIDERS[provider].issuers, audience });
      if (typeof payload.sub !== 'string') throw new Error('sub');
      if (nonce) {
        // Apple renvoie le nonce haché en SHA-256 ; Google le renvoie tel quel.
        const expected = provider === 'apple' ? sha256Hex(nonce) : nonce;
        if (payload['nonce'] !== expected && payload['nonce'] !== nonce) throw new Error('nonce');
      }
      const email = typeof payload['email'] === 'string' ? payload['email'].toLowerCase() : null;
      const verified = payload['email_verified'] === true || payload['email_verified'] === 'true';
      return { provider, subject: payload.sub, email, emailVerified: verified };
    } catch {
      throw AppError.unauthorized('INVALID_IDENTITY_TOKEN', `Jeton d'identité ${provider} invalide`);
    }
  }

  private verifyMock(provider: SocialProvider, token: string): SocialIdentity {
    const match = /^mock-(apple|google):([A-Za-z0-9._-]{3,100})(?::([^:\s]+@[^:\s]+))?$/.exec(token);
    if (!match || match[1] !== provider) throw AppError.unauthorized('INVALID_IDENTITY_TOKEN', `Jeton d'identité ${provider} invalide (simulation : mock-${provider}:<sujet>:<courriel>)`);
    return { provider, subject: match[2]!, email: match[3]?.toLowerCase() ?? null, emailVerified: Boolean(match[3]) };
  }
}
