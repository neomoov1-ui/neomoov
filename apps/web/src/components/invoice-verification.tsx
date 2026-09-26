'use client';

/**
 * Vérification publique d'une facture par son code QR (`/verifier-facture?t=<jeton>`, section 5.13) : le jeton signé est
 * vérifié par l'API ; seul le minimum s'affiche (numéro, nature, date, fournisseur, total, état de l'enregistrement des ventes).
 */
import type { InvoiceVerification } from '@neomoov/domain';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Badge, Card, Notice } from '@/components/ui/kit';
import { formatDateTime, formatMoney } from '@/lib/format';
import type { Language } from '@/lib/i18n-resources';
import { ApiError, publicApi } from '@/lib/site-api';

const TOKEN = /^[A-Za-z0-9_-]{44}$/;

export function InvoiceVerificationView({ token }: { token: string | null }) {
  const { t, i18n } = useTranslation();
  const lang: Language = i18n.language === 'en' ? 'en' : 'fr-CA';
  const valid = token !== null && TOKEN.test(token);
  const check = useQuery<InvoiceVerification>({
    queryKey: ['verify-invoice', token],
    queryFn: () => publicApi.invoicing.verify(token!),
    enabled: valid,
    retry: (count, error) => !(error instanceof ApiError && (error.status === 404 || error.status === 400)) && count < 2,
  });

  const body = !valid
    ? <Notice tone="warning">{t(token ? 'verifyInvoice.invalid' : 'verifyInvoice.missing')}</Notice>
    : check.isPending
      ? <p role="status">{t('common.loading')}</p>
      : check.isError
        ? <Notice tone="danger">{t('verifyInvoice.invalid')}</Notice>
        : (
          <Card>
            <div className="mb-3"><Badge tone="success">{t('verifyInvoice.valid')}</Badge></div>
            <dl className="grid grid-cols-[11rem_1fr] gap-x-3 gap-y-2 text-sm">
              <dt className="font-semibold">{t('verifyInvoice.number')}</dt><dd><code>{check.data.number}</code></dd>
              <dt className="font-semibold">{t('verifyInvoice.kind')}</dt><dd>{t(`enum.invoiceKind.${check.data.kind}`)}</dd>
              <dt className="font-semibold">{t('verifyInvoice.issued')}</dt><dd>{formatDateTime(check.data.issuedAt, lang)}</dd>
              <dt className="font-semibold">{t('verifyInvoice.supplier')}</dt><dd>{check.data.supplierName}</dd>
              <dt className="font-semibold">{t('verifyInvoice.total')}</dt><dd>{formatMoney(check.data.totalCents, lang)}</dd>
              <dt className="font-semibold">{t('verifyInvoice.sev')}</dt><dd>{t(`enum.sevStatus.${check.data.sevStatus}`)}</dd>
            </dl>
          </Card>
        );

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 py-6">
      <div>
        <h1 className="text-2xl text-brand-night">{t('verifyInvoice.title')}</h1>
        <p className="text-sm text-slate-600">{t('verifyInvoice.subtitle')}</p>
      </div>
      {body}
    </div>
  );
}
