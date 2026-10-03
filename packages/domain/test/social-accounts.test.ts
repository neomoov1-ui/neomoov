import { describe, expect, it } from 'vitest';
import {
  defaultSocialMode, effectiveSocialStatus, isSocialProfileUrl, normalizeTelegramChannel, publicSocialLinks, socialAccountUpdateSchema, socialCallbackUrl, socialTelegramConnectSchema, SOCIAL_SPACE_INFO, SOCIAL_SPACES,
} from '../src/index.js';

/** Réseaux sociaux (3 octobre 2026) : catalogue des dix espaces, états, canal Telegram, liens publics de la page Contact. */
describe('réseaux sociaux : espaces et règles pures', () => {
  it('dix espaces dans l\'ordre du chantier ; jamais d\'agrégateur proposé ; Snapchat et chaîne WhatsApp en relais manuel', () => {
    expect(SOCIAL_SPACES).toEqual(['site_blog', 'facebook', 'instagram', 'linkedin', 'x', 'tiktok', 'snapchat', 'telegram', 'youtube', 'whatsapp_channel']);
    for (const space of SOCIAL_SPACES) expect(SOCIAL_SPACE_INFO[space].modes).not.toContain('aggregator');
    expect(defaultSocialMode('snapchat')).toBe('manual');
    expect(defaultSocialMode('whatsapp_channel')).toBe('manual');
    expect(defaultSocialMode('telegram')).toBe('direct');
    expect(SOCIAL_SPACES.filter((s) => SOCIAL_SPACE_INFO[s].requiresApproval)).toEqual(['linkedin', 'tiktok', 'youtube']);
  });

  it('adresse de rappel : Instagram passe par celle de Facebook ; aucune pour les formulaires et les relais manuels', () => {
    expect(socialCallbackUrl('https://api.neomoov.net/', 'instagram')).toBe('https://api.neomoov.net/v1/social/oauth/callback/facebook');
    expect(socialCallbackUrl('https://api.neomoov.net', 'x')).toBe('https://api.neomoov.net/v1/social/oauth/callback/x');
    expect(socialCallbackUrl('https://api.neomoov.net', 'telegram')).toBeNull();
    expect(socialCallbackUrl('https://api.neomoov.net', 'snapchat')).toBeNull();
  });

  it('état affiché : relais manuel relié par son lien ; approbation en attente avant tout état direct', () => {
    expect(effectiveSocialStatus({ space: 'snapchat', mode: 'manual', validation: 'not_connected', profileUrl: null, appApproved: false })).toBe('not_connected');
    expect(effectiveSocialStatus({ space: 'snapchat', mode: 'manual', validation: 'not_connected', profileUrl: 'https://www.snapchat.com/add/neomoov', appApproved: false })).toBe('connected');
    expect(effectiveSocialStatus({ space: 'linkedin', mode: 'direct', validation: 'connected', profileUrl: null, appApproved: false })).toBe('pending_approval');
    expect(effectiveSocialStatus({ space: 'linkedin', mode: 'direct', validation: 'invalid', profileUrl: null, appApproved: true })).toBe('invalid');
    expect(effectiveSocialStatus({ space: 'x', mode: 'direct', validation: 'expired', profileUrl: null, appApproved: false })).toBe('expired');
  });

  it('canal Telegram : @nom, lien t.me ou identifiant -100… ; sinon refusé', () => {
    expect(normalizeTelegramChannel('@neomoov')).toBe('@neomoov');
    expect(normalizeTelegramChannel('https://t.me/neomoov/')).toBe('@neomoov');
    expect(normalizeTelegramChannel('t.me/neomoov_ca')).toBe('@neomoov_ca');
    expect(normalizeTelegramChannel('-1001234567890')).toBe('-1001234567890');
    expect(normalizeTelegramChannel('neo')).toBeNull();
    expect(normalizeTelegramChannel('https://exemple.com/neomoov')).toBeNull();
    expect(socialTelegramConnectSchema.safeParse({ botToken: '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawQ', channel: '@neomoov' }).success).toBe(true);
    expect(socialTelegramConnectSchema.safeParse({ botToken: 'pas-un-jeton', channel: '@neomoov' }).success).toBe(false);
  });

  it('lien public : https sur un domaine du réseau, sans identifiants ni autre domaine', () => {
    expect(isSocialProfileUrl('facebook', 'https://www.facebook.com/neomoov')).toBe(true);
    expect(isSocialProfileUrl('whatsapp_channel', 'https://whatsapp.com/channel/0029VaNeomoov')).toBe(true);
    expect(isSocialProfileUrl('x', 'https://twitter.com/neomoov')).toBe(true);
    expect(isSocialProfileUrl('facebook', 'http://www.facebook.com/neomoov')).toBe(false);
    expect(isSocialProfileUrl('facebook', 'https://facebook.com.exemple.net/neomoov')).toBe(false);
    expect(isSocialProfileUrl('facebook', 'https://user:pass@facebook.com/neomoov')).toBe(false);
    expect(isSocialProfileUrl('instagram', 'https://www.facebook.com/neomoov')).toBe(false);
  });

  it('liens de la page Contact : reliés, validés, visibles, dans l\'ordre des espaces', () => {
    const links = publicSocialLinks([
      { space: 'telegram', status: 'connected', showOnSite: true, profileUrl: 'https://t.me/neomoov' },
      { space: 'facebook', status: 'connected', showOnSite: true, profileUrl: 'https://www.facebook.com/neomoov' },
      { space: 'instagram', status: 'invalid', showOnSite: true, profileUrl: 'https://www.instagram.com/neomoov/' },
      { space: 'x', status: 'connected', showOnSite: false, profileUrl: 'https://x.com/neomoov' },
      { space: 'linkedin', status: 'pending_approval', showOnSite: true, profileUrl: 'https://www.linkedin.com/company/neomoov/' },
      { space: 'snapchat', status: 'connected', showOnSite: true, profileUrl: 'https://exemple.com/neomoov' },
    ]);
    expect(links).toEqual([
      { space: 'facebook', label: 'Facebook', url: 'https://www.facebook.com/neomoov' },
      { space: 'telegram', label: 'Telegram', url: 'https://t.me/neomoov' },
    ]);
  });

  it('réglages : jamais le mode agrégateur, au moins un changement', () => {
    expect(socialAccountUpdateSchema.safeParse({ mode: 'aggregator' }).success).toBe(false);
    expect(socialAccountUpdateSchema.safeParse({}).success).toBe(false);
    expect(socialAccountUpdateSchema.safeParse({ showOnSite: false }).success).toBe(true);
  });
});
