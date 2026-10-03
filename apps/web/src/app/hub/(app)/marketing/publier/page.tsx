'use client';

import {
  adaptForSpace, PUBLICATION_SPACES, publicationsImportSchema, SPACE_RULES, zonedInstant,
  type CtaTarget, type InboxItemView, type PublicationComposeInput, type PublicationGroupView, type PublicationItemView, type PublicationsImport, type PublicationVariant, type RelayTaskView,
} from '@neomoov/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorBlock, Loading, useCanWrite, useErrorText, useLang } from '@/components/hub/common';
import { Action, Badge, Card, Checkbox, Dialog, Field, Input, Notice, PageTitle, Select, Textarea, type BadgeTone } from '@/components/ui/kit';
import { formatDateTime, montrealDate } from '@/lib/format';
import { hubApi } from '@/lib/hub-api';

type Tab = 'compose' | 'publications' | 'relay' | 'social';
type Space = (typeof PUBLICATION_SPACES)[number];
const CTA: CtaTarget[] = ['reserve', 'academy', 'preregister', 'none'];
const TZ = 'America/Toronto';
/**
 * Contrôle en direct du composer (indicatif) : adresses des appels à l'action et prix décidés tels que les lignes
 * éditoriales v1.1 les donnent ; l'API revérifie avec les réglages en vigueur (`marketing.cta_urls`, prix admis).
 */
const LIVE_OPTIONS = {
  allowedPrices: ['48,20 $', '113,83 $'],
  ctaUrls: { reserve: 'https://neomoov.net/reserver', academy: 'https://neomoov.net/academy', preregister: 'https://neomoov.net/chauffeurs/#candidature' },
  allowedPhones: ['+1 438 900 4990'],
  allowedEmailDomains: ['neomoov.net'],
};
/** Taille d'une tranche du lot importé : l'API accepte 100 Ko par appel, l'import est rejouable. */
const CHUNK_BYTES = 90_000;

/** État d'un contenu vu de l'écran de publication : le relais manuel n'est jamais présenté comme un échec. */
function stateOf(item: PublicationItemView): { key: 'draft' | 'blocked' | 'scheduled' | 'published' | 'failed' | 'relay' | 'rejected'; tone: BadgeTone } {
  if (item.awaitsRelay) return { key: 'relay', tone: 'warning' };
  if (item.status === 'draft') return item.issues.some((i) => i.blocking) ? { key: 'blocked', tone: 'danger' } : { key: 'draft', tone: 'neutral' };
  if (item.status === 'scheduled' || item.status === 'approved') return { key: 'scheduled', tone: 'info' };
  if (item.status === 'published' || item.status === 'measured') return { key: 'published', tone: 'success' };
  if (item.status === 'rejected') return { key: 'rejected', tone: 'neutral' };
  return { key: 'failed', tone: 'danger' };
}

/**
 * Publication multiréseau (chantier « Réseaux sociaux » du 3 octobre 2026) : composer (un texte vers un, plusieurs ou
 * tous les réseaux, texte adapté et image différente par réseau à sa taille), publications et import d'un lot JSON avec
 * approbation et programmation en lot, vue « À relayer » du relais manuel, commentaires et messages par réseau.
 */
export default function PublishPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('compose');
  const relay = useQuery({ queryKey: ['hub', 'publish-relay', montrealDate()], queryFn: () => hubApi.marketing.relay({}) });
  const social = useQuery({ queryKey: ['hub', 'publish-social'], queryFn: () => hubApi.marketing.socialSummary() });
  const badge = (key: Tab) => (key === 'relay' && relay.data?.tasks.length ? ` (${relay.data.tasks.length})` : key === 'social' && social.data?.total.unread ? ` (${social.data.total.unread})` : '');
  return (
    <div className="flex flex-col gap-5">
      <PageTitle title={t('hub.publish.title')} subtitle={t('hub.publish.subtitle')} />
      <div className="flex flex-wrap gap-2" role="tablist">
        {(['compose', 'publications', 'relay', 'social'] as const).map((key) => (
          <Action key={key} role="tab" aria-selected={tab === key} tone={tab === key ? 'primary' : 'secondary'} onClick={() => setTab(key)}>{t(`hub.publish.tabs.${key}`)}{badge(key)}</Action>
        ))}
      </div>
      {tab === 'compose' ? <ComposeTab onCreated={() => setTab('publications')} /> : tab === 'publications' ? <PublicationsTab /> : tab === 'relay' ? <RelayTab /> : <SocialTab />}
    </div>
  );
}

// Composer -------------------------------------------------------------------------------------------------------------

function ComposeTab({ onCreated }: { onCreated: () => void }) {
  const { t } = useTranslation();
  const writable = useCanWrite();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [short, setShort] = useState('');
  const [imageText, setImageText] = useState('');
  const [hashtags, setHashtags] = useState('#Neomoov #Montréal');
  const [cta, setCta] = useState<CtaTarget>('reserve');
  const [hints, setHints] = useState('');
  const [spaces, setSpaces] = useState<Space[]>([...PUBLICATION_SPACES]);
  const [variants, setVariants] = useState<Partial<Record<Space, PublicationVariant>>>({});
  const [mode, setMode] = useState<'now' | 'at' | 'slots' | 'draft'>('draft');
  const [at, setAt] = useState('');
  const [created, setCreated] = useState<PublicationGroupView | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const tags = hashtags.split(/[\s,]+/).filter(Boolean);
  const base = { title: title.trim(), body: body.trim(), short: short.trim(), imageText: imageText.trim() || null, cta, hashtags: tags, language: 'fr' as const };
  const adapted = useMemo(
    () => spaces.map((space) => ({ space, results: base.body ? adaptForSpace(space, base, variants[space], LIVE_OPTIONS) : [] })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [spaces, title, body, short, imageText, cta, hashtags, variants],
  );
  const toggle = (space: Space) => setSpaces(spaces.includes(space) ? spaces.filter((s) => s !== space) : PUBLICATION_SPACES.filter((s) => s === space || spaces.includes(s)));
  const setVariant = (space: Space, patch: Partial<PublicationVariant>) => setVariants({ ...variants, [space]: Object.fromEntries(Object.entries({ ...variants[space], ...patch }).filter(([, v]) => v !== undefined && v !== '')) as PublicationVariant });
  const valid = title.trim().length >= 3 && body.trim().length >= 40 && short.trim().length >= 20 && spaces.length > 0 && (mode !== 'at' || Boolean(at));

  const adapt = useMutation({
    mutationFn: () => hubApi.marketing.adaptPublication({ title: base.title, body: base.body, cta, spaces }),
    onSuccess: (r) => { setVariants({ ...variants, ...(r.variants as Partial<Record<Space, PublicationVariant>>) }); setMessage(t('hub.publish.generated')); },
  });
  const submit = useMutation({
    mutationFn: () => {
      const schedule: PublicationComposeInput['schedule'] = mode === 'at' ? { mode, at: zonedInstant(at.slice(0, 10), at.slice(11, 16), TZ).toISOString() } : { mode };
      const cleanVariants = Object.fromEntries(Object.entries(variants).filter(([space]) => spaces.includes(space as Space)));
      return hubApi.marketing.compose({
        title: base.title, body: base.body, short: base.short, cta, hashtags: tags.map((h) => h.replace(/^#+/, '#')), spaces, schedule,
        ...(base.imageText ? { imageText: base.imageText } : {}),
        ...(Object.keys(cleanVariants).length ? { variants: cleanVariants } : {}),
        ...(hints.trim() ? { photoHints: hints.split(',').map((h) => h.trim()).filter((h) => h.length >= 2).slice(0, 6) } : {}),
      });
    },
    onSuccess: (group) => {
      setCreated(group);
      setMessage(t('hub.publish.created', { count: group.items.length }));
      void queryClient.invalidateQueries({ queryKey: ['hub', 'publish-list'] });
      void queryClient.invalidateQueries({ queryKey: ['hub', 'publish-relay'] });
    },
  });

  if (created) {
    return (
      <Card title={created.title} actions={<Action tone="secondary" onClick={() => { setCreated(null); setVariants({}); setMessage(null); }}>{t('hub.publish.newPublication')}</Action>}>
        {message ? <div className="mb-3"><Notice tone="success">{message}</Notice></div> : null}
        <GroupDetail groupId={created.id} />
        <div className="mt-4"><Action tone="secondary" onClick={onCreated}>{t('hub.publish.tabs.publications')}</Action></div>
      </Card>
    );
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <Card title={t('hub.publish.baseTitle')}>
        <div className="flex flex-col gap-3">
          <Field label={t('hub.publish.fieldTitle')}>{(p) => <Input {...p} maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} />}</Field>
          <Field label={t('hub.publish.fieldBody')} hint={t('hub.publish.bodyHint')}>{(p) => <Textarea {...p} rows={7} maxLength={12000} value={body} onChange={(e) => setBody(e.target.value)} />}</Field>
          <Field label={t('hub.publish.fieldShort')} hint={`${short.length} / 200`}>{(p) => <Textarea {...p} rows={2} maxLength={200} value={short} onChange={(e) => setShort(e.target.value)} />}</Field>
          <Field label={t('hub.publish.fieldImageText')}>{(p) => <Input {...p} maxLength={70} value={imageText} onChange={(e) => setImageText(e.target.value)} />}</Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('hub.publish.fieldHashtags')}>{(p) => <Input {...p} value={hashtags} onChange={(e) => setHashtags(e.target.value)} />}</Field>
            <Field label={t('hub.publish.fieldCta')}>{(p) => <Select {...p} value={cta} onChange={(e) => setCta(e.target.value as CtaTarget)}>{CTA.map((c) => <option key={c} value={c}>{t(`hub.marketing.cta.${c}`)}</option>)}</Select>}</Field>
          </div>
          <Field label={t('hub.publish.fieldPhotoHints')}>{(p) => <Input {...p} value={hints} onChange={(e) => setHints(e.target.value)} />}</Field>
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-semibold text-brand-night">{t('hub.publish.networks')}</legend>
            <div className="flex gap-2">
              <Action tone="secondary" onClick={() => setSpaces([...PUBLICATION_SPACES])}>{t('hub.publish.all')}</Action>
              <Action tone="secondary" onClick={() => setSpaces([])}>{t('hub.publish.none')}</Action>
            </div>
            <div className="grid grid-cols-2 gap-1">
              {PUBLICATION_SPACES.map((space) => <Checkbox key={space} label={t(`enum.contentSpace.${space}`)} checked={spaces.includes(space)} onChange={() => toggle(space)} />)}
            </div>
          </fieldset>
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-semibold text-brand-night">{t('hub.publish.when')}</legend>
            <Select aria-label={t('hub.publish.when')} value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
              {(['draft', 'now', 'at', 'slots'] as const).map((m) => <option key={m} value={m}>{t(`hub.publish.mode.${m}`)}</option>)}
            </Select>
            {mode === 'at' ? <Field label={t('hub.publish.at')}>{(p) => <Input {...p} type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />}</Field> : null}
          </fieldset>
          {submit.isError ? <Notice tone="danger">{errorText(submit.error)}</Notice> : null}
          {adapt.isError ? <Notice tone="danger">{errorText(adapt.error)}</Notice> : null}
          {message && !created ? <Notice tone="info">{message}</Notice> : null}
          {writable ? (
            <div className="flex flex-wrap gap-2">
              <Action tone="secondary" busy={adapt.isPending} disabled={!base.title || base.body.length < 20 || !spaces.length} onClick={() => adapt.mutate()}>{t('hub.publish.generate')}</Action>
              <Action busy={submit.isPending} disabled={!valid} onClick={() => submit.mutate()}>{mode === 'draft' ? t('hub.publish.prepare') : t('hub.publish.publish')}</Action>
            </div>
          ) : null}
        </div>
      </Card>
      <Card title={t('hub.publish.perNetwork')}>
        <p className="mb-3 text-xs text-slate-600">{t('hub.publish.liveCheck')}</p>
        {!base.body ? <p className="text-sm text-slate-600">{t('hub.publish.writeFirst')}</p> : (
          <div className="flex flex-col gap-4">
            {adapted.map(({ space, results }) => results.map((r, index) => {
              const rule = SPACE_RULES[space];
              const custom = Boolean(variants[space]?.body);
              const tooLong = r.text.length > rule.maxChars;
              return (
                <section key={`${space}-${index}`} className="rounded-md border border-slate-200 p-3">
                  <header className="mb-2 flex flex-wrap items-center gap-2">
                    <strong className="text-brand-night">{t(`enum.contentSpace.${space}`)}{r.draft.language === 'en' ? ' (EN)' : ''}</strong>
                    <Badge tone={tooLong ? 'danger' : 'neutral'}>{t('hub.publish.chars', { count: r.text.length, max: rule.maxChars })}</Badge>
                    <span className="text-xs text-slate-600">{t(`enum.contentFormat.${r.draft.format}`)} · {t('hub.publish.imageOn')} « {r.imageText} »</span>
                  </header>
                  {index === 0 ? (
                    <>
                      <Field label={custom ? t('hub.publish.custom') : t('hub.publish.automatic')}>
                        {(p) => <Textarea {...p} rows={space === 'site_blog' ? 6 : 3} value={variants[space]?.body ?? r.draft.body} onChange={(e) => setVariant(space, { body: e.target.value })} />}
                      </Field>
                      <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto]">
                        <Field label={t('hub.publish.fieldImageText')}>{(p) => <Input {...p} maxLength={70} value={variants[space]?.imageText ?? ''} placeholder={r.imageText} onChange={(e) => setVariant(space, { imageText: e.target.value })} />}</Field>
                        {variants[space] ? <div className="self-end"><Action tone="secondary" onClick={() => setVariants(Object.fromEntries(Object.entries(variants).filter(([s]) => s !== space)))}>{t('hub.publish.reset')}</Action></div> : null}
                      </div>
                    </>
                  ) : <p className="whitespace-pre-line text-sm">{r.draft.body}</p>}
                  {r.issues.length ? (
                    <ul className="mt-2 flex flex-col gap-1">
                      {r.issues.map((i) => <li key={`${i.kind}-${i.detail}`} className={`text-xs ${i.blocking ? 'text-red-800' : 'text-amber-800'}`}>{i.blocking ? `${t('hub.marketing.blocked')} : ` : ''}{i.detail}</li>)}
                    </ul>
                  ) : null}
                </section>
              );
            }))}
            <Notice tone="info">{t('hub.publish.blockedHint')}</Notice>
          </div>
        )}
      </Card>
    </div>
  );
}

// Visuel d'un contenu ---------------------------------------------------------------------------------------------------

/** Aperçu réduit du visuel d'un contenu, à son format (PNG, vidéo ou gabarit HTML), chargé avec la session de My Hub. */
function VisualPreview({ item, width = 220 }: { item: PublicationItemView; width?: number }) {
  const { t } = useTranslation();
  const [file, setFile] = useState<{ url: string; type: string } | null>(null);
  const ready = item.mediaStatus === 'ready' || item.mediaStatus === 'html';
  useEffect(() => {
    if (!ready) return;
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
  }, [item.id, item.mediaStatus, item.visual?.fingerprint, ready]);
  const w = item.visual?.width ?? 1080;
  const h = item.visual?.height ?? 1080;
  const scale = width / w;
  return (
    <figure className="flex flex-col gap-1">
      <div className="overflow-hidden rounded-md border border-slate-200 bg-slate-100" style={{ width, height: Math.round(h * scale) }}>
        {!ready ? <p className="p-2 text-xs text-slate-600">{item.mediaStatus === 'failed' ? t('hub.publish.mediaFailed') : t('hub.publish.mediaPending')}</p> : !file ? null : file.type.startsWith('image/') ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={file.url} alt={item.visual?.imageText ?? ''} className="h-full w-full object-cover" />
        ) : file.type.startsWith('video/') ? (
          <video src={file.url} controls className="h-full w-full object-cover" />
        ) : (
          <iframe src={file.url} title={item.visual?.imageText ?? ''} sandbox="" style={{ width: w, height: h, transform: `scale(${scale})`, transformOrigin: '0 0', border: 0 }} />
        )}
      </div>
      <figcaption className="text-xs text-slate-600">{t(`enum.contentSpace.${item.space}`)} · {w} × {h}{item.visual ? ` · ${t(`hub.publish.template.${item.visual.template}`)}` : ''}</figcaption>
    </figure>
  );
}

/** Détail d'une publication : un aperçu et un état par réseau, diffusion des brouillons. */
function GroupDetail({ groupId }: { groupId: string }) {
  const { t } = useTranslation();
  const lang = useLang();
  const writable = useCanWrite();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<'now' | 'at' | 'slots'>('slots');
  const [at, setAt] = useState('');
  const group = useQuery({
    queryKey: ['hub', 'publish-group', groupId],
    queryFn: () => hubApi.marketing.publication(groupId),
    refetchInterval: (q) => (q.state.data?.items.some((i) => i.mediaStatus === 'pending') ? 5_000 : false),
  });
  const publish = useMutation({
    mutationFn: () => hubApi.marketing.publishPublication(groupId, { schedule: mode === 'at' ? { mode, at: zonedInstant(at.slice(0, 10), at.slice(11, 16), TZ).toISOString() } : { mode } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['hub', 'publish-group', groupId] });
      void queryClient.invalidateQueries({ queryKey: ['hub', 'publish-list'] });
      void queryClient.invalidateQueries({ queryKey: ['hub', 'publish-relay'] });
    },
  });
  if (group.isPending) return <Loading />;
  if (group.isError) return <ErrorBlock error={group.error} onRetry={() => void group.refetch()} />;
  const drafts = group.data.items.filter((i) => i.status === 'draft' && !i.issues.some((x) => x.blocking));
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
        {group.data.items.map((item) => {
          const state = stateOf(item);
          return (
            <div key={item.id} className="flex flex-col gap-2 rounded-md border border-slate-200 p-2">
              <VisualPreview item={item} />
              <div className="flex flex-wrap items-center gap-1">
                <Badge tone={state.tone}>{t(`hub.publish.state.${state.key}`)}</Badge>
                <Badge tone={item.delivery === 'manual' ? 'warning' : 'neutral'}>{item.delivery === 'manual' ? t('hub.publish.manual') : t('hub.publish.auto')}</Badge>
                {item.language === 'en' ? <Badge>EN</Badge> : null}
              </div>
              {item.scheduledAt && state.key !== 'published' ? <span className="text-xs text-slate-600">{formatDateTime(item.scheduledAt, lang)}</span> : null}
              {item.externalUrl ? <a href={item.externalUrl} target="_blank" rel="noreferrer" className="text-xs text-brand-blue-dark underline">{t('hub.publish.openLink')}</a> : null}
              {item.notice ? <span className="text-xs text-amber-800">{t('hub.publish.notice')} : {item.notice}</span> : null}
              {state.key === 'failed' && item.lastError ? <span className="text-xs text-red-800">{item.lastError}</span> : null}
              {state.key === 'relay' && item.lastError ? <span className="text-xs text-amber-800">{item.lastError}</span> : null}
              {item.issues.filter((i) => i.blocking).map((i) => <span key={i.detail} className="text-xs text-red-800">{i.detail}</span>)}
              <p className="line-clamp-4 whitespace-pre-line text-xs text-slate-700">{item.caption ?? item.body}</p>
            </div>
          );
        })}
      </div>
      {writable && drafts.length ? (
        <div className="flex flex-wrap items-end gap-2 rounded-md bg-brand-mist p-3">
          <Field label={t('hub.publish.when')}>{(p) => <Select {...p} value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>{(['slots', 'now', 'at'] as const).map((m) => <option key={m} value={m}>{t(`hub.publish.mode.${m}`)}</option>)}</Select>}</Field>
          {mode === 'at' ? <Field label={t('hub.publish.at')}>{(p) => <Input {...p} type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />}</Field> : null}
          <Action busy={publish.isPending} disabled={mode === 'at' && !at} onClick={() => publish.mutate()}>{t('hub.publish.publishDrafts', { count: drafts.length })}</Action>
        </div>
      ) : null}
      {publish.isError ? <Notice tone="danger">{errorText(publish.error)}</Notice> : null}
    </div>
  );
}

// Publications, import et programmation en lot ------------------------------------------------------------------------------

/** Lot découpé en tranches de moins de 90 Ko (mêmes en-têtes, publications réparties). */
function chunks(lot: PublicationsImport): PublicationsImport[] {
  const out: PublicationsImport[] = [];
  let current: PublicationsImport['publications'] = [];
  const size = (pubs: PublicationsImport['publications']) => new TextEncoder().encode(JSON.stringify({ ...lot, publications: pubs })).length;
  for (const pub of lot.publications) {
    if (current.length && size([...current, pub]) > CHUNK_BYTES) {
      out.push({ ...lot, publications: current });
      current = [];
    }
    current.push(pub);
  }
  if (current.length) out.push({ ...lot, publications: current });
  return out;
}

function PublicationsTab() {
  const { t } = useTranslation();
  const lang = useLang();
  const writable = useCanWrite();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const [campaign, setCampaign] = useState('');
  const [opened, setOpened] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: BadgeTone; text: string } | null>(null);
  const [startDate, setStartDate] = useState(montrealDate());
  const [days, setDays] = useState('10');
  const list = useQuery({ queryKey: ['hub', 'publish-list', campaign], queryFn: () => hubApi.marketing.publications(campaign ? { campaign, limit: 200 } : { limit: 50 }) });
  const all = useQuery({ queryKey: ['hub', 'publish-list', 'campaigns'], queryFn: () => hubApi.marketing.publications({ limit: 200 }) });
  const campaigns = [...new Set((all.data ?? []).map((g) => g.campaign).filter((c): c is string => Boolean(c)))];
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['hub', 'publish-list'] });

  const importFile = useMutation({
    mutationFn: async (file: File) => {
      let raw: unknown;
      try {
        raw = JSON.parse(await file.text());
      } catch {
        throw new Error(t('hub.publish.importInvalid', { detail: 'JSON illisible' }));
      }
      const parsed = publicationsImportSchema.safeParse(raw);
      if (!parsed.success) throw new Error(t('hub.publish.importInvalid', { detail: parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')} : ${i.message}`).join(' ; ') }));
      const parts = chunks(parsed.data);
      const total = { created: 0, existing: 0, items: 0, blocked: 0 };
      for (const [index, part] of parts.entries()) {
        setProgress(t('hub.publish.importing', { done: index, total: parts.length }));
        const r = await hubApi.marketing.importPublications(part);
        total.created += r.created; total.existing += r.existing; total.items += r.items; total.blocked += r.blocked;
      }
      return { campaign: parsed.data.campaign, ...total };
    },
    onSuccess: (r) => { setProgress(null); setCampaign(r.campaign); setMessage({ tone: 'success', text: t('hub.publish.imported', r) }); refresh(); },
    onError: () => setProgress(null),
  });
  const schedule = useMutation({
    mutationFn: () => hubApi.marketing.schedulePublications({ campaign, startDate, days: Math.max(1, Math.min(90, Number(days) || 1)) }),
    onSuccess: (r) => {
      setMessage({ tone: 'success', text: t('hub.publish.batched', { approved: r.approved, relay: r.relay, skipped: r.skipped.length, first: formatDateTime(r.firstAt, lang), last: formatDateTime(r.lastAt, lang) }) });
      refresh();
      void queryClient.invalidateQueries({ queryKey: ['hub', 'publish-relay'] });
    },
  });

  return (
    <>
      {writable ? (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card title={t('hub.publish.importTitle')}>
            <p className="mb-3 text-sm text-slate-600">{t('hub.publish.importHint')}</p>
            <Field label={t('hub.publish.importFile')}>{(p) => <Input {...p} type="file" accept="application/json,.json" disabled={importFile.isPending} onChange={(e) => { const f = e.target.files?.[0]; if (f) importFile.mutate(f); e.target.value = ''; }} />}</Field>
            {progress ? <p className="mt-2 text-sm">{progress}</p> : null}
            {importFile.isError ? <div className="mt-2"><Notice tone="danger">{importFile.error instanceof Error && !('status' in importFile.error) ? importFile.error.message : errorText(importFile.error)}</Notice></div> : null}
          </Card>
          <Card title={t('hub.publish.batchTitle')}>
            <div className="flex flex-wrap items-end gap-2">
              <Field label={t('hub.publish.campaign')}>{(p) => <Select {...p} value={campaign} onChange={(e) => setCampaign(e.target.value)}><option value="">—</option>{campaigns.map((c) => <option key={c} value={c}>{c}</option>)}</Select>}</Field>
              <Field label={t('hub.publish.startDate')}>{(p) => <Input {...p} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />}</Field>
              <Field label={t('hub.publish.days')}>{(p) => <Input {...p} type="number" min={1} max={90} value={days} onChange={(e) => setDays(e.target.value)} className="w-24" />}</Field>
              <Action busy={schedule.isPending} disabled={!campaign} onClick={() => schedule.mutate()}>{t('hub.publish.batch')}</Action>
            </div>
            <p className="mt-2 text-xs text-slate-600">{t('hub.publish.batchHint')}</p>
            {schedule.isError ? <div className="mt-2"><Notice tone="danger">{errorText(schedule.error)}</Notice></div> : null}
            {schedule.data?.skipped.length ? (
              <details className="mt-2 text-xs"><summary>{t('hub.publish.skipped')} ({schedule.data.skipped.length})</summary><ul className="mt-1">{schedule.data.skipped.map((s) => <li key={s.itemId}>{t(`enum.contentSpace.${s.space}`)} : {s.reason}</li>)}</ul></details>
            ) : null}
          </Card>
        </div>
      ) : null}
      <Card
        title={t('hub.publish.listTitle')}
        actions={<Field label={t('hub.publish.campaign')}>{(p) => <Select {...p} value={campaign} onChange={(e) => setCampaign(e.target.value)}><option value="">{t('hub.publish.allCampaigns')}</option>{campaigns.map((c) => <option key={c} value={c}>{c}</option>)}</Select>}</Field>}
      >
        {message ? <div className="mb-3"><Notice tone={message.tone}>{message.text}</Notice></div> : null}
        {list.isPending ? <Loading /> : list.isError ? <ErrorBlock error={list.error} onRetry={() => void list.refetch()} /> : !list.data.length ? <p className="text-sm text-slate-600">{t('hub.publish.empty')}</p> : (
          <ul className="flex flex-col gap-3">
            {list.data.map((g) => (
              <li key={g.id} className="rounded-md border border-slate-200 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <strong className="text-brand-night">{g.ref ? `${g.ref} · ` : ''}{g.title}</strong>
                    <span className="block text-xs text-slate-600">{t(`hub.publish.source.${g.source}`)}{g.campaign ? ` · ${g.campaign}` : ''} · {formatDateTime(g.createdAt, lang)}</span>
                  </div>
                  <Action tone="secondary" onClick={() => setOpened(g.id)}>{t('hub.publish.detail')}</Action>
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {g.items.map((i) => {
                    const state = stateOf(i);
                    return <Badge key={i.id} tone={state.tone}>{t(`enum.contentSpace.${i.space}`)}{i.language === 'en' ? ' EN' : ''} : {t(`hub.publish.state.${state.key}`)}{i.scheduledAt && state.key === 'scheduled' ? ` ${formatDateTime(i.scheduledAt, lang)}` : ''}</Badge>;
                  })}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {opened ? <Dialog open wide title={list.data?.find((g) => g.id === opened)?.title ?? t('hub.publish.detail')} onClose={() => setOpened(null)}><GroupDetail groupId={opened} /></Dialog> : null}
    </>
  );
}

// À relayer ---------------------------------------------------------------------------------------------------------------

function RelayTab() {
  const { t } = useTranslation();
  const [date, setDate] = useState(montrealDate());
  const relay = useQuery({ queryKey: ['hub', 'publish-relay', date], queryFn: () => hubApi.marketing.relay({ date }), refetchInterval: 60_000 });
  return (
    <Card
      title={t('hub.publish.relayTitle', { date })}
      actions={<Field label={t('hub.publish.day')}>{(p) => <Input {...p} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}</Field>}
    >
      <p className="mb-3 text-sm text-slate-600">{t('hub.publish.relayHint')}</p>
      {relay.isPending ? <Loading /> : relay.isError ? <ErrorBlock error={relay.error} onRetry={() => void relay.refetch()} /> : (
        <>
          <p className="mb-3 text-xs text-slate-600">{t('hub.publish.doneToday', { count: relay.data.doneToday })}</p>
          {!relay.data.tasks.length ? <p className="text-sm text-slate-600">{t('hub.publish.relayEmpty')}</p> : (
            <ul className="flex flex-col gap-4">{relay.data.tasks.map((task) => <RelayTaskCard key={task.item.id} task={task} />)}</ul>
          )}
        </>
      )}
    </Card>
  );
}

function RelayTaskCard({ task }: { task: RelayTaskView }) {
  const { t } = useTranslation();
  const lang = useLang();
  const writable = useCanWrite();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const [url, setUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const network = t(`enum.contentSpace.${task.item.space}`);
  const done = useMutation({
    mutationFn: () => hubApi.marketing.markRelayed(task.item.id, url.trim() ? { url: url.trim() } : {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['hub', 'publish-relay'] });
      void queryClient.invalidateQueries({ queryKey: ['hub', 'publish-list'] });
    },
  });
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(task.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
    } catch {
      setCopied(false);
    }
  };
  return (
    <li className="grid gap-3 rounded-md border border-slate-200 p-3 md:grid-cols-[auto_minmax(0,1fr)]">
      <VisualPreview item={task.item} width={180} />
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <strong className="text-brand-night">{network}</strong>
          <span className="text-xs text-slate-600">{formatDateTime(task.item.scheduledAt, lang)}</span>
          {task.late ? <Badge tone="warning">{t('hub.publish.late')}</Badge> : null}
          {task.item.status === 'failed' ? <Badge tone="info">{t('hub.publish.approvalPending')}</Badge> : null}
          {task.groupTitle ? <span className="text-xs text-slate-600">· {task.groupTitle}</span> : null}
        </div>
        <Textarea aria-label={t('hub.publish.copy')} readOnly rows={Math.min(8, Math.max(3, task.text.split('\n').length + 1))} value={task.text} />
        <div className="flex flex-wrap gap-2">
          <Action tone="secondary" onClick={() => void copy()}>{copied ? t('hub.publish.copied') : t('hub.publish.copy')}</Action>
          {task.fileName ? <a className="inline-flex items-center rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-brand-night hover:bg-slate-50" href={`/api/v1${hubApi.marketing.downloadPath(task.item.id)}`} download={task.fileName}>{t('hub.publish.download')}</a> : <span className="self-center text-xs text-slate-600">{t('hub.publish.mediaPending')}</span>}
          {task.thumbnailFileName ? <a className="inline-flex items-center rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-brand-night hover:bg-slate-50" href={`/api/v1${hubApi.marketing.downloadPath(task.item.id, 'thumbnail')}`} download={task.thumbnailFileName}>{t('hub.publish.downloadThumb')}</a> : null}
          <a className="inline-flex items-center rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-brand-blue-dark hover:bg-slate-50" href={task.link} target="_blank" rel="noreferrer">{t('hub.publish.open', { network })}</a>
        </div>
        {writable ? (
          <div className="flex flex-wrap items-end gap-2">
            <Field label={t('hub.publish.postUrl')}>{(p) => <Input {...p} type="url" maxLength={500} value={url} onChange={(e) => setUrl(e.target.value)} className="min-w-72" />}</Field>
            <Action busy={done.isPending} onClick={() => done.mutate()}>{t('hub.publish.markDone')}</Action>
          </div>
        ) : null}
        {done.isError ? <Notice tone="danger">{errorText(done.error)}</Notice> : null}
      </div>
    </li>
  );
}

// Commentaires et messages ------------------------------------------------------------------------------------------------

function SocialTab() {
  const { t } = useTranslation();
  const lang = useLang();
  const [network, setNetwork] = useState<NonNullable<InboxItemView['network']> | ''>('');
  const [selected, setSelected] = useState<string | null>(null);
  const summary = useQuery({ queryKey: ['hub', 'publish-social'], queryFn: () => hubApi.marketing.socialSummary(), refetchInterval: 60_000 });
  const list = useQuery({
    queryKey: ['hub', 'publish-social-list', network],
    queryFn: () => hubApi.admin.inbox({ channel: 'social', pageSize: 50, ...(network ? { network } : {}) }),
  });
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Card title={t('hub.publish.socialTitle')} actions={<a href="/hub/boite-de-reception" className="text-sm text-brand-blue-dark underline">{t('hub.publish.openInbox')}</a>}>
        <p className="mb-3 text-sm text-slate-600">{t('hub.publish.socialHint')}</p>
        {summary.isPending ? <Loading /> : summary.isError ? <ErrorBlock error={summary.error} onRetry={() => void summary.refetch()} /> : (
          <div className="mb-4 flex flex-wrap gap-2">
            <Action tone={network === '' ? 'primary' : 'secondary'} onClick={() => { setNetwork(''); setSelected(null); }}>{t('hub.publish.allNetworks')}{summary.data.total.unread ? ` (${summary.data.total.unread})` : ''}</Action>
            {summary.data.networks.filter((n) => n.open > 0 || n.network !== 'messenger').map((n) => (
              <Action key={n.network} tone={network === n.network ? 'primary' : 'secondary'} onClick={() => { setNetwork(n.network); setSelected(null); }}>
                {t(`enum.socialNetwork.${n.network}`)}{n.unread ? ` (${n.unread})` : ''}{n.relayPending ? ` · ${t('hub.publish.relayShort', { count: n.relayPending })}` : ''}
              </Action>
            ))}
          </div>
        )}
        {list.isPending ? <Loading /> : list.isError ? <ErrorBlock error={list.error} onRetry={() => void list.refetch()} /> : !list.data.items.length ? <p className="text-sm text-slate-600">{t('hub.publish.noConversation')}</p> : (
          <ul className="flex flex-col divide-y divide-slate-200">
            {list.data.items.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => setSelected(c.id)} className={`w-full p-2 text-left text-sm hover:bg-slate-50 ${selected === c.id ? 'bg-brand-tint' : ''}`}>
                  <span className="flex flex-wrap items-center gap-2">
                    <strong>{c.displayName ?? c.address ?? '?'}</strong>
                    {c.network ? <Badge>{t(`enum.socialNetwork.${c.network}`)}</Badge> : null}
                    <Badge tone={c.state === 'awaiting' ? 'warning' : c.state === 'escalated' ? 'danger' : c.state === 'relay' ? 'info' : 'neutral'}>{t(`enum.inboxState.${c.state}`)}</Badge>
                    <span className="text-xs text-slate-600">{formatDateTime(c.lastMessageAt, lang)}</span>
                  </span>
                  <span className="mt-1 block text-xs text-slate-700">{c.preview}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {selected ? <ConversationPanel conversationId={selected} /> : null}
    </div>
  );
}

function ConversationPanel({ conversationId }: { conversationId: string }) {
  const { t } = useTranslation();
  const lang = useLang();
  const writable = useCanWrite();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const [reply, setReply] = useState('');
  const conversation = useQuery({ queryKey: ['hub', 'inbox-conversation', conversationId], queryFn: () => hubApi.admin.inboxConversation(conversationId) });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['hub', 'inbox-conversation', conversationId] });
    void queryClient.invalidateQueries({ queryKey: ['hub', 'publish-social'] });
    void queryClient.invalidateQueries({ queryKey: ['hub', 'publish-social-list'] });
  };
  const send = useMutation({ mutationFn: (messageId: string) => hubApi.marketing.sendSocialReply(messageId), onSuccess: refresh });
  const relayed = useMutation({ mutationFn: (messageId: string) => hubApi.admin.inboxMarkRelayed(messageId), onSuccess: refresh });
  const answer = useMutation({ mutationFn: () => hubApi.admin.replyConversation(conversationId, { text: reply.trim(), close: false }), onSuccess: () => { setReply(''); refresh(); } });
  if (conversation.isPending) return <Card><Loading /></Card>;
  if (conversation.isError) return <Card><ErrorBlock error={conversation.error} onRetry={() => void conversation.refetch()} /></Card>;
  const c = conversation.data;
  return (
    <Card title={`${t('hub.publish.conversation')} · ${c.network ? t(`enum.socialNetwork.${c.network}`) : ''}`}>
      <ul className="flex flex-col gap-2">
        {c.messages.map((m) => (
          <li key={m.id} className={`rounded-md p-2 text-sm ${m.direction === 'inbound' ? 'bg-slate-100' : 'bg-brand-tint'}`}>
            <p className="text-xs text-slate-600">{formatDateTime(m.createdAt, lang)} · {m.direction === 'inbound' ? (c.displayName ?? '?') : t(`hub.publish.author.${m.author === 'agent' ? 'agent' : m.author === 'staff' ? 'staff' : 'system'}`)}</p>
            <p className="mt-1 whitespace-pre-line">{m.body}</p>
            {m.relayStatus === 'pending' && writable ? (
              <div className="mt-2 flex flex-wrap gap-2">
                <Badge tone="info">{t('hub.publish.pendingReply')}</Badge>
                <Action tone="secondary" onClick={() => void navigator.clipboard.writeText(m.body).catch(() => undefined)}>{t('hub.publish.copyReply')}</Action>
                <Action busy={send.isPending && send.variables === m.id} onClick={() => send.mutate(m.id)}>{t('hub.publish.sendConnector')}</Action>
                <Action tone="secondary" busy={relayed.isPending && relayed.variables === m.id} onClick={() => relayed.mutate(m.id)}>{t('hub.publish.markRelayed')}</Action>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {send.isError ? <div className="mt-2"><Notice tone="warning">{errorText(send.error)}</Notice></div> : null}
      {relayed.isError ? <div className="mt-2"><Notice tone="danger">{errorText(relayed.error)}</Notice></div> : null}
      {writable && c.status !== 'closed' ? (
        <div className="mt-3 flex flex-col gap-2">
          <Field label={t('hub.publish.replyLabel')}>{(p) => <Textarea {...p} rows={3} maxLength={2000} value={reply} onChange={(e) => setReply(e.target.value)} />}</Field>
          <div><Action busy={answer.isPending} disabled={!reply.trim()} onClick={() => answer.mutate()}>{t('hub.publish.replySend')}</Action></div>
          {answer.isError ? <Notice tone="danger">{errorText(answer.error)}</Notice> : null}
        </div>
      ) : null}
    </Card>
  );
}

