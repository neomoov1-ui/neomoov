/**
 * Export JPEG des rapports Booster (vérification sommaire, performance) : chaque page du PDF archivé est rendue en JPEG
 * par `pdftoppm` (poppler, installé dans l'image de l'API), puis les pages sont empilées en une seule image par
 * `ffmpeg` (filtre `vstack`) pour un partage facile (WhatsApp, courriel). Le PDF reste la pièce de référence ; le JPEG
 * en est une copie de lecture, gardée dans le stockage à côté du PDF.
 */
import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Inject, Injectable } from '@nestjs/common';
import { STORAGE_PROVIDER, type StorageProvider } from '../../adapters/types.js';
import { AppError } from '../../common/app-error.js';
import { APP_ENV, type AppEnv } from '../../config/env.js';

const run = promisify(execFile);

/** Pages rendues au plus (un rapport Booster tient en deux ou trois pages ; borne contre un PDF inattendu). */
export const MAX_JPEG_PAGES = 6;

export interface PdfToJpegOptions {
  /** `PDFTOPPM_BIN` ; défaut : `pdftoppm` du PATH. */
  pdftoppm?: string | undefined;
  /** `FFMPEG_BIN` ; défaut : `ffmpeg` du PATH. */
  ffmpeg?: string | undefined;
  /** Résolution du rendu (points par pouce) : 110 donne une page A4 d'environ 910 × 1290 pixels. */
  dpi?: number;
}

/** Clé de stockage du JPEG d'un PDF archivé (même dossier, même nom). */
export function jpegKeyOf(pdfKey: string): string {
  return /\.pdf$/i.test(pdfKey) ? pdfKey.replace(/\.pdf$/i, '.jpg') : `${pdfKey}.jpg`;
}

/** Rend un PDF en une seule image JPEG (pages empilées) ; erreur 503 `JPEG_UNAVAILABLE` si les outils manquent. */
export async function pdfToJpeg(pdf: Buffer, options: PdfToJpegOptions = {}): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'neomoov-jpeg-'));
  try {
    await writeFile(join(dir, 'rapport.pdf'), pdf);
    await run(options.pdftoppm ?? 'pdftoppm', ['-jpeg', '-jpegopt', 'quality=85', '-r', String(options.dpi ?? 110), '-f', '1', '-l', String(MAX_JPEG_PAGES), 'rapport.pdf', 'page'], { cwd: dir, timeout: 60_000 });
    const pages = (await readdir(dir)).filter((f) => /^page-\d+\.jpg$/.test(f)).sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
    if (!pages.length) throw new Error('aucune page rendue');
    if (pages.length === 1) return await readFile(join(dir, pages[0]!));
    const inputs = pages.flatMap((p) => ['-i', p]);
    await run(options.ffmpeg ?? 'ffmpeg', ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', `vstack=inputs=${pages.length}`, '-q:v', '3', 'rapport.jpg'], { cwd: dir, timeout: 60_000 });
    return await readFile(join(dir, 'rapport.jpg'));
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('JPEG_UNAVAILABLE', 'Export JPEG indisponible pour le moment : téléchargez le PDF', 503, { reason: error instanceof Error ? error.message.slice(0, 200) : String(error) });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Copie JPEG d'un PDF archivé : relue dans le stockage si elle existe, sinon rendue puis rangée à côté du PDF. */
@Injectable()
export class BoosterJpegService {
  constructor(
    @Inject(APP_ENV) private readonly env: AppEnv,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  async ensure(pdfKey: string): Promise<{ key: string; body: Buffer; contentType: string }> {
    const key = jpegKeyOf(pdfKey);
    const cached = await this.storage.getObject(key);
    if (cached) return { key, body: cached.body, contentType: 'image/jpeg' };
    const pdf = await this.storage.getObject(pdfKey);
    if (!pdf) throw AppError.notFound('PDF_NOT_FOUND', 'Fichier PDF introuvable dans le stockage');
    const body = await pdfToJpeg(pdf.body, { pdftoppm: this.env.PDFTOPPM_BIN, ffmpeg: this.env.FFMPEG_BIN });
    await this.storage.putObject({ key, body, contentType: 'image/jpeg' });
    return { key, body, contentType: 'image/jpeg' };
  }
}
