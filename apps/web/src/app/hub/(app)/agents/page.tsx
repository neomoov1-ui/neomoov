'use client';

import type { AdminAgent, AdminApproval, AgentReportView, AgentRunView, ConversationView } from '@neomoov/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EnumBadge, ErrorBlock, ListToolbar, Loading, pageLabels, useCanWrite, useErrorText, useHubUser, useLang, usePagedList } from '@/components/hub/common';
import { Action, Badge, Card, Checkbox, DataTable, Dialog, Field, Input, Notice, PageTitle, Pagination, Select, Textarea, type BadgeTone, type Column } from '@/components/ui/kit';
import { formatDateTime } from '@/lib/format';
import { hubApi } from '@/lib/hub-api';

const MODES = ['auto', 'approval', 'manual'] as const;
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
const MODE_TONES: Record<string, BadgeTone> = { auto: 'success', approval: 'info', manual: 'warning' };
const RUN_TONES: Record<string, BadgeTone> = { running: 'info', succeeded: 'success', failed: 'danger', awaiting_approval: 'warning', skipped: 'neutral' };
const CONVERSATION_TONES: Record<string, BadgeTone> = { open: 'info', escalated: 'danger', closed: 'neutral' };
const AUTHOR_ACTOR: Record<string, string> = { client: 'client', staff: 'operator', agent: 'agent', system: 'system' };

/** Coût d'un modèle de langage (facturé en dollars américains), en micro-dollars : 4 décimales au plus. */
function formatMicros(micros: number | null | undefined, lang: string): string {
  if (micros === null || micros === undefined) return '';
  return new Intl.NumberFormat(lang === 'en' ? 'en-CA' : 'fr-CA', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(micros / 1_000_000);
}

/** Agents IA (étape 13) : réglages, file d'approbation (approuver exécute l'action, refuser exige un motif), journal, rapports, conversations. */
export default function AgentsPage() {
  const { t } = useTranslation();
  const lang = useLang();
  const writable = useCanWrite();
  const isAdmin = useHubUser().roles.includes('admin');
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<AdminAgent | null>(null);
  const [runAgent, setRunAgent] = useState('');
  const [runPage, setRunPage] = useState(1);
  const agents = useQuery({ queryKey: ['hub', 'agents'], queryFn: () => hubApi.admin.agents() });
  const list = usePagedList<AdminApproval>('approvals', (q) => hubApi.admin.approvals(q), 25, 'pending');
  const runs = useQuery({ queryKey: ['hub', 'agent-runs', runAgent, runPage], queryFn: () => hubApi.admin.agentRuns({ page: runPage, pageSize: 20, ...(runAgent ? { agentCode: runAgent } : {}) }) });
  const reports = useQuery({ queryKey: ['hub', 'agent-reports'], queryFn: () => hubApi.admin.agentReports({ pageSize: 10 }) });
  const conversations = useQuery({ queryKey: ['hub', 'conversations'], queryFn: () => hubApi.admin.conversations({ pageSize: 10 }) });
  const decide = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'approved' | 'rejected' }) => hubApi.admin.decideApproval(id, { decision, ...(notes[id]?.trim() ? { note: notes[id]!.trim() } : {}) }),
    onSuccess: () => {
      for (const key of ['approvals', 'agents', 'agent-runs', 'conversations']) void queryClient.invalidateQueries({ queryKey: ['hub', key] });
    },
  });

  const columns: Column<AdminApproval>[] = [
    { key: 'created', header: t('hub.common.from'), cell: (a) => formatDateTime(a.createdAt, lang) },
    { key: 'agent', header: t('hub.agents.agent'), cell: (a) => a.agentCode ?? '' },
    { key: 'action', header: t('hub.agents.action'), cell: (a) => <span className="block max-w-72"><strong>{a.proposedAction}</strong><pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap rounded bg-slate-100 p-1 text-[11px]">{JSON.stringify(a.data, null, 1)}</pre></span> },
    { key: 'why', header: t('hub.agents.justification'), cell: (a) => <span className="block max-w-72 text-xs">{a.justification ?? ''}</span> },
    {
      key: 'decision', header: t('hub.common.status'), cell: (a) => (
        <span className="flex max-w-56 flex-col gap-1">
          <EnumBadge group="approval" value={a.decision} />
          {a.decisionNote ? <span className="text-xs text-slate-700">{a.decisionNote}</span> : null}
          {a.executedAt ? <span className="text-xs text-green-900">{t('hub.agents.executed')}</span> : null}
          {a.executionError ? <span className="text-xs text-red-800">{t('hub.agents.executionError', { error: a.executionError })}</span> : null}
        </span>
      ),
    },
    ...(writable ? [{
      key: 'act', header: t('hub.common.actions'), cell: (a: AdminApproval) => (a.decision !== 'pending' && !(a.decision === 'approved' && a.executionError)) ? null : (
        <div className="flex min-w-48 flex-col gap-2">
          {a.decision === 'pending' ? <Field label={t('hub.agents.rejectReason')}>{(p) => <Input {...p} maxLength={500} value={notes[a.id] ?? ''} onChange={(e) => setNotes({ ...notes, [a.id]: e.target.value })} />}</Field> : null}
          <div className="flex gap-2">
            <Action busy={decide.isPending && decide.variables?.id === a.id} onClick={() => decide.mutate({ id: a.id, decision: 'approved' })}>{t('hub.agents.approve')}</Action>
            {a.decision === 'pending' ? <Action tone="danger" disabled={(notes[a.id]?.trim().length ?? 0) < 3} onClick={() => decide.mutate({ id: a.id, decision: 'rejected' })}>{t('hub.agents.reject')}</Action> : null}
          </div>
        </div>
      ),
    }] : []),
  ];

  const runColumns: Column<AgentRunView>[] = [
    { key: 'at', header: t('hub.common.from'), cell: (r) => formatDateTime(r.startedAt, lang) },
    { key: 'agent', header: t('hub.agents.agent'), cell: (r) => <span>{r.agentCode}<span className="block text-xs text-slate-600">{r.model ?? ''}</span></span> },
    { key: 'trigger', header: t('hub.agents.trigger'), cell: (r) => <code className="text-xs">{r.trigger}</code> },
    { key: 'status', header: t('hub.common.status'), cell: (r) => <span className="flex flex-col gap-1"><Badge tone={RUN_TONES[r.status] ?? 'neutral'}>{t(`enum.agentRunStatus.${r.status}`)}</Badge>{r.error ? <span className="max-w-56 text-xs text-red-800">{r.error}</span> : null}</span> },
    { key: 'tools', header: t('hub.agents.tools'), cell: (r) => <span className="text-xs">{r.toolCalls.map((c) => `${c.tool}${c.ok ? '' : ' (×)'}`).join(', ')}</span> },
    { key: 'tokens', header: t('hub.agents.tokens'), className: 'text-right', cell: (r) => `${r.inputTokens + r.cacheReadTokens + r.cacheWriteTokens} / ${r.outputTokens}` },
    { key: 'cost', header: t('hub.agents.cost'), className: 'text-right', cell: (r) => formatMicros(r.costMicros, lang) },
    { key: 'duration', header: t('hub.agents.duration'), className: 'text-right', cell: (r) => (r.durationMs === null ? '' : `${(r.durationMs / 1000).toFixed(1)} s`) },
  ];

  return (
    <div className="flex flex-col gap-5">
      <PageTitle title={t('hub.agents.title')} subtitle={t('hub.agents.subtitle')} />
      <Card>
        {agents.isPending ? <Loading /> : agents.isError ? <ErrorBlock error={agents.error} /> : (
          <DataTable
            rows={agents.data}
            rowKey={(a) => a.code}
            empty={t('hub.common.empty')}
            columns={[
              { key: 'name', header: t('hub.agents.agent'), cell: (a) => <span>{a.name}<span className="block text-xs text-slate-600">{a.code}{a.active ? '' : ` · ${t('hub.agents.inactive')}`}</span></span> },
              { key: 'mode', header: t('hub.agents.mode'), cell: (a) => <span className="flex flex-col gap-1"><Badge tone={MODE_TONES[a.mode] ?? 'neutral'}>{t(`enum.agentMode.${a.mode}`)}</Badge>{a.modeLocked ? <span className="text-xs text-slate-600">{t('hub.agents.locked')}</span> : null}</span> },
              { key: 'model', header: t('hub.agents.model'), cell: (a) => <span><code className="text-xs">{a.model}</code><span className="block text-xs text-slate-600">{t(`enum.effort.${a.effort}`)}</span></span> },
              { key: 'spent', header: t('hub.agents.spent'), className: 'text-right', cell: (a) => <span>{formatMicros(a.spentTodayMicros, lang)}<span className="block text-xs text-slate-600">{t('hub.agents.cap')} : {a.dailyCapMicros === null ? t('hub.agents.noCap') : formatMicros(a.dailyCapMicros, lang)}</span></span> },
              { key: 'runs', header: t('hub.agents.runs'), className: 'text-right', cell: (a) => a.runs7d },
              { key: 'pending', header: t('hub.agents.pending'), className: 'text-right', cell: (a) => (a.pendingApprovals ? <Badge tone="warning">{a.pendingApprovals}</Badge> : 0) },
              ...(isAdmin ? [{ key: 'configure', header: t('hub.common.actions'), cell: (a: AdminAgent) => <Action tone="secondary" onClick={() => setEditing(a)}>{t('hub.agents.configure')}</Action> }] : []),
            ]}
          />
        )}
      </Card>

      <Card title={t('hub.agents.approvals')}>
        {decide.isError ? <div className="mb-3"><Notice tone="danger">{errorText(decide.error)}</Notice></div> : null}
        {decide.isSuccess ? (
          <div className="mb-3 flex flex-col gap-2">
            <Notice tone="success">{t('hub.agents.decided')}</Notice>
            {decide.data.executionError ? <Notice tone="warning">{t('hub.agents.executionError', { error: decide.data.executionError })}</Notice> : null}
          </div>
        ) : null}
        <ListToolbar allowAll={false} filters={list.filters} setQ={list.setQ} setStatus={list.setStatus} statuses={(['pending', 'approved', 'rejected'] as const).map((s) => ({ value: s, label: t(`enum.approval.${s}`) }))} />
        {list.query.isPending ? <Loading /> : list.query.isError ? <ErrorBlock error={list.query.error} onRetry={() => void list.query.refetch()} /> : (
          <>
            <DataTable caption={t('hub.agents.approvals')} columns={columns} rows={list.query.data.items} rowKey={(a) => a.id} empty={t('hub.common.empty')} />
            <Pagination page={list.filters.page} pageSize={list.pageSize} total={list.query.data.total} onPage={list.setPage} labels={pageLabels(t, list.filters.page, list.pageSize, list.query.data.total)} />
          </>
        )}
      </Card>

      <Card
        title={t('hub.agents.journal')}
        actions={(
          <Field label={t('hub.agents.agent')}>
            {(p) => (
              <Select {...p} value={runAgent} onChange={(e) => { setRunAgent(e.target.value); setRunPage(1); }}>
                <option value="">{t('hub.agents.allAgents')}</option>
                {(agents.data ?? []).map((a) => <option key={a.code} value={a.code}>{a.name}</option>)}
              </Select>
            )}
          </Field>
        )}
      >
        {runs.isPending ? <Loading /> : runs.isError ? <ErrorBlock error={runs.error} onRetry={() => void runs.refetch()} /> : (
          <>
            <DataTable caption={t('hub.agents.journal')} columns={runColumns} rows={runs.data.items} rowKey={(r) => r.id} empty={t('hub.common.empty')} />
            <Pagination page={runPage} pageSize={20} total={runs.data.total} onPage={setRunPage} labels={pageLabels(t, runPage, 20, runs.data.total)} />
          </>
        )}
      </Card>

      <Card title={t('hub.agents.reports')}>
        {reports.isPending ? <Loading /> : reports.isError ? <ErrorBlock error={reports.error} /> : reports.data.items.length === 0 ? <p className="text-sm text-slate-600">{t('hub.common.empty')}</p> : (
          <ul className="flex flex-col gap-3">
            {reports.data.items.map((r: AgentReportView) => (
              <li key={r.runId} className="rounded-md border border-slate-200 p-3">
                <p className="font-semibold text-brand-night">{r.title}</p>
                <p className="text-xs text-slate-600">{t('hub.agents.period')} : {r.from} · {r.to} · {t('hub.agents.sentTo', { count: r.sentTo })} · {formatDateTime(r.createdAt, lang)}</p>
                <p className="mt-2 text-sm">{r.summary}</p>
                <details className="mt-2 text-sm">
                  <summary className="cursor-pointer text-brand-blue-dark">{t('hub.agents.readReport')}</summary>
                  <p className="mt-2 whitespace-pre-line">{r.body}</p>
                </details>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={t('hub.agents.conversations')}>
        {conversations.isPending ? <Loading /> : conversations.isError ? <ErrorBlock error={conversations.error} /> : conversations.data.items.length === 0 ? <p className="text-sm text-slate-600">{t('hub.common.empty')}</p> : (
          <ul className="flex flex-col gap-3">
            {conversations.data.items.map((c: ConversationView) => (
              <li key={c.id} className="rounded-md border border-slate-200 p-3">
                <p className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge tone={CONVERSATION_TONES[c.status] ?? 'neutral'}>{t(`enum.conversationStatus.${c.status}`)}</Badge>
                  <span>{t(`enum.conversationChannel.${c.channel}`)}</span>
                  <span className="text-xs text-slate-600">{t('hub.agents.lastMessage')} : {formatDateTime(c.messages.at(-1)?.createdAt ?? c.createdAt, lang)}</span>
                </p>
                {c.escalationReason ? <p className="mt-1 text-xs text-red-800">{t('hub.agents.escalation')} : {c.escalationReason}</p> : null}
                <details className="mt-2 text-sm">
                  <summary className="cursor-pointer text-brand-blue-dark">{t('hub.agents.showMessages')} ({c.messages.length})</summary>
                  <ol className="mt-2 flex flex-col gap-1">
                    {c.messages.map((m) => <li key={m.id} className={m.direction === 'inbound' ? 'text-brand-night' : 'text-slate-700'}><strong>{t(`enum.actor.${AUTHOR_ACTOR[m.author] ?? 'system'}`)}</strong> : {m.body}</li>)}
                  </ol>
                </details>
                {writable && c.status !== 'closed' ? <ConversationReply conversationId={c.id} onSent={() => void queryClient.invalidateQueries({ queryKey: ['hub', 'conversations'] })} /> : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {editing ? <AgentSettings agent={editing} onClose={() => setEditing(null)} onSaved={() => void queryClient.invalidateQueries({ queryKey: ['hub', 'agents'] })} /> : null}
    </div>
  );
}

/** Réponse de l'équipe (push, WhatsApp ou texto selon le canal de la conversation) ; « terminer » la ferme. */
function ConversationReply({ conversationId, onSent }: { conversationId: string; onSent: () => void }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const [text, setText] = useState('');
  const [close, setClose] = useState(false);
  const reply = useMutation({
    mutationFn: () => hubApi.admin.replyConversation(conversationId, { text: text.trim(), close }),
    onSuccess: () => {
      setText('');
      setClose(false);
      onSent();
    },
  });
  return (
    <form className="mt-2 flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); reply.mutate(); }}>
      <Field label={t('hub.agents.reply')}>{(p) => <Textarea {...p} required maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} />}</Field>
      <div className="flex flex-wrap items-center gap-3">
        <Checkbox label={t('hub.agents.closeConversation')} checked={close} onChange={(e) => setClose(e.target.checked)} />
        <Action type="submit" busy={reply.isPending} disabled={!text.trim()}>{t('hub.agents.send')}</Action>
      </div>
      {reply.isError ? <Notice tone="danger">{errorText(reply.error)}</Notice> : null}
    </form>
  );
}

/** Réglage d'un agent (administrateur) : mode, effort, activité, plafond quotidien propre, seuil automatique. */
function AgentSettings({ agent, onClose, onSaved }: { agent: AdminAgent; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const scaled = (value: unknown, scale: number) => (typeof value === 'number' ? String(value / scale) : '');
  const [mode, setMode] = useState<(typeof MODES)[number]>((MODES as readonly string[]).includes(agent.mode) ? (agent.mode as (typeof MODES)[number]) : 'approval');
  const [effort, setEffort] = useState<(typeof EFFORTS)[number]>((EFFORTS as readonly string[]).includes(agent.effort) ? (agent.effort as (typeof EFFORTS)[number]) : 'low');
  const [active, setActive] = useState(agent.active);
  const [cap, setCap] = useState(scaled(agent.thresholds['dailyBudgetMicros'], 1_000_000));
  const [autoRefund, setAutoRefund] = useState(scaled(agent.thresholds['maxAutoRefundCents'], 100));
  const amount = (value: string) => Number(value.trim().replace(',', '.'));
  const invalid = [cap, autoRefund].some((v) => v.trim() !== '' && !(amount(v) >= 0));
  const save = useMutation({
    mutationFn: () => {
      const capMicros = cap.trim() === '' ? null : Math.round(amount(cap) * 1_000_000);
      const refundCents = autoRefund.trim() === '' ? null : Math.round(amount(autoRefund) * 100);
      return hubApi.admin.updateAgent(agent.code, {
        mode, effort, active,
        thresholds: { dailyBudgetMicros: capMicros, ...(agent.code === 'customer_relations' ? { maxAutoRefundCents: refundCents, maxAutoCreditCents: refundCents } : {}) },
      });
    },
    onSuccess: () => { onSaved(); onClose(); },
  });
  return (
    <Dialog open title={t('hub.agents.settingsTitle', { name: agent.name })} onClose={onClose}>
      <div className="flex flex-col gap-3">
        {save.isError ? <Notice tone="danger">{errorText(save.error)}</Notice> : null}
        <Field label={t('hub.agents.mode')} hint={agent.modeLocked ? t('hub.agents.locked') : undefined}>
          {(p) => <Select {...p} value={mode} onChange={(e) => setMode(e.target.value as (typeof MODES)[number])}>{MODES.map((m) => <option key={m} value={m} disabled={agent.modeLocked && m === 'auto'}>{t(`enum.agentMode.${m}`)}</option>)}</Select>}
        </Field>
        <Field label={t('hub.agents.effort')}>
          {(p) => <Select {...p} value={effort} onChange={(e) => setEffort(e.target.value as (typeof EFFORTS)[number])}>{EFFORTS.map((e) => <option key={e} value={e}>{t(`enum.effort.${e}`)}</option>)}</Select>}
        </Field>
        <Field label={t('hub.agents.dailyCap')} hint={t('hub.agents.dailyCapHint')}>
          {(p) => <Input {...p} inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value)} />}
        </Field>
        {agent.code === 'customer_relations' ? (
          <Field label={t('hub.agents.maxAutoRefund')}>
            {(p) => <Input {...p} inputMode="decimal" value={autoRefund} onChange={(e) => setAutoRefund(e.target.value)} />}
          </Field>
        ) : null}
        <Checkbox label={t('hub.agents.active')} checked={active} onChange={(e) => setActive(e.target.checked)} />
        <div className="flex justify-end gap-2">
          <Action tone="secondary" onClick={onClose}>{t('hub.common.cancel')}</Action>
          <Action busy={save.isPending} disabled={invalid} onClick={() => save.mutate()}>{t('hub.common.save')}</Action>
        </div>
      </div>
    </Dialog>
  );
}
