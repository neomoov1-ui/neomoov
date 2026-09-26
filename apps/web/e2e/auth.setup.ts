import { expect, test as setup } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { AUTH_FILE, MFA_FILE, shot, state, totp } from './support';

// Connexion 2FA (prompt 12, tâche 6) : première connexion avec inscription du second facteur par l'interface,
// codes de secours affichés une fois ; la session (témoins httpOnly) sert ensuite aux modules de My Hub.
setup('première connexion du personnel : mot de passe, inscription TOTP, codes de secours', async ({ page }) => {
  const { admin } = state().accounts;
  await page.goto('/hub');
  await expect(page).toHaveURL(/\/hub\/connexion/);

  await page.getByLabel('Courriel').fill(admin.email);
  await page.getByLabel('Mot de passe').fill('mauvais-mot-de-passe');
  await page.getByRole('button', { name: 'Continuer' }).click();
  await expect(page.getByText('Courriel, mot de passe ou code incorrect.')).toBeVisible();

  await page.getByLabel('Mot de passe').fill(admin.password);
  await page.getByRole('button', { name: 'Continuer' }).click();
  await expect(page.getByRole('heading', { name: 'Activer le second facteur' })).toBeVisible();
  const secret = (await page.getByTestId('totp-secret').innerText()).trim();
  await shot(page, '01-connexion-inscription-2fa', [page.getByTestId('totp-secret'), page.getByRole('img', { name: 'QR' })]);

  await page.getByLabel('Code à 6 chiffres').fill('000000');
  await page.getByRole('button', { name: 'Activer et se connecter' }).click();
  await expect(page.getByText('Courriel, mot de passe ou code incorrect.')).toBeVisible();
  await page.getByLabel('Code à 6 chiffres').fill(totp(secret));
  await page.getByRole('button', { name: 'Activer et se connecter' }).click();

  const codes = page.getByTestId('backup-codes').locator('li');
  await expect(codes).toHaveCount(10);
  const backupCodes = await codes.allInnerTexts();
  await shot(page, '02-codes-de-secours', [page.getByTestId('backup-codes')]);
  await page.getByRole('button', { name: /conservé mes codes/ }).click();
  await expect(page.getByRole('heading', { name: 'Tableau de bord' })).toBeVisible();

  // Aucun jeton lisible par la page : les témoins de session sont httpOnly.
  const cookies = await page.context().cookies();
  for (const name of ['nm_hub_at', 'nm_hub_rt']) expect(cookies.find((c) => c.name === name)?.httpOnly).toBe(true);
  expect(await page.evaluate(() => document.cookie)).not.toContain('nm_hub_at');

  fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });
  fs.writeFileSync(MFA_FILE, JSON.stringify({ secret, backupCodes }));
  await page.context().storageState({ path: AUTH_FILE });
});

setup('connexion suivante avec un code de secours, puis déconnexion', async ({ browser }) => {
  const { admin } = state().accounts;
  const { backupCodes } = JSON.parse(fs.readFileSync(MFA_FILE, 'utf8')) as { backupCodes: string[] };
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/hub/connexion');
  await page.getByLabel('Courriel').fill(admin.email);
  await page.getByLabel('Mot de passe').fill(admin.password);
  await page.getByRole('button', { name: 'Continuer' }).click();
  await expect(page.getByRole('heading', { name: 'Second facteur' })).toBeVisible();
  await page.getByRole('button', { name: 'Utiliser un code de secours' }).click();
  await page.getByLabel(/Code de secours/).fill(backupCodes[0]!);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.getByRole('heading', { name: 'Tableau de bord' })).toBeVisible();
  await page.getByRole('button', { name: 'Se déconnecter' }).click();
  await expect(page).toHaveURL(/\/hub\/connexion/);
  await page.goto('/hub/courses');
  await expect(page).toHaveURL(/\/hub\/connexion/);
  await context.close();
});
