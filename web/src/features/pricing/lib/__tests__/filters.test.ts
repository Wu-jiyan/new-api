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
import {
  filterByModality,
  filterBySearch,
  parseSearchScopes,
  sortModels,
} from '../filters'
import { sortGroups } from '../group-sort'

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
      sortModels(models, SORT_OPTIONS.INPUT_PRICE_LOW).map((m) => m.model_name)
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

const GROUPS = ['vip', 'default', 'enterprise', 'beta']

describe('sortGroups', () => {
  it('lists chained groups in chain order and pushes the rest to the end by name', () => {
    expect(
      sortGroups(GROUPS, 'auto', { autoGroups: ['enterprise', 'vip'] })
    ).toEqual(['enterprise', 'vip', 'beta', 'default'])
  })

  it('falls back to alphabetical order when there is no auto group chain', () => {
    expect(sortGroups(GROUPS, 'auto', {})).toEqual([
      'beta',
      'default',
      'enterprise',
      'vip',
    ])
    expect(sortGroups(GROUPS, 'auto', { autoGroups: ['default'] })).toEqual([
      'default',
      'beta',
      'enterprise',
      'vip',
    ])
  })

  it('orders by group name', () => {
    expect(sortGroups(GROUPS, 'name', { autoGroups: ['vip'] })).toEqual([
      'beta',
      'default',
      'enterprise',
      'vip',
    ])
  })

  it('orders by group ratio in both directions, breaking ties by name', () => {
    const groupRatios = { vip: 3, default: 1, enterprise: 5, beta: 1 }
    expect(sortGroups(GROUPS, 'ratio-asc', { groupRatios })).toEqual([
      'beta',
      'default',
      'vip',
      'enterprise',
    ])
    expect(sortGroups(GROUPS, 'ratio-desc', { groupRatios })).toEqual([
      'enterprise',
      'vip',
      'beta',
      'default',
    ])
  })

  it('treats a group without a configured ratio as ratio 1', () => {
    expect(
      sortGroups(['a', 'b'], 'ratio-desc', { groupRatios: { a: 2 } })
    ).toEqual(['a', 'b'])
  })
})
describe('filterByModality', () => {
  const cases: PricingModel[] = [
    pricingModel({ model_name: 'text-only', input_modalities: ['text'] }),
    pricingModel({
      model_name: 'vision',
      input_modalities: ['text', 'image'],
      output_modalities: ['text'],
    }),
    pricingModel({ model_name: 'painter', output_modalities: ['image'] }),
    pricingModel({ model_name: 'unknown' }),
  ]
  const names = (models: PricingModel[]) => models.map((m) => m.model_name)

  it('returns every model when no modality is selected', () => {
    expect(filterByModality(cases, 'all')).toHaveLength(cases.length)
  })

  it('matches a modality declared as input', () => {
    expect(names(filterByModality(cases, 'image'))).toEqual([
      'vision',
      'painter',
    ])
  })

  it('matches a modality declared only as output', () => {
    expect(names(filterByModality(cases, 'image'))).toContain('painter')
  })

  it('excludes models that never declare the modality', () => {
    expect(names(filterByModality(cases, 'audio'))).toEqual([])
  })

  it('does not treat a missing modality list as matching everything', () => {
    expect(names(filterByModality(cases, 'text'))).toEqual([
      'text-only',
      'vision',
    ])
  })
})

describe('sortModels by context window', () => {
  const models: PricingModel[] = [
    pricingModel({ model_name: 'small', context_length: 8000 }),
    pricingModel({ model_name: 'unknown' }),
    pricingModel({ model_name: 'large', context_length: 200000 }),
  ]
  const names = (list: PricingModel[]) => list.map((m) => m.model_name)

  it('puts the largest window first when sorting high to low', () => {
    expect(names(sortModels(models, SORT_OPTIONS.CONTEXT_HIGH))[0]).toBe(
      'large'
    )
  })

  it('puts the smallest window first when sorting low to high', () => {
    expect(names(sortModels(models, SORT_OPTIONS.CONTEXT_LOW))[0]).toBe('small')
  })

  it('sinks models without a configured window in both directions', () => {
    // "unknown" is not the same as "smallest", so it must not lead either way.
    expect(names(sortModels(models, SORT_OPTIONS.CONTEXT_HIGH)).at(-1)).toBe(
      'unknown'
    )
    expect(names(sortModels(models, SORT_OPTIONS.CONTEXT_LOW)).at(-1)).toBe(
      'unknown'
    )
  })

  it('leaves the input array untouched', () => {
    const original = [...models]
    sortModels(models, SORT_OPTIONS.CONTEXT_HIGH)
    expect(models).toEqual(original)
  })
})
