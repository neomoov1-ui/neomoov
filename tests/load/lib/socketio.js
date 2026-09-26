/**
 * Client Socket.IO v4 minimal pour k6 (Engine.IO 4, transport WebSocket seul, sans reconnexion) : poignée de main
 * d'espace avec le jeton (`auth.token`), événements reçus, émission avec acquittement, réponse aux pings du serveur.
 * Suffisant pour les espaces `/driver` et `/client` de l'API (section 7.3) ; aucune dépendance externe.
 *
 * Paquets : Engine.IO `0` ouverture, `2` ping, `3` pong, `4` message ; Socket.IO (après `4`) `0` connexion,
 * `2` événement, `3` acquittement, `4` refus de connexion. Forme : `<type>[/<espace>,][<id>]<JSON>`.
 */
import { WebSocket } from 'k6/websockets';

export function socketUrl(baseUrl) {
  return `${baseUrl.replace(/^http/, 'ws').replace(/\/+$/, '')}/socket.io/?EIO=4&transport=websocket`;
}

/** Décode un paquet Socket.IO (sans le `4` d'Engine.IO). */
export function parsePacket(text) {
  let i = 0;
  const type = Number(text[i]);
  i += 1;
  let nsp = '/';
  if (text[i] === '/') {
    const comma = text.indexOf(',', i);
    nsp = text.slice(i, comma === -1 ? undefined : comma);
    i = comma === -1 ? text.length : comma + 1;
  }
  let id = '';
  while (i < text.length && text[i] >= '0' && text[i] <= '9') {
    id += text[i];
    i += 1;
  }
  const data = i < text.length ? JSON.parse(text.slice(i)) : undefined;
  return { type, nsp, id: id ? Number(id) : null, data };
}

export class SocketIoClient {
  /**
   * @param {string} baseUrl adresse HTTP de l'API
   * @param {string} namespace `/driver` ou `/client`
   * @param {string} token jeton d'accès
   * @param {{ label?: string, onConnect?: (ms: number) => void, onError?: (reason: string) => void, onClose?: () => void }} hooks (`label` : nom dans le journal de `LOAD_DEBUG=1`)
   */
  constructor(baseUrl, namespace, token, hooks = {}) {
    this.namespace = namespace;
    this.token = token;
    this.hooks = hooks;
    this.handlers = {};
    this.acks = {};
    this.nextId = 1;
    this.connected = false;
    /** Vrai dès la première connexion à l'espace (une coupure ultérieure n'est pas un échec de connexion). */
    this.everConnected = false;
    this.closed = false;
    this.openedAt = Date.now();
    this.debug = __ENV.LOAD_DEBUG === '1' ? (hooks.label || namespace) : null;
    this.ws = new WebSocket(socketUrl(baseUrl));
    if (this.debug) this.ws.onopen = () => console.log(`[${this.debug}] ouvert`);
    this.ws.onmessage = (event) => this.receive(String(event.data));
    // Une erreur après une fermeture demandée (code 1005 à la fermeture) n'en est pas une.
    this.ws.onerror = (event) => {
      if (!this.closed) this.fail(`websocket: ${event && event.error ? event.error : 'erreur'}`);
    };
    this.ws.onclose = (event) => {
      if (this.debug) console.log(`[${this.debug}] fermé (${event && event.code}) après ${Date.now() - this.openedAt} ms, connecté=${this.everConnected}`);
      this.closed = true;
      this.connected = false;
      if (this.hooks.onClose) this.hooks.onClose();
    };
  }

  on(event, handler) {
    this.handlers[event] = handler;
  }

  /** Émet un événement ; `onAck(réponse, millisecondes)` reçoit l'acquittement du serveur. */
  emit(event, data, onAck) {
    if (!this.connected) return false;
    let id = '';
    if (onAck) {
      id = String(this.nextId);
      this.nextId += 1;
      this.acks[id] = { onAck, sentAt: Date.now() };
    }
    this.ws.send(`42${this.namespace},${id}${JSON.stringify([event, data])}`);
    return true;
  }

  /** Acquittements attendus depuis plus de `timeoutMs` : retirés et signalés (réponse `null`). */
  expireAcks(timeoutMs) {
    const now = Date.now();
    for (const id of Object.keys(this.acks)) {
      const pending = this.acks[id];
      if (now - pending.sentAt > timeoutMs) {
        delete this.acks[id];
        pending.onAck(null, now - pending.sentAt);
      }
    }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    try {
      this.ws.close();
    } catch (_) {
      // déjà fermé
    }
  }

  fail(reason) {
    if (this.hooks.onError) this.hooks.onError(reason);
    this.close();
  }

  receive(text) {
    if (this.debug && !text.startsWith('42') && !text.startsWith('43')) console.log(`[${this.debug}] reçu ${text.slice(0, 80)}`);
    const kind = text[0];
    if (kind === '0') {
      // Ouverture Engine.IO : connexion à l'espace avec le jeton.
      this.ws.send(`40${this.namespace},${JSON.stringify({ token: this.token })}`);
      return;
    }
    if (kind === '2') {
      this.ws.send('3');
      return;
    }
    if (kind !== '4') return;
    const packet = parsePacket(text.slice(1));
    if (packet.nsp !== this.namespace) return;
    if (packet.type === 0) {
      this.connected = true;
      this.everConnected = true;
      if (this.hooks.onConnect) this.hooks.onConnect(Date.now() - this.openedAt);
    } else if (packet.type === 4) {
      this.fail((packet.data && packet.data.message) || 'CONNECT_ERROR');
    } else if (packet.type === 2 && Array.isArray(packet.data)) {
      const [event, payload] = packet.data;
      const handler = this.handlers[event];
      if (handler) handler(payload);
    } else if (packet.type === 3 && packet.id !== null) {
      const pending = this.acks[String(packet.id)];
      if (!pending) return;
      delete this.acks[String(packet.id)];
      pending.onAck(Array.isArray(packet.data) ? packet.data[0] : packet.data, Date.now() - pending.sentAt);
    }
  }
}
