import type { ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View, type PressableProps, type TextInputProps, type ViewProps } from 'react-native';
import { colors, radius, shadows, spacing, typography } from './theme';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

const buttonColors: Record<ButtonVariant, { bg: string; fg: string }> = {
  primary: { bg: colors.blue, fg: colors.white },
  secondary: { bg: colors.green, fg: colors.night },
  ghost: { bg: 'transparent', fg: colors.blue },
  danger: { bg: colors.danger, fg: colors.white },
};

/** Bouton pilule Neomoov. */
export function Button({ label, variant = 'primary', disabled, style, ...props }: Omit<PressableProps, 'style'> & { label: string; variant?: ButtonVariant; style?: ViewProps['style'] }) {
  const c = buttonColors[variant];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      style={({ pressed }) => [styles.button, { backgroundColor: c.bg, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 }, variant === 'ghost' && styles.buttonGhost, style]}
      {...props}
    >
      <Text style={[styles.buttonLabel, { color: c.fg }]}>{label}</Text>
    </Pressable>
  );
}

/** Champ de saisie avec étiquette et message d'erreur. */
export function Field({ label, error, hint, ...props }: TextInputProps & { label: string; error?: string; hint?: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput placeholderTextColor={colors.muted} accessibilityLabel={label} style={[styles.input, error ? styles.inputError : null]} {...props} />
      {hint && !error ? <Text style={styles.hint}>{hint}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

/** Carte de contenu (fond blanc, coins arrondis, ombre légère). */
export function Card({ children, style, ...props }: ViewProps & { children: ReactNode }) {
  return (
    <View style={[styles.card, style]} {...props}>
      {children}
    </View>
  );
}

/** Feuille modale du bas (confirmation, options, offres). `closeLabel` : texte d'accessibilité du fond, `t('core:close')`. */
export function Sheet({ visible, onClose, title, closeLabel, children }: { visible: boolean; onClose: () => void; title?: string; closeLabel: string; children: ReactNode }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel={closeLabel} />
      <View style={styles.sheet}>
        <View style={styles.grip} />
        {title ? <Text style={styles.sheetTitle}>{title}</Text> : null}
        {children}
      </View>
    </Modal>
  );
}

export function Heading({ children, level = 1 }: { children: ReactNode; level?: 1 | 2 | 3 }) {
  const size = level === 1 ? typography.sizes.xxl : level === 2 ? typography.sizes.xl : typography.sizes.lg;
  return <Text accessibilityRole="header" style={[styles.heading, { fontSize: size }]}>{children}</Text>;
}

export function Body({ children, muted, style }: { children: ReactNode; muted?: boolean; style?: object }) {
  return <Text style={[styles.body, muted ? { color: colors.muted } : null, style]}>{children}</Text>;
}

const styles = StyleSheet.create({
  button: { minHeight: 52, paddingHorizontal: spacing.lg, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  buttonGhost: { borderWidth: 1, borderColor: colors.blue },
  buttonLabel: { fontSize: typography.sizes.md, fontWeight: '700', letterSpacing: 0.5 },
  field: { gap: spacing.xs, marginBottom: spacing.md },
  fieldLabel: { fontSize: typography.sizes.sm, fontWeight: '700', color: colors.ink },
  input: { minHeight: 50, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, fontSize: typography.sizes.md, color: colors.ink, backgroundColor: colors.white },
  inputError: { borderColor: colors.danger },
  hint: { fontSize: typography.sizes.xs, color: colors.muted },
  error: { fontSize: typography.sizes.xs, color: colors.danger },
  card: { backgroundColor: colors.white, borderRadius: radius.lg, padding: spacing.md, ...shadows.card },
  backdrop: { flex: 1, backgroundColor: 'rgba(16,23,31,0.45)' },
  sheet: { backgroundColor: colors.white, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, gap: spacing.md },
  grip: { alignSelf: 'center', width: 44, height: 5, borderRadius: radius.pill, backgroundColor: colors.border, marginBottom: spacing.sm },
  sheetTitle: { fontSize: typography.sizes.lg, fontWeight: '700', color: colors.night },
  heading: { fontWeight: '700', color: colors.night, lineHeight: 40 },
  body: { fontSize: typography.sizes.md, color: colors.ink, lineHeight: 24 },
});
