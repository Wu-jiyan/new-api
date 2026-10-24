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

import type { PricingModel } from '../../types'
import {
  computeModelDiscount,
  createOriginalPriceDisplay,
  discountLabelValue,
  discountPercentOff,
  getOriginalPriceAmounts,
  type OriginalPriceContext,
} from '../original-price'

// model_ratio 1 with completion_ratio 3 prices input at 2 USD / 1M and output
// at 6 USD / 1M before the group ratio, which keeps the expectations readable.
function pricingModel(overrides: Partial<PricingModel> = {}): PricingModel {
  return {
    id: 1,
    model_name: 'example-model',
    quota_type: 0,
    model_ratio: 1,
    completion_ratio: 3,
    enable_groups: ['default'],
    group_ratio: { default: 1 },
    ...overrides,
  }
}

const USD_DISPLAY = createOriginalPriceDisplay({
  quotaDisplayType: 'USD',
  usdExchangeRate: 7,
  customCurrencyExchangeRate: 0.9,
})

function context(
  overrides: Partial<OriginalPriceContext> = {}
): OriginalPriceContext {
  return { display: USD_DISPLAY, usdCnyRate: 7.2, ...overrides }
}

describe('computeModelDiscount', () => {
  it('takes the deepest discount of the price types the model prices', () => {
    const model = pricingModel({
      original_price: { currency: 'USD', input: 2.5, output: 8 },
    })

    // Input is 2 / 2.5 = 0.8 and output is 6 / 8 = 0.75.
    expect(computeModelDiscount(model, context())).toEqual({
      ratio: 0.75,
      exact: false,
      group: 'default',
      priceType: 'output',
    })
  })

  it('reports an exact discount when every price type agrees', () => {
    const model = pricingModel({
      original_price: { currency: 'USD', input: 2.5, output: 7.5 },
    })

    expect(computeModelDiscount(model, context())).toEqual({
      ratio: 0.8,
      exact: true,
      group: 'default',
      priceType: 'input',
    })
  })

  it('treats a difference inside the rounding tolerance as exact', () => {
    const model = pricingModel({
      original_price: { currency: 'USD', input: 2.5, output: 7.495 },
    })

    // 2 / 2.5 = 0.8 versus 6 / 7.495 = 0.8005.
    expect(computeModelDiscount(model, context())?.exact).toBe(true)
  })

  it('keeps an official CNY price as it is instead of applying the market rate', () => {
    const display = createOriginalPriceDisplay({
      quotaDisplayType: 'CNY',
      usdExchangeRate: 7,
      customCurrencyExchangeRate: 0.9,
    })
    const model = pricingModel({
      original_price: { currency: 'CNY', input: 20 },
    })

    // Paid 2 USD at the site rate 7 is 14 CNY against an official 20 CNY.
    const discount = computeModelDiscount(
      model,
      context({ display, usdCnyRate: 9 })
    )
    expect(discount?.ratio).toBe(0.7)
  })

  it('converts an official USD price with the market rate, not the display rate', () => {
    const display = createOriginalPriceDisplay({
      quotaDisplayType: 'CNY',
      usdExchangeRate: 1,
      customCurrencyExchangeRate: 0.9,
    })
    const model = pricingModel({
      original_price: { currency: 'USD', input: 5 },
    })

    // 5 USD at the market rate 2 is 10 CNY against a paid 2 CNY.
    expect(
      computeModelDiscount(model, context({ display, usdCnyRate: 2 }))?.ratio
    ).toBe(0.2)
    // Using the display rate 1 here would have produced 0.4 instead.
    expect(
      computeModelDiscount(model, context({ display, usdCnyRate: 1 }))?.ratio
    ).toBe(0.4)
  })

  it('keeps a USD and a CNY official price equivalent at a 1:1 site rate', () => {
    const display = createOriginalPriceDisplay({
      quotaDisplayType: 'CNY',
      usdExchangeRate: 1,
      customCurrencyExchangeRate: 0.9,
    })
    const shared = context({ display, usdCnyRate: 1 })

    const usdModel = pricingModel({
      original_price: { currency: 'USD', input: 2.5 },
    })
    const cnyModel = pricingModel({
      original_price: { currency: 'CNY', input: 2.5 },
    })

    expect(computeModelDiscount(usdModel, shared)?.ratio).toBe(0.8)
    expect(computeModelDiscount(cnyModel, shared)?.ratio).toBe(0.8)
  })

  it('hides the discount when the market rate is unknown', () => {
    const display = createOriginalPriceDisplay({
      quotaDisplayType: 'CNY',
      usdExchangeRate: 7,
      customCurrencyExchangeRate: 0.9,
    })
    const model = pricingModel({
      original_price: { currency: 'USD', input: 2.5 },
    })
    const unknownRate = context({ display, usdCnyRate: 0 })

    expect(computeModelDiscount(model, unknownRate)).toBeNull()
    expect(
      getOriginalPriceAmounts(model.original_price, {
        display,
        usdCnyRate: 0,
      })
    ).toBeNull()
  })

  it('quotes no discount instead of a 10折 when the paid price reaches the official one', () => {
    const atCost = pricingModel({
      original_price: { currency: 'USD', input: 2 },
    })
    // 2 / 2.01 = 0.995, which rounds to a full price.
    const roundsUp = pricingModel({
      original_price: { currency: 'USD', input: 2.01 },
    })

    expect(computeModelDiscount(atCost, context())).toBeNull()
    expect(computeModelDiscount(roundsUp, context())).toBeNull()
  })

  it('keeps a free group at a full discount', () => {
    const model = pricingModel({
      group_ratio: { default: 0 },
      original_price: { currency: 'USD', input: 2.5 },
    })

    expect(computeModelDiscount(model, context())).toEqual({
      ratio: 0,
      exact: true,
      group: 'default',
      priceType: 'input',
    })
  })

  it('compares a forced price group with the per-request official price', () => {
    const model = pricingModel({
      original_price: { currency: 'USD', input: 2.5, request: 0.05 },
    })

    expect(
      computeModelDiscount(
        model,
        context({ groupForcedPrice: { default: 0.02 } })
      )
    ).toEqual({
      ratio: 0.4,
      exact: true,
      group: 'default',
      priceType: 'request',
    })
  })

  it('invents no discount for a forced price group without a per-request official price', () => {
    const model = pricingModel({
      original_price: { currency: 'USD', input: 2.5 },
    })

    expect(
      computeModelDiscount(
        model,
        context({ groupForcedPrice: { default: 0.02 } })
      )
    ).toBeNull()
  })

  it('compares a per-request model with its per-request official price', () => {
    const model = pricingModel({
      quota_type: 1,
      model_price: 0.04,
      group_ratio: { default: 0.5 },
      original_price: { currency: 'USD', request: 0.04 },
    })

    expect(computeModelDiscount(model, context())).toEqual({
      ratio: 0.5,
      exact: true,
      group: 'default',
      priceType: 'request',
    })
  })

  it('scopes the candidates to the group selected in the toolbar', () => {
    const model = pricingModel({
      enable_groups: ['default', 'premium'],
      group_ratio: { default: 0.5, premium: 1 },
      original_price: { currency: 'USD', input: 4 },
    })

    // Paid 1 / 4 in default, 2 / 4 in premium.
    expect(computeModelDiscount(model, context())?.ratio).toBe(0.25)
    expect(
      computeModelDiscount(model, context({ selectedGroup: 'premium' }))
    ).toEqual({
      ratio: 0.5,
      exact: true,
      group: 'premium',
      priceType: 'input',
    })
  })

  it('limits the candidates to the Auto Group Chain when one is configured', () => {
    const model = pricingModel({
      enable_groups: ['default', 'free'],
      group_ratio: { default: 1, free: 0 },
      original_price: { currency: 'USD', input: 2 },
    })

    // The free group is outside the chain, so the paid price reaches the
    // official price and there is no discount to show.
    expect(
      computeModelDiscount(model, context({ autoGroups: ['default'] }))
    ).toBeNull()
    // Selecting the free group explicitly still quotes its own discount.
    expect(
      computeModelDiscount(
        model,
        context({ autoGroups: ['default'], selectedGroup: 'free' })
      )?.ratio
    ).toBe(0)
  })

  it('shows nothing for a model priced by a billing expression', () => {
    const model = pricingModel({
      billing_mode: 'tiered_expr',
      billing_expr: 'tier("base", p * 1 + c * 3)',
      original_price: { currency: 'USD', input: 2.5 },
    })

    expect(computeModelDiscount(model, context())).toBeNull()
  })

  it('shows nothing when the model has no original price', () => {
    expect(computeModelDiscount(pricingModel(), context())).toBeNull()
  })
})

describe('discountPercentOff', () => {
  it.each([
    { ratio: 0.7, expected: 30 },
    { ratio: 0.81, expected: 19 },
    { ratio: 0.333, expected: 66.7 },
  ])('reports $ratio as $expected percent off', ({ ratio, expected }) => {
    expect(discountPercentOff(ratio)).toBe(expected)
  })
})

// Chinese prints 折, so the label number has to follow the interface language
// while every locale keeps the same {{value}} placeholder.
describe('discountLabelValue', () => {
  it.each([
    { language: 'zh', ratio: 0.8, expected: 8 },
    { language: 'zh-CN', ratio: 0.8, expected: 8 },
    { language: 'zh-TW', ratio: 0.73, expected: 7.3 },
    { language: 'zh-Hant-TW', ratio: 0.73, expected: 7.3 },
    { language: 'en', ratio: 0.8, expected: 20 },
    { language: 'ja', ratio: 0.73, expected: 27 },
    { language: 'vi', ratio: 0.5, expected: 50 },
  ])(
    'reports $ratio as $expected in $language',
    ({ language, ratio, expected }) => {
      expect(discountLabelValue(ratio, language)).toBe(expected)
    }
  )
})
