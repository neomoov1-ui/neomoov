'use client';

import type { ContentItemView, ContentUpdateInput, CtaTarget, MarketingSpaceView, SeoTaskView } from '@neomoov/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EnumBadge, ErrorBlock, Loading, useCanWrite, useErrorText, useLang } from '@/components/hub/common';
import { Action, Badge, Card, DataTable, Dialog, Field, Input, Notice, PageTitle, Select, Textarea, type BadgeTone, type Column } from '@/components/ui/kit';
import { formatDateTime, montrealDate } from '@/lib/format';
import { hubApi } from '@/lib/hub-api';

const CTA: CtaTarget[] = ['reserve', 'academy', 'preregister', 'none'];
const STATUS_TONES: Record<string, BadgeTone> = { draft: 'neutral', approved: 'info', scheduled: 'info', published: 'success', failed: 'danger', measured: 'success', rejected: 'danger' };
const ACTIONABLE = ['draft', 'failed', 'rejected'];

/** Lundi de la semaine qui contient une date locale AAAA-MM-JJ. */
function mondayOf(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
function shiftDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Marketing automatisé (phase 1 « entreprise autonome ») : calendrier par espace, approbation en un clic, aperçu, mesures ; référencement ; espaces. */
export default function MarketingPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'calendar' | 'seo' | 'spaces'>('calendar');
  return (
    <div className="flex flex-col gap-5">
      <PageTitle title={t('hub.marketing.title')} subtitle={t('hub.marketing.subtitle')} />
      <div className="flex flex-wrap gap-2" role="tablist">
        {(['calendar', 'seo', 'spaces'] as const).map((key) => (
          <Action key={key} role="tab" aria-selected={tab === key} tone={tab === key ? 'primary' : 'secondary'} onClick={() => setTab(key)}>{t(`hub.marketing.tabs.${key}`)}</Action>
        ))}
      </div>
      {tab === 'calendar' ? <CalendarTab /> : tab === 'seo' ? <SeoTab /> : <SpacesTab />}
    </div>
  );
}

function CalendarTab() {
  const { t } = useTranslation();
  const lang = useLang();
  const writable = useCanWrite();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const [week, setWeek] = useState(mondayOf(montrealDate()));
  const [space, setSpace] = useState('');
  const [editing, setEditing] = useState<ContentItemView | null>(null);
  const [preview, setPreview] = useState<ContentItemView | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const items = useQuery({ queryKey: ['hub', 'marketing-content', week, space], queryFn: () => hubApi.marketing.content({ week, ...(space ? { space: space as ContentItemView['space'] } : {}) }) });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['hub', 'marketing-content'] });
  const plan = useMutation({
    mutationFn: () => hubApi.marketing.planContent({ weekStart: week }),
    onSuccess: (r) => { setMessage(r.replayed ? t('hub.marketing.replayed') : t('hub.marketing.planned', { created: r.created, autoApproved: r.autoApproved })); refresh(); },
  });
  const decide = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'approve' | 'reject' | 'publish' }) => (action === 'approve' ? hubApi.marketing.approveItem(id) : action === 'publish' ? hubApi.marketing.publishItem(id) : hubApi.marketing.rejectItem(id, reasons[id]?.trim() ?? '')),
    onSuccess: () => { setMessage(t('hub.marketing.decided')); refresh(); },
  });

  const columns: Column<ContentItemView>[] = [
    { key: 'slot', header: t('hub.marketing.slot'), cell: (i) => <span className="text-xs">{formatDateTime(i.scheduledAt, lang)}</span> },
    { key: 'space', header: t('hub.marketing.space'), cell: (i) => <span>{t(`enum.contentSpace.${i.space}`)}<span className="block text-xs text-slate-600">{t(`enum.contentFormat.${i.format}`)} · {i.language.toUpperCase()}</span></span> },
    {
      key: 'text', header: t('hub.marketing.preview'), cell: (i) => (
        <span className="block max-w-96">
          {i.title ? <strong className="block">{i.title}</strong> : null}
          <span className="line-clamp-3 whitespace-pre-line text-sm">{i.caption ?? i.body}</span>
          {i.hashtags.length ? <span className="block text-xs text-brand-blue-dark">{i.hashtags.join(' ')}</span> : null}
          <span className="mt-1 flex flex-wrap gap-1">
            {i.sensitive ? <Badge tone="warning">{t('hub.marketing.sensitive')}</Badge> : null}
            {i.issues.some((x) => x.blocking) ? <Badge tone="danger">{t('hub.marketing.blocked')}</Badge> : null}
            {i.issues.map((x) => <span key={`${x.kind}-${x.detail}`} className="text-xs text-red-800">{x.detail}</span>)}
          </span>
        </span>
      ),
    },
    {
      key: 'status', header: t('hub.marketing.status'), cell: (i) => (
        <span className="flex flex-col gap-1">
          <Badge tone={STATUS_TONES[i.status] ?? 'neutral'}>{t(`enum.contentStatus.${i.status}`)}</Badge>
          <span className="text-xs text-slate-600">{t(`enum.mediaStatus.${i.mediaStatus}`)}</span>
          {i.externalUrl ? <a href={i.externalUrl} target="_blank" rel="noreferrer" className="text-xs text-brand-blue-dark underline">{t('hub.marketing.externalLink')}</a> : null}
          {i.lastError ? <span className="max-w-56 text-xs text-red-800">{i.lastError}</span> : null}
          {i.rejectedReason ? <span className="max-w-56 text-xs text-slate-700">{i.rejectedReason}</span> : null}
        </span>
      ),
    },
    {
      key: 'metrics', header: t('hub.marketing.metrics'), cell: (i) => (i.metrics.measuredAt ? (
        <span className="text-xs">{t('hub.marketing.reach')} {i.metrics.reach} · {t('hub.marketing.interactions')} {i.metrics.interactions} · {t('hub.marketing.clicks')} {i.metrics.clicks}<span className="block text-slate-600">{t('hub.marketing.measuredAt')} {formatDateTime(i.metrics.measuredAt, lang)}</span>{i.comments.length ? <span className="block">{t('hub.marketing.comments')} : {i.comments.length}</span> : null}</span>
      ) : <span className="text-xs text-slate-600">{i.status === 'published' ? t('hub.marketing.notMeasured') : ''}</span>),
    },
    {
      key: 'act', header: t('hub.common.actions'), cell: (i) => (
        <div className="flex min-w-48 flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <Action tone="secondary" onClick={() => setPreview(i)}>{t('hub.marketing.preview')}</Action>
            {writable && ['draft', 'approved', 'scheduled', 'failed'].includes(i.status) ? <Action tone="secondary" onClick={() => setEditing(i)}>{t('hub.marketing.edit')}</Action> : null}
          </div>
          {writable && ACTIONABLE.includes(i.status) ? <Action busy={decide.isPending && decide.variables?.id === i.id} onClick={() => decide.mutate({ id: i.id, action: 'approve' })}>{t('hub.marketing.approve')}</Action> : null}
          {writable && i.status === 'scheduled' ? <Action busy={decide.isPending && decide.variables?.id === i.id} onClick={() => decide.mutate({ id: i.id, action: 'publish' })}>{t('hub.marketing.publishNow')}</Action> : null}
          {writable && ['draft', 'approved', 'scheduled', 'failed'].includes(i.status) ? (
            <>
              <Field label={t('hub.marketing.rejectReason')}>{(p) => <Input {...p} maxLength={500} value={reasons[i.id] ?? ''} onChange={(e) => setReasons({ ...reasons, [i.id]: e.target.value })} />}</Field>
              <Action tone="danger" disabled={(reasons[i.id]?.trim().length ?? 0) < 3} onClick={() => decide.mutate({ id: i.id, action: 'reject' })}>{t('hub.marketing.reject')}</Action>
            </>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <>
      <Card
        title={`${t('hub.marketing.week')} ${week}`}
        actions={(
          <div className="flex flex-wrap items-end gap-2">
            <Action tone="secondary" onClick={() => setWeek(shiftDays(week, -7))}>{t('hub.marketing.previousWeek')}</Action>
            <Action tone="secondary" onClick={() => setWeek(shiftDays(week, 7))}>{t('hub.marketing.nextWeek')}</Action>
            <Field label={t('hub.marketing.space')}>
              {(p) => (
                <Select {...p} value={space} onChange={(e) => setSpace(e.target.value)}>
                  <option value="">{t('hub.marketing.allSpaces')}</option>
                  {(['site_blog', 'academy', 'google_business', 'facebook', 'instagram', 'linkedin', 'tiktok', 'youtube', 'x', 'snapchat', 'newsletter'] as const).map((s) => <option key={s} value={s}>{t(`enum.contentSpace.${s}`)}</option>)}
                </Select>
              )}
            </Field>
            {writable ? <Action busy={plan.isPending} onClick={() => plan.mutate()}>{t('hub.marketing.plan')}</Action> : null}
          </div>
        )}
      >
        {message ? <div className="mb-3"><Notice tone="success">{message}</Notice></div> : null}
        {plan.isError ? <div className="mb-3"><Notice tone="danger">{errorText(plan.error)}</Notice></div> : null}
        {decide.isError ? <div className="mb-3"><Notice tone="danger">{errorText(decide.error)}</Notice></div> : null}
        {items.isPending ? <Loading /> : items.isError ? <ErrorBlock error={items.error} onRetry={() => void items.refetch()} /> : (
          <DataTable caption={t('hub.marketing.title')} columns={columns} rows={items.data} rowKey={(i) => i.id} empty={t('hub.marketing.empty')} />
        )}
      </Card>
      {editing ? <EditDialog item={editing} onClose={() => setEditing(null)} onSaved={() => { setMessage(t('hub.marketing.saved')); refresh(); }} /> : null}
      {preview ? <PreviewDialog item={preview} onClose={() => setPreview(null)} /> : null}
    </>
  );
}

/** Aperçu : texte complet, visuel (PNG, vidéo ou gabarit HTML lu par la passerelle), commentaires et réponses. */
function PreviewDialog({ item, onClose }: { item: ContentItemView; onClose: () => void }) {
  const { t } = useTranslation();
  const lang = useLang();
  const [file, setFile] = useState<{ url: string; type: string } | null>(null);
  useEffect(() => {
    if (item.mediaStatus === 'none' || item.mediaStatus === 'pending' || item.mediaStatus === 'failed') return;
    let url: string | null = null;
    fetch(`/api/v1${hubApi.marketing.mediaPath(item.id)}`, { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) return;
        const blob = await res.blob();
        url = URL.createObjectURL(blob);
        setFile({ url, type: blob.type });
      })
      .catch(() => setFile(null));
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [item]);
  return (
    <Dialog open title={`${t(`enum.contentSpace.${item.space}`)} · ${t(`enum.contentFormat.${item.format}`)}`} onClose={onClose} wide>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="text-sm">
          {item.title ? <p className="font-semibold text-brand-night">{item.title}</p> : null}
          <p className="mt-2 whitespace-pre-line">{item.body}</p>
          {item.caption ? <p className="mt-2 italic">{item.caption}</p> : null}
          {item.hashtags.length ? <p className="mt-2 text-brand-blue-dark">{item.hashtags.join(' ')}</p> : null}
          <p className="mt-2 text-xs text-slate-600">{t('hub.marketing.fieldCta')} : {t(`hub.marketing.cta.${item.cta}`)} · {t('hub.marketing.attempts')} : {item.attempts}</p>
          <h3 className="mt-4 font-semibold">{t('hub.marketing.comments')}</h3>
          {item.comments.length === 0 ? <p className="text-xs text-slate-600">{t('hub.marketing.noComments')}</p> : (
            <ul className="mt-1 flex flex-col gap-2">
              {item.comments.map((c) => (
                <li key={c.id} className="rounded-md border border-slate-200 p-2 text-xs">
                  <p><strong>{c.author ?? '?'}</strong> · {formatDateTime(c.postedAt, lang)} · <EnumBadge group="commentOutcome" value={c.outcome} /></p>
                  <p className="mt-1">{c.body}</p>
                  {c.replyBody ? <p className="mt-1 text-slate-700">{t('hub.marketing.reply')} : {c.replyBody}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="min-h-48 rounded-md bg-slate-100 p-2">
          {item.mediaStatus === 'pending' ? <Notice tone="info">{t('hub.marketing.mediaPending')}</Notice> : item.mediaStatus === 'none' || item.mediaStatus === 'failed' ? <Notice tone="warning">{t('hub.marketing.noMedia')}</Notice> : !file ? <p className="p-4 text-sm">{t('hub.common.loading')}</p> : file.type.startsWith('image/') ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={file.url} alt={item.visualHeadline ?? ''} className="mx-auto max-h-[60vh] w-auto" />
          ) : file.type.startsWith('video/') ? (
            <video src={file.url} controls className="mx-auto max-h-[60vh] w-auto" />
          ) : (
            <iframe src={file.url} title={t('hub.marketing.mediaHtml')} className="h-[60vh] w-full bg-white" sandbox="" />
          )}
        </div>
      </div>
    </Dialog>
  );
}

function EditDialog({ item, onClose, onSaved }: { item: ContentItemView; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const [title, setTitle] = useState(item.title ?? '');
  const [body, setBody] = useState(item.body);
  const [caption, setCaption] = useState(item.caption ?? '');
  const [hashtags, setHashtags] = useState(item.hashtags.join(' '));
  const [cta, setCta] = useState<CtaTarget>(item.cta);
  const [headline, setHeadline] = useState(item.visualHeadline ?? '');
  const save = useMutation({
    mutationFn: () => {
      const input: ContentUpdateInput = { title: title.trim() || null, body: body.trim(), caption: caption.trim() || null, hashtags: hashtags.split(/\s+/).filter(Boolean), cta, visualHeadline: headline.trim() || null };
      return hubApi.marketing.updateItem(item.id, input);
    },
    onSuccess: () => { onSaved(); onClose(); },
  });
  return (
    <Dialog open title={t('hub.marketing.editTitle')} onClose={onClose} wide>
      <div className="flex flex-col gap-3">
        <Notice tone="info">{t('hub.marketing.editHint')}</Notice>
        {save.isError ? <Notice tone="danger">{errorText(save.error)}</Notice> : null}
        <Field label={t('hub.marketing.fieldTitle')}>{(p) => <Input {...p} maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />}</Field>
        <Field label={t('hub.marketing.fieldBody')}>{(p) => <Textarea {...p} rows={8} value={body} onChange={(e) => setBody(e.target.value)} />}</Field>
        <Field label={t('hub.marketing.fieldCaption')}>{(p) => <Textarea {...p} rows={2} maxLength={2200} value={caption} onChange={(e) => setCaption(e.target.value)} />}</Field>
        <Field label={t('hub.marketing.fieldHashtags')}>{(p) => <Input {...p} value={hashtags} onChange={(e) => setHashtags(e.target.value)} />}</Field>
        <Field label={t('hub.marketing.fieldHeadline')}>{(p) => <Input {...p} maxLength={160} value={headline} onChange={(e) => setHeadline(e.target.value)} />}</Field>
        <Field label={t('hub.marketing.fieldCta')}>{(p) => <Select {...p} value={cta} onChange={(e) => setCta(e.target.value as CtaTarget)}>{CTA.map((c) => <option key={c} value={c}>{t(`hub.marketing.cta.${c}`)}</option>)}</Select>}</Field>
        <div className="flex justify-end gap-2">
          <Action tone="secondary" onClick={onClose}>{t('hub.common.cancel')}</Action>
          <Action busy={save.isPending} disabled={!body.trim()} onClick={() => save.mutate()}>{t('hub.common.save')}</Action>
        </div>
      </div>
    </Dialog>
  );
}

function SeoTab() {
  const { t } = useTranslation();
  const lang = useLang();
  const writable = useCanWrite();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState('');
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const tasks = useQuery({ queryKey: ['hub', 'marketing-seo', status], queryFn: () => hubApi.marketing.seoTasks(status ? { status } : {}) });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['hub', 'marketing-seo'] });
  const plan = useMutation({ mutationFn: () => hubApi.marketing.planSeo({}), onSuccess: (r) => { setMessage(r.replayed ? t('hub.marketing.replayed') : t('hub.marketing.seoPlanned', { created: r.created, applied: r.applied })); refresh(); } });
  const decide = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'approve' | 'reject' }) => (action === 'approve' ? hubApi.marketing.approveSeoTask(id) : hubApi.marketing.rejectSeoTask(id, reasons[id]?.trim() ?? '')),
    onSuccess: () => { setMessage(t('hub.marketing.decided')); refresh(); },
  });
  const metricsText = (m: SeoTaskView['metricsBefore']) => (m ? `${m.clicks} ${t('hub.marketing.clicks').toLowerCase()} · ${m.impressions} ${t('hub.marketing.impressions')}${m.position !== null ? ` · ${t('hub.marketing.position')} ${m.position}` : ''}` : '');
  const columns: Column<SeoTaskView>[] = [
    { key: 'created', header: t('hub.common.from'), cell: (s) => <span className="text-xs">{formatDateTime(s.createdAt, lang)}</span> },
    { key: 'action', header: t('hub.marketing.action'), cell: (s) => <span><EnumBadge group="seoAction" value={s.action} /><span className="block text-xs text-slate-600">{s.keyword ?? ''}</span></span> },
    { key: 'target', header: t('hub.marketing.target'), cell: (s) => <span className="text-xs">{s.targetTitle ?? '—'}{s.targetUrl ? <a href={s.targetUrl} target="_blank" rel="noreferrer" className="block text-brand-blue-dark underline">{s.targetUrl}</a> : null}{s.externalUrl && s.externalUrl !== s.targetUrl ? <a href={s.externalUrl} target="_blank" rel="noreferrer" className="block text-brand-blue-dark underline">{s.externalUrl}</a> : null}</span> },
    { key: 'why', header: t('hub.marketing.justification'), cell: (s) => <span className="block max-w-72 text-xs">{s.justification}<pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-slate-100 p-1 text-[11px]">{JSON.stringify(s.proposal, null, 1)}</pre></span> },
    { key: 'status', header: t('hub.marketing.status'), cell: (s) => <span className="flex flex-col gap-1"><EnumBadge group="seoStatus" value={s.status} />{s.metricsBefore ? <span className="text-xs">{t('hub.marketing.before')} : {metricsText(s.metricsBefore)}</span> : null}{s.metricsAfter ? <span className="text-xs">{t('hub.marketing.after')} : {metricsText(s.metricsAfter)}</span> : null}{s.lastError ? <span className="text-xs text-red-800">{s.lastError}</span> : null}{s.decisionNote ? <span className="text-xs text-slate-700">{s.decisionNote}</span> : null}</span> },
    ...(writable ? [{
      key: 'act', header: t('hub.common.actions'), cell: (s: SeoTaskView) => (!['proposed', 'approved', 'failed'].includes(s.status) ? null : (
        <div className="flex min-w-48 flex-col gap-2">
          {s.status !== 'approved' ? <Action busy={decide.isPending && decide.variables?.id === s.id} onClick={() => decide.mutate({ id: s.id, action: 'approve' })}>{t('hub.marketing.apply')}</Action> : null}
          <Field label={t('hub.marketing.rejectReason')}>{(p) => <Input {...p} maxLength={500} value={reasons[s.id] ?? ''} onChange={(e) => setReasons({ ...reasons, [s.id]: e.target.value })} />}</Field>
          <Action tone="danger" disabled={(reasons[s.id]?.trim().length ?? 0) < 3} onClick={() => decide.mutate({ id: s.id, action: 'reject' })}>{t('hub.marketing.reject')}</Action>
        </div>
      )),
    }] : []),
  ];
  return (
    <Card
      title={t('hub.marketing.seoTitle')}
      actions={(
        <div className="flex flex-wrap items-end gap-2">
          <Field label={t('hub.common.status')}>
            {(p) => (
              <Select {...p} value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">{t('hub.common.all')}</option>
                {(['proposed', 'approved', 'applied', 'rejected', 'failed', 'measured'] as const).map((s) => <option key={s} value={s}>{t(`enum.seoStatus.${s}`)}</option>)}
              </Select>
            )}
          </Field>
          {writable ? <Action busy={plan.isPending} onClick={() => plan.mutate()}>{t('hub.marketing.seoPlan')}</Action> : null}
        </div>
      )}
    >
      <p className="mb-3 text-sm text-slate-600">{t('hub.marketing.seoHint')}</p>
      {message ? <div className="mb-3"><Notice tone="success">{message}</Notice></div> : null}
      {plan.isError ? <div className="mb-3"><Notice tone="danger">{errorText(plan.error)}</Notice></div> : null}
      {decide.isError ? <div className="mb-3"><Notice tone="danger">{errorText(decide.error)}</Notice></div> : null}
      {tasks.isPending ? <Loading /> : tasks.isError ? <ErrorBlock error={tasks.error} onRetry={() => void tasks.refetch()} /> : (
        <DataTable caption={t('hub.marketing.seoTitle')} columns={columns} rows={tasks.data} rowKey={(s) => s.id} empty={t('hub.marketing.seoEmpty')} />
      )}
    </Card>
  );
}

function SpacesTab() {
  const { t } = useTranslation();
  const spaces = useQuery({ queryKey: ['hub', 'marketing-spaces'], queryFn: () => hubApi.marketing.spaces() });
  const columns: Column<MarketingSpaceView>[] = [
    { key: 'space', header: t('hub.marketing.space'), cell: (s) => s.name },
    { key: 'connector', header: t('hub.marketing.connector'), cell: (s) => <span className="flex flex-col gap-1"><code className="text-xs">{s.provider}</code><Badge tone={s.configured ? 'success' : 'warning'}>{s.configured ? t('hub.marketing.configured') : t('hub.marketing.notConfigured')}</Badge></span> },
    { key: 'formats', header: t('hub.marketing.formats'), cell: (s) => <span className="text-xs">{s.formats.map((f) => t(`enum.contentFormat.${f}`)).join(', ')}</span> },
    { key: 'slots', header: t('hub.marketing.slots'), cell: (s) => <span className="text-xs">{s.slots.map((slot) => `${t('hub.marketing.day')}${slot.day} ${slot.time}`).join(' · ')}</span> },
  ];
  return (
    <Card title={t('hub.marketing.spacesTitle')}>
      <p className="mb-3 text-sm text-slate-600">{t('hub.marketing.spacesHint')}</p>
      {spaces.isPending ? <Loading /> : spaces.isError ? <ErrorBlock error={spaces.error} onRetry={() => void spaces.refetch()} /> : (
        <DataTable caption={t('hub.marketing.spacesTitle')} columns={columns} rows={spaces.data} rowKey={(s) => s.space} empty={t('hub.common.empty')} />
      )}
    </Card>
  );
}
