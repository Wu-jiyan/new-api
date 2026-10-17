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
import { create } from 'zustand'

/**
 * Token 数量的显示口径：紧凑写（1M / 128K）还是精确值（1,000,000 / 128,000）。
 *
 * 放在全局状态而不是每个数值各自 useState：同一屏上同时出现上下文窗口和最大输出，
 * 各点各的会变成「1M 与 128,000 并存」，读者无法判断两个数字是不是同一口径。
 * 这是纯展示偏好，不落 localStorage —— 刷新后回到营销口径（紧凑写法）。
 */
type TokenCountDisplayState = {
  expanded: boolean
  toggleExpanded: () => void
}

export const useTokenCountDisplayStore = create<TokenCountDisplayState>(
  (set) => ({
    expanded: false,
    toggleExpanded: () => set((state) => ({ expanded: !state.expanded })),
  })
)
