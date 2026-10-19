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

import { FILTER_ALL } from '../../constants'
import type { PricingModel } from '../../types'
import {
  getAutoChainForcedPrice,
  getAutoChainGroups,
  getAutoChainRatio,
  getDisplayGroupForcedPrice,
  getDisplayGroupRatio,
} from '../model-helpers'

// buddy is the paid group inside the Auto Group Chain; free is a 0x group the
// operator deliberately left out of it.
function pricingModel(overrides: Partial<PricingModel> = {}): PricingModel {
  return {
    id: 1,
    model_name: 'example-model',
    quota_type: 0,
    model_ratio: 1,
    completion_ratio: 3,
    enable_groups: ['buddy', 'free'],
    group_ratio: { buddy: 1, free: 0 },
    ...overrides,
  }
}

describe('getAutoChainGroups', () => {
  it('keeps the chain order and drops groups the model is not enabled in', () => {
    expect(
      getAutoChainGroups(pricingModel(), ['vip', 'free', 'buddy'])
    ).toEqual(['free', 'buddy'])
  })

  it('returns no groups when no Auto Group Chain is configured', () => {
    expect(getAutoChainGroups(pricingModel(), [])).toEqual([])
    expect(getAutoChainGroups(pricingModel())).toEqual([])
  })
})

describe('getAutoChainRatio', () => {
  it('takes the cheapest ratio inside the chain only', () => {
    // The 0x free group is outside the chain, so it must not win the comparison.
    expect(getAutoChainRatio(pricingModel(), ['buddy'])).toBe(1)
  })

  it('keeps a valid zero ratio when the free group is inside the chain', () => {
    expect(getAutoChainRatio(pricingModel(), ['free'])).toBe(0)
  })

  it('returns undefined when the model is only offered outside the chain', () => {
    expect(
      getAutoChainRatio(pricingModel({ enable_groups: ['free'] }), ['buddy'])
    ).toBeUndefined()
  })
})

describe('getDisplayGroupRatio', () => {
  it('quotes the Auto Group Chain price for "all groups"', () => {
    expect(
      getDisplayGroupRatio(pricingModel({ auto_chain_ratio: 1 }), FILTER_ALL)
    ).toBe(1)
  })

  it('still quotes an explicitly selected group instead of the chain price', () => {
    expect(
      getDisplayGroupRatio(pricingModel({ auto_chain_ratio: 1 }), 'free')
    ).toBe(0)
  })

  it('falls back to the cheapest of every group when no chain price was resolved', () => {
    expect(getDisplayGroupRatio(pricingModel(), FILTER_ALL)).toBe(0)
  })
})

describe('getAutoChainForcedPrice', () => {
  it('takes the cheapest flat price inside the chain', () => {
    expect(
      getAutoChainForcedPrice(pricingModel(), ['buddy'], {
        buddy: 0.02,
        free: 0.001,
      })
    ).toBe(0.02)
  })

  it('ignores flat prices outside the chain', () => {
    expect(
      getAutoChainForcedPrice(pricingModel(), ['buddy'], { free: 0.001 })
    ).toBeUndefined()
  })
})

describe('getDisplayGroupForcedPrice', () => {
  it('quotes the chain flat price for "all groups"', () => {
    expect(
      getDisplayGroupForcedPrice(
        pricingModel({ auto_chain_forced_price: 0.02 }),
        { free: 0.001 },
        FILTER_ALL
      )
    ).toBe(0.02)
  })

  it('quotes the selected group flat price instead of the chain price', () => {
    expect(
      getDisplayGroupForcedPrice(
        pricingModel({ auto_chain_forced_price: 0.02 }),
        { free: 0.001 },
        'free'
      )
    ).toBe(0.001)
  })
})
