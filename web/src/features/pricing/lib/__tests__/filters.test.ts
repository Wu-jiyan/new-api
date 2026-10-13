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

import { SORT_OPTIONS } from '../../constants'
import type { PricingModel } from '../../types'
import { filterBySearch, parseSearchScopes, sortModels } from '../filters'

function pricingModel(model: Partial<PricingModel>): PricingModel {
  return {
    id: 0,
    model_name: 'model',
    quota_type: 0,
    model_ratio: 1,
    completion_ratio: 1,
    enable_groups: ['default'],
    ...model,
  }
}

describe('sortModels', () => {
  it('orders models with equal scores by model name instead of backend order', () => {
    const models = [
      pricingModel({ model_name: 'zeta', rating_score: 80 }),
      pricingModel({ model_name: 'alpha', rating_score: 80 }),
      pricingModel({ model_name: 'mid', rating_score: 90 }),
    ]

    expect(
      sortModels(models, SORT_OPTIONS.SCORE_HIGH).map((m) => m.model_name)
    ).toEqual(['mid', 'alpha', 'zeta'])
  })

  it('keeps unrated models after rated ones when sorting by score', () => {
    const models = [
      pricingModel({ model_name: 'unrated-b' }),
      pricingModel({ model_name: 'scored', rating_score: 10 }),
      pricingModel({ model_name: 'unrated-a' }),
    ]

    expect(
      sortModels(models, SORT_OPTIONS.SCORE_HIGH).map((m) => m.model_name)
    ).toEqual(['scored', 'unrated-a', 'unrated-b'])
  })

  it('orders models with equal prices by model name', () => {
    const models = [
      pricingModel({ model_name: 'b-model', model_ratio: 2 }),
      pricingModel({ model_name: 'a-model', model_ratio: 2 }),
      pricingModel({ model_name: 'c-model', model_ratio: 1 }),
    ]

    expect(
      sortModels(models, SORT_OPTIONS.PRICE_LOW).map((m) => m.model_name)
    ).toEqual(['c-model', 'a-model', 'b-model'])
  })
})

describe('filterBySearch', () => {
  const models = [
    pricingModel({
      model_name: 'text-embedding-3',
      description: 'Retrieval optimised embeddings',
      tags: 'Chat,Rerank',
      vendor_name: 'OpenAI',
    }),
    pricingModel({
      model_name: 'claude-sonnet',
      description: 'Balanced coding model',
      tags: 'Chat',
      vendor_name: 'Anthropic',
    }),
  ]

  it('matches model names only while no other scope is selected', () => {
    expect(filterBySearch(models, 'retrieval')).toEqual([])
    expect(filterBySearch(models, 'claude').map((m) => m.model_name)).toEqual([
      'claude-sonnet',
    ])
  })

  it('matches descriptions only after the description scope is selected', () => {
    expect(
      filterBySearch(models, 'retrieval', ['description']).map(
        (m) => m.model_name
      )
    ).toEqual(['text-embedding-3'])
  })

  it('normalizes the comma separated scope parameter from the URL', () => {
    expect(parseSearchScopes('description, name')).toEqual([
      'name',
      'description',
    ])
    expect(parseSearchScopes('vendor')).toEqual(['vendor'])
    expect(parseSearchScopes('unknown')).toEqual(['name'])
    expect(parseSearchScopes(undefined)).toEqual(['name'])
  })
})
