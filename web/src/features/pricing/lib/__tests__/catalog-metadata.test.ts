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
  CATALOG_MODALITY_LABELS,
  collectModalities,
  formatCatalogTokenCount,
} from '../catalog-metadata'

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

describe('formatCatalogTokenCount', () => {
  // The card decides whether to render its Context row by testing for an empty
  // string. Returning the generic '-' placeholder for an unset value would put
  // "Context -" on every model that has no catalogue entry yet.
  it('renders nothing for an unset window', () => {
    expect(formatCatalogTokenCount(undefined, 'en')).toBe('')
    expect(formatCatalogTokenCount(0, 'en')).toBe('')
    expect(formatCatalogTokenCount(-1, 'en')).toBe('')
  })

  it('abbreviates configured windows in the requested locale', () => {
    expect(formatCatalogTokenCount(128000, 'en')).toBe('128K')
    expect(formatCatalogTokenCount(1500000, 'en')).toBe('1.5M')
  })

  it('follows the supplied locale rather than the system one', () => {
    // The unit suffix is fixed by convention, so the decimal separator is what
    // proves the locale argument is honoured. Leaving it off makes Intl fall back
    // to the operating system locale, which is not the interface language.
    expect(formatCatalogTokenCount(1500000, 'en')).toBe('1.5M')
    expect(formatCatalogTokenCount(1500000, 'fr')).toBe('1,5M')
  })
})

describe('collectModalities', () => {
  it('merges both directions without duplicating', () => {
    const model = pricingModel({
      input_modalities: ['text', 'image'],
      output_modalities: ['text', 'image'],
    })
    expect(collectModalities(model)).toEqual(['text', 'image'])
  })

  it('returns an empty list when nothing is declared', () => {
    expect(collectModalities(pricingModel({}))).toEqual([])
  })

  it('keeps the catalogue order regardless of declaration order', () => {
    const model = pricingModel({
      input_modalities: ['audio'],
      output_modalities: ['text'],
    })
    expect(collectModalities(model)).toEqual(['text', 'audio'])
  })
})

describe('CATALOG_MODALITY_LABELS', () => {
  it('covers exactly the closed set the backend accepts', () => {
    // Must stay in step with model/model_catalog_fields.go; a value the backend
    // rejects would render as a raw string on the card.
    expect(Object.keys(CATALOG_MODALITY_LABELS).sort()).toEqual([
      'audio',
      'file',
      'image',
      'text',
      'video',
    ])
  })
})
