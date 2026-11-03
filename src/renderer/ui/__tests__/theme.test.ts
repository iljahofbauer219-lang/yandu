/**
 * 主题解析单测：偏好持久化校验 + 偏好 → data-theme / data-theme-mode 的纯映射。
 * 回归目标：新增第 3 套主题（graphite「砚石」）后，历史存档值 light/dark/system 行为不变，
 * 且深色覆写表按 mode 命中而不是按具体主题名命中——否则每加一套深色主题都要再抄一遍 193 条覆写。
 */
import { describe, expect, it } from 'vitest'
import { resolveTheme, readThemePreference, THEME_STORAGE_KEY, type ThemePreference } from '../theme'

describe('readThemePreference', () => {
  it('接受四种合法偏好', () => {
    for (const value of ['light', 'dark', 'graphite', 'system'] as const) {
      expect(readThemePreference(value)).toBe(value)
    }
  })

  it('损坏或未知值回落浅色', () => {
    for (const value of [null, undefined, '', 'midnight', 'LIGHT', '  dark  ', '0', '{}'] as Array<string | null | undefined>) {
      expect(readThemePreference(value ?? null)).toBe('light')
    }
  })

  it('持久化键保持 app-theme:v1', () => {
    expect(THEME_STORAGE_KEY).toBe('app-theme:v1')
  })
})

describe('resolveTheme', () => {
  it('浅色与砚石都是 light 模式', () => {
    expect(resolveTheme('light', false)).toEqual({ theme: 'light', mode: 'light' })
    expect(resolveTheme('light', true)).toEqual({ theme: 'light', mode: 'light' })
    expect(resolveTheme('graphite', false)).toEqual({ theme: 'graphite', mode: 'light' })
    expect(resolveTheme('graphite', true)).toEqual({ theme: 'graphite', mode: 'light' })
  })

  it('深色在两种系统取向下都是 dark 模式', () => {
    expect(resolveTheme('dark', false)).toEqual({ theme: 'dark', mode: 'dark' })
    expect(resolveTheme('dark', true)).toEqual({ theme: 'dark', mode: 'dark' })
  })

  it('跟随系统按系统取向解析', () => {
    expect(resolveTheme('system', true)).toEqual({ theme: 'dark', mode: 'dark' })
    expect(resolveTheme('system', false)).toEqual({ theme: 'light', mode: 'light' })
  })

  it('砚石不受系统深色影响（不是 system 就别跟着翻）', () => {
    const preferences: ThemePreference[] = ['light', 'dark', 'graphite']
    for (const preference of preferences) {
      expect(resolveTheme(preference, true)).toEqual(resolveTheme(preference, false))
    }
  })
})
