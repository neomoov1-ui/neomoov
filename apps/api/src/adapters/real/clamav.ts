/**
 * Analyse antivirus réelle par ClamAV (démon `clamd` en conteneur, prompt 14 tâche 5), par son protocole TCP sans
 * dépendance : commande `zINSTREAM`, fichier envoyé par blocs préfixés de leur longueur (4 octets, gros-boutiste), bloc
 * vide final, réponse `stream: OK` ou `stream: <signature> FOUND`. Délai borné : un démon muet est une erreur, jamais
 * un fichier réputé sain.
 */
import { Socket } from 'node:net';
import { AppError } from '../../common/app-error.js';
import type { ScanResult, VirusScanner } from '../types.js';

const CHUNK = 64 * 1024;

export function parseClamdReply(reply: string): ScanResult {
  const text = reply.replace(/\0/g, '').trim();
  if (/:\s*OK$/.test(text)) return { clean: true, signature: null };
  const found = /:\s*(.+)\s+FOUND$/.exec(text);
  if (found) return { clean: false, signature: found[1]!.trim() };
  throw new AppError('VIRUS_SCAN_FAILED', `Réponse inattendue de ClamAV : ${text.slice(0, 120)}`, 502);
}

export class ClamAvScanner implements VirusScanner {
  readonly name = 'clamav';

  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly timeoutMs = 15_000,
  ) {}

  toJSON() {
    return { name: this.name, configured: true };
  }

  scan(input: { body: Buffer; filename?: string }): Promise<ScanResult> {
    return new Promise((resolve, reject) => {
      const socket = new Socket();
      const chunks: Buffer[] = [];
      const fail = (message: string) => {
        socket.destroy();
        reject(new AppError('VIRUS_SCAN_FAILED', message, 502));
      };
      socket.setTimeout(this.timeoutMs, () => fail('ClamAV ne répond pas'));
      socket.on('error', (error) => fail(`ClamAV injoignable (${error.message})`));
      socket.on('data', (data: Buffer) => chunks.push(data));
      socket.on('end', () => {
        try {
          resolve(parseClamdReply(Buffer.concat(chunks).toString('utf8')));
        } catch (error) {
          reject(error);
        }
      });
      socket.connect(this.port, this.host, () => {
        socket.write('zINSTREAM\0');
        for (let offset = 0; offset < input.body.length; offset += CHUNK) {
          const part = input.body.subarray(offset, offset + CHUNK);
          const size = Buffer.alloc(4);
          size.writeUInt32BE(part.length, 0);
          socket.write(size);
          socket.write(part);
        }
        socket.write(Buffer.alloc(4));
      });
    });
  }
}
