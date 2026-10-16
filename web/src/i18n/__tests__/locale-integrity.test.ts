/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { STATIC_I18N_KEYS } from '../static-keys'

const LOCALES_DIR = path.join(process.cwd(), 'src/i18n/locales')
const LOCALES = ['en', 'zh', 'zh-TW', 'fr', 'ja', 'ru', 'vi'] as const

// i18next reads keys from the `translation` namespace. A key added beside it
// still produces valid JSON and an insert-only diff, but never resolves, so the
// UI silently renders the raw key. These assertions are the guard for that.
function loadLocale(locale: string) {
  const raw = fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), 'utf8')
  return JSON.parse(raw) as Record<string, unknown>
}

function translationOf(locale: string) {
  const parsed = loadLocale(locale)
  return (parsed.translation ?? {}) as Record<string, string>
}

describe('locale file integrity', () => {
  it('keeps every locale to a single top-level "translation" key', () => {
    for (const locale of LOCALES) {
      const stray = Object.keys(loadLocale(locale)).filter(
        (key) => key !== 'translation'
      )
      expect(stray, `${locale}.json has keys outside translation`).toEqual([])
    }
  })

  it('resolves every statically registered key in every locale', () => {
    for (const locale of LOCALES) {
      const translation = translationOf(locale)
      const absent = STATIC_I18N_KEYS.filter(
        (key) => translation[key] === undefined
      )
      expect(absent, `${locale}.json is missing static keys`).toEqual([])
    }
  })

  it('holds the same key set in every locale', () => {
    const reference = Object.keys(translationOf('en')).sort()
    for (const locale of LOCALES) {
      if (locale === 'en') continue
      const keys = Object.keys(translationOf(locale)).sort()
      const absent = reference.filter((key) => !keys.includes(key))
      const extra = keys.filter((key) => !reference.includes(key))
      expect(absent, `${locale}.json is missing keys`).toEqual([])
      expect(extra, `${locale}.json has keys en.json lacks`).toEqual([])
    }
  })

  it('never ships an empty translation', () => {
    for (const locale of LOCALES) {
      const blank = Object.entries(translationOf(locale))
        .filter(([, value]) => typeof value !== 'string' || value.trim() === '')
        .map(([key]) => key)
      expect(blank, `${locale}.json has empty values`).toEqual([])
    }
  })

  it('keeps interpolation placeholders in step with the base locale', () => {
    const placeholders = (value: string) =>
      (value.match(/\{\{\s*[\w.]+\s*\}\}/g) ?? []).sort().join(',')
    const base = translationOf('en')
    for (const locale of LOCALES) {
      if (locale === 'en') continue
      const translation = translationOf(locale)
      const mismatched = Object.keys(base).filter(
        (key) =>
          typeof translation[key] === 'string' &&
          placeholders(base[key]) !== placeholders(translation[key])
      )
      expect(mismatched, `${locale}.json has placeholder drift`).toEqual([])
    }
  })
})
