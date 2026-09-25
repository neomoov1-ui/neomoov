/** Éléments d'interface propres à l'application client (au-dessus des composants communs de `mobile-core`). */
import { Body, Button, Card } from '@neomoov/mobile-core/components';
import { colors, radius, spacing, typography } from '@neomoov/mobile-core/theme';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

/** Écran standard : zone sûre, défilement, titre et retour facultatifs. */
export function Screen({ title, subtitle, back, children, footer, onRefresh, refreshing }: { title?: string; subtitle?: string; back?: boolean; children: ReactNode; footer?: ReactNode; onRefresh?: () => void; refreshing?: boolean }) {
  const { t } = useTranslation();
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      {back || title ? (
        <View style={styles.header}>
          {back ? (
            <Pressable accessibilityRole="button" accessibilityLabel={t('core:back')} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} hitSlop={12} style={styles.back}>
              <Ionicons name="chevron-back" size={26} color={colors.night} />
            </Pressable>
          ) : null}
          <View style={styles.headerText}>
            {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
            {title ? <Text accessibilityRole="header" style={styles.title}>{title}</Text> : null}
          </View>
        </View>
      ) : null}
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} /> : undefined}>
        {children}
      </ScrollView>
      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </SafeAreaView>
  );
}

export function Loading({ label }: { label?: string }) {
  const { t } = useTranslation();
  return (
    <View style={styles.center} accessibilityLiveRegion="polite">
      <ActivityIndicator color={colors.blue} size="large" />
      <Body muted>{label ?? t('core:loading')}</Body>
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { t } = useTranslation();
  return (
    <Card style={styles.errorCard} accessibilityRole="alert">
      <Body style={styles.errorText}>{message}</Body>
      {onRetry ? <Button label={t('errors.retry')} variant="ghost" onPress={onRetry} /> : null}
    </Card>
  );
}

export function Empty({ message, action }: { message: string; action?: ReactNode }) {
  return (
    <View style={styles.center}>
      <Body muted style={styles.centerText}>{message}</Body>
      {action}
    </View>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <Text accessibilityRole="header" style={styles.section}>{children}</Text>;
}

/** Choix exclusif en pastilles (ambiance, jour, créneau, pourboire…). */
export function Choices<T extends string | number>({ options, value, onChange, label }: { options: Array<{ value: T; label: string }>; value: T | null; onChange: (value: T) => void; label?: string }) {
  return (
    <View style={styles.choicesBlock}>
      {label ? <Text style={styles.choicesLabel}>{label}</Text> : null}
      <View style={styles.choices} accessibilityRole="radiogroup" accessibilityLabel={label}>
        {options.map((o) => {
          const selected = o.value === value;
          return (
            <Pressable key={String(o.value)} accessibilityRole="radio" accessibilityState={{ selected }} onPress={() => onChange(o.value)} style={[styles.chip, selected && styles.chipSelected]}>
              <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** Interrupteur avec son libellé et une aide facultative : toute la ligne se touche (cible large, un seul élément accessible). */
export function ToggleRow({ label, hint, value, onChange }: { label: string; hint?: string; value: boolean; onChange: (value: boolean) => void }) {
  return (
    <Pressable accessibilityRole="switch" accessibilityState={{ checked: value }} accessibilityLabel={label} accessibilityHint={hint} onPress={() => onChange(!value)} style={styles.toggle}>
      <View style={styles.toggleText}>
        <Text style={styles.toggleLabel}>{label}</Text>
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      </View>
      <View pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <Switch value={value} trackColor={{ true: colors.blue, false: colors.border }} thumbColor={colors.white} />
      </View>
    </Pressable>
  );
}

/** Ligne libellé et valeur (récapitulatif, détail). */
export function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, strong && styles.strong]}>{label}</Text>
      <Text style={[styles.rowValue, strong && styles.strong]}>{value}</Text>
    </View>
  );
}

export function Notice({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warning' | 'success' }) {
  const background = tone === 'warning' ? '#FFF4DC' : tone === 'success' ? '#E6F6DF' : colors.tint;
  return (
    <View style={[styles.notice, { backgroundColor: background }]} accessibilityLiveRegion="polite">
      <Text style={styles.noticeText}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.mist },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.xs, gap: spacing.xs },
  back: { padding: spacing.xs },
  headerText: { flex: 1 },
  subtitle: { fontSize: typography.sizes.xs, color: colors.muted, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6 },
  title: { fontSize: typography.sizes.xl, fontWeight: '700', color: colors.night },
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  footer: { padding: spacing.lg, paddingTop: spacing.sm, backgroundColor: colors.mist, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, gap: spacing.sm },
  center: { alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.md },
  centerText: { textAlign: 'center' },
  errorCard: { gap: spacing.sm, borderLeftWidth: 4, borderLeftColor: colors.danger },
  errorText: { color: colors.danger },
  section: { fontSize: typography.sizes.lg, fontWeight: '700', color: colors.night, marginTop: spacing.sm },
  choicesBlock: { gap: spacing.xs },
  choicesLabel: { fontSize: typography.sizes.sm, fontWeight: '700', color: colors.ink },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white, minHeight: 40, justifyContent: 'center' },
  chipSelected: { backgroundColor: colors.blue, borderColor: colors.blue },
  chipText: { fontSize: typography.sizes.sm, color: colors.ink, fontWeight: '600' },
  chipTextSelected: { color: colors.white },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xs },
  toggleText: { flex: 1 },
  toggleLabel: { fontSize: typography.sizes.md, color: colors.ink, fontWeight: '600' },
  hint: { fontSize: typography.sizes.xs, color: colors.muted },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md, paddingVertical: 3 },
  rowLabel: { flex: 1, fontSize: typography.sizes.sm, color: colors.ink },
  rowValue: { fontSize: typography.sizes.sm, color: colors.ink, fontVariant: ['tabular-nums'] },
  strong: { fontWeight: '700', fontSize: typography.sizes.md, color: colors.night },
  notice: { borderRadius: radius.md, padding: spacing.md },
  noticeText: { fontSize: typography.sizes.sm, color: colors.ink, lineHeight: 20 },
});
