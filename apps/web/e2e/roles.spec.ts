import { expect, test } from '@playwright/test';
import { shot, state, totp } from './support';

// Autorisation par rôle côté web : la passerelle ne donne jamais plus que le jeton (lecture seule refusée en écriture
// par l'API), protège les écritures contre la falsification de requête, et refuse sans session.
test('rôle lecture seule : modules visibles, écritures refusées par l\'API', async ({ page }) => {
  const { readonly } = state().accounts;
  await page.goto('/hub/connexion');
  await page.getByLabel('Courriel').fill(readonly.email);
  await page.getByLabel('Mot de passe').fill(readonly.password);
  await page.getByRole('button', { name: 'Continuer' }).click();
  const secret = (await page.getByTestId('totp-secret').innerText()).trim();
  await page.getByLabel('Code à 6 chiffres').fill(totp(secret));
  await page.getByRole('button', { name: 'Activer et se connecter' }).click();
  await page.getByRole('button', { name: /conservé mes codes/ }).click();

  await expect(page.getByText('Lecture seule')).toBeVisible();
  await page.goto('/hub/courses');
  await expect(page.getByRole('heading', { name: 'Courses' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Nouvelle course' })).toHaveCount(0);
  await page.goto('/hub/courses/nouvelle');
  await expect(page.getByText('Votre rôle ne permet pas cette action.')).toBeVisible();
  await shot(page, '32-lecture-seule');

  const denied = await page.request.patch('/api/v1/admin/settings/booking.min_lead_seconds', { headers: { 'x-neomoov-hub': '1', 'content-type': 'application/json' }, data: { value: 60 } });
  expect(denied.status()).toBe(403);
  const csrf = await page.request.post('/api/v1/admin/tariffs', { data: {} });
  expect(csrf.status()).toBe(403);
  expect((await csrf.json()).code).toBe('CSRF');
  const notRelayed = await page.request.get('/api/v1/internal/service/whoami');
  expect(notRelayed.status()).toBe(404);
});

test('sans session : pages et relais refusés', async ({ request, page }) => {
  expect((await request.get('/api/v1/admin/dashboard')).status()).toBe(401);
  expect((await request.get('/api/session')).status()).toBe(401);
  await page.goto('/hub/rapports');
  await expect(page).toHaveURL(/\/hub\/connexion/);
});
