import { expect, test, type Page } from '@playwright/test';
import { closeSql, createDriver, createPendingApproval, createSosIncident, randomPhone, shot, sql, waitForTiles } from './support';

// Critères d'acceptation de l'étape 12 depuis My Hub : suivre la flotte, créer et attribuer une course par téléphone,
// valider un chauffeur, modifier un tarif avec date de validité, consulter les factures et l'état SEV, décider un
// incident, approuver une action d'agent ; plus la visite de chaque module (captures dans docs/screens/hub/).
test.describe.configure({ mode: 'serial' });

async function pickAddress(page: Page, label: string, typed: string, option: RegExp) {
  await page.getByLabel(label).fill(typed);
  await page.getByRole('option', { name: option }).first().click();
  await expect(page.getByLabel(label)).toHaveValue(option);
}

test('tableau de bord : indicateurs, carte de la flotte, alertes', async ({ page }) => {
  await page.goto('/hub');
  await expect(page.getByRole('heading', { name: 'Tableau de bord' })).toBeVisible();
  await expect(page.getByText('Courses du jour')).toBeVisible();
  await expect(page.locator('.leaflet-container')).toBeVisible();
  await expect(page.getByText(/Temps réel actif|Actualisation périodique/)).toBeVisible();
  await page.getByLabel('Catégorie').selectOption('neo_premium');
  await waitForTiles(page);
  await shot(page, '03-tableau-de-bord');
});

test('création d\'une course par téléphone (fiche minimale) et attribution manuelle', async ({ page }) => {
  const driver = await createDriver(true);
  await page.goto('/hub/courses/nouvelle');
  await pickAddress(page, 'Adresse de départ', 'Aéroport', /Montréal-Trudeau/);
  await pickAddress(page, 'Adresse d\'arrivée', 'Saint-Sacrement', /Saint-Sacrement/);
  await page.getByRole('button', { name: 'Calculer le prix' }).click();
  await page.getByRole('radio', { name: /Neo Premium/ }).check();
  await page.getByLabel('Nom du client').fill('Client Téléphone');
  await page.getByLabel('Téléphone du client').fill(randomPhone('+1438561'));
  await shot(page, '04-nouvelle-course-telephone');
  await page.getByRole('button', { name: 'Créer la course' }).click();
  await expect(page).toHaveURL(/\/hub\/courses\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: /^Course / })).toBeVisible();
  await expect(page.getByText('Client Téléphone')).toBeVisible();

  await page.getByRole('button', { name: 'Attribuer' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Rechercher').fill(driver.lastName);
  const option = dialog.getByRole('option', { name: new RegExp(driver.lastName) });
  await expect(option).toBeAttached();
  await dialog.getByLabel('Chauffeur').selectOption((await option.getAttribute('value'))!);
  await dialog.getByRole('button', { name: 'Attribuer' }).click();
  await expect(page.getByText('Action enregistrée.')).toBeVisible();
  await expect(page.getByText(/Model X/)).toBeVisible();
  await expect(page.getByText('Attribuée').first()).toBeVisible();
  await shot(page, '05-course-attribuee');

  await page.goto('/hub/courses?view=scheduled');
  await expect(page.getByRole('tab', { name: 'Planifiées' })).toHaveAttribute('aria-selected', 'true');
  await shot(page, '06-courses-planifiees');
});

test('validation d\'un chauffeur : visionneuse, document validé, activation', async ({ page }) => {
  const driver = await createDriver(false);
  await page.goto(`/hub/chauffeurs/${driver.driverId}`);
  await expect(page.getByRole('heading', { name: new RegExp(driver.lastName) })).toBeVisible();
  await expect(page.getByText('À valider').first()).toBeVisible();
  await page.getByRole('row', { name: /Permis de conduire/ }).getByRole('button', { name: 'Afficher' }).click();
  const viewer = page.getByRole('dialog');
  await expect(viewer.getByRole('img', { name: 'Permis de conduire' })).toBeVisible();
  await shot(page, '07-visionneuse-document');
  await viewer.getByRole('button', { name: 'Valider' }).click();
  await expect(page.getByText('Enregistré.')).toBeVisible();
  await expect(page.getByRole('row', { name: /Permis de conduire/ })).toContainText('Validé');
  await page.getByRole('button', { name: 'Activer' }).click();
  await expect(page.getByText('Actif').first()).toBeVisible();
  await shot(page, '08-chauffeur-active');

  await page.goto('/hub/documents');
  await expect(page.getByRole('heading', { name: 'Documents à vérifier' })).toBeVisible();
  await page.goto('/hub/chauffeurs');
  await page.getByLabel('Rechercher').fill(driver.lastName);
  await expect(page.getByRole('row', { name: new RegExp(driver.lastName) })).toContainText('Actif');
  await shot(page, '09-chauffeurs');
});

test('modification d\'un tarif avec date de validité, simulation de devis', async ({ page }) => {
  const day = String(1 + Math.floor(Math.random() * 27)).padStart(2, '0');
  await page.goto('/hub/tarifs');
  await expect(page.getByRole('heading', { name: 'Tarifs' })).toBeVisible();
  await page.getByLabel('Catégorie').selectOption('neo_xl');
  await page.getByLabel('En vigueur le').fill(`2099-01-${day}`);
  await page.getByLabel('Prise en charge ($)').fill('7.25');
  await page.getByLabel('Par km ($)').fill('2.10');
  await page.getByLabel('Par minute ($)').fill('0.55');
  await page.getByLabel('Minimum ($)').fill('25');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByText('Tarif enregistré.')).toBeVisible();
  await expect(page.getByRole('row', { name: /Neo XL.*2099/ }).first()).toContainText('À venir');
  await page.getByRole('button', { name: 'Simuler un devis' }).click();
  await expect(page.getByText(/Résultat de la simulation/)).toBeVisible();
  await shot(page, '10-tarifs');
});

test('éditeur de zones : tracé refusé s\'il se croise', async ({ page }) => {
  await page.goto('/hub/zones');
  await expect(page.getByRole('heading', { name: 'Zones' })).toBeVisible();
  await page.getByRole('list', { name: 'Zones' }).getByRole('button').first().click();
  await page.getByRole('button', { name: 'Modifier le tracé' }).click();
  const map = page.locator('.leaflet-container');
  const box = (await map.boundingBox())!;
  // Nœud papillon : quatre sommets dont les arêtes se croisent.
  for (const [x, y] of [[0.3, 0.3], [0.7, 0.7], [0.7, 0.3], [0.3, 0.7]] as const) await map.click({ position: { x: box.width * x, y: box.height * y } });
  await expect(page.getByText('4 sommets')).toBeVisible();
  await expect(page.getByText(/Le tracé se croise/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Enregistrer la zone' })).toBeDisabled();
  await waitForTiles(page);
  await shot(page, '11-zones-trace-refuse');
  await page.getByRole('button', { name: 'Annuler' }).click();
});

test('incident : SOS reçu, décision motivée', async ({ page }) => {
  const label = `SOS de test ${Date.now().toString(36)}`;
  await createSosIncident(label);
  await page.goto('/hub/incidents');
  const row = page.getByRole('row', { name: new RegExp(label) });
  await expect(row).toContainText('Critique');
  await row.getByRole('button', { name: 'Décider' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('État').selectOption('decided');
  await dialog.getByLabel('Décision').fill('Client rappelé, fausse alerte confirmée ; aucun suivi requis.');
  await dialog.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByRole('row', { name: new RegExp(label) })).toContainText('Décidé');
  await shot(page, '12-incidents');
});

test('agents IA : approbation d\'une action proposée', async ({ page }) => {
  const justification = `Retard de 25 minutes, crédit proposé (${Date.now().toString(36)})`;
  await createPendingApproval(justification);
  await page.goto('/hub/agents');
  const row = page.getByRole('row', { name: new RegExp(justification.replace(/[()]/g, '.')) });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Approuver' }).click();
  await expect(page.getByText('Décision enregistrée.')).toBeVisible();
  await expect(page.getByRole('row', { name: new RegExp(justification.replace(/[()]/g, '.')) })).toHaveCount(0);
  await shot(page, '13-agents-approbations');
});

test('facturation, relevés, rapports et export CSV', async ({ page }) => {
  await page.goto('/hub/factures');
  await expect(page.getByRole('heading', { name: 'Factures' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'État SEV' })).toBeVisible();
  await shot(page, '14-factures-sev');
  await page.goto('/hub/releves');
  await expect(page.getByText(/étape 9/)).toBeVisible();
  await shot(page, '15-releves');
  await page.goto('/hub/rapports');
  await expect(page.getByText('Chiffre d\'affaires')).toBeVisible();
  await expect(page.getByRole('img', { name: /Courses terminées et annulées/ })).toBeVisible();
  await shot(page, '16-rapports');
  const href = await page.getByRole('link', { name: 'Exporter en CSV' }).getAttribute('href');
  const csv = await page.request.get(href!);
  expect(csv.status()).toBe(200);
  expect(csv.headers()['content-type']).toContain('text/csv');
});

test('autres modules : clients, prospects, offres, droits, paramètres, équipe, journal d\'audit', async ({ page }) => {
  const pages: Array<[string, string, string]> = [
    ['/hub/courses', 'Courses', '17-courses-repartition'],
    ['/hub/vehicules', 'Véhicules', '18-vehicules'],
    ['/hub/clients', 'Clients', '19-clients'],
    ['/hub/prospects', 'Prospects', '20-prospects'],
    ['/hub/offres', 'Packs et promotions', '21-packs-promotions'],
    ['/hub/demandes', 'Demandes de droits (Loi 25)', '22-demandes-droits'],
    ['/hub/parametres', 'Paramètres', '23-parametres'],
    ['/hub/equipe', 'Équipe et rôles', '24-equipe'],
    ['/hub/journal', 'Journal d\'audit', '25-journal-audit'],
  ];
  for (const [url, title, name] of pages) {
    await page.goto(url);
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
    await expect(page.getByText('Chargement…')).toHaveCount(0);
    await shot(page, name);
  }
  // Chaque action administrative de ce parcours est au journal, avec son acteur.
  await page.getByLabel('Action').fill('admin.driver_activated');
  await expect(page.getByRole('row', { name: /admin\.driver_activated/ }).first()).toBeVisible();
});

test.afterAll(async () => {
  // Lignes de tarif lointaines créées par ce parcours (jamais en vigueur) : retirées pour ne pas encombrer la grille.
  await sql()`DELETE FROM pricing_rules WHERE valid_from >= '2090-01-01'`;
  await closeSql();
});
