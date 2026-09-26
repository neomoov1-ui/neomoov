'use client';

import type { AdminBalance, AdminStatement, StatementGeneration } from '@neomoov/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EnumBadge, ErrorBlock, ListToolbar, Loading, pageLabels, useErrorText, useHubUser, useLang, usePagedList } from '@/components/hub/common';
import { Action, Card, DataTable, Field, Input, Notice, PageTitle, Pagination, focus, type Column } from '@/components/ui/kit';
import { formatDate, formatMoney } from '@/lib/format';
import { FINANCE_ROLES, hubApi } from '@/lib/hub-api';

/** Relevés hebdomadaires : génération ou aperçu d'une semaine, liste, soldes des chauffeurs (étape 9). */
export default function StatementsPage() {
  const { t } = useTranslation();
  const lang = useLang();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const finance = useHubUser().roles.some((r) => FINANCE_ROLES.includes(r));
  const [week, setWeek] = useState('');
  const [result, setResult] = useState<StatementGeneration | null>(null);
  const list = usePagedList<AdminStatement>('statements', (q) => hubApi.admin.statements(q));
  const balances = useQuery({ queryKey: ['hub', 'balances'], queryFn: () => hubApi.admin.balances() });
  const generate = useMutation({
    mutationFn: (preview: boolean) => hubApi.admin.generateStatements({ ...(week ? { periodStart: week } : {}), preview }),
    onSuccess: (data) => {
      setResult(data);
      if (!data.preview) void queryClient.invalidateQueries({ queryKey: ['hub', 'statements'] });
    },
  });

  const columns: Column<AdminStatement>[] = [
    { key: 'period', header: t('hub.statements.period'), cell: (s) => <Link className={`text-brand-blue-dark underline ${focus}`} href={`/hub/releves/${s.id}`}>{`${formatDate(s.periodStart, lang)} → ${formatDate(s.periodEnd, lang)}`}</Link> },
    { key: 'driver', header: t('hub.statements.driver'), cell: (s) => <Link className={`text-brand-blue-dark underline ${focus}`} href={`/hub/chauffeurs/${s.driverId}`}>{s.driverName ?? s.driverPublicNumber}</Link> },
    { key: 'status', header: t('hub.statements.status'), cell: (s) => <EnumBadge group="statementStatus" value={s.status} /> },
    { key: 'credits', header: t('hub.statements.credits'), className: 'text-right', cell: (s) => formatMoney(s.creditsCents, lang) },
    { key: 'debits', header: t('hub.statements.debits'), className: 'text-right', cell: (s) => formatMoney(s.debitsCents, lang) },
    { key: 'net', header: t('hub.statements.net'), className: 'text-right font-semibold', cell: (s) => formatMoney(s.netCents, lang) },
    { key: 'issued', header: t('hub.statements.issued'), cell: (s) => formatDate(s.issuedAt, lang) },
  ];
  const balanceColumns: Column<AdminBalance>[] = [
    { key: 'driver', header: t('hub.statements.driver'), cell: (b) => <Link className={`text-brand-blue-dark underline ${focus}`} href={`/hub/chauffeurs/${b.driverId}`}>{b.driverName ?? b.driverPublicNumber}</Link> },
    { key: 'balance', header: t('hub.statements.balance'), className: 'text-right font-semibold', cell: (b) => formatMoney(b.balanceCents, lang) },
    { key: 'unpaid', header: t('hub.statements.unpaidSince'), cell: (b) => formatDate(b.unpaidSince, lang) },
    { key: 'suspended', header: t('hub.statements.suspendedAt'), cell: (b) => formatDate(b.suspendedForBalanceAt, lang) },
    { key: 'last', header: t('hub.statements.view'), cell: (b) => (b.lastStatementId ? <Link className={`text-brand-blue-dark underline ${focus}`} href={`/hub/releves/${b.lastStatementId}`}>{t('hub.statements.view')}</Link> : null) },
  ];

  return (
    <div className="flex flex-col gap-5">
      <PageTitle title={t('hub.statements.title')} />
      <Notice tone="info">{t('hub.statements.generation')}</Notice>

      {finance ? (
        <Card title={t('hub.statements.generateTitle')}>
          <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); generate.mutate(false); }}>
            <Field label={t('hub.statements.week')} hint={t('hub.statements.weekHint')}>{(p) => <Input {...p} type="date" value={week} onChange={(e) => setWeek(e.target.value)} />}</Field>
            <Action tone="secondary" busy={generate.isPending && generate.variables === true} onClick={() => generate.mutate(true)}>{t('hub.statements.preview')}</Action>
            <Action type="submit" busy={generate.isPending && generate.variables === false}>{t('hub.statements.generate')}</Action>
          </form>
          {generate.isError ? <div className="mt-3"><Notice tone="danger">{errorText(generate.error)}</Notice></div> : null}
          {result ? (
            <div className="mt-3 flex flex-col gap-3">
              <Notice tone="success">
                {result.preview
                  ? t('hub.statements.previewDone', { count: result.statements.length, start: formatDate(result.periodStart, lang) })
                  : t('hub.statements.generatedDone', { generated: result.generated, skipped: result.skipped, start: formatDate(result.periodStart, lang) })}
              </Notice>
              {result.statements.length ? (
                <DataTable
                  caption={t('hub.statements.generateTitle')}
                  columns={[
                    { key: 'driver', header: t('hub.statements.driver'), cell: (s) => (s.id ? <Link className={`text-brand-blue-dark underline ${focus}`} href={`/hub/releves/${s.id}`}>{s.driverName ?? s.driverPublicNumber}</Link> : (s.driverName ?? s.driverPublicNumber)) },
                    { key: 'lines', header: t('hub.statements.lines'), className: 'text-right', cell: (s) => s.lines.length },
                    { key: 'credits', header: t('hub.statements.credits'), className: 'text-right', cell: (s) => formatMoney(s.creditsCents, lang) },
                    { key: 'debits', header: t('hub.statements.debits'), className: 'text-right', cell: (s) => formatMoney(s.debitsCents, lang) },
                    { key: 'net', header: t('hub.statements.net'), className: 'text-right font-semibold', cell: (s) => formatMoney(s.netCents, lang) },
                  ]}
                  rows={result.statements}
                  rowKey={(s) => s.id ?? s.driverId}
                  empty={t('hub.common.empty')}
                />
              ) : null}
            </div>
          ) : null}
        </Card>
      ) : null}

      <Card>
        <ListToolbar filters={list.filters} setQ={list.setQ} />
        {list.query.isPending ? <Loading /> : list.query.isError ? <ErrorBlock error={list.query.error} onRetry={() => void list.query.refetch()} /> : (
          <>
            <DataTable caption={t('hub.statements.title')} columns={columns} rows={list.query.data.items} rowKey={(s) => s.id} empty={t('hub.common.empty')} />
            <Pagination page={list.filters.page} pageSize={list.pageSize} total={list.query.data.total} onPage={list.setPage} labels={pageLabels(t, list.filters.page, list.pageSize, list.query.data.total)} />
          </>
        )}
      </Card>

      <Card title={t('hub.statements.balancesTitle')}>
        {balances.isPending ? <Loading /> : balances.isError ? <ErrorBlock error={balances.error} onRetry={() => void balances.refetch()} /> : (
          <DataTable caption={t('hub.statements.balancesTitle')} columns={balanceColumns} rows={balances.data} rowKey={(b) => b.driverId} empty={t('hub.statements.noBalance')} />
        )}
      </Card>
    </div>
  );
}
