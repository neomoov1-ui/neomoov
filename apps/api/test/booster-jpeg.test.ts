import { describe, expect, it } from 'vitest';
import { AppError } from '../src/common/app-error.js';
import { jpegKeyOf, pdfToJpeg } from '../src/modules/booster/pdf-to-jpeg.js';

describe('export JPEG des rapports Booster', () => {
  it('clé du JPEG à côté du PDF', () => {
    expect(jpegKeyOf('booster/inspections/abc/rapport.pdf')).toBe('booster/inspections/abc/rapport.jpg');
    expect(jpegKeyOf('booster/inspections/abc/RAPPORT.PDF')).toBe('booster/inspections/abc/RAPPORT.jpg');
    expect(jpegKeyOf('booster/x')).toBe('booster/x.jpg');
  });

  it('outil absent : erreur 503 JPEG_UNAVAILABLE, sans fichier temporaire laissé', async () => {
    const error = await pdfToJpeg(Buffer.from('%PDF-1.4'), { pdftoppm: 'neomoov-outil-absent-pdftoppm' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('JPEG_UNAVAILABLE');
    expect((error as AppError).status).toBe(503);
  });
});
