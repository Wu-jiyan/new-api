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
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import GachaEntitlementsPage from '@/features/gacha-entitlements'
import { api } from '@/lib/api'

import GachaPage from '../index'
import type { GachaEntitlement, GachaPool } from '../types'

// 这两个页面曾各自手写 `<main className='min-h-0 flex-1 overflow-y-auto'>` 外壳，
// 标题处理、内边距和页脚与其余分区页不一致。现在统一走 SectionPageLayout ——
// Main 裁剪溢出，所有分支（含加载骨架、空状态）都落在壳内的滚动区里。
const server = vi.hoisted(() => ({
  pools: [] as unknown[],
  entitlements: [] as unknown[],
  // 请求永不返回，用于稳定复现加载分支
  hold: false,
}))

const pool: GachaPool = {
  id: 7,
  name: 'Standard pool',
  description: 'Starter pool',
  price: 100,
  ten_price: 900,
  enabled: true,
  sort_order: 0,
  pity_enabled: false,
  pity_max: 0,
  pity_rarity: '',
  pity_uprate: 0,
  ev_value: 90,
  entries: [],
}

const entitlement: GachaEntitlement = {
  id: 3,
  user_id: 1,
  source: 'gacha',
  usable_models: ['model-a'],
  usable_groups: ['vip'],
  amount_total: 500,
  amount_used: 100,
  start_time: 0,
  end_time: 1893456000,
  status: 'active',
  merge_count: 1,
}

const neverSettles = new Promise<never>(() => undefined)

/** 断言页面用的是共享分区页外壳：Main 裁剪溢出，滚动发生在壳内的滚动区。 */
function sharedPageScroller(): HTMLElement {
  const main = screen.getByRole('main')
  expect(main.className.split(' ')).toContain('overflow-hidden')
  const scroller = main.querySelector<HTMLElement>('.overflow-auto')
  if (!scroller) throw new Error('shared page layout renders no scroll region')
  // 加载 / 空状态分支同样要把内容放进滚动区，不能退回旧的手写外壳
  expect(scroller.childElementCount).toBeGreaterThan(0)
  return scroller
}

beforeEach(() => {
  server.pools = []
  server.entitlements = []
  server.hold = false

  vi.spyOn(api, 'get').mockImplementation(async (url: string) => {
    if (server.hold) return neverSettles
    if (url.startsWith('/api/gacha/pools')) {
      return { data: { success: true, data: server.pools } }
    }
    if (url.startsWith('/api/gacha/stats')) {
      return { data: { success: true, data: null } }
    }
    if (url.startsWith('/api/gacha/entitlements')) {
      return {
        data: {
          success: true,
          data: server.entitlements,
          total: server.entitlements.length,
          ratings: { 'model-a': 'SSR' },
        },
      }
    }
    return { data: { success: true, data: null } }
  })
})

describe('gacha page shell', () => {
  it('scrolls the loaded card pools inside the shared page layout', async () => {
    server.pools = [pool]
    render(<GachaPage />)

    expect(await screen.findByText('Standard pool')).toBeVisible()
    expect(sharedPageScroller()).toContainElement(
      screen.getByText('Standard pool')
    )
  })

  it('keeps the shared scroll region while the pools are still loading', () => {
    server.hold = true
    render(<GachaPage />)

    // 外壳在拿到卡池前就已就位：首屏落在壳内的滚动区，而不是退回旧的手写外壳
    expect(sharedPageScroller()).toContainElement(
      screen.getByText('Model Gacha')
    )
  })
})

describe('gacha entitlements page shell', () => {
  it('scrolls the loaded entitlements inside the shared page layout', async () => {
    server.entitlements = [entitlement]
    render(<GachaEntitlementsPage />)

    expect((await screen.findAllByText('model-a')).length).toBeGreaterThan(0)
    const scroller = sharedPageScroller()
    // 卡片标题与模型范围标签都渲染一次，同一份内容必须整体落在滚动区内
    for (const label of screen.getAllByText('model-a')) {
      expect(scroller).toContainElement(label)
    }
  })

  it('keeps the shared scroll region while the entitlements are still loading', () => {
    server.hold = true
    render(<GachaEntitlementsPage />)

    // 骨架屏与标题说明共用同一个滚动区，加载中也不会退回旧的手写外壳
    expect(sharedPageScroller()).toContainElement(
      screen.getByText(
        'Pulled quota is a subscription restricted to its model range. Use your own API token — the balance is deducted automatically.'
      )
    )
  })

  it('keeps the shared scroll region when no entitlement exists', async () => {
    render(<GachaEntitlementsPage />)

    expect(
      await screen.findByText(
        'No entitlements yet — try your luck on the gacha page'
      )
    ).toBeVisible()
    expect(sharedPageScroller()).toContainElement(
      screen.getByText('No entitlements yet — try your luck on the gacha page')
    )
  })
})
