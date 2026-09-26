/**
 * Facturation certifiée (prompt 09) : facture d'une course et son PDF, vérification publique d'un code QR, état des
 * transmissions au SEV et reprise pour My Hub. Types des schémas de `@neomoov/domain` ; aucune règle métier ici.
 */
import type { InvoiceVerification, RideInvoiceView, SevRetryResult, SevStatusReport } from '@neomoov/domain';
import type { Query } from './client.js';
import type { Transport } from './resources.js';

/** Le client complet : un PDF s'ouvre par son adresse (navigateur, visionneuse), il ne se lit pas en JSON. */
export interface UrlTransport extends Transport {
  url(path: string, query?: Query): string;
}

const id = (value: string) => encodeURIComponent(value);

export function invoicingResource(t: UrlTransport) {
  return {
    /** Facture de la course (client, chauffeur de la course, personnel) et ses notes de crédit ; 404 `INVOICE_NOT_FOUND` avant l'émission. */
    rideInvoice: (rideId: string) => t.get<RideInvoiceView>(`/rides/${id(rideId)}/invoice`),
    /**
     * Adresse du PDF de la facture, ou d'une note de crédit (`documentId`). Jeton d'accès requis : téléchargement
     * authentifié (en-tête `Authorization`) ; 409 `INVOICE_PDF_PENDING` tant qu'il est en préparation.
     */
    rideInvoicePdfUrl: (rideId: string, documentId?: string) => t.url(`/rides/${id(rideId)}/invoice/pdf`, documentId ? { documentId } : undefined),
    /** Vérification publique d'un code QR (sans compte) : numéro, date, fournisseur, total, état SEV. */
    verify: (token: string) => t.get<InvoiceVerification>(`/public/invoices/verify/${id(token)}`, { auth: false }),
    /** My Hub : factures par état de transmission, dernières erreurs, santé de l'adaptateur. */
    sevStatus: () => t.get<SevStatusReport>('/admin/sev/status'),
    /** My Hub : reprise d'une transmission en attente ou en erreur (409 si déjà accusée ou en cours). */
    retrySev: (invoiceId: string) => t.post<SevRetryResult>(`/admin/sev/retry/${id(invoiceId)}`),
    /** My Hub : adresse du PDF d'une facture ou d'une note de crédit (relais authentifié du web). */
    adminInvoicePdfUrl: (invoiceId: string) => t.url(`/admin/invoices/${id(invoiceId)}/pdf`),
  };
}
