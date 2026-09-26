// Outils des parcours web de bout en bout des applications mobiles (versions web d'Expo), partagés par le client et le
// chauffeur : Edge sans interface piloté par le protocole DevTools, gestes réels (souris et clavier aux coordonnées),
// captures d'écran, lecture du code SMS simulé dans le journal de l'API locale.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Écrans émulés (variable SHOT_DEVICE) : captures aux dimensions des magasins (docs/store/verification-soumission.md,
 * section 7). `default` : 390 × 844 à 2x (780 × 1688, captures de travail, refusées par Apple et Google) ;
 * `iphone-6.9` : 440 × 956 à 3x (1320 × 2868) ; `iphone-6.5` : 414 × 896 à 3x (1242 × 2688) ; `android` : 360 × 640 à 3x
 * (1080 × 1920, rapport 16:9 accepté par Google Play).
 */
const SCREENS = {
  default: { width: 390, height: 844, deviceScaleFactor: 2, mobile: true },
  'iphone-6.9': { width: 440, height: 956, deviceScaleFactor: 3, mobile: true },
  'iphone-6.5': { width: 414, height: 896, deviceScaleFactor: 3, mobile: true },
  android: { width: 360, height: 640, deviceScaleFactor: 3, mobile: true },
};

function screenMetrics(device = process.env.SHOT_DEVICE || 'default') {
  const metrics = SCREENS[device];
  if (!metrics) throw new Error(`SHOT_DEVICE inconnu : ${device} (valeurs : ${Object.keys(SCREENS).join(', ')})`);
  return metrics;
}
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

/** Code du dernier texto simulé envoyé à ce numéro (journal de l'API en développement, champ `devOtpCode`). */
function lastCode(apiLog, phone) {
  const lines = fs.readFileSync(apiLog, 'utf8').split('\n').reverse();
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
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, disabled: el.getAttribute('aria-disabled') === 'true' };
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
  constructor(ws, out) {
    this.ws = ws;
    this.out = out;
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Map();
    this.errors = [];
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.method === 'Runtime.exceptionThrown') this.errors.push(m.params.exceptionDetails.exception?.description?.slice(0, 300) || m.params.exceptionDetails.text);
      if (m.method && this.listeners.has(m.method)) for (const fn of this.listeners.get(m.method)) fn(m.params);
      if (m.id && this.pending.has(m.id)) {
        const p = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
      }
    };
  }
  on(method, fn) {
    this.listeners.set(method, [...(this.listeners.get(method) || []), fn]);
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
    fs.writeFileSync(path.join(this.out, `${name}.png`), Buffer.from(r.data, 'base64'));
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
  /** Touche l'élément une fois visible et actif (un bouton désactivé pendant un envoi ignorerait le geste). */
  async clickId(id, timeoutMs = 15000) {
    const end = Date.now() + timeoutMs;
    let p = await this.call(FIND_TESTID, id);
    while (p && p.disabled && Date.now() < end) {
      await sleep(250);
      p = await this.call(FIND_TESTID, id);
    }
    if (!p) throw new Error('identifiant introuvable : ' + id);
    if (p.disabled) throw new Error('élément resté désactivé : ' + id);
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

/** Lance Edge sans interface avec un profil neuf ; renvoie la page pilotée (écran de `screenMetrics`, heure de Montréal). */
async function launchEdge({ out, port = 9333, edgePath = process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', profileName = 'neomoov-e2e-edge' }) {
  fs.mkdirSync(out, { recursive: true });
  const profile = path.join(os.tmpdir(), profileName);
  fs.rmSync(profile, { recursive: true, force: true });
  const edge = spawn(edgePath, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--disable-gpu', '--lang=fr-CA', '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: 'ignore' });
  let targets;
  for (let i = 0; i < 40; i += 1) {
    try {
      targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      break;
    } catch {
      await sleep(250);
    }
  }
  const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  const page = new Page(ws, out);
  await page.send('Page.enable');
  await page.send('Runtime.enable');
  await page.send('Emulation.setDeviceMetricsOverride', screenMetrics());
  await page.send('Emulation.setTimezoneOverride', { timezoneId: 'America/Toronto' }).catch(() => undefined);
  return { page, edge };
}

/** Échec : capture et texte de l'écran à côté des captures, pour comprendre sans relancer. */
async function recordFailure(page, out, error) {
  if (!page) return;
  await page.shotHere('zz-echec').catch(() => undefined);
  fs.writeFileSync(path.join(out, 'zz-echec.txt'), `${error.message}\n\n${await page.text().catch(() => '')}\n\nErreurs JS : ${JSON.stringify(page.errors)}`);
}

module.exports = { Page, launchEdge, lastCode, log, recordFailure, screenMetrics, sleep };
