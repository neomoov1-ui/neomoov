import { isJoinCode, normalizeJoinCode, type PublicBrand } from '@neomoov/domain';
import { BrandPreview } from '@neomoov/mobile-core/brand';
import { Body, Button, Field } from '@neomoov/mobile-core/components';
import { ErrorState, Notice, Screen } from '@neomoov/mobile-core/ui';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, errorMessage } from '@/lib/api';
import { usePendingJoin } from '@/lib/pending-join';
import { keys, queryClient } from '@/lib/queries';
import { useSession } from '@/lib/session';

/**
 * Rejoindre une organisation (étape 22) : code saisi, lu sur un code QR ou reçu par le lien des chauffeurs
 * `https://neomoov.net/d/<code>` (ou `neomoov-driver://c/<code>`) ; aperçu de la marque, puis rattachement du profil par
 * l'API (l'application prend la marque de l'organisation). Le rattachement comme chauffeur d'une flotte (répartition,
 * relevés) passe par l'invitation de l'organisation (écran `fleet-invitation`).
 */
export default function JoinScreen() {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ code?: string }>();
  const status = useSession((s) => s.status);
  const [code, setCode] = useState(typeof params.code === 'string' ? normalizeJoinCode(params.code) : '');
  const [preview, setPreview] = useState<PublicBrand | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [joined, setJoined] = useState<string | null>(null);
  const normalized = normalizeJoinCode(code);
  const valid = isJoinCode(normalized);

  useEffect(() => {
    if (!valid) {
      setPreview(null);
      setPreviewError(null);
      return;
    }
    let cancelled = false;
    api.branding
      .publicByCode(normalized)
      .then((found: PublicBrand) => {
        if (cancelled) return;
        setPreview(found);
        setPreviewError(null);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setPreview(null);
        setPreviewError(errorMessage(e));
      });
    return () => {
      cancelled = true;
    };
  }, [normalized, valid]);

  async function join() {
    if (!valid) {
      setError(t('organization.invalidCode'));
      return;
    }
    if (status !== 'signedIn') {
      usePendingJoin.getState().set(normalized);
      router.push('/login');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await api.branding.attach(normalized);
      await queryClient.invalidateQueries({ queryKey: keys.config });
      setJoined(result.organization.name);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const leave = () => (router.canGoBack() ? router.back() : router.replace('/'));
  return (
    <Screen
      back
      title={t('organization.title')}
      footer={joined ? <Button label={t('core:continue')} onPress={leave} /> : <Button label={t('organization.join')} onPress={() => void join()} disabled={busy || !valid} testID="join-organization" />}
    >
      <Body muted>{t('organization.intro')}</Body>
      <Field label={t('organization.codeLabel')} hint={t('organization.codeHint')} value={code} onChangeText={(v) => setCode(v.toUpperCase())} autoCapitalize="characters" autoCorrect={false} maxLength={12} testID="join-code" />
      {preview ? (
        <>
          <BrandPreview brand={preview.brand} />
          <Body>{t('organization.preview', { name: preview.organizationName })}</Body>
        </>
      ) : null}
      {previewError ? <ErrorState message={previewError} /> : null}
      <Notice>{t('organization.fleetNote')}</Notice>
      <Button label={t('fleetInvite.open')} variant="ghost" onPress={() => router.push('/fleet-invitation')} testID="join-fleet-invitation" />
      {status !== 'signedIn' ? <Notice>{t('organization.signInFirst')}</Notice> : null}
      {joined ? <Notice tone="success">{t('organization.joined', { name: joined })}</Notice> : null}
      {error ? <ErrorState message={error} /> : null}
    </Screen>
  );
}
