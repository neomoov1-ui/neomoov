/**
 * Voix de synthèse réelle (phase 1 « entreprise autonome ») pour la narration des vidéos courtes : Piper sur le serveur
 * (`PIPER_BIN`, `PIPER_MODEL`, hors ligne, comme l'audio de l'Academy) ou Azure Speech (`AZURE_SPEECH_KEY`,
 * `AZURE_SPEECH_REGION`, voix neuronales fr-CA et en-CA). `TTS_ENGINE` choisit (sinon Piper si son binaire est donné,
 * sinon Azure). Les clés ne quittent jamais les objets.
 */
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { ContentLanguage } from '@neomoov/domain';
import { AppError } from '../../common/app-error.js';
import type { TtsProvider } from '../marketing.types.js';

const run = promisify(execFile);

/** Durée d'un fichier WAV PCM (en-tête RIFF : débit en octets par seconde, taille des données) ; null si illisible. */
export function wavDurationSeconds(audio: Buffer): number | null {
  if (audio.length < 44 || audio.toString('ascii', 0, 4) !== 'RIFF' || audio.toString('ascii', 8, 12) !== 'WAVE') return null;
  const byteRate = audio.readUInt32LE(28);
  let offset = 12;
  while (offset + 8 <= audio.length) {
    const id = audio.toString('ascii', offset, offset + 4);
    const size = audio.readUInt32LE(offset + 4);
    if (id === 'data') return byteRate ? Math.round((size / byteRate) * 100) / 100 : null;
    offset += 8 + size + (size % 2);
  }
  return null;
}

export class PiperTtsProvider implements TtsProvider {
  readonly name = 'piper';
  readonly configured = true;

  constructor(private readonly options: { bin: string; model: string; modelEn?: string | null }) {}

  toJSON() {
    return { name: this.name, configured: true };
  }

  async synthesize(input: { text: string; language: ContentLanguage }) {
    const dir = await mkdtemp(join(tmpdir(), 'neomoov-tts-'));
    const file = join(dir, 'narration.wav');
    try {
      const model = input.language === 'en' && this.options.modelEn ? this.options.modelEn : this.options.model;
      const child = run(this.options.bin, ['--model', model, '--output_file', file], { maxBuffer: 1024 * 1024 });
      child.child.stdin?.end(input.text);
      await child;
      const audio = await readFile(file);
      return { audio, contentType: 'audio/wav', durationSeconds: wavDurationSeconds(audio) };
    } catch (error) {
      throw new AppError('TTS_ERROR', `Piper en échec : ${error instanceof Error ? error.message : String(error)}`, 502);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}

export interface AzureTtsOptions {
  key: string;
  region: string;
  voiceFr?: string;
  voiceEn?: string;
  fetchImpl?: typeof fetch;
}

const escapeXml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export class AzureTtsProvider implements TtsProvider {
  readonly name = 'azure';
  readonly configured = true;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: AzureTtsOptions) {
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  }

  toJSON() {
    return { name: this.name, region: this.options.region, configured: true };
  }

  async synthesize(input: { text: string; language: ContentLanguage }) {
    const voice = input.language === 'en' ? (this.options.voiceEn ?? 'en-CA-ClaraNeural') : (this.options.voiceFr ?? 'fr-CA-SylvieNeural');
    const lang = input.language === 'en' ? 'en-CA' : 'fr-CA';
    const ssml = `<speak version="1.0" xml:lang="${lang}"><voice name="${voice}">${escapeXml(input.text)}</voice></speak>`;
    let response: Response;
    try {
      response = await this.fetchImpl(`https://${this.options.region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
        method: 'POST',
        headers: { 'Ocp-Apim-Subscription-Key': this.options.key, 'content-type': 'application/ssml+xml', 'x-microsoft-outputformat': 'riff-24khz-16bit-mono-pcm', 'user-agent': 'neomoov-marketing' },
        body: ssml,
        signal: AbortSignal.timeout(120_000),
      });
    } catch (error) {
      throw new AppError('TTS_ERROR', `Azure Speech injoignable : ${error instanceof Error ? error.message : String(error)}`, 502);
    }
    if (!response.ok) throw new AppError('TTS_ERROR', `Azure Speech ${response.status}`, 502);
    const audio = Buffer.from(await response.arrayBuffer());
    return { audio, contentType: 'audio/wav', durationSeconds: wavDurationSeconds(audio) };
  }
}
