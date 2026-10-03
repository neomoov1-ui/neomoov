'use client';

/**
 * Notes des clients d'un chauffeur dans sa fiche (Charte d'équité, D7) : les 50 dernières, exclues comprises ; une personne
 * habilitée (`fairness.appeals.decide`) en retire une du calcul avec un motif, la note du chauffeur est recalculée.
 * L'exclusion est rejouable et journalisée par l'API. Le client n'est jamais identifié.
 */
import type { AdminDriverRatingView } from '@neomoov/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Action, Badge, Card, DataTable, Dialog, Field, Notice, Textarea, focus, type Column } from '@/components/ui/kit';
import { formatDateTime } from '@/lib/format';
import { hubApi } from '@/lib/hub-api';
import type { Language } from '@/lib/i18n-resources';
import { ErrorBlock, Loading, useErrorText, useLang } from './common';

export function DriverRatingsCard({ driverId }: { driverId: string }) {
  const { t } = useTranslation();
  const lang = useLang();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const ratings = useQuery({ queryKey: ['hub', 'driver', driverId, 'ratings'], queryFn: () => hubApi.admin.driverRatings(driverId) });
  const [excluding, setExcluding] = useState<AdminDriverRatingView | null>(null);
  const [reason, setReason] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const exclude = useMutation({
    mutationFn: () => hubApi.admin.excludeRating(excluding!.id, reason.trim()),
    onSuccess: (result) => {
      setExcluding(null);
      setReason('');
      setDone(result.driverRating ? t('hub.ratings.done', { average: result.driverRating.average.toFixed(2), count: result.driverRating.count }) : t('hub.ratings.doneNoRating'));
      // La fiche (note moyenne) et la liste des notes sont relues.
      void queryClient.invalidateQueries({ queryKey: ['hub', 'driver', driverId] });
    },
  });
  return (
    <Card title={t('hub.ratings.title')}>
      <p className="mb-3 text-sm text-slate-700">{t('hub.ratings.intro')}</p>
      {done ? <div className="mb-3"><Notice tone="success">{done}</Notice></div> : null}
      {ratings.isPending ? <Loading /> : ratings.isError ? <ErrorBlock error={ratings.error} onRetry={() => void ratings.refetch()} /> : (
        <RatingsTable ratings={ratings.data} lang={lang} onExclude={(rating) => { setExcluding(rating); setReason(''); exclude.reset(); }} />
      )}
      <Dialog open={excluding !== null} title={t('hub.ratings.exclude')} onClose={() => setExcluding(null)}>
        <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); if (reason.trim().length >= 3) exclude.mutate(); }}>
          {excluding ? <p className="text-sm"><strong>{t('hub.ratings.scoreOf', { score: excluding.score })}</strong> · {excluding.ridePublicNumber}{excluding.comment ? ` · ${excluding.comment}` : ''}</p> : null}
          <Field label={t('hub.ratings.reason')} hint={t('hub.ratings.reasonHint')}>{(p) => <Textarea {...p} required minLength={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
          {exclude.isError ? <Notice tone="danger">{errorText(exclude.error)}</Notice> : null}
          <div className="flex justify-end gap-2">
            <Action tone="secondary" onClick={() => setExcluding(null)}>{t('hub.common.cancel')}</Action>
            <Action type="submit" busy={exclude.isPending} disabled={reason.trim().length < 3}>{t('hub.ratings.exclude')}</Action>
          </div>
        </form>
      </Dialog>
    </Card>
  );
}

/** Tableau des notes ; sans `onExclude`, lecture seule. Exporté pour les tests de rendu. */
export function RatingsTable({ ratings, lang, onExclude }: { ratings: AdminDriverRatingView[]; lang: Language; onExclude?: (rating: AdminDriverRatingView) => void }) {
  const { t } = useTranslation();
  const columns: Column<AdminDriverRatingView>[] = [
    { key: 'date', header: t('hub.ratings.date'), cell: (r) => formatDateTime(r.createdAt, lang) },
    { key: 'ride', header: t('hub.ratings.ride'), cell: (r) => <Link href={`/hub/courses/${r.rideId}`} className={`text-brand-blue-dark underline ${focus}`}>{r.ridePublicNumber}</Link> },
    { key: 'score', header: t('hub.ratings.score'), cell: (r) => <span className="font-semibold">{t('hub.ratings.scoreOf', { score: r.score })}</span> },
    {
      key: 'comment', header: t('hub.ratings.comment'), cell: (r) => (
        <span className="block max-w-80 text-xs">
          {r.tags.length ? <span className="block">{r.tags.map((tag) => t(`hub.ratings.tags.${tag}`, { defaultValue: tag })).join(', ')}</span> : null}
          {r.comment ? <span className="block whitespace-pre-wrap">{r.comment}</span> : null}
        </span>
      ),
    },
    {
      key: 'status', header: t('hub.ratings.status'), cell: (r) => (r.excludedAt ? (
        <span><Badge tone="warning">{t('hub.ratings.excluded')}</Badge><span className="mt-1 block text-xs text-slate-700">{formatDateTime(r.excludedAt, lang)}{r.excludedReason ? ` · ${r.excludedReason}` : ''}</span></span>
      ) : <Badge tone="success">{t('hub.ratings.counted')}</Badge>),
    },
    { key: 'action', header: <span className="sr-only">{t('hub.common.actions')}</span>, cell: (r) => (onExclude && !r.excludedAt ? <Action tone="secondary" onClick={() => onExclude(r)}>{t('hub.ratings.exclude')}</Action> : null) },
  ];
  return <DataTable caption={t('hub.ratings.title')} columns={columns} rows={ratings} rowKey={(r) => r.id} empty={t('hub.ratings.empty')} />;
}
