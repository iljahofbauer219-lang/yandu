export type ThemePreference = 'light' | 'dark' | 'graphite' | 'system'
export type ThemeName = 'light' | 'dark' | 'graphite'
export type ThemeMode = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'app-theme:v1'

const PREFERENCES: readonly ThemePreference[] = ['light', 'dark', 'graphite', 'system']

export function readThemePreference(raw: string | null): ThemePreference {
  return PREFERENCES.find(value => value === raw) ?? 'light'
}

export function resolveTheme(preference: ThemePreference, systemDark: boolean): { theme: ThemeName; mode: ThemeMode } {
  if (preference === 'system') return systemDark ? { theme: 'dark', mode: 'dark' } : { theme: 'light', mode: 'light' }
  return { theme: preference, mode: preference === 'dark' ? 'dark' : 'light' }
}
