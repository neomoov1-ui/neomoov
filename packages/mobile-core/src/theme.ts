/** Charte Neomoov (planche de marque du fondateur, 22 septembre 2026 ; cahier des charges, section 6). */
export const colors = {
  blue: '#1485E0',
  blueDark: '#0B5FB5',
  green: '#6CC04A',
  ink: '#2C3A4A',
  night: '#10171F',
  mist: '#F4F7FB',
  tint: '#E3F1FC',
  white: '#FFFFFF',
  danger: '#D64545',
  warning: '#E0A21B',
  muted: '#7A8794',
  border: '#D9E2EC',
} as const;

export const typography = {
  heading: 'Montserrat_700Bold',
  headingFallback: 'System',
  body: 'Nunito_400Regular',
  bodyBold: 'Nunito_700Bold',
  bodyFallback: 'System',
  sizes: { xs: 12, sm: 14, md: 16, lg: 20, xl: 26, xxl: 34 },
} as const;

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 } as const;

export const radius = { sm: 8, md: 14, lg: 20, pill: 999 } as const;

export const shadows = {
  card: { shadowColor: '#10171F', shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 3 },
} as const;

export type ThemeColors = typeof colors;
