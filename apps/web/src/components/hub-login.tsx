'use client';

import { useRouter } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';

export function HubLogin() {
  const { t } = useTranslation();
  const router = useRouter();
  const enter = () => {
    // Étape 1 seulement : un témoin de session factice. L'étape 3 remplace ce bouton par la connexion à deux facteurs.
    document.cookie = 'hub_session=dev; path=/; max-age=3600; samesite=lax';
    router.push('/hub');
  };
  return (
    <section className="py-12">
      <h1 className="text-3xl text-brand-night">{t('hub.title')}</h1>
      <p className="mt-4 max-w-2xl">{t('hub.locked')}</p>
      <div className="mt-6">
        <Button onClick={enter}>{t('hub.login')}</Button>
      </div>
    </section>
  );
}
