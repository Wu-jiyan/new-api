import { describe, expect, it } from 'vitest'

import {
  formatProfitChartValue,
  normalizeProfitModelName,
} from '../chart-format'

describe('profit chart formatting', () => {
  it('formats area chart values with the configured currency formatter', () => {
    expect(formatProfitChartValue(250000)).toBe('$0.5')
  })

  it('replaces placeholder model names with the translated topup label', () => {
    expect(normalizeProfitModelName('-', '充值')).toBe('充值')
    expect(normalizeProfitModelName('  ', '充值')).toBe('充值')
    expect(normalizeProfitModelName('gpt-5', '充值')).toBe('gpt-5')
  })
})
