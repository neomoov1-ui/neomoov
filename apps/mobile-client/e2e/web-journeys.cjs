// Parcours client de bout en bout sur la version web (prompt 10, tâche 8), contre une API locale en développement :
// accueil, création du compte par code SMS, consentements, réservation en trois écrans (adresses, créneau, catégorie,
// détail du prix, commodités, paiement), course réservée, réservations, profil, assistance ; captures d'écran.
// Gestes réels (souris et clavier aux coordonnées) dans Edge sans interface, par le protocole DevTools.
//
// Prérequis : API locale (`NODE_ENV=development`, `CORS_ORIGINS=http://localhost:8081`, journal écrit dans un fichier,
// d'où le code SMS simulé est lu), export web servi sur le port 8081 (`npx expo export --platform web` puis
// `node e2e/serve-web.cjs dist 8081`).
// Usage : API_LOG=<journal de l'API> node e2e/web-journeys.cjs [dossier des captures, défaut docs/screens/client]
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const API_LOG = process.env.API_LOG;
if (!API_LOG) throw new Error("API_LOG : chemin du journal de l'API locale, requis pour lire le code SMS simulé");
const WEB = process.env.WEB_URL || 'http://localhost:8081';
const OUT = process.argv[2] || path.join(__dirname, '..', '..', '..', 'docs', 'screens', 'client');
const EDGE = process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9333;
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

/** Code du dernier texto simulé envoyé à ce numéro (journal de l'API en développement). */
function lastCode(phone) {
  const lines = fs.readFileSync(API_LOG, 'utf8').split('\n').reverse();
  for (const l of lines) {
    if (!l.includes('devOtpCode')) continue;
    const o = JSON.parse(l);
    if (String(o.phone || '').endsWith(phone.slice(-3))) return o.devOtpCode;
  }
  throw new Error('code introuvable pour ' + phone);
}

const FIND_TEXT = function (text, contains) {
  const all = [...document.querySelectorAll('div,span,a,button')].filter((e) => {
    const t = (e.innerText || '').trim();
    return contains ? t.includes(text) : t === text;
  }).filter((e) => e.getBoundingClientRect().width > 0);
  const leaves = all.filter((e) => !all.some((o) => o !== e && e.contains(o)));
  const el = leaves[leaves.length - 1];
  if (!el) return null;
  el.scrollIntoView({ block: 'center' });
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
};

const FIND_TESTID = function (id) {
  const all = [...document.querySelectorAll(`[data-testid="${id}"]`)].filter((e) => e.getBoundingClientRect().width > 0);
  const el = all[all.length - 1];
  if (!el) return null;
  el.scrollIntoView({ block: 'center' });
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
};

const FIND_FIELD = function (label) {
  const labels = [...document.querySelectorAll('div,span')].filter((e) => (e.innerText || '').trim() === label && e.children.length === 0);
  const lab = labels[labels.length - 1];
  if (!lab) return null;
  const el = [...document.querySelectorAll('input,textarea')].find((i) => lab.compareDocumentPosition(i) & Node.DOCUMENT_POSITION_FOLLOWING);
  if (!el) return null;
  el.scrollIntoView({ block: 'center' });
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
};

/** Valeur posée comme React l'attend (setter natif, puis événement `input`), dans le champ qui suit le libellé. */
const SET_FIELD = function (label, value) {
  const labels = [...document.querySelectorAll('div,span')].filter((e) => (e.innerText || '').trim() === label && e.children.length === 0);
  const lab = labels[labels.length - 1];
  if (!lab) return false;
  const el = [...document.querySelectorAll('input,textarea')].find((i) => lab.compareDocumentPosition(i) & Node.DOCUMENT_POSITION_FOLLOWING);
  if (!el) return false;
  el.focus();
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
};

class Page {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.errors = [];
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.method === 'Runtime.exceptionThrown') this.errors.push(m.params.exceptionDetails.exception?.description?.slice(0, 300) || m.params.exceptionDetails.text);
      if (m.id && this.pending.has(m.id)) {
        const p = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
      }
    };
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  async call(fn, ...args) {
    const expression = `(${fn.toString()})(${args.map((a) => JSON.stringify(a)).join(',')})`;
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'erreur JS');
    return r.result.value;
  }
  async go(url, wait = 3500) {
    await this.send('Page.navigate', { url });
    await sleep(wait);
  }
  /** Capture en haut de l'écran courant (défilements remis à zéro). */
  async shot(name) {
    await this.send('Runtime.evaluate', { expression: 'window.scrollTo(0,0); document.querySelectorAll("*").forEach(e => { if (e.scrollTop) e.scrollTop = 0; }); true' });
    await sleep(300);
    await this.shotHere(name);
  }
  async shotHere(name) {
    const r = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(r.data, 'base64'));
    log('capture', name);
  }
  async tap(p) {
    await sleep(150);
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y });
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 });
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 });
    await sleep(800);
  }
  async click(text, contains = false) {
    const p = await this.call(FIND_TEXT, text, contains);
    if (!p) throw new Error('élément introuvable : ' + text);
    await this.tap(p);
  }
  async clickId(id) {
    const p = await this.call(FIND_TESTID, id);
    if (!p) throw new Error('identifiant introuvable : ' + id);
    await this.tap(p);
  }
  async type(label, value) {
    const p = await this.call(FIND_FIELD, label);
    if (!p) throw new Error('champ introuvable : ' + label);
    await this.tap(p);
    const ok = await this.call(SET_FIELD, label, value);
    if (!ok) throw new Error('saisie impossible : ' + label);
    await sleep(700);
  }
  text() {
    return this.call(() => document.body.innerText);
  }
  async waitText(text, timeoutMs = 25000) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      if ((await this.text()).includes(text)) return;
      await sleep(300);
    }
    throw new Error(`texte attendu absent : ${text}`);
  }
  async waitId(id, timeoutMs = 20000) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      if (await this.call((x) => document.querySelectorAll(`[data-testid="${x}"]`).length > 0, id)) return;
      await sleep(300);
    }
    throw new Error(`élément attendu absent : ${id}`);
  }
}

async function main() {
  const profile = path.join(require('os').tmpdir(), 'neomoov-e2e-edge');
  fs.rmSync(profile, { recursive: true, force: true });
  const edge = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--disable-gpu', '--lang=fr-CA', 'about:blank'], { stdio: 'ignore' });
  let page;
  try {
    let targets;
    for (let i = 0; i < 40; i += 1) {
      try {
        targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
        break;
      } catch {
        await sleep(250);
      }
    }
    const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
    await new Promise((r) => (ws.onopen = r));
    page = new Page(ws);
    await page.send('Page.enable');
    await page.send('Runtime.enable');
    await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await page.send('Emulation.setTimezoneOverride', { timezoneId: 'America/Toronto' }).catch(() => undefined);

    // Parcours 1 (9.2) : accueil, création du compte par code SMS, conditions, consentements.
    await page.go(`${WEB}/`);
    await page.shot('01-accueil');
    await page.click('Réserver ma course');
    await page.waitText('Votre numéro de téléphone');
    await page.shot('02-telephone');
    const phone = `+1999${String(Date.now()).slice(-7)}`;
    await page.type('Numéro de téléphone', phone.slice(2));
    await page.click('Recevoir le code');
    await page.waitText('Code de vérification');
    await sleep(1500);
    const code = lastCode(phone);
    log('code reçu', code);
    await page.type('Code à 6 chiffres', code);
    await page.click("J'accepte les conditions d'utilisation et la politique de confidentialité.");
    await page.shot('03-code');
    await page.click('Vérifier');
    await page.waitText('Vos choix de confidentialité');
    await page.shot('04-consentements');
    await page.click('Enregistrer et continuer');
    await page.waitText('Où allons-nous ?');
    await sleep(1000);
    await page.shot('05-reserver');

    // Parcours 3 (9.2) : réservation en trois écrans.
    await page.type('Départ', '4500 rue Saint-Denis');
    await page.waitId('suggestion-0', 10000);
    await page.shotHere('06-suggestions');
    await page.clickId('suggestion-0');
    await page.type('Destination', '1000 rue De La Gauchetière Ouest');
    await page.waitId('suggestion-0', 10000);
    await page.clickId('suggestion-0');
    await page.clickId('pickup-day-1');
    await page.clickId('pickup-hour-10');
    await page.clickId('pickup-slot-0');
    await page.shotHere('07-reserver-rempli');
    await page.click('Voir les prix');
    await page.waitText('Catégorie et prix', 15000);
    await sleep(1500);
    await page.shot('08-categories');
    await page.click('Voir le détail du prix');
    await page.shotHere('09-detail-prix');
    // Parcours 4 : réservation pour un tiers.
    await page.click("Je réserve pour quelqu'un d'autre");
    await page.type('Nom du passager', 'Marie Tremblay');
    await page.type('Téléphone du passager', '9995550202');
    await page.shotHere('09b-passager');
    await page.click('Continuer');
    await page.waitText('Commodités et confirmation');
    await page.shot('10-commodites');
    await page.click('Payer le chauffeur après la course');
    await page.click('Prix fixe tout compris');
    await page.shotHere('11-recapitulatif');
    await page.click('Confirmer la réservation');
    await page.waitText('Réservation confirmée', 15000);
    await sleep(1500);
    await page.shot('12-course-reservee');

    // Réservations et profil.
    await page.go(`${WEB}/reservations`, 4000);
    await page.waitText('Mes réservations');
    await sleep(1500);
    await page.shot('13-reservations');
    await page.go(`${WEB}/profile`, 4000);
    await page.waitText('Préférences de confort');
    await sleep(1500);
    await page.shot('14-profil');
    await page.go(`${WEB}/support`, 3000);
    await page.shot('15-assistance');
    if (page.errors.length) log('erreurs JS', page.errors);
    return { phone };
  } catch (error) {
    if (page) {
      await page.shotHere('zz-echec').catch(() => undefined);
      fs.writeFileSync(path.join(OUT, 'zz-echec.txt'), `${error.message}\n\n${await page.text().catch(() => '')}\n\nErreurs JS : ${JSON.stringify(page.errors)}`);
    }
    throw error;
  } finally {
    edge.kill();
  }
}

main()
  .then((r) => {
    log('terminé', JSON.stringify(r));
    process.exit(0);
  })
  .catch((e) => {
    console.error('ÉCHEC', e.message.slice(0, 1200));
    process.exit(1);
  });
