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
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import ModelRatingPage from '../index'
import type { ModelRatingItem, RatingThresholds } from '../types'

const deepsweThresholds: RatingThresholds = { ur: 65, ssr: 55, sr: 45, r: 30 }
const aaThresholds: RatingThresholds = { ur: 60, ssr: 50, sr: 40, r: 30 }

function tierFor(score: number, thresholds: RatingThresholds): string {
  if (score >= thresholds.ur) return 'UR'
  if (score >= thresholds.ssr) return 'SSR'
  if (score >= thresholds.sr) return 'SR'
  if (score >= thresholds.r) return 'R'
  return 'N'
}

let ratings: ModelRatingItem[] = []
let ratingReads = 0

function mockGet() {
  return vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === '/api/admin/model-rating/square-defaults') {
      return {
        data: {
          success: true,
          data: { sort: 'score-high', dimension: 'aa_intelligence' },
          sorts: ['name', 'price-low', 'price-high', 'score-high'],
        },
      }
    }
    ratingReads++
    return {
      data: {
        success: true,
        data: ratings,
        total: ratings.length,
        thresholds: {
          deepswe: deepsweThresholds,
          aa_intelligence: aaThresholds,
          aa_coding: aaThresholds,
          aa_agentic: aaThresholds,
        },
        deepswe: { last_sync_at: 0, last_sync_num: 0 },
        aa: {
          last_sync_at: 0,
          last_sync_num: 0,
          api_key_set: false,
          last_error: '',
        },
      },
    }
  })
}

// mockPut 模拟后端：写入分数后档位由分数按该维度阈值推导。
function mockPut() {
  return vi.spyOn(api, 'put').mockImplementation(async (url, body) => {
    if (url === '/api/admin/model-rating/thresholds') {
      return { data: { success: true, data: { retiered: 1 } } }
    }
    const score = (body as { rating_score: number }).rating_score
    ratings = ratings.map((item) =>
      item.id === 1
        ? {
            ...item,
            rating_score: score,
            rating: score > 0 ? tierFor(score, deepsweThresholds) : '',
            rating_source: 'manual',
          }
        : item
    )
    return { data: { success: true, data: { id: 1 } } }
  })
}

async function openPage() {
  const user = userEvent.setup()
  render(<ModelRatingPage />)
  return user
}

afterEach(() => {
  ratings = []
  ratingReads = 0
})

describe('model rating dimensions', () => {
  it('derives the tier from the score instead of offering a tier editor', async () => {
    ratings = [
      {
        id: 1,
        model_name: 'rating-model-a',
        rating: 'N',
        rating_score: 60,
        rating_source: 'deepswe',
      },
    ]
    mockGet()
    await openPage()

    // 分数 60 落在默认阈值的 SSR 区间，即使库里存的是旧档位也按分数展示
    expect(await screen.findByText('SSR')).toBeVisible()
    expect(screen.getByPlaceholderText('Score')).toHaveValue(60)
    expect(
      screen.getByText(
        'Tier cannot be edited directly; it is computed from score and thresholds'
      )
    ).toBeVisible()
  })

  it('saves only the score and refreshes the tier it maps to', async () => {
    ratings = [
      {
        id: 1,
        model_name: 'rating-model-a',
        rating: 'SSR',
        rating_score: 60,
        rating_source: 'deepswe',
      },
    ]
    mockGet()
    const put = mockPut()
    const success = vi.spyOn(toast, 'success')
    const user = await openPage()

    const input = await screen.findByPlaceholderText('Score')
    await user.clear(input)
    await user.type(input, '72')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(put).toHaveBeenCalledWith('/api/admin/model-rating/1', {
        rating_score: 72,
      })
    )
    await waitFor(() => expect(screen.getByText('UR')).toBeVisible())
    expect(screen.queryByText('SSR')).toBeNull()
    expect(success).toHaveBeenCalledWith('Score saved')
  })

  it('keeps the draft and reports the server rejection when a score is refused', async () => {
    ratings = [
      {
        id: 1,
        model_name: 'rating-model-a',
        rating: 'SSR',
        rating_score: 60,
        rating_source: 'deepswe',
      },
    ]
    mockGet()
    vi.spyOn(api, 'put').mockResolvedValue({
      data: { success: false, message: '分数必须在 0-100 之间' },
    })
    const success = vi.spyOn(toast, 'success')
    const error = vi.spyOn(toast, 'error')
    const user = await openPage()

    const input = await screen.findByPlaceholderText('Score')
    await user.clear(input)
    await user.type(input, '150')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(error).toHaveBeenCalledWith('分数必须在 0-100 之间')
    )
    expect(success).not.toHaveBeenCalled()
    expect(ratingReads).toBe(1)
  })

  it('retiers every model after the thresholds change and reloads the list', async () => {
    ratings = [
      {
        id: 1,
        model_name: 'rating-model-a',
        rating: 'SSR',
        rating_score: 60,
        rating_source: 'deepswe',
      },
    ]
    mockGet()
    const put = mockPut()
    const success = vi.spyOn(toast, 'success')
    await openPage()

    await userEvent.click(
      await screen.findByRole('button', { name: 'Save thresholds' })
    )

    await waitFor(() =>
      expect(put).toHaveBeenCalledWith('/api/admin/model-rating/thresholds', {
        dimension: 'deepswe',
        ...deepsweThresholds,
      })
    )
    await waitFor(() =>
      expect(success).toHaveBeenCalledWith(
        'Thresholds updated, retiered 1 models'
      )
    )
    await waitFor(() => expect(ratingReads).toBeGreaterThanOrEqual(2))
  })

  it('scores an AA dimension with its own thresholds and shows the other two read-only', async () => {
    ratings = [
      {
        id: 1,
        model_name: 'rating-model-a',
        aa_intelligence_score: 55,
        aa_coding_score: 41,
        aa_agentic_score: 20,
        aa_source: 'artificialanalysis',
      },
    ]
    mockGet()
    const user = await openPage()

    await user.click(
      await screen.findByRole('tab', { name: 'AA Intelligence' })
    )

    // 55 落在 AA 综合阈值 [50,60) -> SSR；同一分数若用 DeepSWE 阈值会是 UR
    expect(await screen.findByText('SSR')).toBeVisible()
    expect(screen.getByPlaceholderText('Score')).toHaveValue(55)
    // 另外两个 AA 维度只读展示，不提供输入框
    expect(screen.getByText(/AA Coding:/)).toBeVisible()
    expect(screen.getByText(/AA Agentic:/)).toBeVisible()
    expect(screen.getAllByPlaceholderText('Score')).toHaveLength(1)
  })
})

// 手机端曾完全无法下滑：页面没套 SectionPageLayout，而布局的 Main 会
// overflow-hidden，内容超出视口后既滚不动也够不着。
describe('model rating page layout', () => {
  it('scrolls inside the shared page layout instead of relying on the window', async () => {
    ratings = [
      { id: 1, model_name: 'rating-model-a', rating: 'SSR', rating_score: 60 },
    ]
    mockGet()
    await openPage()

    const main = screen.getByRole('main')
    // Main 自身裁剪溢出，因此内部必须存在可滚动区域承载内容
    expect(main.className).toContain('overflow-hidden')
    const scroller = main.querySelector('.overflow-auto')
    expect(scroller).not.toBeNull()
    expect(scroller).toContainElement(await screen.findByRole('tablist'))
  })

  it('wraps the dimension tabs so narrow screens do not scroll sideways', async () => {
    ratings = [
      { id: 1, model_name: 'rating-model-a', rating: 'SSR', rating_score: 60 },
    ]
    mockGet()
    await openPage()

    const tablist = await screen.findByRole('tablist')
    expect(tablist.className).toContain('flex-wrap')
    expect(tablist.className).toContain('max-w-full')
  })

  it('shows the configured default sort as a translated label, not a raw value', async () => {
    ratings = [
      { id: 1, model_name: 'rating-model-a', rating: 'SSR', rating_score: 60 },
    ]
    mockGet()
    const user = await openPage()

    await user.click(await screen.findByRole('tab', { name: 'Settings' }))

    const trigger = await screen.findByLabelText('Default sort')
    expect(trigger).toHaveTextContent('Score: High to Low')
    expect(trigger).not.toHaveTextContent('score-high')

    const dimension = await screen.findByLabelText('Default score dimension')
    expect(dimension).toHaveTextContent('AA Intelligence')
  })
})
