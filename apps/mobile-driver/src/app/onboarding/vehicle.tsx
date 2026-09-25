import type { AdmittedModel, VehicleInputBody } from '@neomoov/domain';
import { Body, Button, Card, Field } from '@neomoov/mobile-core/components';
import { colors, spacing, typography } from '@neomoov/mobile-core/theme';
import { ErrorState, Notice, Row, Screen, SectionTitle, ToggleRow } from '@neomoov/mobile-core/ui';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text } from 'react-native';
import { api, errorMessage } from '@/lib/api';
import { keys, queryClient, useAppConfig, useVehicleModels, useVehicles } from '@/lib/queries';

const EQUIPMENT = ['childSeat', 'boosterSeat', 'wheelchairAccessible', 'water', 'chargers', 'wifi', 'umbrella'] as const;
type Equipment = Record<(typeof EQUIPMENT)[number], boolean>;

/** « Tesla Model Y » : la marque est le premier mot, le modèle le reste (plus la version saisie). */
function splitModel(model: AdmittedModel, trim: string): { make: string; model: string } {
  const [make = '', ...rest] = model.name.split(' ');
  return { make, model: [rest.join(' '), trim.trim()].filter(Boolean).join(' ') };
}

/** Véhicule (parcours 10) : modèle choisi dans la liste des modèles admis, catégorie déduite par l'API. */
export default function VehicleScreen() {
  const { t } = useTranslation();
  const vehicles = useVehicles();
  const models = useVehicleModels();
  const config = useAppConfig();
  const [search, setSearch] = useState('');
  const [chosen, setChosen] = useState<AdmittedModel | null>(null);
  const [trim, setTrim] = useState('');
  const [year, setYear] = useState('');
  const [colour, setColour] = useState('');
  const [plate, setPlate] = useState('');
  const [seats, setSeats] = useState('5');
  const [vin, setVin] = useState('');
  const [equipment, setEquipment] = useState<Equipment>({ childSeat: false, boosterSeat: false, wheelchairAccessible: false, water: true, chargers: true, wifi: false, umbrella: true });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const categoryName = (code: string) => config.data?.categories.find((c) => c.code === code)?.name ?? code;
  const filtered = useMemo(() => (models.data ?? []).filter((m) => m.name.toLowerCase().includes(search.trim().toLowerCase())), [models.data, search]);
  const yearNumber = Number.parseInt(year, 10);
  const seatsNumber = Number.parseInt(seats, 10);
  const valid = chosen !== null && yearNumber >= 2015 && yearNumber <= 2100 && colour.trim().length >= 2 && /^[A-Za-z0-9 -]{2,12}$/.test(plate.trim()) && seatsNumber >= 1 && seatsNumber <= 8;

  async function add() {
    if (!chosen || !valid) {
      setError(t('vehicle.invalid'));
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const body: VehicleInputBody = { ...splitModel(chosen, trim), year: yearNumber, colour: colour.trim(), plate: plate.trim().toUpperCase(), seats: seatsNumber, equipment, ...(vin.trim() ? { vin: vin.trim().toUpperCase() } : {}) };
      const created = await api.driver.addVehicle(body);
      await Promise.all([queryClient.invalidateQueries({ queryKey: keys.vehicles }), queryClient.invalidateQueries({ queryKey: keys.onboarding }), queryClient.invalidateQueries({ queryKey: keys.home })]);
      setNotice(t('vehicle.category', { category: categoryName(created.category) }));
      setChosen(null);
      setPlate('');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen back title={t('vehicle.title')} footer={<Button label={t('vehicle.add')} onPress={() => void add()} disabled={busy || !valid} testID="vehicle-add" />}>
      {(vehicles.data ?? []).length ? <SectionTitle>{t('vehicle.mine')}</SectionTitle> : null}
      {(vehicles.data ?? []).map((v) => (
        <Card key={v.id}>
          <Row label={`${v.make} ${v.model} ${v.year}`} value={v.plate} strong />
          <Row label={t('vehicle.category', { category: categoryName(v.category) })} value={t(`vehicle.statuses.${v.status}`)} />
          {v.current ? <Body muted>{t('vehicle.current')}</Body> : null}
        </Card>
      ))}
      <Body muted>{t('vehicle.intro')}</Body>
      <Field label={t('vehicle.modelSearch')} value={search} onChangeText={setSearch} autoCapitalize="none" testID="model-search" />
      {filtered.slice(0, 12).map((m) => {
        const selected = chosen?.name === m.name;
        return (
          <Pressable key={m.name} accessibilityRole="radio" accessibilityState={{ selected }} onPress={() => setChosen(m)} style={[styles.model, selected && styles.modelSelected]} testID={`model-${m.name}`}>
            <Text style={[styles.modelName, selected && styles.modelNameSelected]}>{m.name}</Text>
            <Text style={[styles.modelMeta, selected && styles.modelNameSelected]}>{m.categories.map(categoryName).join(', ')} · {t('vehicle.minYear', { year: m.minYear })}</Text>
          </Pressable>
        );
      })}
      {chosen ? (
        <>
          <Field label={t('vehicle.trim')} value={trim} onChangeText={setTrim} maxLength={30} />
          <Field label={t('vehicle.year')} value={year} onChangeText={(v) => setYear(v.replace(/\D/g, '').slice(0, 4))} keyboardType="number-pad" maxLength={4} testID="vehicle-year" />
          <Field label={t('vehicle.colour')} value={colour} onChangeText={setColour} maxLength={40} testID="vehicle-colour" />
          <Field label={t('vehicle.plate')} value={plate} onChangeText={setPlate} autoCapitalize="characters" maxLength={12} testID="vehicle-plate" />
          <Field label={t('vehicle.seats')} value={seats} onChangeText={(v) => setSeats(v.replace(/\D/g, '').slice(0, 1))} keyboardType="number-pad" maxLength={1} />
          <Field label={t('vehicle.vin')} value={vin} onChangeText={setVin} autoCapitalize="characters" maxLength={17} />
          <SectionTitle>{t('vehicle.equipment')}</SectionTitle>
          {EQUIPMENT.map((item) => (
            <ToggleRow key={item} label={t(`vehicle.equipmentItems.${item}`)} value={equipment[item]} onChange={(on) => setEquipment((e) => ({ ...e, [item]: on }))} />
          ))}
        </>
      ) : null}
      {notice ? <Notice tone="success">{notice}</Notice> : null}
      {error ? <ErrorState message={error} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  model: { padding: spacing.md, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white, gap: 2 },
  modelSelected: { backgroundColor: colors.blue, borderColor: colors.blue },
  modelName: { fontSize: typography.sizes.md, fontWeight: '700', color: colors.night },
  modelNameSelected: { color: colors.white },
  modelMeta: { fontSize: typography.sizes.xs, color: colors.muted },
});
