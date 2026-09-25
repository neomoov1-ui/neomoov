// Parcours chauffeur de bout en bout sur la version web (prompt 11, tâche 8 ; parcours 10 et 2 de la section 9.2),
// contre une API locale en développement : inscription par code SMS, candidature, identité et taxes, véhicule, documents
// (un par l'interface avec l'appareil photo simulé, les autres par l'API), formation et quiz, compte de versement,
// validation par l'équipe (simulée en base), passage en ligne avec position, offre reçue en direct (réservation d'un
// client), course complète, paiement direct confirmé, évaluation du client, onglets, passage hors ligne ; captures.
//
// Prérequis : API locale (`NODE_ENV=development`, `CORS_ORIGINS=http://localhost:8081`, répartition automatique, journal
// écrit dans un fichier d'où le code SMS simulé est lu), export web servi sur le port 8081
// (`npx expo export --platform web` puis `node ../../scripts/e2e/serve-web.cjs dist 8081`).
// La validation par l'équipe (My Hub, étape 12) est faite directement en base : `.env` est chargé dans le processus.
// Usage : API_LOG=<journal de l'API> node e2e/web-journeys.cjs [dossier des captures, défaut docs/screens/driver]
const fs = require('fs');
const path = require('path');
const { launchEdge, lastCode, log, recordFailure, sleep } = require('../../../scripts/e2e/cdp.cjs');

const ROOT = path.join(__dirname, '..', '..', '..');
const API_LOG = process.env.API_LOG;
if (!API_LOG) throw new Error("API_LOG : chemin du journal de l'API locale, requis pour lire le code SMS simulé");
const WEB = process.env.WEB_URL || 'http://localhost:8081';
const API = process.env.API_URL || 'http://localhost:4000';
const OUT = process.argv[2] || path.join(ROOT, 'docs', 'screens', 'driver');
const PHOTO = path.join(ROOT, 'apps', 'mobile-driver', 'assets', 'images', 'icon.png');
const PLATEAU = { address: '4500 rue Saint-Denis, Montréal', coordinates: { lat: 45.523, lng: -73.582 } };
const CENTRE = { address: '1000 rue De La Gauchetière Ouest, Montréal', coordinates: { lat: 45.5, lng: -73.567 } };
const inOneYear = () => new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10);

process.loadEnvFile(path.join(ROOT, '.env'));
const postgres = require(path.join(ROOT, 'packages', 'db', 'node_modules', 'postgres'));
const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, onnotice: () => {} });

async function call(method, pathname, token, body, headers = {}) {
  const init = { method, headers: { accept: 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers } };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(`${API}/v1${pathname}`, init);
  const text = await res.text();
  const json = text ? JSON.parse(text) : undefined;
  if (!res.ok) throw new Error(`${method} ${pathname} : ${res.status} ${text.slice(0, 300)}`);
  return json;
}

/** Compte client par l'API (code SMS lu dans le journal), pour réserver la course que le chauffeur recevra. */
async function clientLogin(phone) {
  await call('POST', '/auth/otp/request', null, { phone });
  await sleep(1200);
  const config = await call('GET', '/config');
  return call('POST', '/auth/otp/verify', null, { phone, code: lastCode(API_LOG, phone), acceptTerms: true, privacyPolicyVersion: config.legal.privacyPolicyVersion });
}

async function main() {
  const { page, edge } = await launchEdge({ out: OUT, profileName: 'neomoov-e2e-driver' });
  const started = Date.now();
  let driverId = null;
  try {
    // Parcours 10 (9.2) : démarrage, inscription par code SMS, conditions.
    await page.go(`${WEB}/`);
    await page.shot('01-demarrage');
    await page.clickId('start');
    await page.waitText('Votre numéro de téléphone');
    const phone = `+1999${String(Date.now()).slice(-7)}`;
    await page.type('Numéro de téléphone', phone.slice(2));
    await page.clickId('send-code');
    await page.waitText('Code de vérification');
    await sleep(1500);
    await page.type('Code à 6 chiffres', lastCode(API_LOG, phone));
    await page.clickId('accept-terms');
    await page.shot('02-code');
    await page.clickId('verify');

    // Candidature, puis assistant d'inscription.
    await page.waitText('Devenir chauffeur');
    await page.type('Prénom', 'Awa');
    await page.type('Nom', 'Diallo');
    await page.click("Chauffeur inscrit auprès d'un répondant");
    await page.shot('03-candidature');
    await page.clickId('apply-submit');
    await page.waitText('Mon inscription', 20000);
    await sleep(1500);
    await page.shot('04-inscription');

    await page.clickId('step-profile');
    await page.waitText('Identité et taxes');
    await sleep(1000);
    await page.type('Numéro de TPS', '123456789 RT0001');
    await page.type('Numéro de TVQ', '1234567890 TQ0001');
    await page.type("Années d'expérience en transport de personnes", '6');
    await page.shot('05-identite-taxes');
    await page.clickId('profile-save');
    await page.waitText('Mon inscription');

    await page.clickId('step-vehicle');
    await page.waitText('Mon véhicule');
    await page.type('Rechercher un modèle', 'Model Y');
    await page.clickId('model-Tesla Model Y');
    await page.type('Année', '2023');
    await page.type('Couleur', 'Blanc nacré');
    await page.type('Plaque', `E2E ${String(Date.now()).slice(-3)}`);
    await page.shot('06-vehicule');
    await page.clickId('vehicle-add');
    await page.waitText('Catégorie : Neo Premium');
    await page.shot('07-vehicule-enregistre');

    // Documents : le permis par l'interface (photo simulée), les autres par l'API.
    const session = await page.call(() => JSON.parse(localStorage.getItem('neomoov.driver.session') || '{}'));
    const token = session.accessToken;
    const profile = await call('GET', '/driver/profile', token);
    driverId = profile.id;
    await page.go(`${WEB}/documents`, 4000);
    await page.waitText('Documents et échéances');
    await page.shot('08-documents');
    await page.clickId('upload-licence');
    await page.send('Page.setInterceptFileChooserDialog', { enabled: true });
    const chooser = new Promise((resolve) => page.on('Page.fileChooserOpened', resolve));
    await page.clickId('pick-licence');
    const opened = await Promise.race([chooser, sleep(8000).then(() => null)]);
    if (!opened) throw new Error('sélecteur de fichier non ouvert');
    await page.send('DOM.setFileInputFiles', { files: [PHOTO], backendNodeId: opened.backendNodeId });
    await page.waitText("Photo prête à l'envoi.");
    await page.type("Date d'échéance (AAAA-MM-JJ)", inOneYear());
    await page.shotHere('09-document-photo');
    await page.clickId('send-licence');
    await page.waitText('Document envoyé');
    const docs = await call('GET', '/driver/documents', token);
    for (const item of docs.items.filter((i) => i.state === 'missing')) {
      const form = new FormData();
      form.append('type', item.type);
      if (item.expires) form.append('expiresOn', inOneYear());
      form.append('file', new Blob([fs.readFileSync(PHOTO)], { type: 'image/png' }), `${item.type}.png`);
      await call('POST', '/driver/documents', token, form);
    }
    await page.go(`${WEB}/documents`, 4000);
    await page.waitText('En vérification');
    await page.shot('10-documents-en-verification');

    // Formation : un module par l'interface, les autres par l'API (bonnes réponses lues en base).
    const [setting] = await sql`SELECT value FROM settings WHERE key = 'training.modules'`;
    const modules = setting.value;
    await page.go(`${WEB}/training`, 4000);
    await page.waitText('Formation Neomoov');
    await page.shot('11-formation');
    const first = modules[0];
    await page.clickId(`module-${first.code}`);
    await page.waitText(first.questions[0].prompt.fr);
    await page.shot('12-module');
    for (const q of first.questions) await page.click(q.choices[q.answerIndex].fr);
    await page.clickId('training-submit');
    await page.waitText('Réussi');
    await page.shotHere('13-quiz-reussi');
    for (const m of modules.slice(1)) await call('POST', `/driver/training/${m.code}/submit`, token, { answers: Object.fromEntries(m.questions.map((q) => [q.id, q.answerIndex])) });

    // Compte de versement (fournisseur simulé).
    await page.go(`${WEB}/payout`, 4000);
    await page.clickId('payout-start');
    await page.waitText('Compte de versement prêt.');
    await page.shot('14-versements');

    // Modes de paiement acceptés : espèces (le client paiera le chauffeur).
    await page.go(`${WEB}/profile`, 4000);
    await page.waitText('Modes de paiement acceptés');
    await page.click('Espèces');
    await page.clickId('profile-save');
    await page.waitText('Enregistré.');

    // Validation par l'équipe (My Hub, étape 12), simulée en base.
    await sql`UPDATE drivers SET status = 'active', activated_at = now() WHERE id = ${driverId}`;
    await sql`UPDATE vehicles SET status = 'active' WHERE driver_id = ${driverId}`;
    await sql`UPDATE driver_documents SET status = 'approved', verified_at = now() WHERE driver_id = ${driverId}`;

    // Passage en ligne avec une position (autorisation et position du navigateur simulées).
    await page.send('Browser.grantPermissions', { origin: WEB, permissions: ['geolocation'] });
    await page.send('Emulation.setGeolocationOverride', { latitude: PLATEAU.coordinates.lat, longitude: PLATEAU.coordinates.lng, accuracy: 10 });
    await page.go(`${WEB}/home`, 5000);
    await page.waitText('Hors ligne');
    await page.shot('15-accueil-hors-ligne');
    await page.clickId('go-online');
    await page.waitText('Vous recevez les offres');
    const onlineAt = Date.now();
    await sleep(1500);
    await page.shot('16-accueil-en-ligne');

    // Parcours 2 (9.2) : un client réserve, payé au chauffeur en espèces ; l'offre arrive en direct.
    const client = await clientLogin(`+1999${String(Date.now() + 7).slice(-7)}`);
    await call('PATCH', '/me', client.accessToken, { firstName: 'Léa' });
    const requestedAt = new Date(Date.now() + 3 * 3_600_000).toISOString();
    const quotes = await call('POST', '/quotes', client.accessToken, { category: 'neo_premium', origin: PLATEAU, destination: CENTRE, requestedAt });
    const quote = quotes.quotes[0];
    const vehicles = await call('GET', `/quotes/${quote.id}/vehicles`, client.accessToken).catch(() => []);
    const mine = vehicles.find((v) => v.driver?.id === driverId);
    const ride = await call('POST', '/rides', client.accessToken, {
      quoteId: quote.id, type: 'scheduled', requestedAt, paymentMethod: 'cash', paymentChoice: 'pay_driver_after', maxConsentedCents: quote.maxConsentedCents,
      preferences: { conversation: 'silence', music: 'soft', temperature: 'cool', luggageHelp: true, luggageCount: 2 }, specialRequests: 'Deux valises', ...(mine ? { vehicleId: mine.vehicleId } : {}),
    }, { 'idempotency-key': `e2e-${Date.now()}` });
    log('course réservée', ride.id, mine ? '(véhicule choisi)' : '(catégorie)');
    await page.waitId('offer-accept', 60000);
    await sleep(1500);
    await page.shotHere('17-offre');
    await page.clickId('offer-accept');
    await page.waitId('action-depart', 20000);
    await sleep(1500);
    await page.shot('18-course-acceptee');
    await page.clickId('action-depart');
    await page.waitId('action-arrive');
    await page.shot('19-en-route');
    await page.clickId('action-arrive');
    await page.waitId('action-start');
    await sleep(2500);
    await page.shot('20-sur-place');
    await page.clickId('action-start');
    await page.waitId('action-complete');
    await page.shot('21-client-a-bord');
    await page.clickId('action-complete');
    await page.waitId('confirm-received', 20000);
    await sleep(1000);
    await page.shot('22-fin-de-course');
    await page.clickId('confirm-received');
    await page.waitText('Montant reçu confirmé');
    await page.clickId('star-5');
    await page.click('Poli');
    await page.clickId('rate-client');
    await page.waitText('Merci : évaluation envoyée.');
    await page.shot('23-evaluation-client');
    await page.clickId('ride-done');
    await page.waitText('Passer hors ligne');

    // Onglets et écrans de l'activité.
    const screens = [
      ['/home', 'Passer hors ligne', '24-accueil-apres-course'],
      ['/rides', 'Courses planifiées', '25-courses'],
      ['/earnings', 'Tarifs', '26-revenus'],
      ['/documents', 'Documents et échéances', '27-documents'],
      ['/profile', 'Modes de paiement acceptés', '28-profil'],
      ['/packs', 'Packs de courses', '29-packs'],
      ['/score', 'Ponctualité', '30-tableau-de-conduite'],
      ['/loyal-clients', 'Mes clients', '31-mes-clients'],
      ['/onboarding', 'Mon inscription', '32-inscription-complete'],
      ['/support', 'Sécurité et assistance', '33-assistance'],
      ['/location-permission', 'Votre position, seulement en ligne', '34-explication-localisation'],
    ];
    for (const [route, text, name] of screens) {
      await page.go(`${WEB}${route}`, 4000);
      await page.waitText(text);
      await sleep(1200);
      await page.shot(name);
    }
    await page.go(`${WEB}/packs`, 4000);
    await page.clickId('activate-discovery');
    await page.waitText('Pack actif');
    await page.shot('35-pack-active');

    // Hors ligne : plus aucune position.
    await page.go(`${WEB}/home`, 4000);
    await page.clickId('go-offline');
    await page.waitText("Hors ligne, aucune position n'est envoyée.");
    const offlineAt = Date.now();
    await page.shot('36-hors-ligne');
    const [{ n: during }] = await sql`SELECT count(*)::int AS n FROM driver_locations WHERE driver_id = ${driverId} AND recorded_at <= ${new Date(offlineAt).toISOString()}`;
    await sleep(12000);
    const [{ n: after }] = await sql`SELECT count(*)::int AS n FROM driver_locations WHERE driver_id = ${driverId} AND recorded_at > ${new Date(offlineAt + 1000).toISOString()}`;
    const seconds = Math.round((offlineAt - onlineAt) / 1000);
    if (page.errors.length) log('erreurs JS', page.errors);
    return { phone, driverId, rideId: ride.id, positionsWhileOnline: during, onlineSeconds: seconds, positionsAfterOffline: after, totalSeconds: Math.round((Date.now() - started) / 1000) };
  } catch (error) {
    await recordFailure(page, OUT, error);
    throw error;
  } finally {
    edge.kill();
    // Le chauffeur du parcours quitte le service : il ne doit pas entrer en concurrence avec ceux des tests de l'API
    // (même base de développement), mais ses courses et captures restent consultables.
    if (driverId) {
      await sql`UPDATE vehicles SET status = 'retired' WHERE driver_id = ${driverId}`;
      await sql`UPDATE drivers SET status = 'offboarded', offboarded_at = now(), is_online = false WHERE id = ${driverId}`;
      await sql`DELETE FROM driver_presence WHERE driver_id = ${driverId}`;
    }
    await sql.end();
  }
}

main()
  .then((r) => {
    log('terminé', JSON.stringify(r));
    process.exit(0);
  })
  .catch((e) => {
    console.error('ÉCHEC', e.message.slice(0, 1500));
    process.exit(1);
  });
