/**
 * Factures du client (5.13, 6.1 « Historique et reçus »), sans React Native (testé par vitest). L'API n'a pas de liste
 * des factures d'un client : chaque facture se lit par sa course (`GET /v1/rides/{id}/invoice`, 404 tant qu'aucune n'est
 * émise). Seules les courses closes qui peuvent en porter une sont interrogées (règle `invoiceKindForRide` du domaine).
 */
import type { RideInvoiceView, RideView } from '@neomoov/domain';

/** États qui peuvent porter une facture : course terminée, frais d'annulation ou de non-présentation. */
export const INVOICED_STATES: ReadonlyArray<RideView['state']> = ['completed', 'rated', 'disputed', 'cancelled_by_client', 'no_show'];

/** Courses dont on demande la facture, dans l'ordre de la liste (la plus récente d'abord). */
export function invoiceCandidates(rides: ReadonlyArray<Pick<RideView, 'id' | 'state'>>): string[] {
  return rides.filter((ride) => INVOICED_STATES.includes(ride.state)).map((ride) => ride.id);
}

/** Factures émises, la plus récente d'abord ; une course sans facture (null) n'apparaît pas. */
export function sortInvoices(invoices: ReadonlyArray<RideInvoiceView | null | undefined>): RideInvoiceView[] {
  return invoices.filter((invoice): invoice is RideInvoiceView => Boolean(invoice)).sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));
}

/** Nom du fichier enregistré sur l'appareil, sans caractère hors du numéro (NM-0001841). */
export function invoiceFileName(number: string): string {
  return `neomoov-${number.replace(/[^A-Za-z0-9-]/g, '')}.pdf`;
}

/** PDF protégé par le jeton d'accès : téléchargé avec ses en-têtes, jamais par un lien qui porterait le jeton. */
export interface ProtectedPdf {
  url: string;
  headers: Record<string, string>;
  fileName: string;
  /** Titre de la feuille de partage (Android). */
  title: string;
}

/** Aucun moyen d'afficher ou d'enregistrer un fichier sur cet appareil. */
export class PdfUnavailableError extends Error {
  constructor() {
    super('Partage de fichiers indisponible');
    this.name = 'PdfUnavailableError';
  }
}

/** Téléchargement refusé ou interrompu ; `status` : code HTTP quand il est connu (409 : PDF en préparation). */
export class PdfDownloadError extends Error {
  constructor(readonly status: number | null) {
    super(status ? `Téléchargement refusé (HTTP ${status})` : 'Téléchargement interrompu');
    this.name = 'PdfDownloadError';
  }
}

/** Code HTTP d'un échec de téléchargement natif (« response has status 409 », « server returned HTTP 409 »). */
export function downloadStatus(error: unknown): number | null {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const match = /(?:status|HTTP)\D{0,3}(\d{3})/i.exec(message);
  return match ? Number(match[1]) : null;
}
