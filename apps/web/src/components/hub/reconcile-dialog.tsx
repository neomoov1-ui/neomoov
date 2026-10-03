'use client';

/**
 * Réconciliation d'un relevé resté sans réponse du prestataire (revue du 2 octobre 2026, constat 7) : rejeu, mouvement
 * constaté (référence exigée) ou rien d'exécuté. Partagée par le relevé d'un chauffeur et les relevés d'une organisation.
 */
import type { StatementReconcile } from '@neomoov/domain';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Action, Dialog, Field, Input, Notice, Select } from '@/components/ui/kit';

export function ReconcileDialog({ open, busy, error, onClose, onSubmit }: { open: boolean; busy: boolean; error: string | null; onClose: () => void; onSubmit: (body: StatementReconcile) => void }) {
  const { t } = useTranslation();
  const [outcome, setOutcome] = useState<StatementReconcile['outcome']>('replay');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const needsReference = outcome === 'executed';
  return (
    <Dialog open={open} title={t('hub.statements.reconcile')} onClose={onClose}>
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); onSubmit({ outcome, ...(reference.trim() ? { reference: reference.trim() } : {}), ...(note.trim() ? { note: note.trim() } : {}) }); }}>
        <Notice tone="info">{t('hub.statements.reconcileHint')}</Notice>
        <Field label={t('hub.statements.reconcileOutcome')}>
          {(p) => (
            <Select {...p} value={outcome} onChange={(e) => setOutcome(e.target.value as StatementReconcile['outcome'])}>
              <option value="replay">{t('hub.statements.outcomeReplay')}</option>
              <option value="executed">{t('hub.statements.outcomeExecuted')}</option>
              <option value="not_executed">{t('hub.statements.outcomeNotExecuted')}</option>
            </Select>
          )}
        </Field>
        <Field label={t('hub.statements.reconcileReference')}>{(p) => <Input {...p} required={needsReference} minLength={2} maxLength={120} value={reference} onChange={(e) => setReference(e.target.value)} />}</Field>
        <Field label={t('hub.statements.offlineNote')}>{(p) => <Input {...p} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <div className="flex justify-end gap-2">
          <Action tone="secondary" onClick={onClose}>{t('hub.common.cancel')}</Action>
          <Action type="submit" busy={busy} disabled={needsReference && reference.trim().length < 2}>{t('hub.common.confirm')}</Action>
        </div>
      </form>
    </Dialog>
  );
}
