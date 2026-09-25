import type { AppConfig } from '@neomoov/domain';
import { colors, radius, spacing, typography } from '@neomoov/mobile-core/theme';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { pickupSchedule, serviceClock } from '@/features/booking/logic';
import { formatDay, formatTime, type UiLanguage } from '@/lib/format';

/**
 * Date et heure de prise en charge (D32) : jour, heure puis quart d'heure, à l'heure de Montréal ; seuls les créneaux à
 * au moins 2 heures et à moins de 30 jours sont proposés (réglages de l'API) ; « maintenant » n'existe pas en V1.
 */
export function PickupPicker({ booking, value, onChange }: { booking: AppConfig['booking']; value: string | null; onChange: (iso: string) => void }) {
  const { t, i18n } = useTranslation();
  const language = (i18n.language === 'en' ? 'en' : 'fr-CA') as UiLanguage;
  const schedule = useMemo(() => pickupSchedule(new Date(), booking), [booking]);
  const selected = value ? new Date(value) : null;
  const [dayKey, setDayKey] = useState<string | null>(() => (selected ? serviceClock(selected).day : (schedule[0]?.day ?? null)));
  const day = schedule.find((d) => d.day === dayKey) ?? schedule[0] ?? null;
  const hours = useMemo(() => [...new Set((day?.slots ?? []).map((s) => serviceClock(s).hour))], [day]);
  const [hour, setHour] = useState<number | null>(() => (selected ? serviceClock(selected).hour : null));
  const activeHour = hour !== null && hours.includes(hour) ? hour : (hours[0] ?? null);
  const quarters = (day?.slots ?? []).filter((s) => serviceClock(s).hour === activeHour);

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{t('book.when')}</Text>
      <Text style={styles.hint}>{t('book.leadTime')}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row} accessibilityRole="radiogroup">
        {schedule.map((d, index) => {
          const active = d.day === day?.day;
          return (
            <Pressable key={d.day} testID={`pickup-day-${index}`} accessibilityRole="radio" accessibilityState={{ selected: active }} onPress={() => setDayKey(d.day)} style={[styles.pill, active && styles.active]}>
              <Text style={[styles.text, active && styles.activeText]}>{formatDay(d.slots[0]!, language)}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      {schedule.length === 0 ? <Text style={styles.hint}>{t('book.noSlot')}</Text> : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row} accessibilityRole="radiogroup">
        {hours.map((h) => {
          const active = h === activeHour;
          return (
            <Pressable key={h} testID={`pickup-hour-${h}`} accessibilityRole="radio" accessibilityState={{ selected: active }} onPress={() => setHour(h)} style={[styles.hour, active && styles.activeSoft]}>
              <Text style={[styles.text, active && styles.activeSoftText]}>{`${String(h).padStart(2, '0')} h`}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <View style={styles.quarters} accessibilityRole="radiogroup">
        {quarters.map((s, index) => {
          const active = selected !== null && s.getTime() === selected.getTime();
          return (
            <Pressable key={s.toISOString()} testID={`pickup-slot-${index}`} accessibilityRole="radio" accessibilityState={{ selected: active }} onPress={() => onChange(s.toISOString())} style={[styles.quarter, active && styles.active]}>
              <Text style={[styles.text, active && styles.activeText]}>{formatTime(s, language)}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  label: { fontSize: typography.sizes.sm, fontWeight: '700', color: colors.ink },
  hint: { fontSize: typography.sizes.xs, color: colors.muted },
  row: { gap: spacing.xs, paddingVertical: spacing.xs },
  pill: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white },
  hour: { minWidth: 58, alignItems: 'center', paddingVertical: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white },
  quarters: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  quarter: { width: 76, alignItems: 'center', paddingVertical: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white },
  text: { fontSize: typography.sizes.sm, color: colors.ink, fontWeight: '600', fontVariant: ['tabular-nums'] },
  active: { backgroundColor: colors.blue, borderColor: colors.blue },
  activeText: { color: colors.white },
  activeSoft: { backgroundColor: colors.tint, borderColor: colors.blue },
  activeSoftText: { color: colors.blueDark },
});
