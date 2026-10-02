/**
 * Neomoov Booster (phase 1, agent G) : réception des photos et captures d'écran. Même chaîne que les documents des
 * chauffeurs (étape 14) : type reconnu à la signature du fichier (JPEG, PNG, WEBP ; jamais de PDF ici), taille bornée
 * par un réglage, analyse antivirus avant tout stockage, clé de stockage privée (préfixe de l'organisation sous contexte).
 */
import type { schema } from '@neomoov/db';
import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import type { StorageProvider, VirusScanner } from '../../adapters/types.js';
import { AppError } from '../../common/app-error.js';
import { currentOrgScope, storageKeyPrefix } from '../../common/org-scope.context.js';

/** Types des colonnes JSON des rapports (schéma de la base). */
export type StoredImage = schema.StoredImage;
export type StoredAnalysis = schema.StoredAnalysis;

export interface UploadedImage {
  buffer: Buffer;
  mimetype: string;
  size: number;
  originalname?: string;
}

export type ImageContentType = 'image/jpeg' | 'image/png' | 'image/webp';

/** Type d'image reconnu à la signature des premiers octets ; null pour tout autre contenu (PDF compris). */
export function sniffImageType(buffer: Buffer): { contentType: ImageContentType; extension: string } | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { contentType: 'image/jpeg', extension: 'jpg' };
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { contentType: 'image/png', extension: 'png' };
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return { contentType: 'image/webp', extension: 'webp' };
  return null;
}

/** Vues déclarées pour les fichiers (`kinds`, séparées par des virgules) ; `other` à défaut, une par fichier. */
export function kindsOf(raw: string | undefined, count: number, allowed: readonly string[]): string[] {
  const declared = (raw ?? '').split(',').map((k) => k.trim()).filter(Boolean);
  return Array.from({ length: count }, (_, i) => (declared[i] && allowed.includes(declared[i]!) ? declared[i]! : 'other'));
}

export interface ImageIntake {
  storage: StorageProvider;
  scanner: VirusScanner;
  logger: Logger;
  maxBytes: number;
  /** Dossier de stockage, sous le préfixe de l'organisation du contexte : `booster/inspections/<id>`. */
  folder: string;
  /** Journalisation : identifiant du rapport. */
  reportId: string;
}

/** Reçoit, contrôle, analyse et range chaque fichier ; renvoie les clés et métadonnées à garder en base. */
export async function intakeImages(files: UploadedImage[], kinds: string[], intake: ImageIntake): Promise<StoredImage[]> {
  const stored: StoredImage[] = [];
  const prefix = storageKeyPrefix(currentOrgScope()?.organizationId);
  for (const [index, file] of files.entries()) {
    if (!file?.buffer?.length) throw new AppError('FILE_REQUIRED', 'Un fichier reçu est vide', 400, { index });
    if (file.size > intake.maxBytes || file.buffer.length > intake.maxBytes) throw new AppError('FILE_TOO_LARGE', 'Une photo dépasse la taille maximale', 413, { index, maxBytes: intake.maxBytes });
    const sniffed = sniffImageType(file.buffer);
    if (!sniffed) throw new AppError('FILE_TYPE_NOT_ALLOWED', 'Formats acceptés pour les photos : JPEG, PNG ou WEBP', 415, { index });
    const scan = await intake.scanner.scan({ body: file.buffer, ...(file.originalname ? { filename: file.originalname } : {}) });
    if (!scan.clean) {
      intake.logger.warn({ reportId: intake.reportId, index, signature: scan.signature }, 'Photo refusée par l\'antivirus');
      throw new AppError('DOCUMENT_INFECTED', 'Ce fichier est refusé par l\'analyse antivirus', 422, { index, signature: scan.signature });
    }
    const key = `${prefix}${intake.folder}/${randomUUID()}.${sniffed.extension}`;
    await intake.storage.putObject({ key, body: file.buffer, contentType: sniffed.contentType });
    stored.push({ key, kind: kinds[index] ?? 'other', contentType: sniffed.contentType, bytes: file.buffer.length, uploadedAt: new Date().toISOString() });
  }
  return stored;
}

/** Suppression silencieuse des fichiers (purge, remplacement) : un fichier déjà absent n'est pas une erreur. */
export async function deleteImages(storage: StorageProvider, logger: Logger, keys: string[]): Promise<number> {
  let deleted = 0;
  for (const key of keys) {
    await storage.deleteObject(key).then(() => { deleted += 1; }).catch((error: unknown) => logger.warn({ err: error, key }, 'Fichier Booster non supprimé'));
  }
  return deleted;
}
