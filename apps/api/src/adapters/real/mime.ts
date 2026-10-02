/**
 * Décodage minimal des parties MIME lues par IMAP (boîte unifiée) : encodages de transfert `quoted-printable` et
 * `base64`, jeux de caractères usuels (UTF-8, Latin-1, Windows-1252), choix de la partie texte dans une structure
 * MIME et liste des pièces jointes. Fonctions pures, sans dépendance : un courriel n'est jamais parsé en entier.
 */

export interface MimeNode {
  part?: string | undefined;
  type: string;
  parameters?: Record<string, string> | undefined;
  encoding?: string | undefined;
  size?: number | undefined;
  disposition?: string | undefined;
  dispositionParameters?: Record<string, string> | undefined;
  childNodes?: MimeNode[] | undefined;
}

/** Octets d'une partie selon son encodage de transfert (`7bit`, `8bit`, `binary` : tels quels). */
export function decodeTransferEncoding(raw: Buffer, encoding: string | undefined): Buffer {
  const enc = (encoding ?? '').toLowerCase().trim();
  if (enc === 'base64') return Buffer.from(raw.toString('latin1').replace(/[^A-Za-z0-9+/=]/g, ''), 'base64');
  if (enc === 'quoted-printable') {
    const text = raw.toString('latin1').replace(/=\r?\n/g, '');
    const bytes: number[] = [];
    for (let i = 0; i < text.length; i += 1) {
      const c = text[i]!;
      const hex = text.slice(i + 1, i + 3);
      if (c === '=' && /^[0-9A-Fa-f]{2}$/.test(hex)) {
        bytes.push(Number.parseInt(hex, 16));
        i += 2;
      } else bytes.push(c.charCodeAt(0) & 0xff);
    }
    return Buffer.from(bytes);
  }
  return raw;
}

/** Texte d'une partie : octets décodés puis lus dans son jeu de caractères (UTF-8 par défaut, Latin-1 et Windows-1252 admis). */
export function decodeMimeText(raw: Buffer, encoding: string | undefined, charset: string | undefined): string {
  const bytes = decodeTransferEncoding(raw, encoding);
  const cs = (charset ?? 'utf-8').toLowerCase().replace(/_/g, '-');
  const label = cs === 'iso-8859-1' || cs === 'latin1' || cs === 'us-ascii' || cs === 'ascii' ? 'iso-8859-1' : cs === 'windows-1252' || cs === 'cp1252' ? 'windows-1252' : 'utf-8';
  try {
    return new TextDecoder(label, { fatal: false }).decode(bytes);
  } catch {
    return bytes.toString('utf8');
  }
}

function walk(node: MimeNode, visit: (n: MimeNode) => void): void {
  visit(node);
  for (const child of node.childNodes ?? []) walk(child, visit);
}

/** Partie à lire : `text/plain` de préférence, sinon `text/html` ; une pièce jointe (disposition `attachment`) n'est jamais choisie. */
export function pickTextPart(structure: MimeNode): { part: string; type: 'text/plain' | 'text/html'; encoding: string | undefined; charset: string | undefined } | null {
  const plain: MimeNode[] = [];
  const html: MimeNode[] = [];
  walk(structure, (n) => {
    const type = n.type.toLowerCase();
    if ((n.disposition ?? '').toLowerCase() === 'attachment') return;
    if (type === 'text/plain') plain.push(n);
    if (type === 'text/html') html.push(n);
  });
  const chosen = plain[0] ?? html[0];
  if (!chosen) return null;
  // Un message non multipart a sa seule partie en `TEXT` ; les autres portent leur numéro (`1`, `1.2`…).
  const part = chosen.part ?? (chosen === structure ? 'TEXT' : '1');
  const charset = chosen.parameters?.['charset'] ?? chosen.parameters?.['CHARSET'];
  return { part, type: chosen.type.toLowerCase() === 'text/html' ? 'text/html' : 'text/plain', encoding: chosen.encoding, charset };
}

/** Pièces jointes listées (nom, type, taille) : disposition `attachment`, ou partie non textuelle nommée. */
export function listAttachments(structure: MimeNode): Array<{ name: string; contentType: string | null; size: number | null }> {
  const out: Array<{ name: string; contentType: string | null; size: number | null }> = [];
  walk(structure, (n) => {
    const type = n.type.toLowerCase();
    if (type.startsWith('multipart/')) return;
    const name = n.dispositionParameters?.['filename'] ?? n.parameters?.['name'] ?? null;
    const attached = (n.disposition ?? '').toLowerCase() === 'attachment' || (Boolean(name) && !type.startsWith('text/'));
    if (!attached) return;
    out.push({ name: (name ?? `piece-jointe.${type.split('/')[1] ?? 'bin'}`).slice(0, 200), contentType: n.type, size: n.size ?? null });
  });
  return out;
}

/** En-têtes bruts (`Nom: valeur`, lignes pliées) en objet aux noms en minuscules ; un en-tête répété est joint par un espace. */
export function parseRawHeaders(raw: Buffer | string | undefined): Record<string, string> {
  const text = (raw ?? '').toString().replace(/\r\n[ \t]+/g, ' ').replace(/\n[ \t]+/g, ' ');
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i <= 0) continue;
    const key = line.slice(0, i).trim().toLowerCase();
    const value = line.slice(i + 1).trim();
    out[key] = out[key] ? `${out[key]} ${value}` : value;
  }
  return out;
}
