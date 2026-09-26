'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ErrorBlock, Loading, useLang } from '@/components/hub/common';
import { Badge, Card, DataTable, PageTitle } from '@/components/ui/kit';
import { formatDate, formatMoney } from '@/lib/format';
import { hubApi } from '@/lib/hub-api';

/** Catalogue des packs de courses et promotions (lecture en V1 ; création et budgets à l'étape 8). */
export default function OffersPage() {
  const { t } = useTranslation();
  const lang = useLang();
  const packs = useQuery({ queryKey: ['hub', 'packs'], queryFn: () => hubApi.admin.packs() });
  const promotions = useQuery({ queryKey: ['hub', 'promotions'], queryFn: () => hubApi.admin.promotions() });
  const yes = (v: boolean) => (v ? <Badge tone="success">{t('hub.common.yes')}</Badge> : <Badge>{t('hub.common.no')}</Badge>);
  return (
    <div className="flex flex-col gap-5">
      <PageTitle title={t('hub.nav.offers')} subtitle={t('hub.common.nextStep', { step: 8 })} />
      <Card title={t('hub.offers.packs')}>
        {packs.isPending ? <Loading /> : packs.isError ? <ErrorBlock error={packs.error} /> : (
          <DataTable
            rows={packs.data}
            rowKey={(p) => p.code}
            empty={t('hub.common.empty')}
            columns={[
              { key: 'code', header: t('hub.offers.code'), cell: (p) => p.code },
              { key: 'name', header: t('hub.offers.name'), cell: (p) => p.name },
              { key: 'rides', header: t('hub.offers.rides'), className: 'text-right', cell: (p) => p.ridesIncluded ?? '∞' },
              { key: 'price', header: t('hub.offers.price'), className: 'text-right', cell: (p) => formatMoney(p.priceCents, lang) },
              { key: 'validity', header: t('hub.offers.validity'), className: 'text-right', cell: (p) => `${p.validityDays} j` },
              { key: 'active', header: t('hub.offers.active'), cell: (p) => yes(p.active) },
            ]}
          />
        )}
      </Card>
      <Card title={t('hub.offers.promotions')}>
        {promotions.isPending ? <Loading /> : promotions.isError ? <ErrorBlock error={promotions.error} /> : (
          <DataTable
            rows={promotions.data}
            rowKey={(p) => p.id}
            empty={t('hub.common.empty')}
            columns={[
              { key: 'code', header: t('hub.offers.code'), cell: (p) => <code>{p.code}</code> },
              { key: 'name', header: t('hub.offers.name'), cell: (p) => p.name },
              { key: 'type', header: t('hub.offers.type'), cell: (p) => p.type },
              { key: 'value', header: t('hub.offers.value'), className: 'text-right', cell: (p) => p.value },
              { key: 'spent', header: t('hub.offers.spent'), className: 'text-right', cell: (p) => formatMoney(p.spentCents, lang) },
              { key: 'budget', header: t('hub.offers.budget'), className: 'text-right', cell: (p) => (p.budgetCents === null ? '' : formatMoney(p.budgetCents, lang)) },
              { key: 'validity', header: t('hub.offers.validity'), cell: (p) => `${formatDate(p.validFrom, lang)}${p.validTo ? ` → ${formatDate(p.validTo, lang)}` : ''}` },
              { key: 'active', header: t('hub.offers.active'), cell: (p) => yes(p.active) },
            ]}
          />
        )}
      </Card>
    </div>
  );
}
