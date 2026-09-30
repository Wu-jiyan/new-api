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

import GachaAdminPage from '../index'
import type { ModelRatingItem } from '../types'

const thresholds = { ur: 65, ssr: 55, sr: 45, r: 30 }

function tierFor(score: number): string {
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
    if (url === '/api/gacha/admin/pools') {
      return { data: { success: true, data: [] } }
    }
    ratingReads++
    return {
      data: {
        success: true,
        data: ratings,
        total: ratings.length,
        thresholds,
        last_sync_at: 0,
        last_sync_num: 0,
      },
    }
  })
}

// mockPut 模拟后端：写入分数后档位由分数按阈值推导。
function mockPut() {
  return vi.spyOn(api, 'put').mockImplementation(async (url, body) => {
    if (url === '/api/gacha/admin/settings') {
      return { data: { success: true, data: { retiered: 1 } } }
    }
    const score = (body as { rating_score: number }).rating_score
    ratings = ratings.map((item) =>
      item.id === 1
        ? {
            ...item,
            rating_score: score,
            rating: score > 0 ? tierFor(score) : '',
            rating_source: 'manual',
          }
        : item
    )
    return { data: { success: true, data: { id: 1 } } }
  })
}

async function openRatingsTab() {
  const user = userEvent.setup()
  render(<GachaAdminPage />)
  await user.click(await screen.findByRole('tab', { name: '模型分级' }))
  return user
}

afterEach(() => {
  ratings = []
  ratingReads = 0
})

describe('gacha model ratings', () => {
  it('derives the tier from the score instead of offering a tier editor', async () => {
    ratings = [
      {
        id: 1,
        model_name: 'gacha-model-a',
        rating: 'N',
        rating_score: 60,
        rating_source: 'deepswe',
      },
    ]
    mockGet()
    await openRatingsTab()

    // 分数 60 落在默认阈值的 SSR 区间，即使库里存的是旧档位也按分数展示
    expect(await screen.findByText('SSR')).toBeVisible()
    expect(screen.getByPlaceholderText('分数')).toHaveValue(60)
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(
      screen.getByText(
        '档位不可直接编辑，由分数按阈值自动计算；手动填写的分数会被固定，自动同步跳过'
      )
    ).toBeVisible()
  })

  it('saves only the score and refreshes the tier it maps to', async () => {
    ratings = [
      {
        id: 1,
        model_name: 'gacha-model-a',
        rating: 'SSR',
        rating_score: 60,
        rating_source: 'deepswe',
      },
    ]
    mockGet()
    const put = mockPut()
    const success = vi.spyOn(toast, 'success')
    const user = await openRatingsTab()

    const input = await screen.findByPlaceholderText('分数')
    await user.clear(input)
    await user.type(input, '72')
    await user.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() =>
      expect(put).toHaveBeenCalledWith('/api/gacha/admin/ratings/1', {
        rating_score: 72,
      })
    )
    await waitFor(() => expect(screen.getByText('UR')).toBeVisible())
    expect(screen.queryByText('SSR')).toBeNull()
    expect(success).toHaveBeenCalledWith('分数已保存，档位已按阈值更新')
  })

  it('keeps the draft and reports the server rejection when a score is refused', async () => {
    ratings = [
      {
        id: 1,
        model_name: 'gacha-model-a',
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
    const user = await openRatingsTab()

    const input = await screen.findByPlaceholderText('分数')
    await user.clear(input)
    await user.type(input, '150')
    await user.click(screen.getByRole('button', { name: '保存' }))

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
        model_name: 'gacha-model-a',
        rating: 'SSR',
        rating_score: 60,
        rating_source: 'deepswe',
      },
    ]
    mockGet()
    const put = mockPut()
    const success = vi.spyOn(toast, 'success')
    await openRatingsTab()

    await userEvent.click(
      await screen.findByRole('button', { name: '保存阈值' })
    )

    await waitFor(() =>
      expect(put).toHaveBeenCalledWith('/api/gacha/admin/settings', thresholds)
    )
    await waitFor(() =>
      expect(success).toHaveBeenCalledWith('阈值已更新，已重算 1 个模型的分级')
    )
    await waitFor(() => expect(ratingReads).toBeGreaterThanOrEqual(2))
  })
})
