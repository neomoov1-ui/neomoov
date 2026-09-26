import { expect, test, type Page } from '@playwright/test';
import { call, closeSql, randomPhone, shot, signUp, smsCode, sql, state } from './support';

// Pages publiques (prompt 12, tâche 4) : réservation web complète sans compte préalable, suivi par lien, préinscription
// des chauffeurs, page des droits ; en-têtes de sécurité (iframe de réservation autorisée sur les domaines permis).
test.describe.configure({ mode: 'serial' });

async function pickAddress(page: Page, label: string, typed: string, option: RegExp) {
  await page.getByLabel(label).fill(typed);
  await page.getByRole('option', { name: option }).first().click();
  await expect(page.getByLabel(label)).toHaveValue(option);
}

let trackingPath = '';

test('réservation web sans compte : prix garanti, vérification SMS, confirmation, lien de suivi', async ({ page }) => {
  const phone = randomPhone('+1438562');
  await page.goto('/reserver');
  await expect(page.getByRole('heading', { name: 'Réserver une course' })).toBeVisible();
  await pickAddress(page, 'Adresse de départ', 'Aéroport', /Montréal-Trudeau/);
  await pickAddress(page, 'Adresse d\'arrivée', 'Saint-Sacrement', /Saint-Sacrement/);
  await page.getByRole('button', { name: 'Voir les prix' }).click();
  await page.getByRole('radio', { name: /Neo Premium/ }).check();
  await page.getByText('Détail du prix').click();
  await expect(page.getByText('Total tout compris').first()).toBeVisible();
  await shot(page, '26-reservation-prix');
  await page.getByRole('button', { name: 'Choisir' }).click();

  await page.getByLabel('Prénom').fill('Camille');
  await page.getByLabel('Nom', { exact: true }).fill('Essai');
  await page.getByLabel('Téléphone mobile').fill(phone);
  const since = Date.now() - 1000;
  await page.getByRole('button', { name: 'Recevoir le code' }).click();
  await page.getByLabel('Code reçu par texto').fill(await smsCode(phone, since));
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Vérifier le code' }).click();
  await expect(page.getByText('Numéro vérifié.')).toBeVisible();
  await expect(page.getByLabel(/Payer par carte/)).toBeDisabled();
  await page.getByLabel('Demandes spéciales (facultatif)').fill('Deux valises');
  await shot(page, '27-reservation-coordonnees');
  await page.getByRole('button', { name: 'Confirmer la réservation' }).click();
  await expect(page.getByRole('heading', { name: 'Réservation confirmée' })).toBeVisible();
  trackingPath = (await page.getByTestId('tracking-link').innerText()).trim();
  expect(trackingPath).toMatch(/^\/suivi\/[A-Za-z0-9_-]{16,24}$/);
  await shot(page, '28-reservation-confirmee');
});

test('suivi partagé par lien', async ({ page }) => {
  test.skip(!trackingPath, 'réservation précédente absente');
  await page.goto(trackingPath);
  await expect(page.getByRole('heading', { name: /Suivi de la course/ })).toBeVisible();
  await expect(page.getByText('Aéroport', { exact: false }).or(page.getByText('Saint-Sacrement'))).toBeVisible();
  await shot(page, '29-suivi-partage');
  await page.goto('/suivi/lien-invalide-0000000');
  await expect(page.getByText(/lien de suivi (est invalide|a expiré)/)).toBeVisible();
});

test('préinscription d\'un chauffeur (API publique, anti-robots, consentement) visible dans My Hub', async ({ page }) => {
  const phone = randomPhone('+1438563');
  await page.goto('/chauffeurs');
  await expect(page.getByRole('heading', { name: 'Devenez chauffeur Neomoov' })).toBeVisible();
  await page.getByLabel('Prénom').fill('Nadia');
  await page.getByLabel('Nom', { exact: true }).fill('Préinscrite');
  await page.getByLabel('Téléphone').fill(phone);
  await page.getByLabel(/Votre véhicule/).fill('Tesla Model Y 2023, 6 ans de VTC');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Envoyer ma préinscription' }).click();
  await expect(page.getByText('Merci ! Votre préinscription est reçue.')).toBeVisible();
  await shot(page, '30-devenir-chauffeur');
  const leads = await call<{ items: Array<{ phone: string | null; kind: string; source: string }> }>('GET', `/admin/leads?q=${encodeURIComponent('Préinscrite')}`, state().setupToken);
  expect(leads.items.some((l) => l.kind === 'driver' && l.source.startsWith('E2E web'))).toBe(true);
});

test('page des droits : vérification du numéro, dépôt et suivi d\'une demande', async ({ page }) => {
  const phone = randomPhone('+1438564');
  await signUp(phone);
  // Délai avant renvoi d'un code : le code du compte créé juste avant est vieilli (comme dans les tests de l'API).
  await sql()`UPDATE otp_codes SET created_at = created_at - interval '5 minutes' WHERE phone = ${phone}`;
  await closeSql();
  await page.goto('/droits');
  await page.getByLabel('Téléphone mobile').fill(phone);
  const since = Date.now() - 1000;
  await page.getByRole('button', { name: 'Recevoir le code' }).click();
  await page.getByLabel('Code reçu par texto').fill(await smsCode(phone, since));
  await page.getByRole('button', { name: 'Vérifier le code' }).click();
  await expect(page.getByRole('heading', { name: 'Vos demandes' })).toBeVisible();
  await page.getByLabel('Type de demande').selectOption('access');
  await page.getByRole('button', { name: 'Envoyer la demande' }).click();
  await expect(page.getByText('Demande reçue.')).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: 'Accès à mes données' }).first()).toBeVisible();
  await shot(page, '31-droits');
});

test('en-têtes : réservation intégrable sur les domaines autorisés, le reste jamais en iframe', async ({ request }) => {
  const booking = await request.get('/reserver');
  expect(booking.headers()['x-frame-options']).toBeUndefined();
  expect(booking.headers()['content-security-policy']).toContain('frame-ancestors \'self\' https://neomoov.net');
  const hub = await request.get('/hub/connexion');
  expect(hub.headers()['x-frame-options']).toBe('DENY');
  expect(hub.headers()['content-security-policy']).toContain('frame-ancestors \'none\'');
  expect(hub.headers()['x-content-type-options']).toBe('nosniff');
});
