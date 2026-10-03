/**
 * Visuels et vidéos des contenus (plan 4.2) : gabarits de marque en HTML (un par format : carré, portrait, paysage),
 * photo réelle de la médiathèque du site en fond quand il y en a une (D46 : jamais une image de synthèse présentée
 * comme réelle), rendu PNG par un navigateur sans interface (`BROWSER_BIN`, comme `slides.cjs` de l'Academy) ; vidéo
 * courte par la chaîne diapositives et voix (narration par `TtsProvider`, montage ffmpeg quand il est présent). Sans
 * navigateur ou sans ffmpeg, les gabarits et la narration sont produits et rangés, le rendu est différé (état `html`),
 * jamais bloquant pour les réseaux qui n'exigent pas de média. Tout est rangé dans le stockage sous `marketing/<id>/`.
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { isVideoFormat, SPACE_RULES, thumbnailSize, visualSize, type ContentFormat, type ContentLanguage, type ContentSpace, type MediaStatus, type VisualVariant } from '@neomoov/domain';
import { Inject, Injectable } from '@nestjs/common';
import type { Logger } from 'pino';
import { SITE_CONNECTOR, TTS_PROVIDER, type SiteConnector, type SiteMediaItem, type TtsProvider } from '../../adapters/marketing.types.js';
import { STORAGE_PROVIDER, type StorageProvider } from '../../adapters/types.js';
import { APP_LOGGER } from '../../common/logger.js';
import { APP_ENV, type AppEnv } from '../../config/env.js';
import { variantHtml, type VariantPhoto } from './visual-templates.js';

const run = promisify(execFile);

/** Navigateur installé dans les images de l'API et du worker (Dockerfile) : utilisé quand `BROWSER_BIN` est vide. */
export const IMAGE_BROWSER = '/usr/local/bin/neomoov-browser';

export interface VisualInput {
  id: string;
  space: ContentSpace;
  format: ContentFormat;
  language: ContentLanguage;
  title: string | null;
  body: string;
  headline: string | null;
}

export interface MediaResult {
  mediaKey: string | null;
  mediaKind: 'image' | 'video' | 'html' | null;
  mediaStatus: MediaStatus;
  /** Références des éléments produits (narration, diapositives, liste de montage), pour le journal. */
  assets: string[];
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Dimensions par format et par espace : table unique du domaine (`VISUAL_SIZES`, tailles exactes de chaque réseau). */
export function visualDimensions(space: ContentSpace, format: ContentFormat): { width: number; height: number } {
  return visualSize(space, format);
}

/** Visuel d'un contenu de publication multiréseau : média produit, taille, empreinte et miniature éventuelle. */
export interface VariantMediaResult extends MediaResult {
  width: number;
  height: number;
  /** Empreinte SHA-256 du PNG rendu (sinon du gabarit HTML) : toutes différentes dans une publication. */
  fingerprint: string | null;
  thumbnailKey: string | null;
}

export const fingerprintOf = (body: Buffer | string): string => createHash('sha256').update(body).digest('hex');

/** Points clés d'un texte : première phrase de chaque paragraphe ou élément de liste, au plus `max`, courts (comme `slides.cjs`). */
export function keyPoints(text: string, max = 4): string[] {
  const blocks = text.split(/\n+/).map((b) => b.replace(/^[-#]+\s*/, '').trim()).filter(Boolean);
  const points: string[] = [];
  for (const block of blocks) {
    const first = (block.split(/(?<=[.!?])\s+/)[0] ?? '').trim();
    if (first.length >= 12) points.push(first.length > 140 ? `${first.slice(0, 137).replace(/\s+\S*$/, '')}…` : first);
    if (points.length >= max) break;
  }
  return points;
}

@Injectable()
export class VisualsService {
  constructor(
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    @Inject(TTS_PROVIDER) private readonly tts: TtsProvider,
    @Inject(SITE_CONNECTOR) private readonly site: SiteConnector,
    @Inject(APP_ENV) private readonly env: AppEnv,
    @Inject(APP_LOGGER) private readonly logger: Logger,
  ) {}

  /** Média attendu : aucun sur le site, l'Academy et l'infolettre (texte et photos du site) ; un visuel ou une vidéo ailleurs. */
  static expected(space: ContentSpace): boolean {
    return !['site_blog', 'academy', 'newsletter'].includes(space);
  }

  /** Gabarit de marque d'un visuel : fond sombre et accent lime de l'Academy, photo réelle en fond si disponible. */
  html(input: VisualInput, photo: SiteMediaItem | null, points: string[], options: { kicker?: string; footer?: string; progress?: number } = {}): string {
    const { width, height } = visualDimensions(input.space, input.format);
    const portrait = height > width;
    const headline = input.headline?.trim() || input.title?.trim() || points[0] || 'Neomoov';
    const kicker = options.kicker ?? SPACE_RULES[input.space].name;
    const footer = options.footer ?? (input.language === 'en' ? 'neomoov.net · electric rides in Montréal' : 'neomoov.net · transport électrique à Montréal');
    const background = photo ? `background:linear-gradient(180deg,rgba(10,36,49,.55),rgba(16,23,31,.92)),url("${esc(photo.url)}") center/cover no-repeat` : 'background:linear-gradient(135deg,#0a2431 0%,#10171f 60%,#163541 100%)';
    const list = points.length ? `<ul>${points.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : '';
    const h1Size = portrait ? 72 : width >= 1280 ? 56 : 52;
    return `<!doctype html><html lang="${input.language === 'en' ? 'en-CA' : 'fr-CA'}"><head><meta charset="utf-8"><title>${esc(headline)}</title><style>
*{box-sizing:border-box}html,body{margin:0;width:${width}px;height:${height}px;overflow:hidden}body{font:28px/1.4 "Segoe UI",Arial,sans-serif;color:#fff;${background};position:relative}
.top{position:absolute;top:${portrait ? 72 : 36}px;left:60px;right:60px;display:flex;justify-content:space-between;align-items:center}.brand{font-size:36px;font-weight:800;letter-spacing:-1px}.brand span{font-size:13px;letter-spacing:5px;margin-left:10px;font-weight:700;color:#c4f45c}
.kicker{font-size:16px;letter-spacing:3px;text-transform:uppercase;color:#c4f45c;font-weight:700}.body{position:absolute;top:${portrait ? 360 : 150}px;left:60px;right:60px;bottom:90px}
h1{font-size:${h1Size}px;line-height:1.1;margin:0 0 28px;letter-spacing:-1px;max-width:${width - 120}px;text-shadow:0 2px 12px rgba(0,0,0,.35)}
ul{list-style:none;padding:0;margin:0}li{position:relative;padding-left:42px;margin:0 0 16px;font-size:${portrait ? 36 : 28}px;line-height:1.35;text-shadow:0 1px 8px rgba(0,0,0,.4)}li:before{content:"";position:absolute;left:0;top:14px;width:18px;height:18px;border-radius:50%;background:#c4f45c}
.foot{position:absolute;bottom:${portrait ? 110 : 28}px;left:60px;right:60px;display:flex;justify-content:space-between;font-size:16px;color:#d6e0e6}.bar{position:absolute;bottom:0;left:0;height:8px;background:#c4f45c;width:${Math.round((options.progress ?? 1) * 100)}%}
.credit{position:absolute;bottom:8px;right:60px;font-size:12px;color:#9fb3bd}
</style></head><body><div class="top"><div class="brand">neomoov<span>${input.space === 'academy' ? 'ACADEMY' : 'MONTRÉAL'}</span></div><div class="kicker">${esc(kicker)}</div></div><div class="body"><h1>${esc(headline)}</h1>${list}</div><div class="foot"><span>${esc(footer)}</span><span>${input.language === 'en' ? 'Book at least 2 hours ahead' : 'Réservez au moins 2 heures à l\'avance'}</span></div>${photo?.alt ? `<div class="credit">${esc(photo.alt)}</div>` : ''}<div class="bar"></div></body></html>`;
  }

  /** Photo réelle de la médiathèque du site, choisie de façon stable pour un contenu ; null sans médiathèque (jamais une image inventée). */
  private async photoFor(id: string): Promise<SiteMediaItem | null> {
    try {
      const items = await this.site.mediaLibrary(12);
      if (!items.length) return null;
      const index = parseInt(id.replace(/-/g, '').slice(0, 8), 16) % items.length;
      return items[index] ?? null;
    } catch (error) {
      this.logger.warn({ err: error }, 'Médiathèque du site indisponible : visuel sans photo');
      return null;
    }
  }

  /** Rendu PNG d'un gabarit HTML par le navigateur sans interface ; null quand aucun navigateur n'est configuré ou que le rendu échoue. */
  async render(html: string, size: { width: number; height: number }): Promise<Buffer | null> {
    const bin = this.env.BROWSER_BIN ?? (existsSync(IMAGE_BROWSER) ? IMAGE_BROWSER : null);
    if (!bin) return null;
    const dir = await mkdtemp(join(tmpdir(), 'neomoov-visual-'));
    try {
      const file = join(dir, 'visual.html');
      const png = join(dir, 'visual.png');
      await writeFile(file, html, 'utf8');
      await run(bin, ['--headless=new', '--disable-gpu', '--disable-dev-shm-usage', '--hide-scrollbars', '--no-first-run', '--no-sandbox', `--user-data-dir=${join(dir, 'profile')}`, `--window-size=${size.width},${size.height}`, `--screenshot=${png}`, `file:///${file.replace(/\\/g, '/')}`], { timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
      return await readFile(png);
    } catch (error) {
      this.logger.warn({ err: error }, 'Rendu du visuel impossible : gabarit HTML gardé, PNG différé');
      return null;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  private async put(key: string, body: Buffer | string, contentType: string): Promise<string> {
    await this.storage.putObject({ key, body: Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8'), contentType });
    return key;
  }

  /** Visuel ou vidéo d'un contenu : rangés dans le stockage, référence et état renvoyés (l'appelant met la ligne à jour). */
  async prepare(input: VisualInput): Promise<MediaResult> {
    const prefix = `marketing/${input.id}`;
    const photo = await this.photoFor(input.id);
    if (!isVideoFormat(input.format)) {
      const html = this.html(input, photo, keyPoints(input.body, 3));
      const assets = [await this.put(`${prefix}/visual.html`, html, 'text/html; charset=utf-8')];
      const png = await this.render(html, visualDimensions(input.space, input.format));
      if (!png) return { mediaKey: assets[0]!, mediaKind: 'html', mediaStatus: 'html', assets };
      assets.push(await this.put(`${prefix}/visual.png`, png, 'image/png'));
      return { mediaKey: assets[1]!, mediaKind: 'image', mediaStatus: 'ready', assets };
    }
    return this.prepareVideo(input, photo, prefix);
  }

  /**
   * Visuel d'un contenu de publication multiréseau (3 octobre 2026) : gabarit de sa variante (mise en page, photo réelle,
   * recadrage, accent, position et texte propres au réseau) à la taille exacte du réseau, rendu en PNG ; vidéo courte
   * (TikTok, YouTube Short, reels) par la chaîne existante avec la variante en couverture ; miniature 1280 × 720 pour
   * YouTube. L'empreinte du fichier produit permet de vérifier qu'aucune image n'est répétée dans une publication.
   */
  async prepareVariant(input: VisualInput, variant: VisualVariant, photo: VariantPhoto | null): Promise<VariantMediaResult> {
    const prefix = `marketing/${input.id}`;
    const size = visualSize(input.space, input.format);
    const html = variantHtml({ size, language: input.language, variant, photo, spaceName: SPACE_RULES[input.space].name });
    let result: MediaResult;
    let fingerprint: string | null;
    if (isVideoFormat(input.format)) {
      const sitePhoto: SiteMediaItem | null = photo ? { id: 'variant', url: photo.url, alt: photo.alt, mimeType: 'image/jpeg' } : null;
      result = await this.prepareVideo({ ...input, headline: variant.imageText }, sitePhoto, prefix, html);
      const file = result.mediaKey ? await this.storage.getObject(result.mediaKey).catch(() => null) : null;
      fingerprint = file ? fingerprintOf(file.body) : fingerprintOf(html);
    } else {
      const assets = [await this.put(`${prefix}/visual.html`, html, 'text/html; charset=utf-8')];
      const png = await this.render(html, size);
      if (png) {
        assets.push(await this.put(`${prefix}/visual.png`, png, 'image/png'));
        result = { mediaKey: assets[1]!, mediaKind: 'image', mediaStatus: 'ready', assets };
      } else {
        result = { mediaKey: assets[0]!, mediaKind: 'html', mediaStatus: 'html', assets };
      }
      fingerprint = fingerprintOf(png ?? html);
    }
    let thumbnailKey: string | null = null;
    const thumb = thumbnailSize(input.space);
    if (thumb) {
      const thumbHtml = variantHtml({ size: thumb, language: input.language, variant, photo, spaceName: SPACE_RULES[input.space].name });
      const png = await this.render(thumbHtml, thumb);
      thumbnailKey = png ? await this.put(`${prefix}/thumbnail.png`, png, 'image/png') : await this.put(`${prefix}/thumbnail.html`, thumbHtml, 'text/html; charset=utf-8');
      result.assets.push(thumbnailKey);
    }
    return { ...result, width: size.width, height: size.height, fingerprint, thumbnailKey };
  }

  /** Chaîne vidéo de l'Academy : narration (voix de synthèse), une diapositive par séquence, liste de montage, ffmpeg si présent ; `cover` remplace la première diapositive. */
  private async prepareVideo(input: VisualInput, photo: SiteMediaItem | null, prefix: string, cover?: string): Promise<MediaResult> {
    const assets: string[] = [];
    const points = keyPoints(input.body, 5);
    const sequences = [input.headline?.trim() || input.title?.trim() || points[0] || 'Neomoov', ...points];
    let narration: { key: string; durationSeconds: number | null } | null = null;
    try {
      const voice = await this.tts.synthesize({ text: input.body, language: input.language });
      narration = { key: await this.put(`${prefix}/narration.${voice.contentType === 'audio/mpeg' ? 'mp3' : 'wav'}`, voice.audio, voice.contentType), durationSeconds: voice.durationSeconds };
      assets.push(narration.key);
    } catch (error) {
      this.logger.warn({ err: error, itemId: input.id }, 'Narration indisponible : vidéo sans voix pour le moment');
    }
    const perSlide = Math.max(3, Math.round((narration?.durationSeconds ?? sequences.length * 4) / sequences.length));
    const size = visualDimensions(input.space, input.format);
    const slides: Array<{ html: string; png: Buffer | null }> = [];
    for (const [index, sequence] of sequences.entries()) {
      const html = index === 0 && cover ? cover : this.html({ ...input, headline: sequence }, photo, index === 0 ? [] : [sequence], { kicker: `${index + 1} / ${sequences.length}`, progress: (index + 1) / sequences.length });
      const n = String(index + 1).padStart(2, '0');
      assets.push(await this.put(`${prefix}/slides/${n}.html`, html, 'text/html; charset=utf-8'));
      const png = await this.render(html, size);
      if (png) assets.push(await this.put(`${prefix}/slides/${n}.png`, png, 'image/png'));
      slides.push({ html, png });
    }
    const montage = slides.flatMap((_, i) => [`file '${String(i + 1).padStart(2, '0')}.png'`, `duration ${perSlide.toFixed(3)}`]).concat([`file '${String(slides.length).padStart(2, '0')}.png'`]).join('\n');
    assets.push(await this.put(`${prefix}/montage.txt`, `${montage}\n`, 'text/plain; charset=utf-8'));
    const rendered = slides.every((s) => s.png);
    if (!rendered) return { mediaKey: assets.find((a) => a.endsWith('/01.html')) ?? null, mediaKind: 'html', mediaStatus: 'html', assets };
    const video = await this.assemble(slides.map((s) => s.png!), perSlide, narration ? await this.storage.getObject(narration.key) : null, size);
    if (video) {
      const key = await this.put(`${prefix}/video.mp4`, video, 'video/mp4');
      assets.push(key);
      return { mediaKey: key, mediaKind: 'video', mediaStatus: 'ready', assets };
    }
    // Sans ffmpeg : la première diapositive sert de visuel ; le montage reste à faire sur le serveur.
    return { mediaKey: assets.find((a) => a.endsWith('/01.png')) ?? null, mediaKind: 'image', mediaStatus: 'ready', assets };
  }

  /** Montage ffmpeg (liste concat des diapositives, piste de narration) ; null sans ffmpeg ou en cas d'échec. */
  private async assemble(frames: Buffer[], secondsPerFrame: number, narration: { body: Buffer; contentType: string } | null, size: { width: number; height: number }): Promise<Buffer | null> {
    const bin = this.env.FFMPEG_BIN ?? 'ffmpeg';
    const dir = await mkdtemp(join(tmpdir(), 'neomoov-video-'));
    try {
      const list: string[] = [];
      for (const [i, frame] of frames.entries()) {
        const name = `${String(i + 1).padStart(2, '0')}.png`;
        await writeFile(join(dir, name), frame);
        list.push(`file '${name}'`, `duration ${secondsPerFrame.toFixed(3)}`);
      }
      list.push(`file '${String(frames.length).padStart(2, '0')}.png'`);
      await writeFile(join(dir, 'liste.txt'), `${list.join('\n')}\n`, 'utf8');
      const args = ['-y', '-f', 'concat', '-safe', '0', '-i', 'liste.txt'];
      if (narration) {
        const audio = narration.contentType === 'audio/mpeg' ? 'narration.mp3' : 'narration.wav';
        await writeFile(join(dir, audio), narration.body);
        args.push('-i', audio, '-shortest', '-c:a', 'aac');
      }
      args.push('-vf', `scale=${size.width}:${size.height},format=yuv420p`, '-r', '25', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', 'video.mp4');
      await run(bin, args, { cwd: dir, timeout: 300_000, maxBuffer: 8 * 1024 * 1024 });
      return await readFile(join(dir, 'video.mp4'));
    } catch (error) {
      this.logger.warn({ err: error }, 'Montage vidéo impossible (ffmpeg absent ou en échec) : diapositives gardées');
      return null;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}
