'use client';

/**
 * Registre des incidents de confidentialité (Loi 25) dans My Hub : saisie des rubriques du règlement, suites à donner,
 * modèle de notification à copier (personnes concernées ou CAI, en français ou en anglais). Procédure :
 * `docs/runbooks/incident-confidentialite.md`. Aucune donnée n'est envoyée d'ici : les avis partent à la main.
 */
import { PRIVACY_DATA_CATEGORIES, SERIOUS_HARM_ASSESSMENTS, type AdminIncident, type PrivacyBreachView, type PrivacyDataCategory, type SeriousHarmAssessment } from '@neomoov/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorBlock, Loading, useErrorText, useLang } from '@/components/hub/common';
import { Action, Badge, Checkbox, Dialog, Field, Input, Notice, Select, Textarea } from '@/components/ui/kit';
import { formatDateTime } from '@/lib/format';
import { hubApi } from '@/lib/hub-api';
import type { Language } from '@/lib/i18n-resources';
import { draftOf, emptyDraft, inputOf, noticeText, type BreachDraft, type NoticeAudience } from '@/lib/privacy-breach';

export { emptyDraft, inputOf, type BreachDraft } from '@/lib/privacy-breach';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-3 rounded-md border border-slate-200 p-3">
      <legend className="px-1 text-sm font-bold text-brand-night">{title}</legend>
      {children}
    </fieldset>
  );
}

/**
 * Rubriques du registre. `essential` : seulement ce qui s'inscrit le jour même (incident, renseignements, confinement),
 * pour l'ouverture d'un incident ; la fiche complète s'ouvre ensuite depuis la liste.
 */
export function BreachFields({ draft, onChange, essential = false }: { draft: BreachDraft; onChange: (draft: BreachDraft) => void; essential?: boolean }) {
  const { t } = useTranslation();
  const set = <K extends keyof BreachDraft>(key: K, value: BreachDraft[K]) => onChange({ ...draft, [key]: value });
  const toggle = (category: PrivacyDataCategory, checked: boolean) => set('dataCategories', checked ? [...draft.dataCategories, category] : draft.dataCategories.filter((c) => c !== category));
  return (
    <div className="flex flex-col gap-3">
      <Section title={t('hub.privacy.sections.incident')}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('hub.privacy.occurredFrom')}>{(p) => <Input {...p} type="date" value={draft.occurredFrom} onChange={(e) => set('occurredFrom', e.target.value)} />}</Field>
          <Field label={t('hub.privacy.occurredTo')}>{(p) => <Input {...p} type="date" min={draft.occurredFrom || undefined} value={draft.occurredTo} onChange={(e) => set('occurredTo', e.target.value)} />}</Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_9rem]">
          <Field label={t('hub.privacy.discoveredAt')}>{(p) => <Input {...p} type="date" required value={draft.discoveredDate} onChange={(e) => set('discoveredDate', e.target.value)} />}</Field>
          <Field label={t('hub.rides.when')}>{(p) => <Input {...p} type="time" required value={draft.discoveredTime} onChange={(e) => set('discoveredTime', e.target.value)} />}</Field>
        </div>
        <Field label={t('hub.privacy.reportedBy')}>{(p) => <Input {...p} maxLength={200} value={draft.reportedBy} onChange={(e) => set('reportedBy', e.target.value)} />}</Field>
      </Section>
      <Section title={t('hub.privacy.sections.data')}>
        <div role="group" aria-label={t('hub.privacy.categories')}>
          <p className="mb-1 text-sm font-semibold text-brand-ink">{t('hub.privacy.categories')}</p>
          <div className="grid gap-1 sm:grid-cols-2">
            {PRIVACY_DATA_CATEGORIES.map((c) => <Checkbox key={c} label={t(`hub.privacy.dataCategories.${c}`)} checked={draft.dataCategories.includes(c)} onChange={(e) => toggle(c, e.target.checked)} />)}
          </div>
        </div>
        <Field label={t('hub.privacy.dataDescription')}>{(p) => <Textarea {...p} required minLength={3} maxLength={4000} value={draft.dataDescription} onChange={(e) => set('dataDescription', e.target.value)} />}</Field>
        <Field label={t('hub.privacy.circumstances')}>{(p) => <Textarea {...p} required minLength={3} maxLength={4000} value={draft.circumstances} onChange={(e) => set('circumstances', e.target.value)} />}</Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('hub.privacy.personsAffected')}>{(p) => <Input {...p} type="number" min={0} step={1} value={draft.personsAffected} onChange={(e) => set('personsAffected', e.target.value)} />}</Field>
          <Field label={t('hub.privacy.personsAffectedQuebec')}>{(p) => <Input {...p} type="number" min={0} step={1} max={draft.personsAffected || undefined} value={draft.personsAffectedQuebec} onChange={(e) => set('personsAffectedQuebec', e.target.value)} />}</Field>
        </div>
      </Section>
      <Section title={t('hub.privacy.sections.containment')}>
        <Field label={t('hub.privacy.containment')}>{(p) => <Textarea {...p} maxLength={4000} value={draft.containment} onChange={(e) => set('containment', e.target.value)} />}</Field>
      </Section>
      {essential ? null : (
        <>
          <Section title={t('hub.privacy.sections.assessment')}>
            <Field label={t('hub.privacy.sensitivity')}>{(p) => <Textarea {...p} maxLength={2000} value={draft.sensitivity} onChange={(e) => set('sensitivity', e.target.value)} />}</Field>
            <Field label={t('hub.privacy.consequences')}>{(p) => <Textarea {...p} maxLength={2000} value={draft.consequences} onChange={(e) => set('consequences', e.target.value)} />}</Field>
            <Field label={t('hub.privacy.misuseLikelihood')}>{(p) => <Textarea {...p} maxLength={2000} value={draft.misuseLikelihood} onChange={(e) => set('misuseLikelihood', e.target.value)} />}</Field>
            <Field label={t('hub.privacy.seriousHarm')}>
              {(p) => (
                <Select {...p} value={draft.seriousHarm} onChange={(e) => set('seriousHarm', e.target.value as SeriousHarmAssessment)}>
                  {SERIOUS_HARM_ASSESSMENTS.map((h) => <option key={h} value={h}>{t(`hub.privacy.harm.${h}`)}</option>)}
                </Select>
              )}
            </Field>
            <Field label={t('hub.privacy.privacyOfficer')}>{(p) => <Input {...p} maxLength={200} value={draft.privacyOfficerConsulted} onChange={(e) => set('privacyOfficerConsulted', e.target.value)} />}</Field>
          </Section>
          <Section title={t('hub.privacy.sections.notices')}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('hub.privacy.caiNotifiedOn')}>{(p) => <Input {...p} type="date" value={draft.caiNotifiedOn} onChange={(e) => set('caiNotifiedOn', e.target.value)} />}</Field>
              <Field label={t('hub.privacy.caiReference')}>{(p) => <Input {...p} maxLength={100} value={draft.caiReference} onChange={(e) => set('caiReference', e.target.value)} />}</Field>
              <Field label={t('hub.privacy.personsNotifiedOn')}>{(p) => <Input {...p} type="date" value={draft.personsNotifiedOn} onChange={(e) => set('personsNotifiedOn', e.target.value)} />}</Field>
              <Field label={t('hub.privacy.personsNotificationMeans')}>{(p) => <Input {...p} maxLength={500} value={draft.personsNotificationMeans} onChange={(e) => set('personsNotificationMeans', e.target.value)} />}</Field>
            </div>
            <Checkbox label={t('hub.privacy.publicNotice')} checked={draft.publicNotice} onChange={(e) => set('publicNotice', e.target.checked)} />
            {draft.publicNotice ? <Field label={t('hub.privacy.publicNoticeReason')}>{(p) => <Textarea {...p} required maxLength={1000} value={draft.publicNoticeReason} onChange={(e) => set('publicNoticeReason', e.target.value)} />}</Field> : null}
            <Field label={t('hub.privacy.otherNotices')}>{(p) => <Textarea {...p} maxLength={2000} value={draft.otherNotices} onChange={(e) => set('otherNotices', e.target.value)} />}</Field>
          </Section>
          <Section title={t('hub.privacy.sections.measures')}>
            <Field label={t('hub.privacy.measures')}>{(p) => <Textarea {...p} maxLength={4000} value={draft.measures} onChange={(e) => set('measures', e.target.value)} />}</Field>
            <Field label={t('hub.privacy.followUpReview')}>{(p) => <Textarea {...p} maxLength={2000} value={draft.followUpReview} onChange={(e) => set('followUpReview', e.target.value)} />}</Field>
          </Section>
        </>
      )}
    </div>
  );
}

/** Modèle de notification à copier : destinataire et langue au choix (la langue du compte de la personne). */
export function NoticeTemplate({ entry }: { entry: PrivacyBreachView }) {
  const { t, i18n } = useTranslation();
  const lang = useLang();
  const [audience, setAudience] = useState<NoticeAudience>('persons');
  const [language, setLanguage] = useState<Language>(lang);
  const [copied, setCopied] = useState(false);
  const text = noticeText(entry, audience, i18n.getFixedT(language), language);
  const copy = () => {
    void navigator.clipboard?.writeText(text).then(() => setCopied(true), () => setCopied(false));
  };
  return (
    <Section title={t('hub.privacy.sections.template')}>
      <p className="text-xs text-slate-600">{t('hub.privacy.template.hint')}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('hub.privacy.template.audience')}>
          {(p) => (
            <Select {...p} value={audience} onChange={(e) => { setAudience(e.target.value as NoticeAudience); setCopied(false); }}>
              <option value="persons">{t('hub.privacy.template.persons')}</option>
              <option value="cai">{t('hub.privacy.template.cai')}</option>
            </Select>
          )}
        </Field>
        <Field label={t('hub.privacy.template.language')}>
          {(p) => (
            <Select {...p} value={language} onChange={(e) => { setLanguage(e.target.value as Language); setCopied(false); }}>
              <option value="fr-CA">{t('hub.staff.languages.fr')}</option>
              <option value="en">{t('hub.staff.languages.en')}</option>
            </Select>
          )}
        </Field>
      </div>
      <Field label={t('hub.privacy.sections.template')}>{(p) => <Textarea {...p} readOnly rows={14} className="font-mono text-xs" value={text} />}</Field>
      <div className="flex flex-wrap items-center gap-3">
        <Action tone="secondary" onClick={copy}>{t('hub.privacy.template.copy')}</Action>
        {copied ? <span role="status" className="text-sm text-green-900">{t('hub.privacy.template.copied')}</span> : null}
      </div>
    </Section>
  );
}

/** Suites à donner et temps écoulé depuis la prise de connaissance. */
function FollowUps({ entry }: { entry: PrivacyBreachView }) {
  const { t } = useTranslation();
  const lang = useLang();
  const hours = Math.max(0, Math.floor((Date.now() - Date.parse(entry.discoveredAt)) / 3_600_000));
  return (
    <div className="flex flex-col gap-2 rounded-md bg-brand-mist p-3 text-sm">
      <p className="text-xs text-slate-700">{t('hub.privacy.recordedAt', { date: formatDateTime(entry.recordedAt, lang), updated: formatDateTime(entry.updatedAt, lang) })}</p>
      <p>{t('hub.privacy.elapsed', { hours })}</p>
      <p className="font-semibold">{t('hub.privacy.followUpsTitle')}</p>
      {entry.followUps.length === 0 ? <p>{t('hub.privacy.noFollowUps')}</p> : (
        <ul className="flex flex-wrap gap-1">{entry.followUps.map((f) => <li key={f}><Badge tone={f === 'notify_cai' || f === 'notify_persons' ? 'danger' : 'warning'}>{t(`hub.privacy.followUps.${f}`)}</Badge></li>)}</ul>
      )}
    </div>
  );
}

/** Fiche du registre d'un incident : inscription (numéro attribué) ou mise à jour, puis modèle de notification. */
export function PrivacyBreachDialog({ incident, onClose, onSaved }: { incident: AdminIncident | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const recorded = Boolean(incident?.privacyBreach);
  const entry = useQuery({ queryKey: ['hub', 'privacy-breach', incident?.id], queryFn: () => hubApi.admin.privacyBreach(incident!.id), enabled: recorded });
  const title = incident?.privacyReference ? t('hub.privacy.title', { reference: incident.privacyReference }) : t('hub.privacy.newTitle');
  return (
    <Dialog open={incident !== null} title={title} onClose={onClose} wide>
      {incident && recorded && entry.isPending ? <Loading /> : incident && recorded && entry.isError ? <ErrorBlock error={entry.error} onRetry={() => void entry.refetch()} /> : incident ? (
        <BreachEditor key={incident.id} incident={incident} saved={entry.data ?? null} onClose={onClose} onSaved={onSaved} />
      ) : null}
    </Dialog>
  );
}

function BreachEditor({ incident, saved, onClose, onSaved }: { incident: AdminIncident; saved: PrivacyBreachView | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const [draft, setDraft] = useState<BreachDraft>(() => (saved ? draftOf(saved) : emptyDraft()));
  const [current, setCurrent] = useState<PrivacyBreachView | null>(saved);
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: () => hubApi.admin.savePrivacyBreach(incident.id, inputOf(draft)),
    onSuccess: (view) => {
      setCurrent(view);
      // Fiche relue au prochain affichage sans attendre l'API ; le formulaire en cours n'est jamais remplacé par une relecture.
      queryClient.setQueryData(['hub', 'privacy-breach', incident.id], view);
      onSaved();
    },
  });
  return (
    <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <p className="text-sm text-slate-700">{t('hub.privacy.intro')}</p>
      <p className="whitespace-pre-wrap rounded-md border border-slate-200 p-2 text-sm">{incident.description}</p>
      {current ? <FollowUps entry={current} /> : null}
      <BreachFields draft={draft} onChange={setDraft} />
      {save.isError ? <Notice tone="danger">{errorText(save.error)}</Notice> : null}
      {save.isSuccess && current ? <Notice tone="success">{t('hub.privacy.saved', { reference: current.reference })}</Notice> : null}
      <div className="flex justify-end gap-2">
        <Action tone="secondary" onClick={onClose}>{t('hub.common.close')}</Action>
        <Action type="submit" busy={save.isPending}>{t('hub.common.save')}</Action>
      </div>
      {current ? <NoticeTemplate key={current.updatedAt} entry={current} /> : null}
    </form>
  );
}
