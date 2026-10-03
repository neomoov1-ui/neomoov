import type { RideInvoiceView, RideView } from '@neomoov/domain';
import { describe, expect, it } from 'vitest';
import { createLimiter, downloadStatus, INVOICE_CONCURRENCY, INVOICE_PAGE_SIZE, invoiceCandidates, invoiceFileName, PdfDownloadError, sortInvoices, visibleCandidates } from '../src/features/invoices/logic';

const ride = (id: string, state: RideView['state']): Pick<RideView, 'id' | 'state'> => ({ id, state });

/** Facture réduite aux champs utiles au tri (le reste n'intervient pas). */
const invoice = (number: string, issuedAt: string) => ({ id: number, number, issuedAt }) as unknown as RideInvoiceView;

describe('factures du client', () => {
  it('interroge seulement les courses qui peuvent porter une facture, dans leur ordre', () => {
    const rides = [ride('a', 'completed'), ride('b', 'offering'), ride('c', 'cancelled_by_client'), ride('d', 'no_driver'), ride('e', 'no_show'), ride('f', 'rated'), ride('g', 'disputed'), ride('h', 'expired')];
    expect(invoiceCandidates(rides)).toEqual(['a', 'c', 'e', 'f', 'g']);
    expect(invoiceCandidates([])).toEqual([]);
  });

  it('retire les courses sans facture et trie de la plus récente à la plus ancienne', () => {
    const list = sortInvoices([invoice('NM-0000001', '2026-09-20T10:00:00.000Z'), null, undefined, invoice('NM-0000003', '2026-09-25T08:00:00.000Z'), invoice('NM-0000002', '2026-09-22T12:00:00.000Z')]);
    expect(list.map((i) => i.number)).toEqual(['NM-0000003', 'NM-0000002', 'NM-0000001']);
  });

  it('nom de fichier sûr, tiré du numéro', () => {
    expect(invoiceFileName('NM-0001841')).toBe('neomoov-NM-0001841.pdf');
    expect(invoiceFileName('NM-00/../01841')).toBe('neomoov-NM-0001841.pdf');
  });

  it('code HTTP d\'un téléchargement natif refusé (iOS et Android)', () => {
    expect(downloadStatus(new Error('response has status 409'))).toBe(409);
    expect(downloadStatus(new Error('server returned HTTP 404'))).toBe(404);
    expect(downloadStatus(new Error('Unable to download: response has status: 401'))).toBe(401);
    expect(downloadStatus(new Error('The Internet connection appears to be offline.'))).toBeNull();
    expect(downloadStatus('inconnu')).toBeNull();
    expect(new PdfDownloadError(409).status).toBe(409);
  });

  it('10 courses par page ouverte, dans l\'ordre de la liste', () => {
    const ids = Array.from({ length: 23 }, (_, i) => `r${i}`);
    expect(INVOICE_PAGE_SIZE).toBe(10);
    expect(visibleCandidates(ids, 1)).toEqual(ids.slice(0, 10));
    expect(visibleCandidates(ids, 2)).toEqual(ids.slice(0, 20));
    expect(visibleCandidates(ids, 3)).toEqual(ids);
    expect(visibleCandidates(ids, 0)).toEqual(ids.slice(0, 10));
  });

  it('5 requêtes au plus en même temps, les suivantes dans l\'ordre, même après un échec', async () => {
    const limit = createLimiter(INVOICE_CONCURRENCY);
    let running = 0;
    let peak = 0;
    const started: number[] = [];
    const releases: Array<() => void> = [];
    const task = (i: number) => () =>
      new Promise<number>((resolve, reject) => {
        started.push(i);
        running += 1;
        peak = Math.max(peak, running);
        releases[i] = () => {
          running -= 1;
          if (i === 2) reject(new Error('panne'));
          else resolve(i);
        };
      });
    const results = Array.from({ length: 12 }, (_, i) => limit(task(i)).catch((e: Error) => e.message));
    await Promise.resolve();
    expect(started).toEqual([0, 1, 2, 3, 4]);
    for (let i = 0; i < 12; i += 1) {
      await new Promise((r) => setTimeout(r, 0));
      releases[i]?.();
    }
    const values = await Promise.all(results);
    expect(peak).toBe(5);
    expect(started).toEqual(Array.from({ length: 12 }, (_, i) => i));
    expect(values[2]).toBe('panne');
    expect(values[11]).toBe(11);
  });
});
