'use client';

/**
 * Marque et domaines d'une organisation cliente (étape 22), dans « Organisations et accès » : nom, logo, couleurs (contrôle
 * du contraste WCAG AA avant l'envoi, l'API refuse de toute façon), assistance, expéditeur, conditions ; domaines de la
 * réservation web et de My Hub, enregistrement TXT montré une seule fois, vérification par la plateforme.
 */
import { BRAND_COLOR_KEYS, ORGANIZATION_DOMAIN_KINDS, brandContrastIssues, type OrganizationDomainCreated, type OrganizationDomainKind, type OrganizationDomainView, type OrganizationView } from '@neomoov/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Action, Badge, Card, DataTable, Field, Input, Notice, Select, type Column } from '@/components/ui/kit';
import { BRAND_TEXT_FIELDS, brandFormFrom, brandUpdateFrom, effectiveColors, hasBrandChanges, resolvedValue, type BrandFormState, type BrandTextField } from '@/lib/brand-form';
import { formatDate } from '@/lib/format';
import { hubApi } from '@/lib/hub-api';
import type { Language } from '@/lib/i18n-resources';
import { ErrorBlock, Loading, useErrorText, useHubUser, useLang } from './common';

const INPUT_TYPES: Partial<Record<BrandTextField, string>> = { logoUrl: 'url', termsUrl: 'url', privacyUrl: 'url', supportEmail: 'email', emailSenderAddress: 'email', supportPhone: 'tel' };

export function OrgBrandPanel({ org }: { org: OrganizationView }) {
  const { t } = useTranslation();
  if (org.parentId === null) return <Notice tone="info">{t('hub.brand.rootOnly')}</Notice>;
  return (
    <div className="flex flex-col gap-4">
      <BrandForm organizationId={org.id} />
      <Domains organizationId={org.id} />
    </div>
  );
}

function BrandForm({ organizationId }: { organizationId: string }) {
  const { t } = useTranslation();
  const lang = useLang();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const key = ['hub', 'orgs', organizationId, 'brand'];
  const view = useQuery({ queryKey: key, queryFn: () => hubApi.branding.get(organizationId) });
  const [form, setForm] = useState<BrandFormState | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    if (view.data) setForm(brandFormFrom(view.data));
  }, [view.data]);
  const save = useMutation({
    mutationFn: (body: ReturnType<typeof brandUpdateFrom>) => hubApi.branding.update(organizationId, body),
    onSuccess: (next) => {
      queryClient.setQueryData(key, next);
      setMessage(t('hub.brand.saved'));
    },
  });
  if (view.isPending || (view.data && !form)) return <Loading />;
  if (view.isError) return <ErrorBlock error={view.error} onRetry={() => void view.refetch()} />;
  if (!form) return null;
  const data = view.data;
  const colors = effectiveColors(data, form);
  const issues = brandContrastIssues(colors);
  const update = brandUpdateFrom(data, form);
  const setField = (field: BrandTextField, value: string) => { setMessage(null); setForm({ ...form, fields: { ...form.fields, [field]: value } }); };
  const submit = () => {
    if (!hasBrandChanges(update)) return setMessage(t('hub.brand.nothing'));
    save.mutate(update);
  };
  return (
    <Card title={t('hub.brand.title')}>
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <p className="text-sm text-slate-700">{t('hub.brand.intro')}</p>
        <p className="text-sm"><strong>{t('hub.brand.joinCode')}</strong> : <code data-testid="join-code">{data.joinCode}</code></p>
        <div className="grid gap-3 sm:grid-cols-2">
          {BRAND_TEXT_FIELDS.map((field) => {
            const inherited = resolvedValue(data.brand, field);
            const hint = field === 'smsSender' ? t('hub.brand.smsSenderHint') : !form.fields[field].trim() && inherited ? t('hub.brand.inherited', { value: inherited }) : undefined;
            return (
              <Field key={field} label={t(`hub.brand.${field}`)} hint={hint}>
                {(p) => <Input {...p} type={INPUT_TYPES[field] ?? 'text'} maxLength={500} value={form.fields[field]} onChange={(e) => setField(field, e.target.value)} />}
              </Field>
            );
          })}
        </div>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-semibold text-brand-ink">{t('hub.brand.colors')}</legend>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {BRAND_COLOR_KEYS.map((c) => (
              <Field key={c} label={t(`hub.brand.color.${c}`)}>
                {(p) => <Input {...p} type="color" className="h-10 p-1" value={colors[c].toLowerCase()} onChange={(e) => { setMessage(null); setForm({ ...form, colors: { ...form.colors, [c]: e.target.value.toUpperCase() } }); }} />}
              </Field>
            ))}
          </div>
        </fieldset>
        <BrandPreview colors={colors} name={form.fields.displayName.trim() || data.brand.displayName} />
        {issues.length ? (
          <Notice tone="danger">
            {issues.map((i) => `${t(i.pair === 'text_on_background' ? 'hub.brand.contrastText' : 'hub.brand.contrastButton')} : ${t('hub.brand.contrast', { ratio: ratioText(i.ratio, lang) })}`).join(' ')}
          </Notice>
        ) : null}
        {save.isError ? <Notice tone="danger">{errorText(save.error)}</Notice> : null}
        {message ? <Notice tone={message === t('hub.brand.saved') ? 'success' : 'info'}>{message}</Notice> : null}
        <div><Action type="submit" busy={save.isPending} disabled={issues.length > 0}>{t('hub.brand.save')}</Action></div>
      </form>
    </Card>
  );
}

const ratioText = (ratio: number, lang: Language) => ratio.toLocaleString(lang === 'en' ? 'en-CA' : 'fr-CA', { maximumFractionDigits: 2 });

/** Aperçu : texte sur le fond, bouton blanc sur la couleur principale, liseré secondaire et pastille d'accent. */
export function BrandPreview({ colors, name }: { colors: ReturnType<typeof effectiveColors>; name: string }) {
  const { t } = useTranslation();
  return (
    <div aria-label={t('hub.brand.preview')} role="group" className="rounded-lg border p-4" style={{ background: colors.background, color: colors.text, borderColor: colors.secondary }}>
      <p className="font-heading text-lg font-bold">{name}</p>
      <div className="mt-2 flex items-center gap-3">
        <span className="rounded-md px-3 py-2 text-sm font-semibold" style={{ background: colors.primary, color: '#FFFFFF' }}>{t('hub.brand.previewButton')}</span>
        <span aria-hidden className="inline-block h-4 w-4 rounded-full" style={{ background: colors.accent }} />
      </div>
    </div>
  );
}

function Domains({ organizationId }: { organizationId: string }) {
  const { t } = useTranslation();
  const lang = useLang();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const platformAdmin = useHubUser().roles.includes('admin');
  const key = ['hub', 'orgs', organizationId, 'domains'];
  const domains = useQuery({ queryKey: key, queryFn: () => hubApi.branding.domains(organizationId) });
  const [domain, setDomain] = useState('');
  const [kind, setKind] = useState<OrganizationDomainKind>('booking');
  const [created, setCreated] = useState<OrganizationDomainCreated | null>(null);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: key });
  const add = useMutation({ mutationFn: () => hubApi.branding.addDomain(organizationId, { domain: domain.trim(), kind }), onSuccess: (d) => { setCreated(d); setDomain(''); refresh(); } });
  const remove = useMutation({ mutationFn: (domainId: string) => hubApi.branding.removeDomain(organizationId, domainId), onSuccess: refresh });
  const verify = useMutation({ mutationFn: (domainId: string) => hubApi.branding.verifyDomain(organizationId, domainId), onSuccess: refresh });
  const columns: Column<OrganizationDomainView>[] = [
    { key: 'domain', header: t('hub.brand.domain'), cell: (d) => <code>{d.domain}</code> },
    { key: 'kind', header: t('hub.brand.kind'), cell: (d) => t(`hub.brand.kinds.${d.kind}`) },
    { key: 'state', header: t('hub.brand.state'), cell: (d) => (d.verifiedAt ? <Badge tone="success">{t('hub.brand.verifiedOn', { date: formatDate(d.verifiedAt, lang) })}</Badge> : <Badge tone="warning">{t('hub.brand.pending')}</Badge>) },
    {
      key: 'actions', header: <span className="sr-only">{t('hub.common.actions')}</span>, cell: (d) => (
        <div className="flex flex-wrap gap-2">
          {!d.verifiedAt && platformAdmin ? <Action tone="secondary" busy={verify.isPending && verify.variables === d.id} onClick={() => verify.mutate(d.id)}>{t('hub.brand.verify')}</Action> : null}
          <Action tone="danger" busy={remove.isPending && remove.variables === d.id} onClick={() => remove.mutate(d.id)}>{t('hub.brand.remove')}</Action>
        </div>
      ),
    },
  ];
  const error = add.error ?? remove.error ?? verify.error;
  return (
    <Card title={t('hub.brand.domains')}>
      <p className="mb-3 text-sm text-slate-700">{t('hub.brand.domainsIntro')}</p>
      {domains.isPending ? <Loading /> : domains.isError ? <ErrorBlock error={domains.error} onRetry={() => void domains.refetch()} /> : (
        <DataTable caption={t('hub.brand.domains')} columns={columns} rows={domains.data} rowKey={(d) => d.id} empty={t('hub.brand.none')} />
      )}
      {created ? <DnsRecord created={created} /> : null}
      <form className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem_auto] sm:items-end" onSubmit={(e) => { e.preventDefault(); if (domain.trim()) add.mutate(); }}>
        <Field label={t('hub.brand.domain')}>{(p) => <Input {...p} required maxLength={253} placeholder="reservation.exemple.ca" value={domain} onChange={(e) => { setDomain(e.target.value); setCreated(null); }} />}</Field>
        <Field label={t('hub.brand.kind')}>
          {(p) => <Select {...p} value={kind} onChange={(e) => setKind(e.target.value as OrganizationDomainKind)}>{ORGANIZATION_DOMAIN_KINDS.map((k) => <option key={k} value={k}>{t(`hub.brand.kinds.${k}`)}</option>)}</Select>}
        </Field>
        <Action type="submit" busy={add.isPending}>{t('hub.brand.add')}</Action>
      </form>
      {error ? <div className="mt-3"><Notice tone="danger">{errorText(error)}</Notice></div> : null}
    </Card>
  );
}

/** Enregistrement TXT à poser, rendu une seule fois par l'API à la création du domaine. */
export function DnsRecord({ created }: { created: OrganizationDomainCreated }) {
  const { t } = useTranslation();
  return (
    <div className="mt-3 rounded-md border border-amber-400 bg-amber-50 p-3 text-sm" role="status">
      <p className="font-semibold">{t('hub.brand.dnsTitle')} · <code>{created.domain}</code></p>
      <p className="text-amber-950">{t('hub.brand.dnsOnce')}</p>
      <dl className="mt-2 grid gap-x-3 gap-y-1 sm:grid-cols-[6rem_1fr]">
        <dt className="font-semibold">{t('hub.brand.dnsType')}</dt><dd><code>{created.dnsRecord.type}</code></dd>
        <dt className="font-semibold">{t('hub.brand.dnsName')}</dt><dd><code className="break-all">{created.dnsRecord.name}</code></dd>
        <dt className="font-semibold">{t('hub.brand.dnsValue')}</dt><dd><code className="break-all">{created.dnsRecord.value}</code></dd>
      </dl>
    </div>
  );
}

