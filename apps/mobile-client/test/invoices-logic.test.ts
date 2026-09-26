import type { RideInvoiceView, RideView } from '@neomoov/domain';
import { describe, expect, it } from 'vitest';
import { downloadStatus, invoiceCandidates, invoiceFileName, PdfDownloadError, sortInvoices } from '../src/features/invoices/logic';

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
});
