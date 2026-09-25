import type { AutocompleteSuggestion, Place, SavedPlace } from '@neomoov/domain';
import { colors, radius, spacing, typography } from '@neomoov/mobile-core/theme';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { api, errorMessage } from '@/lib/api';

const newSession = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

/**
 * Champ d'adresse : autocomplétion Places par l'API (jeton de session par recherche), lieux enregistrés et, pour le
 * départ, la position de l'appareil (« lors de l'utilisation » seulement, expliquée avant la demande du système).
 */
export function AddressField({ label, value, onChange, savedPlaces = [], allowCurrentLocation = false, near, testID }: {
  label: string;
  value: Place | null;
  onChange: (place: Place | null) => void;
  savedPlaces?: SavedPlace[];
  allowCurrentLocation?: boolean;
  near?: { lat: number; lng: number } | undefined;
  testID?: string;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState(value?.address ?? '');
  const [focused, setFocused] = useState(false);
  const [suggestions, setSuggestions] = useState<AutocompleteSuggestion[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [explainLocation, setExplainLocation] = useState(false);
  const session = useRef(newSession());

  useEffect(() => {
    setText(value?.address ?? '');
  }, [value?.address]);

  useEffect(() => {
    if (!focused || text.trim().length < 2 || text === value?.address) {
      setSuggestions([]);
      return;
    }
    const handle = setTimeout(() => {
      setBusy(true);
      api.places
        .autocomplete(text.trim(), { sessionToken: session.current, ...(near ? { near } : {}) })
        .then((list) => {
          setSuggestions(list);
          setError(null);
        })
        .catch((e: unknown) => setError(errorMessage(e)))
        .finally(() => setBusy(false));
    }, 300);
    return () => clearTimeout(handle);
  }, [text, focused, near, value?.address]);

  async function choose(suggestion: AutocompleteSuggestion) {
    setBusy(true);
    try {
      const details = await api.places.details(suggestion.placeId, session.current);
      onChange({ address: details.address, coordinates: details.coordinates, ...(details.placeId ? { placeId: details.placeId } : {}) });
      session.current = newSession();
      setSuggestions([]);
      setFocused(false);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function locateMe() {
    setExplainLocation(false);
    setBusy(true);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') {
        setError(t('book.locationDenied'));
        return;
      }
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const coordinates = { lat: position.coords.latitude, lng: position.coords.longitude };
      let address = t('book.myPosition');
      try {
        const [first] = await Location.reverseGeocodeAsync({ latitude: coordinates.lat, longitude: coordinates.lng });
        if (first) address = [first.streetNumber, first.street, first.city].filter(Boolean).join(' ') || address;
      } catch {
        // Géocodage inverse indisponible (web) : l'adresse reste « Ma position », les coordonnées font foi.
      }
      onChange({ address, coordinates });
      setError(null);
    } catch {
      setError(t('book.locationDenied'));
    } finally {
      setBusy(false);
    }
  }

  const showList = focused && (suggestions.length > 0 || savedPlaces.length > 0);
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.inputRow}>
        <TextInput
          accessibilityLabel={label}
          testID={testID}
          style={styles.input}
          value={text}
          placeholder={t('book.searchPlaceholder')}
          placeholderTextColor={colors.muted}
          onChangeText={(v) => {
            setText(v);
            if (value) onChange(null);
          }}
          onFocus={() => setFocused(true)}
          autoCorrect={false}
        />
        {busy ? <ActivityIndicator color={colors.blue} /> : null}
      </View>
      {allowCurrentLocation && !value ? (
        explainLocation ? (
          <View style={styles.explain}>
            <Text style={styles.explainText}>{t('book.locationExplain')}</Text>
            <Pressable accessibilityRole="button" onPress={() => void locateMe()} style={styles.linkRow}>
              <Text style={styles.link}>{t('core:continue')}</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable accessibilityRole="button" onPress={() => setExplainLocation(true)} style={styles.linkRow}>
            <Ionicons name="locate" size={18} color={colors.blueDark} />
            <Text style={styles.link}>{t('book.useMyLocation')}</Text>
          </Pressable>
        )
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {showList ? (
        <View style={styles.list}>
          {suggestions.map((s, index) => (
            <Pressable key={s.placeId} testID={`suggestion-${index}`} accessibilityRole="button" onPress={() => void choose(s)} style={styles.item}>
              <Ionicons name="location-outline" size={18} color={colors.muted} />
              <Text style={styles.itemText}>{s.description}</Text>
            </Pressable>
          ))}
          {suggestions.length === 0 && savedPlaces.length > 0 ? <Text style={styles.listTitle}>{t('book.savedPlaces')}</Text> : null}
          {suggestions.length === 0
            ? savedPlaces.map((p) => (
                <Pressable
                  key={p.id}
                  accessibilityRole="button"
                  onPress={() => {
                    onChange({ address: p.address, coordinates: p.coordinates });
                    setFocused(false);
                  }}
                  style={styles.item}
                >
                  <Ionicons name="bookmark-outline" size={18} color={colors.muted} />
                  <Text style={styles.itemText}>{`${p.label} · ${p.address}`}</Text>
                </Pressable>
              ))
            : null}
        </View>
      ) : null}
      {focused && !busy && text.trim().length >= 2 && suggestions.length === 0 && text !== value?.address ? <Text style={styles.muted}>{t('book.noResults')}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  label: { fontSize: typography.sizes.sm, fontWeight: '700', color: colors.ink },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.white, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md },
  input: { flex: 1, minHeight: 50, fontSize: typography.sizes.md, color: colors.ink },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.xs },
  link: { color: colors.blueDark, fontWeight: '700' },
  explain: { backgroundColor: colors.tint, borderRadius: radius.md, padding: spacing.md, gap: spacing.xs },
  explainText: { fontSize: typography.sizes.sm, color: colors.ink },
  error: { fontSize: typography.sizes.xs, color: colors.danger },
  muted: { fontSize: typography.sizes.xs, color: colors.muted },
  list: { backgroundColor: colors.white, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  listTitle: { fontSize: typography.sizes.xs, color: colors.muted, fontWeight: '700', paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  item: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, minHeight: 44 },
  itemText: { flex: 1, fontSize: typography.sizes.sm, color: colors.ink },
});
