'use client';

/** Étape 21 : messages d'erreur de l'espace organisation (dernier propriétaire, double authentification requise). */
import { useTranslation } from 'react-i18next';
import { ApiError } from '@/lib/hub-api';
import { useErrorText } from './common';

export function useOrgErrorText() {
  const { t } = useTranslation();
  const base = useErrorText();
  return (error: unknown): string => {
    if (error instanceof ApiError) {
      if (error.code === 'LAST_OWNER') return t('org.members.lastOwner');
      if (error.status === 403 && (error.details as { mfaRequired?: boolean } | undefined)?.mfaRequired) return t('org.shell.mfaNotice');
    }
    return base(error);
  };
}
