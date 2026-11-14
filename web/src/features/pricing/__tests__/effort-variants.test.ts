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
import { describe, expect, it } from 'vitest'

import {
  collapseEffortVariants,
  hiddenEffortVariantNames,
  isListedEffortVariant,
  splitEffortVariant,
} from '../lib/effort-variants'

describe('effort variants', () => {
  it('splits every recognised effort suffix from its base model', () => {
    const cases: Array<[string, string]> = [
      ['gemini-4-argon-high', 'gemini-4-argon'],
      ['gemini-4-argon-low', 'gemini-4-argon'],
      ['gemini-4-argon-medium', 'gemini-4-argon'],
      ['gemini-4-hydrogen-xhigh', 'gemini-4-hydrogen'],
      ['qwen3.8-max', 'qwen3.8'],
      ['gpt-6-sol-off', 'gpt-6-sol'],
      ['kimi-k3-minimal', 'kimi-k3'],
      ['kimi-k3-minimum', 'kimi-k3'],
      ['qwen3.6-27b-nonthinking', 'qwen3.6-27b'],
      ['grok-4.20-0309-non-reasoning', 'grok-4.20-0309'],
      ['nova-pro-thinking', 'nova-pro'],
      ['gpt-5.4-tiered', 'gpt-5.4'],
    ]
    for (const [name, base] of cases) {
      expect(splitEffortVariant(name)?.base).toBe(base)
    }
  })

  it('prefers the longer suffix so the base name stays real', () => {
    // `-nonthinking` would otherwise be read as `-thinking` and leave `…-non`.
    expect(splitEffortVariant('qwen3.6-27b-nonthinking')).toEqual({
      base: 'qwen3.6-27b',
      effort: 'nonthinking',
    })
    expect(splitEffortVariant('gemini-4-hydrogen-xhigh')).toEqual({
      base: 'gemini-4-hydrogen',
      effort: 'xhigh',
    })
  })

  it('leaves models without an effort suffix alone', () => {
    expect(splitEffortVariant('gemini-4-argon')).toBeNull()
    expect(
      splitEffortVariant('deepseek-v4-flash-0731-long-unrestricted')
    ).toBeNull()
    expect(splitEffortVariant('gpt-image-2.5-flare')).toBeNull()
  })

  it('only treats a variant as hideable when its base is listed', () => {
    const listed = new Set(['gemini-4-argon', 'gemini-3.8-flash'])

    expect(isListedEffortVariant('gemini-4-argon-high', listed)).toBe(true)
    expect(isListedEffortVariant('gemini-3.8-flash-high', listed)).toBe(true)
    // qwen3.8-max 的基础名 qwen3.8 不在广场里，它必须作为独立模型展示。
    expect(isListedEffortVariant('qwen3.8-max', listed)).toBe(false)
    expect(isListedEffortVariant('gemini-4-argon', listed)).toBe(false)
  })

  it('never reports a bare model name as a hideable variant', () => {
    expect(isListedEffortVariant('high', new Set(['high']))).toBe(false)
  })

  it('collapses a listed family to one card and keeps orphans visible', () => {
    const models = [
      { model_name: 'gemini-4-argon' },
      { model_name: 'gemini-4-argon-low' },
      { model_name: 'gemini-4-argon-high' },
      { model_name: 'qwen3.8-max' },
      { model_name: 'gemini-3.8-flash' },
    ]

    expect(
      collapseEffortVariants(models, false).map((m) => m.model_name)
    ).toEqual(['gemini-4-argon', 'qwen3.8-max', 'gemini-3.8-flash'])
    // 展开时一张不落。
    expect(collapseEffortVariants(models, true)).toHaveLength(5)
    expect([...hiddenEffortVariantNames(models)]).toEqual([
      'gemini-4-argon-low',
      'gemini-4-argon-high',
    ])
  })

  it('treats a -tiered row as the variant of its base model', () => {
    const models = [
      { model_name: 'gpt-5.4' },
      { model_name: 'gpt-5.4-tiered' },
      { model_name: 'gpt-image-2.5-tiered' },
    ]

    expect(splitEffortVariant('gpt-5.4-tiered')).toEqual({
      base: 'gpt-5.4',
      effort: 'tiered',
    })
    // 基础模型在广场里时收起，但一个没有基础模型的 -tiered 行仍然独立展示。
    expect(
      collapseEffortVariants(models, false).map((m) => m.model_name)
    ).toEqual(['gpt-5.4', 'gpt-image-2.5-tiered'])
    expect([...hiddenEffortVariantNames(models)]).toEqual(['gpt-5.4-tiered'])
  })

  it('does not hide a whole family when the base model is absent', () => {
    const orphans = [
      { model_name: 'gemini-4-hydrogen-high' },
      { model_name: 'gemini-4-hydrogen-low' },
    ]
    expect(collapseEffortVariants(orphans, false)).toHaveLength(2)
    expect(hiddenEffortVariantNames(orphans).size).toBe(0)
  })
})
