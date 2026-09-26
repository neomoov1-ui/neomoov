/**
 * Tests de charge k6 de Neomoov (étape 15, tâche 3 ; sections 2.2 et 9.1 du cahier des charges).
 *
 * Trois scénarios, joués ensemble comme une heure de pointe :
 * - `drivers` : chaque utilisateur virtuel est un chauffeur connecté au socket `/driver`, en ligne, qui envoie sa
 *   position toutes les `LOAD_POSITION_INTERVAL_S` secondes (acquittement mesuré), accepte les offres reçues puis
 *   mène la course (départ, arrivée, début, fin) ;
 * - `rides` : demandes de course simultanées (devis puis réservation immédiate payée par carte simulée), suivies par le
 *   socket `/client` : délai de la première offre et de l'attribution (horodatages du serveur), positions reçues ;
 * - `quotes` : devis à débit constant.
 *
 * Lancer par `pnpm test:load` (comptes préparés puis retirés), jamais contre la production. Variables : voir
 * `lib/config.js` et `docs/testing/README.md`.
 */
import http from 'k6/http';
import exec from 'k6/execution';
import { check, sleep } from 'k6';
import { SharedArray } from 'k6/data';
import { Counter, Rate, Trend } from 'k6/metrics';
import { SocketIoClient } from './lib/socketio.js';
import { ENDPOINTS, loadConfig, rampSeconds, reportRows, SOCKET_EVENTS, TARGETS, thresholdsFor } from './lib/config.js';

const config = loadConfig();
if (!config.fixtures) throw new Error('LOAD_FIXTURES manquant : chemin du fichier produit par load-fixtures (pnpm test:load le fournit)');

const fixtures = JSON.parse(open(config.fixtures));
const drivers = new SharedArray('chauffeurs', () => fixtures.drivers);
const clients = new SharedArray('clients', () => fixtures.clients);
const area = { center: fixtures.areaCenter, radiusMeters: fixtures.areaRadiusMeters };

const wsAck = new Trend('ws_ack_ms', true);
const locationOk = new Rate('location_ok');
const positionsSent = new Counter('positions_sent');
const socketsOpened = new Counter('driver_sockets_opened');
const socketConnectOk = new Rate('socket_connect_ok');
const socketConnect = new Trend('socket_connect_ms', true);
const quoteMs = new Trend('quote_ms', true);
const firstOffer = new Trend('dispatch_first_offer_ms', true);
const assignedMs = new Trend('dispatch_assigned_ms', true);
const rideAssigned = new Rate('ride_assigned');
const broadcast = new Trend('location_broadcast_ms', true);
const offersReceived = new Counter('offers_received');
const offersAccepted = new Counter('offers_accepted');
const ridesCompleted = new Counter('rides_completed');

function scenarios() {
  const out = {};
  if (config.scenarios.includes('drivers')) {
    const ramp = rampSeconds(config);
    out.drivers = {
      executor: 'ramping-vus', exec: 'driverSession', startVUs: 0, gracefulRampDown: '5s', gracefulStop: '15s',
      stages: [{ duration: `${ramp}s`, target: config.drivers }, { duration: `${Math.max(1, config.positionsDurationS - ramp)}s`, target: config.drivers }],
    };
  }
  if (config.scenarios.includes('rides')) {
    out.rides = { executor: 'per-vu-iterations', exec: 'rideRequest', vus: config.rides, iterations: 1, startTime: `${config.ridesStartS}s`, maxDuration: `${config.rideFollowS + 60}s`, gracefulStop: '10s' };
  }
  if (config.scenarios.includes('quotes')) {
    out.quotes = {
      executor: 'constant-arrival-rate', exec: 'quoteRequest', rate: config.quotesRate, timeUnit: '1s', duration: `${config.quotesDurationS}s`, startTime: `${config.quotesStartS}s`,
      preAllocatedVUs: Math.max(2, Math.ceil(config.quotesRate)), maxVUs: Math.max(4, Math.ceil(config.quotesRate * 4)),
    };
  }
  return out;
}

export const options = {
  scenarios: scenarios(),
  thresholds: thresholdsFor(config),
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max', 'count'],
  // Les requêtes passent par les étiquettes `name` (et non l'adresse, qui contient des identifiants).
  systemTags: ['status', 'method', 'name', 'scenario', 'check', 'error_code'],
  userAgent: 'neomoov-k6',
};

export function setup() {
  const health = http.get(`${config.baseUrl}/v1/health`, { tags: { name: 'health', kind: 'setup' } });
  if (health.status !== 200) throw new Error(`API injoignable à ${config.baseUrl} (état ${health.status})`);
  return { startedAt: Date.now() };
}

// --- Outils ---

function headers(token, extra) {
  const h = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...extra };
  // Adresses distinctes par utilisateur virtuel (API atteinte directement, sans mandataire) : la limite par adresse IP
  // vaut pour des milliers de téléphones, pas pour un seul générateur de charge.
  if (config.spreadIps) h['X-Forwarded-For'] = `10.${(exec.vu.idInTest >> 16) & 255}.${(exec.vu.idInTest >> 8) & 255}.${exec.vu.idInTest & 255}`;
  return h;
}

function api(method, path, body, token, name, kind = 'api', extra = {}) {
  return http.request(method, `${config.baseUrl}${path}`, body === null ? null : JSON.stringify(body), { headers: headers(token, extra), tags: { name, kind } });
}

/** Même requête sans bloquer la boucle d'événements (les positions du chauffeur continuent pendant l'appel). */
function apiAsync(method, path, body, token, name) {
  return http.asyncRequest(method, `${config.baseUrl}${path}`, body === null ? null : JSON.stringify(body), { headers: headers(token, {}), tags: { name, kind: 'api' } });
}

const toRad = (d) => (d * Math.PI) / 180;

function pointNear(center, radiusMeters) {
  const r = radiusMeters * Math.sqrt(Math.random());
  const angle = Math.random() * 2 * Math.PI;
  return {
    lat: Number((center.lat + (r * Math.sin(angle)) / 111_320).toFixed(6)),
    lng: Number((center.lng + (r * Math.cos(angle)) / (111_320 * Math.cos(toRad(center.lat)))).toFixed(6)),
  };
}

function metersBetween(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

function trip() {
  const origin = pointNear(area.center, area.radiusMeters * 0.8);
  let destination = pointNear(area.center, area.radiusMeters * 1.5);
  for (let i = 0; i < 5 && metersBetween(origin, destination) < 1500; i += 1) destination = pointNear(area.center, area.radiusMeters * 1.5);
  return { origin: { address: `Départ d'essai de charge ${exec.vu.idInTest}`, coordinates: origin }, destination: { address: `Arrivée d'essai de charge ${exec.vu.idInTest}`, coordinates: destination } };
}

// --- Scénario `drivers` : socket chauffeur, positions, offres, courses ---

let driverSlot = -1;

export function driverSession(data) {
  const endAt = data.startedAt + config.positionsDurationS * 1000 - 1500;
  if (Date.now() >= endAt) {
    sleep(1);
    return;
  }
  if (driverSlot < 0) driverSlot = exec.scenario.iterationInTest % drivers.length;
  const me = drivers[driverSlot];
  const intervalMs = config.positionIntervalS * 1000;
  const stepMeters = Math.max(60, 11 * config.positionIntervalS);
  let position = { lat: me.lat, lng: me.lng };
  let heading = Math.random() * 360;
  let busy = false;
  const timers = [];
  let ticker = null;

  const socket = new SocketIoClient(config.baseUrl, '/driver', me.token, {
    label: `chauffeur ${driverSlot}`,
    onConnect: (ms) => {
      socketConnect.add(ms);
      socketConnectOk.add(true);
      socketsOpened.add(1);
      socket.emit('status.update', { status: 'online', coordinates: position }, (ack, ackMs) => {
        wsAck.add(ackMs, { event: 'status.update' });
        check(ack, { 'chauffeur en ligne': (a) => Boolean(a && a.ok) });
        // Premier envoi décalé au hasard dans l'intervalle : le débit est réparti uniformément.
        timers.push(setTimeout(() => {
          sendPosition();
          ticker = setInterval(sendPosition, intervalMs);
        }, Math.random() * intervalMs));
      });
    },
    onError: (reason) => {
      if (!socket.everConnected) socketConnectOk.add(false);
      console.warn(`socket chauffeur ${driverSlot} : ${reason}`);
      stop();
    },
    // Coupure par le serveur : minuteries arrêtées, l'itération suivante reconnecte le chauffeur (avant la fin de l'essai).
    onClose: () => clearTimers(),
  });

  function clearTimers() {
    if (ticker) clearInterval(ticker);
    ticker = null;
    for (const t of timers) clearTimeout(t);
    timers.length = 0;
  }

  function sendPosition() {
    if (Date.now() >= endAt) return stop();
    socket.expireAcks(10_000);
    heading = (heading + (Math.random() * 60 - 30) + 360) % 360;
    if (metersBetween(position, area.center) > area.radiusMeters * 1.3) heading = (Math.atan2(area.center.lng - position.lng, area.center.lat - position.lat) * 180) / Math.PI;
    position = {
      lat: Number((position.lat + (stepMeters * Math.cos(toRad(heading))) / 111_320).toFixed(6)),
      lng: Number((position.lng + (stepMeters * Math.sin(toRad(heading))) / (111_320 * Math.cos(toRad(position.lat)))).toFixed(6)),
    };
    const sent = socket.emit('location.update', { coordinates: position, speedMps: 11, headingDegrees: Math.round((heading + 360) % 360), accuracyMeters: 5, recordedAt: new Date().toISOString() }, (ack, ackMs) => {
      const ok = Boolean(ack && ack.ok);
      locationOk.add(ok);
      if (ack) wsAck.add(ackMs, { event: 'location.update' });
      if (!ok && ack) console.warn(`position refusée : ${ack.code}`);
    });
    if (sent) positionsSent.add(1);
  }

  function later(ms, fn) {
    timers.push(setTimeout(fn, ms));
  }

  socket.on('offer.new', (offer) => {
    offersReceived.add(1);
    if (__ENV.LOAD_DEBUG === '1') console.log(`[chauffeur ${driverSlot}] offre ${offer && offer.id} (occupé=${busy})`);
    if (busy || !offer || !offer.id) return;
    busy = true;
    later(config.acceptDelayMs * (0.5 + Math.random()), async () => {
      const accepted = await apiAsync('POST', `/v1/driver/offers/${offer.id}/accept`, {}, me.token, 'driver_accept');
      if (__ENV.LOAD_DEBUG === '1') console.log(`[chauffeur ${driverSlot}] acceptation ${accepted.status} ${accepted.status !== 200 ? accepted.body : ''}`);
      if (accepted.status !== 200) {
        busy = false;
        return;
      }
      offersAccepted.add(1);
      const rideId = offer.rideId;
      check(await apiAsync('POST', `/v1/driver/rides/${rideId}/depart`, {}, me.token, 'driver_depart'), { 'départ 200': (r) => r.status === 200 });
      later(config.ridePickupS * 1000, async () => {
        check(await apiAsync('POST', `/v1/driver/rides/${rideId}/arrive`, {}, me.token, 'driver_arrive'), { 'arrivée 200': (r) => r.status === 200 });
        check(await apiAsync('POST', `/v1/driver/rides/${rideId}/start`, {}, me.token, 'driver_start'), { 'début 200': (r) => r.status === 200 });
        later(config.rideTripS * 1000, async () => {
          const done = await apiAsync('POST', `/v1/driver/rides/${rideId}/complete`, { measuredDistanceMeters: 4000, measuredDurationSeconds: 600 }, me.token, 'driver_complete');
          if (check(done, { 'fin 200': (r) => r.status === 200 })) ridesCompleted.add(1);
          busy = false;
        });
      });
    });
  });

  function stop() {
    clearTimers();
    if (socket.connected) socket.emit('status.update', { status: 'offline' });
    later(300, () => socket.close());
  }

  timers.push(setTimeout(stop, Math.max(0, endAt - Date.now())));
}

// --- Scénario `rides` : demandes simultanées, attribution, positions reçues par le client ---

export function rideRequest() {
  const slot = exec.scenario.iterationInTest;
  const client = clients[slot % clients.length];
  const t = trip();
  const scheduledAt = config.rideType === 'scheduled' ? new Date(Date.now() + 130 * 60_000).toISOString() : null;
  const q = api('POST', '/v1/quotes', { category: 'neo_premium', ...t, ...(scheduledAt ? { requestedAt: scheduledAt } : {}) }, client.token, 'quote', 'quote');
  quoteMs.add(q.timings.duration);
  if (!check(q, { 'devis 201': (r) => r.status === 201 })) {
    rideAssigned.add(false);
    console.warn(`devis refusé (${q.status}) : ${q.body}`);
    return;
  }
  const quote = q.json('quotes.0');
  const created = api(
    'POST', '/v1/rides',
    { quoteId: quote.id, type: config.rideType, ...(scheduledAt ? { requestedAt: scheduledAt } : {}), paymentMethod: 'card_app', paymentChoice: 'prepaid', maxConsentedCents: quote.maxConsentedCents },
    client.token, 'ride_create', 'api', { 'Idempotency-Key': `load-${exec.vu.idInTest}-${slot}-${Date.now()}` },
  );
  if (!check(created, { 'course 201': (r) => r.status === 201 })) {
    rideAssigned.add(false);
    console.warn(`course refusée (${created.status}) : ${created.body}`);
    return;
  }
  const rideId = created.json('id');
  const deadline = Date.now() + config.rideFollowS * 1000;
  let assigned = false;
  let finished = false;

  const onView = (view) => {
    if (!view || !view.timestamps) return;
    const ts = view.timestamps;
    if (!assigned && ts.assigned) {
      assigned = true;
      if (ts.offering) firstOffer.add(Date.parse(ts.offering) - Date.parse(ts.requested));
      assignedMs.add(Date.parse(ts.assigned) - Date.parse(ts.requested));
    }
    if (view.state === 'completed' || view.state === 'rated') finish();
  };

  const socket = new SocketIoClient(config.baseUrl, '/client', client.token, {
    onConnect: () => socket.emit('ride.subscribe', { rideId }, (ack, ackMs) => {
      if (ack) wsAck.add(ackMs, { event: 'ride.subscribe' });
      if (ack && ack.ok) onView(ack.ride);
    }),
    onError: (reason) => console.warn(`socket client : ${reason}`),
  });
  socket.on('ride.updated', onView);
  socket.on('driver.location', (payload) => {
    if (payload && payload.rideId === rideId && payload.recordedAt) broadcast.add(Date.now() - Date.parse(payload.recordedAt));
  });
  const watch = setInterval(() => {
    if (Date.now() >= deadline) finish();
  }, 1000);

  function finish() {
    if (finished) return;
    finished = true;
    clearInterval(watch);
    if (!assigned) {
      // Secours HTTP (7.3) : l'état fait foi même si un événement du socket a été manqué.
      const res = api('GET', `/v1/rides/${rideId}`, null, client.token, 'ride_get');
      if (res.status === 200) onView(res.json());
    }
    rideAssigned.add(assigned);
    socket.close();
  }
}

// --- Scénario `quotes` : devis à débit constant ---

export function quoteRequest() {
  const client = clients[exec.scenario.iterationInTest % clients.length];
  const res = api('POST', '/v1/quotes', { category: 'neo_premium', ...trip(), requestedAt: new Date(Date.now() + 3 * 3_600_000).toISOString() }, client.token, 'quote', 'quote');
  quoteMs.add(res.timings.duration);
  check(res, { 'devis 201': (r) => r.status === 201 });
}

// --- Rapport ---

function valueOf(data, metric, stat) {
  const m = data.metrics[metric];
  if (!m) return null;
  const v = m.values[stat];
  return v === undefined ? null : v;
}

export function handleSummary(data) {
  const rows = reportRows(config).map((row) => {
    const value = valueOf(data, row.metric, row.stat);
    const threshold = data.metrics[row.metric] && data.metrics[row.metric].thresholds;
    const failed = threshold ? Object.values(threshold).some((t) => !t.ok) : null;
    const shown = value === null ? 'non mesuré' : row.stat === 'rate' && row.unit === '' ? `${(value * 100).toFixed(2)} %` : `${Math.round(value * 100) / 100}${row.unit ? ` ${row.unit}` : ''}`;
    const target = row.target === null ? '(information)' : row.stat === 'rate' && row.unit === '' ? `${row.metric === 'http_req_failed' ? '<' : '≥'} ${(row.target * 100).toFixed(0)} %` : `${row.stat === 'count' || row.stat === 'rate' ? '≥' : '<'} ${Math.round(row.target * 100) / 100}${row.unit ? ` ${row.unit}` : ''}`;
    const status = value === null ? '—' : row.target === null || failed === null ? 'information' : failed ? 'ÉCHEC' : 'atteint';
    return `| ${row.label} | ${shown} | ${target} | ${status} |`;
  });
  const detail = [...ENDPOINTS.map((n) => [`HTTP ${n}`, `http_req_duration{name:${n}}`]), ...SOCKET_EVENTS.map((e) => [`socket ${e}`, `ws_ack_ms{event:${e}}`])]
    .filter(([, metric]) => data.metrics[metric] && data.metrics[metric].values.count)
    .map(([label, metric]) => {
      const v = data.metrics[metric].values;
      return `| ${label} | ${v.count} | ${Math.round(v.med)} | ${Math.round(v['p(95)'])} | ${Math.round(v.max)} |`;
    });
  const failedThresholds = Object.entries(data.metrics).flatMap(([name, m]) => Object.entries(m.thresholds || {}).filter(([, th]) => !th.ok).map(([expr]) => `${name} ${expr}`));
  const counters = ['offers_received', 'offers_accepted', 'rides_completed', 'positions_sent', 'http_reqs', 'iterations'].map((name) => `${name} = ${valueOf(data, name, 'count') ?? 0}`);
  const md = [
    `# Essai de charge Neomoov : profil ${config.profile}${config.scale !== 1 ? ` (échelle ${config.scale})` : ''}`,
    '',
    `Date : ${new Date().toISOString()} · API : ${config.baseUrl} · cartographie : ${config.maps === 'real' ? 'réelle' : 'simulée'} · course : ${config.rideType} · scénarios : ${config.scenarios.join(', ')}`,
    `Chauffeurs : ${config.drivers} (une position toutes les ${config.positionIntervalS} s pendant ${config.positionsDurationS} s) · courses simultanées : ${config.rides} · devis : ${config.quotesRate}/s pendant ${config.quotesDurationS} s`,
    '',
    '| Mesure | Résultat | Cible | État |',
    '|---|---|---|---|',
    ...rows,
    '',
    '| Requête | Nombre | Médiane (ms) | 95e centile (ms) | Maximum (ms) |',
    '|---|---|---|---|---|',
    ...detail,
    '',
    `Compteurs : ${counters.join(' · ')}`,
    '',
    failedThresholds.length ? `Seuils non atteints : ${failedThresholds.join(' ; ')}` : 'Tous les seuils sont atteints.',
    '',
    `Cibles (section 2.2) : devis ${TARGETS.quoteComputeP95Ms} ms hors cartographie, ${TARGETS.quoteFullP95Ms} ms au 95e centile avec itinéraire ; première offre ${TARGETS.firstOfferP95Ms} ms ; position ${TARGETS.locationBroadcastP95Ms} ms ; API ${TARGETS.apiP95Ms} ms au 95e centile ; ${TARGETS.drivers} chauffeurs, ${TARGETS.positionsPerSecond} positions par seconde.`,
    '',
  ].join('\n');
  const dir = (__ENV.LOAD_SUMMARY_DIR || 'tests/load/results').replace(/\/+$/, '');
  return {
    stdout: `\n${md}\n`,
    [`${dir}/${config.profile}-summary.md`]: md,
    [`${dir}/${config.profile}-summary.json`]: JSON.stringify({ config, metrics: data.metrics }, null, 2),
  };
}
