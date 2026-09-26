import type { RideInvoiceView } from '@neomoov/domain';
import { Body, Button, Card } from '@neomoov/mobile-core/components';
import { spacing } from '@neomoov/mobile-core/theme';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Empty, ErrorState, Loading, Notice, Row, Screen } from '@/components/ui';
import { invoiceCandidates, invoiceFileName, PdfDownloadError, PdfUnavailableError } from '@/features/invoices/logic';
import { api, errorMessage } from '@/lib/api';
import { formatDateTime, formatMoney, type UiLanguage } from '@/lib/format';
import { openProtectedPdf } from '@/lib/invoice-pdf';
import { keys, queryClient, useRideInvoices, useRides } from '@/lib/queries';
import { useSession } from '@/lib/session';

/**
 * Mes factures (5.13, 6.1 « Historique et reçus ») : factures des courses et des frais d'annulation ou de
 * non-présentation, avec leurs notes de crédit, la plus récente d'abord. Chaque PDF est téléchargé avec le jeton
 * d'accès puis ouvert par la feuille de partage du système (aperçu, enregistrement, envoi, impression).
 */
export default function InvoicesScreen() {
  const { t, i18n } = useTranslation();
  const language = (i18n.language === 'en' ? 'en' : 'fr-CA') as UiLanguage;
  const rides = useRides();
  const result = useRideInvoices(invoiceCandidates(rides.data ?? []));
  const [opening, setOpening] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loading = rides.isLoading || (result.loading && result.invoices.length === 0);

  async function refresh() {
    setError(null);
    await rides.refetch();
    await queryClient.invalidateQueries({ queryKey: keys.invoices });
  }

  function downloadMessage(e: unknown): string {
    if (e instanceof PdfUnavailableError) return t('invoices.unavailable');
    if (e instanceof PdfDownloadError) {
      if (e.status === 409) return t('errors.codes.INVOICE_PDF_PENDING');
      if (e.status === 404) return t('errors.codes.INVOICE_NOT_FOUND');
      return e.status === null ? t('errors.network') : t('errors.generic');
    }
    return errorMessage(e);
  }

  /** Facture (sans `documentId`) ou l'une de ses notes de crédit. */
  async function open(invoice: RideInvoiceView, documentId?: string, number = invoice.number) {
    setOpening(documentId ?? invoice.id);
    setError(null);
    try {
      // Facture relue d'abord : jeton d'accès rafraîchi au besoin par le client de l'API, PDF confirmé prêt.
      const fresh = await api.invoicing.rideInvoice(invoice.rideId);
      queryClient.setQueryData(keys.invoice(invoice.rideId), fresh);
      if (!documentId && !fresh.pdfAvailable) {
        setError(t('invoices.pending'));
        return;
      }
      const token = useSession.getState().accessToken;
      await openProtectedPdf({
        url: api.invoicing.rideInvoicePdfUrl(invoice.rideId, documentId),
        headers: { accept: 'application/pdf', 'accept-language': language, 'x-client-app': 'mobile-client', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        fileName: invoiceFileName(number),
        title: t('invoices.shareTitle', { number }),
      });
    } catch (e) {
      setError(downloadMessage(e));
    } finally {
      setOpening(null);
    }
  }

  return (
    <Screen back title={t('invoices.title')} onRefresh={() => void refresh()} refreshing={rides.isRefetching}>
      <Body muted>{t('invoices.intro')}</Body>
      {loading ? <Loading /> : null}
      {rides.isError ? <ErrorState message={errorMessage(rides.error)} onRetry={() => void refresh()} /> : null}
      {result.failed ? <Notice tone="warning">{t('invoices.partial')}</Notice> : null}
      {error ? <ErrorState message={error} /> : null}
      {!loading && !rides.isError && !result.failed && result.invoices.length === 0 ? <Empty message={t('invoices.empty')} /> : null}
      {result.invoices.map((invoice) => (
        <Card key={invoice.id} style={styles.card}>
          <Row label={`${t(`invoices.kinds.${invoice.kind}`)} · ${invoice.number}`} value={formatMoney(invoice.totalCents, language)} strong />
          <Body muted>{t('invoices.issued', { date: formatDateTime(invoice.issuedAt, language) })}</Body>
          <Body muted>{`${invoice.trip.originAddress} → ${invoice.trip.destinationAddress}`}</Body>
          {invoice.pdfAvailable ? (
            <Button label={opening === invoice.id ? t('invoices.opening') : t('invoices.open')} variant="secondary" onPress={() => void open(invoice)} disabled={opening !== null} />
          ) : (
            <Notice>{t('invoices.pending')}</Notice>
          )}
          {invoice.creditNotes.map((note) => (
            <View key={note.id} style={styles.note}>
              <Body>{t('invoices.creditNote', { number: note.number, amount: formatMoney(note.totalCents, language) })}</Body>
              <Button label={opening === note.id ? t('invoices.opening') : t('invoices.openCreditNote')} variant="ghost" onPress={() => void open(invoice, note.id, note.number)} disabled={opening !== null} />
            </View>
          ))}
        </Card>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.xs },
  note: { gap: spacing.xs, paddingTop: spacing.xs },
});
