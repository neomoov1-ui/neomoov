import {
  BODY_ZONES, INSPECTION_ITEMS, INSPECTION_PHOTO_STEPS, ITEM_STATES, defaultInspectionItems, overallSeverity, type BodyZone, type BodyZoneEntry, type InspectionItem, type InspectionItems,
  type ItemState, type PhotoKind, type VehicleInspectionView,
} from '@neomoov/domain';
import { Body, Button, Card, Field } from '@neomoov/mobile-core/components';
import { colors, radius, spacing, typography } from '@neomoov/mobile-core/theme';
import { Choices, ErrorState, Loading, Notice, Row, Screen, SectionTitle, ToggleRow } from '@neomoov/mobile-core/ui';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { inspectionForm, pickBoosterPhoto, type PickedPhoto } from '@/features/booster/photos';
import { api, errorMessage } from '@/lib/api';
import { keys, queryClient } from '@/lib/queries';

type Stage = 'photos' | 'review' | 'done';
const MIN_PHOTOS = 6;
const SEVERITY_COLORS = { ok: colors.green, minor: colors.warning, major: colors.danger } as const;

interface ReviewForm {
  plate: string;
  accessoryNumber: string;
  driverName: string;
  licenceNumber: string;
  odometerKm: string;
  energyPercent: string;
  warningLightOn: boolean;
  warningLightReason: string;
  items: InspectionItems;
  zones: Record<string, string>;
  notes: string;
  attested: boolean;
}

function formOf(i: VehicleInspectionView): ReviewForm {
  return {
    plate: i.plate ?? '', accessoryNumber: i.accessoryNumber ?? '', driverName: i.driverName ?? '', licenceNumber: i.licenceNumber ?? '',
    odometerKm: i.odometerKm?.toString() ?? '', energyPercent: i.energyPercent?.toString() ?? '', warningLightOn: i.warningLightOn, warningLightReason: i.warningLightReason ?? '',
    items: i.items ?? defaultInspectionItems(), zones: Object.fromEntries(i.bodyZones.map((z) => [z.zone, z.description])), notes: i.notes ?? '', attested: i.allItemsChecked,
  };
}

const int = (v: string): number | null => (v.trim() === '' ? null : Number.isInteger(Number(v)) ? Number(v) : null);

/**
 * Vérification sommaire par caméra (Neomoov Booster) : parcours de photos guidé (une étape par vue, reprise possible),
 * envoi et analyse, écran de confirmation (champs préremplis par l'analyse, à confirmer ou corriger ; gravité par élément ;
 * zones de carrosserie), archivage et téléchargement du PDF. Rien n'est archivé sans la confirmation du chauffeur.
 */
export default function InspectionScreen() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === 'en' ? 'en' : 'fr';
  const params = useLocalSearchParams<{ id?: string }>();
  const [stage, setStage] = useState<Stage>(params.id ? 'review' : 'photos');
  const [photos, setPhotos] = useState<Partial<Record<PhotoKind, PickedPhoto>>>({});
  const [inspection, setInspection] = useState<VehicleInspectionView | null>(null);
  const [form, setForm] = useState<ReviewForm | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(params.id));

  useEffect(() => {
    if (!params.id) return;
    api.driver.inspection(params.id).then((i) => { setInspection(i); setForm(formOf(i)); setStage(i.status === 'archived' ? 'done' : 'review'); }).catch((e) => setError(errorMessage(e))).finally(() => setLoading(false));
  }, [params.id]);

  const taken = INSPECTION_PHOTO_STEPS.filter((s) => photos[s.kind]).length;
  const requiredTaken = INSPECTION_PHOTO_STEPS.filter((s) => s.required && photos[s.kind]).length;
  const requiredTotal = INSPECTION_PHOTO_STEPS.filter((s) => s.required).length;

  async function take(kind: PhotoKind, source: 'camera' | 'library') {
    setError(null);
    const picked = await pickBoosterPhoto(source);
    if (picked === 'denied') setError(t('booster.inspection.cameraDenied'));
    else if (picked[0]) setPhotos((p) => ({ ...p, [kind]: picked[0] }));
  }

  async function send(analyse: boolean) {
    setBusy(analyse ? 'analyse' : 'send');
    setError(null);
    try {
      const list = INSPECTION_PHOTO_STEPS.filter((s) => photos[s.kind]).map((s) => ({ kind: s.kind, file: photos[s.kind]! }));
      let created = await api.driver.createInspection(await inspectionForm(list));
      if (analyse) created = await api.driver.analyseInspection(created.id);
      setInspection(created);
      setForm(formOf(created));
      setStage('review');
      void queryClient.invalidateQueries({ queryKey: keys.boosterInspections });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  const set = <K extends keyof ReviewForm>(key: K, value: ReviewForm[K]) => setForm((f) => (f ? { ...f, [key]: value } : f));
  const setItem = (item: InspectionItem, patch: Partial<{ state: ItemState; note: string | null }>) => setForm((f) => (f ? { ...f, items: { ...f.items, [item]: { ...f.items[item], ...patch } } } : f));
  const toggleZone = (zone: BodyZone) => setForm((f) => {
    if (!f) return f;
    const zones = { ...f.zones };
    if (zone in zones) delete zones[zone];
    else zones[zone] = '';
    return { ...f, zones };
  });

  const payloadOf = (f: ReviewForm) => {
    const bodyZones: BodyZoneEntry[] = (Object.entries(f.zones) as Array<[BodyZone, string]>).map(([zone, description]) => ({ zone, description: description.trim() || t(`booster.zones.${zone}`) }));
    return {
      plate: f.plate.trim() || null, accessoryNumber: f.accessoryNumber.trim() || null, driverName: f.driverName.trim() || null, licenceNumber: f.licenceNumber.trim() || null,
      odometerKm: int(f.odometerKm), energyPercent: int(f.energyPercent), warningLightOn: f.warningLightOn, warningLightReason: f.warningLightOn ? f.warningLightReason.trim() || null : null,
      items: f.items, bodyZones, notes: f.notes.trim() || null,
    };
  };

  async function confirm() {
    if (!form || !inspection) return;
    setError(null);
    if (!form.attested) {
      setError(t('booster.inspection.attestRequired'));
      return;
    }
    if (int(form.odometerKm) === null && form.odometerKm.trim() !== '') {
      setError(t('booster.inspection.numberInvalid'));
      return;
    }
    setBusy('confirm');
    try {
      const archived = await api.driver.confirmInspection(inspection.id, { ...payloadOf(form), allItemsChecked: true });
      setInspection(archived);
      setForm(formOf(archived));
      setStage('done');
      void queryClient.invalidateQueries({ queryKey: keys.boosterInspections });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function download() {
    if (!inspection) return;
    setBusy('download');
    try {
      const link = await api.driver.inspectionDownload(inspection.id);
      await Linking.openURL(link.url);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  const severity = form ? overallSeverity(form.items, Object.keys(form.zones).map((zone) => ({ zone: zone as BodyZone, description: 'x' }))) : 'ok';

  return (
    <Screen back title={t('booster.inspection.title')}>
      {loading ? <Loading /> : null}
      {error ? <ErrorState message={error} /> : null}

      {stage === 'photos' ? (
        <>
          <Body muted>{t('booster.inspection.photosIntro')}</Body>
          <Notice tone="info">{t('booster.inspection.progress', { taken, total: INSPECTION_PHOTO_STEPS.length, required: requiredTotal })}</Notice>
          {INSPECTION_PHOTO_STEPS.map((step, index) => {
            const photo = photos[step.kind];
            return (
              <Card key={step.kind} style={styles.card}>
                <Text style={styles.stepTitle}>{index + 1}. {t(`booster.photoKinds.${step.kind}`)}{step.required ? '' : ` · ${t('booster.inspection.optional')}`}</Text>
                <Body muted>{t(`booster.inspection.guides.${step.kind}`)}</Body>
                {photo ? <Image source={{ uri: photo.uri }} style={styles.preview} contentFit="cover" accessibilityLabel={t(`booster.photoKinds.${step.kind}`)} /> : <View style={styles.frame}><Text style={styles.frameText}>{t('booster.inspection.frame')}</Text></View>}
                <View style={styles.buttons}>
                  <Button label={photo ? t('booster.inspection.retake') : t('booster.inspection.take')} variant="secondary" onPress={() => void take(step.kind, 'camera')} style={styles.flex} testID={`photo-${step.kind}`} />
                  <Button label={t('booster.inspection.pick')} variant="ghost" onPress={() => void take(step.kind, 'library')} style={styles.flex} />
                </View>
              </Card>
            );
          })}
          <Notice tone="info">{t('booster.inspection.analysisIsHelp')}</Notice>
          <Button label={busy === 'analyse' ? t('booster.inspection.analysing') : t('booster.inspection.sendAndAnalyse')} onPress={() => void send(true)} disabled={busy !== null || requiredTaken < requiredTotal || taken < MIN_PHOTOS} testID="inspection-send" />
          <Button label={t('booster.inspection.manual')} variant="ghost" onPress={() => void send(false)} disabled={busy !== null} />
        </>
      ) : null}

      {stage === 'review' && form && inspection ? (
        <>
          {inspection.analysis.status === 'done' ? <Notice tone="success">{t('booster.inspection.analysed', { percent: Math.round((inspection.analysis.confidence ?? 0) * 100) })}{inspection.analysis.summary ? `\n${inspection.analysis.summary}` : ''}</Notice> : null}
          {inspection.analysis.status === 'failed' ? <Notice tone="warning">{t('booster.inspection.analysisFailed')}</Notice> : null}
          {inspection.analysis.status === 'none' ? <Notice tone="info">{t('booster.inspection.noAnalysis')}</Notice> : null}
          <Body muted>{t('booster.inspection.reviewIntro', { count: inspection.photos.length })}</Body>

          <SectionTitle>{t('booster.inspection.identification')}</SectionTitle>
          <Card style={styles.card}>
            <Field label={t('booster.inspection.plate')} value={form.plate} onChangeText={(v) => set('plate', v)} autoCapitalize="characters" maxLength={12} />
            <Field label={t('booster.inspection.accessory')} value={form.accessoryNumber} onChangeText={(v) => set('accessoryNumber', v)} maxLength={40} />
            <Field label={t('booster.inspection.driverName')} value={form.driverName} onChangeText={(v) => set('driverName', v)} maxLength={120} />
            <Field label={t('booster.inspection.licence')} value={form.licenceNumber} onChangeText={(v) => set('licenceNumber', v)} autoCapitalize="characters" maxLength={40} />
            <Field label={t('booster.inspection.odometer')} value={form.odometerKm} onChangeText={(v) => set('odometerKm', v)} keyboardType="number-pad" maxLength={7} />
            <Field label={t('booster.inspection.energy')} value={form.energyPercent} onChangeText={(v) => set('energyPercent', v)} keyboardType="number-pad" maxLength={3} />
            <ToggleRow label={t('booster.inspection.warningLight')} value={form.warningLightOn} onChange={(v) => set('warningLightOn', v)} />
            {form.warningLightOn ? <Field label={t('booster.inspection.warningReason')} value={form.warningLightReason} onChangeText={(v) => set('warningLightReason', v)} maxLength={300} /> : null}
          </Card>

          <SectionTitle>{t('booster.inspection.items')}</SectionTitle>
          <Body muted>{t('booster.inspection.itemsHint')}</Body>
          {INSPECTION_ITEMS.map((item) => {
            const entry = form.items[item];
            const fromAnalysis = inspection.analysis.itemsFromAnalysis.includes(item);
            return (
              <Card key={item} style={styles.card}>
                <Text style={styles.stepTitle}>{t(`booster.items.${item}`)}{fromAnalysis ? ` · ${t('booster.inspection.fromAnalysis')}` : ''}</Text>
                <Choices value={entry.state} onChange={(state) => setItem(item, { state })} options={ITEM_STATES.map((s) => ({ value: s, label: t(`booster.states.${s}`) }))} />
                {entry.state === 'minor' || entry.state === 'major' ? <Field label={t('booster.inspection.observation')} value={entry.note ?? ''} onChangeText={(v) => setItem(item, { note: v })} maxLength={200} /> : null}
              </Card>
            );
          })}
          <ToggleRow label={t('booster.inspection.attest')} hint={t('booster.inspection.attestHint')} value={form.attested} onChange={(v) => set('attested', v)} />

          <SectionTitle>{t('booster.inspection.bodyZones')}</SectionTitle>
          <Body muted>{t('booster.inspection.zonesHint')}</Body>
          <View style={styles.carGrid}>
            {([
              ['front_left', 'front_right'], ['windshield', 'windshield'], ['left_side', 'roof', 'right_side'], ['rear_window', 'rear_window'], ['rear_left', 'rear_right'],
            ] as BodyZone[][]).map((rowZones, rowIndex) => (
              <View key={rowIndex} style={styles.carRow}>
                {[...new Set(rowZones)].map((zone) => {
                  const selected = zone in form.zones;
                  return (
                    <Pressable key={zone} accessibilityRole="checkbox" accessibilityState={{ checked: selected }} onPress={() => toggleZone(zone)} style={[styles.zone, selected && styles.zoneSelected]}>
                      <Text style={[styles.zoneText, selected && styles.zoneTextSelected]}>{t(`booster.zones.${zone}`)}</Text>
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </View>
          {BODY_ZONES.filter((z) => z in form.zones).map((zone) => (
            <Field key={zone} label={t('booster.inspection.zoneDescription', { zone: t(`booster.zones.${zone}`) })} value={form.zones[zone] ?? ''} onChangeText={(v) => set('zones', { ...form.zones, [zone]: v })} maxLength={200} />
          ))}
          <Field label={t('booster.inspection.notes')} value={form.notes} onChangeText={(v) => set('notes', v)} multiline maxLength={1000} />

          <Card style={styles.card}>
            <View style={styles.severityRow}>
              <View style={[styles.dot, { backgroundColor: SEVERITY_COLORS[severity] }]} />
              <Text style={styles.stepTitle}>{t(`booster.severities.${severity}`)}</Text>
            </View>
            {severity === 'major' ? <Body muted>{t('booster.inspection.majorWarning')}</Body> : null}
          </Card>
          <Button label={busy === 'confirm' ? t('booster.inspection.archiving') : t('booster.inspection.confirm')} onPress={() => void confirm()} disabled={busy !== null} testID="inspection-confirm" />
          <Body muted>{t('booster.inspection.lang', { lang })}</Body>
        </>
      ) : null}

      {stage === 'done' && inspection ? (
        <>
          <Notice tone={inspection.severity === 'major' ? 'warning' : 'success'}>{inspection.severity === 'major' ? t('booster.inspection.doneMajor') : t('booster.inspection.done')}</Notice>
          <Card style={styles.card}>
            <Row label={t('booster.inspection.plate')} value={inspection.plate ?? ''} />
            <Row label={t('booster.inspection.odometer')} value={inspection.odometerKm !== null ? `${inspection.odometerKm} km` : ''} />
            <Row label={t('booster.severity')} value={t(`booster.severities.${inspection.severity}`)} strong />
          </Card>
          <Button label={t('booster.inspection.downloadPdf')} onPress={() => void download()} disabled={busy !== null} />
          <Button label={t('booster.inspection.myReports')} variant="secondary" onPress={() => router.replace('/booster/inspections')} />
          <Body muted>{t('booster.inspection.formatsNote')}</Body>
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm },
  stepTitle: { fontSize: typography.sizes.md, fontWeight: '700', color: colors.night },
  preview: { width: '100%', height: 180, borderRadius: radius.md, backgroundColor: colors.mist },
  frame: { height: 120, borderRadius: radius.md, borderWidth: 2, borderStyle: 'dashed', borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  frameText: { color: colors.muted, fontSize: typography.sizes.sm },
  buttons: { flexDirection: 'row', gap: spacing.sm },
  flex: { flex: 1 },
  carGrid: { gap: spacing.xs, alignItems: 'stretch' },
  carRow: { flexDirection: 'row', gap: spacing.xs },
  zone: { flex: 1, minHeight: 44, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.white, paddingHorizontal: spacing.xs },
  zoneSelected: { borderColor: colors.danger, backgroundColor: '#FDE2E1' },
  zoneText: { fontSize: typography.sizes.xs, color: colors.ink, textAlign: 'center' },
  zoneTextSelected: { color: colors.danger, fontWeight: '700' },
  severityRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dot: { width: 14, height: 14, borderRadius: 7 },
});
