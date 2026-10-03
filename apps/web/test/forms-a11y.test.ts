/**
 * Accessibilité automatisée des formulaires de réservation et de connexion (revue finale V1), sans navigateur : rendu
 * statique de la réservation web, de la vérification du numéro, de la connexion de My Hub et de la saisie d'une course,
 * puis contrôles du balisage (`support/markup.ts`). Nouveaux champs de la réservation : animal d'assistance, code promo.
 */
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/hub/connexion',
  useParams: () => ({}),
}));

const { Booking } = await import('../src/components/booking');
const { OtpSignIn } = await import('../src/components/otp-sign-in');
const { HubLogin } = await import('../src/components/hub-login');
const { NewRideForm } = await import('../src/components/hub/new-ride-form');
const { createGuestApi } = await import('../src/lib/site-api');
const { a11yIssues, render, tags } = await import('./support/markup');

describe('accessibilité des formulaires', () => {
  it('réservation web (trajet) : champs nommés, adresses en liste annoncée, animal d\'assistance et code promo', () => {
    for (const language of ['fr-CA', 'en'] as const) {
      const html = render(createElement(Booking), { language });
      expect(a11yIssues(html), language).toEqual([]);
      const combos = tags(html).filter((t) => t.attrs['role'] === 'combobox');
      expect(combos).toHaveLength(2);
      for (const c of combos) {
        expect(c.attrs['aria-required']).toBeDefined();
        // Liste fermée : pas de référence vers une liste absente.
        expect(c.attrs['aria-controls']).toBeUndefined();
      }
    }
    const fr = render(createElement(Booking));
    expect(fr).toContain('Je voyage avec un animal d&#x27;assistance');
    expect(fr).toContain('Code promo (facultatif)');
    expect(fr).toContain('aria-current="step"');
  });

  it('vérification du numéro par texto', () => {
    const html = render(createElement(OtpSignIn, { guest: createGuestApi(), onSignedIn: () => undefined }));
    expect(a11yIssues(html)).toEqual([]);
    expect(html).toMatch(/autocomplete="tel"/i);
  });

  it('connexion de My Hub : onglets reliés à leur panneau, un seul onglet atteignable par Tab', () => {
    const html = render(createElement(HubLogin, { language: 'fr-CA' }));
    expect(a11yIssues(html)).toEqual([]);
    const tabs = tags(html).filter((t) => t.attrs['role'] === 'tab');
    expect(tabs).toHaveLength(2);
    expect(tabs.map((t) => t.attrs['tabindex'])).toEqual(['0', '-1']);
    expect(tabs.every((t) => t.attrs['aria-controls'] === 'login-panel')).toBe(true);
    expect(tags(html).find((t) => t.attrs['role'] === 'tabpanel')?.attrs['aria-labelledby']).toBe('login-tab-staff');
  });

  it('saisie d\'une course (plateforme et organisation) : trajet nommé', () => {
    const api = { quote: async () => { throw new Error('non appelé'); }, create: async () => { throw new Error('non appelé'); } };
    const html = render(createElement(NewRideForm, { api, scope: 'test', onCreated: () => undefined }));
    expect(a11yIssues(html)).toEqual([]);
    expect(html).toContain('animal de compagnie en cage');
  });

  it('le contrôle détecte bien les défauts (témoin)', () => {
    expect(a11yIssues('<input type="text" id="a"><label for="b">X</label><button></button><img src="x"><div aria-describedby="z" tabindex="2"></div>').sort()).toEqual([
      'label[for] vers un identifiant absent : b', 'image sans texte de remplacement', 'div[aria-describedby] vers un identifiant absent : z', 'div avec tabindex positif', 'input sans libellé', 'button sans nom accessible',
    ].sort());
  });
});
