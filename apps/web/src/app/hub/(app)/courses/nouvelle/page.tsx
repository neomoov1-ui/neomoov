'use client';

import { useRouter } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import { useCanWrite } from '@/components/hub/common';
import { NewRideForm, type NewRideApi } from '@/components/hub/new-ride-form';
import { Notice, PageTitle } from '@/components/ui/kit';
import { hubApi } from '@/lib/hub-api';

const PLATFORM_API: NewRideApi = {
  quote: (body) => hubApi.quotes.create(body),
  create: (body) => hubApi.admin.createRide(body),
  searchClients: async (q) => (await hubApi.admin.clients({ pageSize: 20, ...(q ? { q } : {}) })).items,
};

/** Création d'une course par téléphone : devis au prix garanti, client existant ou fiche minimale, paiement au chauffeur. */
export default function NewRidePage() {
  const { t } = useTranslation();
  const router = useRouter();
  const writable = useCanWrite();
  if (!writable) return <Notice tone="warning">{t('hub.common.forbidden')}</Notice>;
  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <PageTitle title={t('hub.newRide.title')} subtitle={t('hub.newRide.subtitle')} />
      <NewRideForm api={PLATFORM_API} scope="platform" onCreated={(ride) => router.push(`/hub/courses/${ride.id}`)} />
    </div>
  );
}
