'use client';

import { useRouter } from 'next/navigation';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { NewRideForm, type NewRideApi } from '@/components/hub/new-ride-form';
import { OrgPage } from '@/components/hub/org-context';
import { Notice, PageTitle } from '@/components/ui/kit';
import { hubApi } from '@/lib/hub-api';

/**
 * Étape 23 : course saisie par le répartiteur d'une organisation (`POST /v1/org/:id/quotes` puis `/rides`) ; elle
 * appartient à l'organisation et part d'abord à ses chauffeurs. Client : fiche minimale (nom, téléphone, langue), les
 * comptes clients de la plateforme ne sont pas consultables depuis une organisation.
 */
export default function OrgNewRidePage() {
  return <OrgPage permissions={['rides.create']}>{(orgId) => <OrgNewRide orgId={orgId} />}</OrgPage>;
}

function OrgNewRide({ orgId }: { orgId: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const api = useMemo<NewRideApi>(() => ({ quote: (body) => hubApi.org.quote(orgId, body), create: (body) => hubApi.org.createRide(orgId, body) }), [orgId]);
  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <PageTitle title={t('org.newRide.title')} subtitle={t('org.newRide.subtitle')} />
      <Notice tone="info">{t('org.newRide.guestOnly')}</Notice>
      <NewRideForm key={orgId} api={api} scope={`org-${orgId}`} onCreated={(ride) => router.push(`/hub/organisation/courses/${ride.id}`)} />
    </div>
  );
}
