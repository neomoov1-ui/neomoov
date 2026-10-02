'use client';

import type { ConversationView, InboxItemView, InboxSummaryView } from '@neomoov/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorBlock, Loading, pageLabels, useCanWrite, useErrorText, useLang } from '@/components/hub/common';
import { Action, Badge, Card, Checkbox, DataTable, Field, Input, Notice, PageTitle, Pagination, Select, Textarea, type BadgeTone, type Column } from '@/components/ui/kit';
import { formatDateTime } from '@/lib/format';
import { hubApi } from '@/lib/hub-api';

const CHANNELS = ['email', 'social', 'whatsapp', 'sms', 'voice', 'app', 'web'] as const;
const STATES = ['awaiting', 'escalated', 'relay', 'answered', 'closed'] as const;
const NETWORKS = ['messenger', 'facebook', 'instagram', 'youtube', 'tiktok', 'x', 'gbp', 'linkedin', 'snapchat'] as const;
const RELAY_NETWORKS = ['youtube', 'tiktok', 'x', 'gbp', 'linkedin', 'snapchat'] as const;
const STATE_TONES: Record<string, BadgeTone> = { awaiting: 'warning', escalated: 'danger', relay: 'info', answered: 'success', closed: 'neutral' };
const AUTHOR_ACTOR: Record<string, string> = { client: 'client', staff: 'operator', agent: 'agent', system: 'system' };
const PAGE_SIZE = 25;

/**
 * Boîte de réception unifiée (phase 1 « entreprise autonome ») : toutes les conversations, tous canaux, filtrées par canal,
 * état et réseau ; détail avec réponse manuelle ; relais manuel pour les réseaux sans connecteur (l'agent prépare la
 * réponse, l'humain la colle puis la marque relayée).
 */
export default function InboxPage() {
  const { t } = useTranslation();
  const lang = useLang();
  const writable = useCanWrite();
  const queryClient = useQueryClient();
  const [channel, setChannel] = useState('');
  const [state, setState] = useState('');
  const [network, setNetwork] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ['hub', 'inbox', channel, state, network, q, page],
    queryFn: () => hubApi.admin.inbox({ page, pageSize: PAGE_SIZE, ...(channel ? { channel: channel as InboxItemView['channel'] } : {}), ...(state ? { state: state as InboxItemView['state'] } : {}), ...(network ? { network: network as NonNullable<InboxItemView['network']> } : {}), ...(q.trim() ? { q: q.trim() } : {}) }),
  });
  const summary = useQuery({ queryKey: ['hub', 'inbox-summary'], queryFn: () => hubApi.admin.inboxSummary() });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['hub', 'inbox'] });
    void queryClient.invalidateQueries({ queryKey: ['hub', 'inbox-summary'] });
    void queryClient.invalidateQueries({ queryKey: ['hub', 'inbox-conversation'] });
  };
  const who = (i: InboxItemView) => i.displayName ?? i.address ?? i.phone ?? (i.userId ? i.userId.slice(0, 8) : '');

  const columns: Column<InboxItemView>[] = [
    { key: 'when', header: t('hub.inbox.lastMessage'), cell: (i) => formatDateTime(i.lastMessageAt, lang) },
    { key: 'channel', header: t('hub.inbox.channel'), cell: (i) => <span>{t(`enum.conversationChannel.${i.channel}`)}{i.network ? <span className="block text-xs text-slate-600">{t(`enum.socialNetwork.${i.network}`)}</span> : null}{i.kind !== 'message' ? <span className="block text-xs text-slate-600">{t(`enum.conversationKind.${i.kind}`)}</span> : null}</span> },
    { key: 'from', header: t('hub.inbox.from'), cell: (i) => <span className="block max-w-56 break-words">{who(i)}{i.subject ? <span className="block text-xs text-slate-600">{i.subject}</span> : null}</span> },
    { key: 'preview', header: t('hub.inbox.preview'), cell: (i) => <span className="block max-w-80 text-xs text-slate-700">{i.preview}</span> },
    {
      key: 'state', header: t('hub.inbox.state'), cell: (i) => (
        <span className="flex flex-col gap-1">
          <Badge tone={STATE_TONES[i.state] ?? 'neutral'}>{t(`enum.inboxState.${i.state}`)}</Badge>
          <span className="text-xs text-slate-600">{t('hub.inbox.messages', { count: i.messageCount })}{i.firstReplySeconds !== null ? ` · ${t('hub.inbox.firstReply')} ${i.firstReplySeconds} s${i.firstReplyLate ? ` (${t('hub.inbox.late')})` : ''}` : ''}</span>
        </span>
      ),
    },
    { key: 'open', header: t('hub.common.actions'), cell: (i) => <Action tone="secondary" onClick={() => setSelected(selected === i.id ? null : i.id)}>{selected === i.id ? t('hub.inbox.close') : t('hub.inbox.open')}</Action> },
  ];

  return (
    <div className="flex flex-col gap-5">
      <PageTitle title={t('hub.inbox.title')} subtitle={t('hub.inbox.subtitle')} />
      {summary.isSuccess ? <SummaryBar summary={summary.data} /> : null}
      {writable ? <RelayForm onDone={(c) => { refresh(); setSelected(c.id); }} /> : null}
      <Card>
        <div className="mb-3 grid gap-3 sm:grid-cols-4">
          <Field label={t('hub.common.search')}>{(p) => <Input {...p} type="search" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />}</Field>
          <Field label={t('hub.inbox.channel')}>{(p) => <Select {...p} value={channel} onChange={(e) => { setChannel(e.target.value); setPage(1); }}><option value="">{t('hub.inbox.allChannels')}</option>{CHANNELS.map((c) => <option key={c} value={c}>{t(`enum.conversationChannel.${c}`)}</option>)}</Select>}</Field>
          <Field label={t('hub.inbox.state')}>{(p) => <Select {...p} value={state} onChange={(e) => { setState(e.target.value); setPage(1); }}><option value="">{t('hub.inbox.allStates')}</option>{STATES.map((s) => <option key={s} value={s}>{t(`enum.inboxState.${s}`)}</option>)}</Select>}</Field>
          <Field label={t('hub.inbox.network')}>{(p) => <Select {...p} value={network} onChange={(e) => { setNetwork(e.target.value); setPage(1); }}><option value="">{t('hub.inbox.allNetworks')}</option>{NETWORKS.map((n) => <option key={n} value={n}>{t(`enum.socialNetwork.${n}`)}</option>)}</Select>}</Field>
        </div>
        {list.isPending ? <Loading /> : list.isError ? <ErrorBlock error={list.error} onRetry={() => void list.refetch()} /> : (
          <>
            <DataTable caption={t('hub.inbox.title')} columns={columns} rows={list.data.items} rowKey={(i) => i.id} empty={t('hub.common.empty')} />
            <Pagination page={page} pageSize={PAGE_SIZE} total={list.data.total} onPage={setPage} labels={pageLabels(t, page, PAGE_SIZE, list.data.total)} />
          </>
        )}
      </Card>
      {selected ? <ConversationDetail id={selected} writable={writable} onChanged={refresh} /> : null}
    </div>
  );
}

function SummaryBar({ summary }: { summary: InboxSummaryView }) {
  const { t } = useTranslation();
  return (
    <Card title={t('hub.inbox.summary')}>
      <ul className="flex flex-wrap gap-3 text-sm">
        {summary.byChannel.map((c) => (
          <li key={c.channel} className="rounded-md border border-slate-200 px-3 py-2">
            <strong>{t(`enum.conversationChannel.${c.channel}`)}</strong> : {c.open} · {c.awaiting} {t('hub.inbox.awaiting')} · {c.escalated} {t('hub.inbox.escalated')}
          </li>
        ))}
        <li className="rounded-md border border-slate-200 px-3 py-2"><strong>{t('enum.inboxState.relay')}</strong> : {summary.relayPending}</li>
      </ul>
    </Card>
  );
}

/** Relais manuel : message collé d'un réseau sans connecteur ; l'agent répond tout de suite (quelques secondes). */
function RelayForm({ onDone }: { onDone: (conversation: ConversationView) => void }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const [network, setNetwork] = useState<(typeof RELAY_NETWORKS)[number]>('youtube');
  const [kind, setKind] = useState<'message' | 'comment'>('comment');
  const [from, setFrom] = useState('');
  const [text, setText] = useState('');
  const [link, setLink] = useState('');
  const relay = useMutation({
    mutationFn: () => hubApi.admin.inboxRelay({ network, kind, from: from.trim(), text: text.trim(), ...(link.trim() ? { link: link.trim() } : {}) }),
    onSuccess: (conversation) => { setText(''); setFrom(''); setLink(''); onDone(conversation); },
  });
  return (
    <Card title={t('hub.inbox.relayTitle')}>
      <p className="mb-3 text-sm text-slate-700">{t('hub.inbox.relayHint')}</p>
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); relay.mutate(); }}>
        <Field label={t('hub.inbox.network')}>{(p) => <Select {...p} value={network} onChange={(e) => setNetwork(e.target.value as (typeof RELAY_NETWORKS)[number])}>{RELAY_NETWORKS.map((n) => <option key={n} value={n}>{t(`enum.socialNetwork.${n}`)}</option>)}</Select>}</Field>
        <Field label={t('hub.inbox.relayKind')}>{(p) => <Select {...p} value={kind} onChange={(e) => setKind(e.target.value as 'message' | 'comment')}><option value="comment">{t('enum.conversationKind.comment')}</option><option value="message">{t('enum.conversationKind.message')}</option></Select>}</Field>
        <Field label={t('hub.inbox.relayFrom')}>{(p) => <Input {...p} required maxLength={120} value={from} onChange={(e) => setFrom(e.target.value)} />}</Field>
        <Field label={t('hub.inbox.relayLink')}>{(p) => <Input {...p} type="url" maxLength={500} value={link} onChange={(e) => setLink(e.target.value)} />}</Field>
        <div className="sm:col-span-2"><Field label={t('hub.inbox.relayText')}>{(p) => <Textarea {...p} required maxLength={4000} value={text} onChange={(e) => setText(e.target.value)} />}</Field></div>
        <div className="flex items-center gap-3 sm:col-span-2">
          <Action type="submit" busy={relay.isPending} disabled={!from.trim() || !text.trim()}>{t('hub.inbox.relaySubmit')}</Action>
          {relay.isSuccess ? <Notice tone="success">{t('hub.inbox.relayDone')}</Notice> : null}
          {relay.isError ? <Notice tone="danger">{errorText(relay.error)}</Notice> : null}
        </div>
      </form>
    </Card>
  );
}

function ConversationDetail({ id, writable, onChanged }: { id: string; writable: boolean; onChanged: () => void }) {
  const { t } = useTranslation();
  const lang = useLang();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const [close, setClose] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const conversation = useQuery({ queryKey: ['hub', 'inbox-conversation', id], queryFn: () => hubApi.admin.inboxConversation(id) });
  const done = () => { void queryClient.invalidateQueries({ queryKey: ['hub', 'inbox-conversation', id] }); onChanged(); };
  const reply = useMutation({ mutationFn: () => hubApi.admin.replyConversation(id, { text: text.trim(), close }), onSuccess: () => { setText(''); setClose(false); done(); } });
  const relayed = useMutation({ mutationFn: (messageId: string) => hubApi.admin.inboxMarkRelayed(messageId), onSuccess: done });
  const copy = async (messageId: string, body: string) => {
    try {
      await navigator.clipboard.writeText(body);
      setCopied(messageId);
    } catch {
      setCopied(null);
    }
  };
  if (conversation.isPending) return <Card title={t('hub.inbox.detail')}><Loading /></Card>;
  if (conversation.isError) return <Card title={t('hub.inbox.detail')}><ErrorBlock error={conversation.error} onRetry={() => void conversation.refetch()} /></Card>;
  const c = conversation.data;
  return (
    <Card title={`${t('hub.inbox.detail')} · ${t(`enum.conversationChannel.${c.channel}`)}${c.network ? ` · ${t(`enum.socialNetwork.${c.network}`)}` : ''}`}>
      <p className="flex flex-wrap items-center gap-2 text-sm">
        <Badge tone={c.status === 'escalated' ? 'danger' : c.status === 'closed' ? 'neutral' : 'info'}>{t(`enum.conversationStatus.${c.status}`)}</Badge>
        <span>{t(`enum.conversationKind.${c.kind}`)}</span>
        {c.displayName || c.address ? <span className="text-slate-700">{c.displayName ?? ''}{c.address ? ` (${c.address})` : ''}</span> : null}
        {c.subject ? <span className="text-slate-700">{t('hub.inbox.subject')} : {c.subject}</span> : null}
      </p>
      {c.escalationReason ? <p className="mt-1 text-xs text-red-800">{t('hub.inbox.escalation')} : {c.escalationReason}</p> : null}
      <ol className="mt-3 flex flex-col gap-2">
        {c.messages.map((m) => (
          <li key={m.id} className={`rounded-md border p-2 text-sm ${m.direction === 'inbound' ? 'border-slate-200 bg-slate-50 text-brand-night' : 'border-slate-200 text-slate-700'}`}>
            <p className="text-xs text-slate-600"><strong>{t(`enum.actor.${AUTHOR_ACTOR[m.author] ?? 'system'}`)}</strong> · {formatDateTime(m.createdAt, lang)}{m.attachments.length ? ` · ${t('hub.inbox.attachments', { names: m.attachments.join(', ') })}` : ''}</p>
            <p className="mt-1 whitespace-pre-line">{m.body}</p>
            {m.relayStatus ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Badge tone={m.relayStatus === 'pending' ? 'info' : 'success'}>{m.relayStatus === 'pending' ? t('hub.inbox.toRelay') : t('hub.inbox.relayed')}</Badge>
                {m.relayStatus === 'pending' ? <Action tone="secondary" onClick={() => void copy(m.id, m.body)}>{copied === m.id ? t('hub.inbox.copied') : t('hub.inbox.copy')}</Action> : null}
                {m.relayStatus === 'pending' && writable ? <Action busy={relayed.isPending && relayed.variables === m.id} onClick={() => relayed.mutate(m.id)}>{t('hub.inbox.markRelayed')}</Action> : null}
              </div>
            ) : null}
          </li>
        ))}
      </ol>
      {relayed.isError ? <div className="mt-2"><Notice tone="danger">{errorText(relayed.error)}</Notice></div> : null}
      {writable && c.status !== 'closed' ? (
        <form className="mt-3 flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); reply.mutate(); }}>
          <Field label={t('hub.inbox.reply')}>{(p) => <Textarea {...p} required maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} />}</Field>
          <div className="flex flex-wrap items-center gap-3">
            <Checkbox label={t('hub.inbox.closeConversation')} checked={close} onChange={(e) => setClose(e.target.checked)} />
            <Action type="submit" busy={reply.isPending} disabled={!text.trim()}>{t('hub.inbox.send')}</Action>
          </div>
          {reply.isError ? <Notice tone="danger">{errorText(reply.error)}</Notice> : null}
        </form>
      ) : null}
    </Card>
  );
}
