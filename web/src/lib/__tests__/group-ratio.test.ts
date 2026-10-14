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
  formatGroupRatioLabel,
  isFreeGroupRatio,
} from '@/lib/group-ratio'

const FREE = 'Free of charge'

describe('isFreeGroupRatio', () => {
  it('treats only an exact zero as free', () => {
    expect(isFreeGroupRatio(0)).toBe(true)
    expect(isFreeGroupRatio(0.001)).toBe(false)
    expect(isFreeGroupRatio(1)).toBe(false)
    expect(isFreeGroupRatio(undefined)).toBe(false)
  })
})

describe('formatGroupRatioLabel', () => {
  it('reads a zero ratio as free rather than as "0x"', () => {
    expect(formatGroupRatioLabel(0, FREE)).toBe(FREE)
  })

  it('keeps the multiplier text for any non-zero ratio', () => {
    expect(formatGroupRatioLabel(1, FREE)).toBe('1x')
    expect(formatGroupRatioLabel(0.5, FREE)).toBe('0.5x')
    expect(formatGroupRatioLabel(3, FREE)).toBe('3x')
  })

  it('prints a ratio with full precision instead of rounding it', () => {
    expect(formatGroupRatioLabel(12.345678, FREE)).toBe('12.345678x')
  })
})