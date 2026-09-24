import { Body, Button, Card, Heading, Sheet } from '@neomoov/mobile-core/components';
import { isLanguage, SUPPORTED_LANGUAGES } from '@neomoov/mobile-core/i18n';
import { colors, spacing } from '@neomoov/mobile-core/theme';
import { Image } from 'expo-image';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const LABELS: Record<string, string> = { 'fr-CA': 'FR', en: 'EN' };

/** Écran de démarrage (étape 1) : logo, slogan (D44), préavis de 2 heures (D32), choix de la langue. */
export default function StartScreen() {
  const { t, i18n } = useTranslation();
  const [sheet, setSheet] = useState(false);
  const current = isLanguage(i18n.language) ? i18n.language : 'fr-CA';
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.languages} accessibilityLabel={t('core:language')}>
        {SUPPORTED_LANGUAGES.map((lang) => (
          <Pressable key={lang} onPress={() => void i18n.changeLanguage(lang)} accessibilityRole="button" accessibilityState={{ selected: lang === current }} style={[styles.langPill, lang === current && styles.langPillActive]}>
            <Text style={[styles.langText, lang === current && styles.langTextActive]}>{LABELS[lang]}</Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.hero}>
        <Image source={require('../../assets/images/logo.png')} style={styles.logo} contentFit="contain" accessibilityLabel="Neomoov" />
        <Heading>{t('welcome')}</Heading>
        <Body style={styles.tagline}>{t('core:tagline')}</Body>
        <Body muted style={styles.center}>{t('intro')}</Body>
      </View>
      <Card style={styles.card}>
        <Body>{t('core:leadTime')}</Body>
      </Card>
      <View style={styles.actions}>
        <Button label={t('start')} onPress={() => setSheet(true)} />
        <Button label={t('login')} variant="ghost" onPress={() => setSheet(true)} />
      </View>
      <Sheet visible={sheet} onClose={() => setSheet(false)} title={t('core:appName')} closeLabel={t('core:close')}>
        <Body>{t('stepOne')}</Body>
        <Button label={t('core:continue')} onPress={() => setSheet(false)} />
      </Sheet>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, backgroundColor: colors.mist },
  languages: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.xs, paddingVertical: spacing.sm },
  langPill: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: 999 },
  langPillActive: { backgroundColor: colors.blue },
  langText: { fontSize: 12, fontWeight: '700', color: colors.ink },
  langTextActive: { color: colors.white },
  hero: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  logo: { width: 260, height: 90 },
  tagline: { textAlign: 'center', color: colors.blueDark, fontWeight: '700' },
  center: { textAlign: 'center' },
  card: { marginBottom: spacing.md },
  actions: { gap: spacing.sm },
});
