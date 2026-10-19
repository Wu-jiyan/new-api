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
import { api } from '@/lib/api'

import type { PerformanceMetricsData, PerfSummaryAllData } from './types'

/**
 * Model-level summaries for the model square.
 *
 * `group` scopes the figures: a specific group reports that group only, while an
 * omitted group reports the Auto Group Chain. Groups outside the chain keep their
 * own row but never dilute the model's overall success rate.
 */
export async function getPerfMetricsSummary(
  hours = 24,
  recentModels?: string[],
  group?: string
): Promise<PerfSummaryAllData> {
  const res = await api.get<PerfSummaryAllData>('/api/perf-metrics/summary', {
    params: { hours, recent_model: recentModels, group },
    paramsSerializer: { indexes: null },
    optionalAuth: true,
  })
  return res.data
}

/**
 * One model's performance. `group` scopes the summary only; the returned group
 * rows always list every group so the details view can show the breakdown.
 */
export async function getPerfMetrics(
  modelName: string,
  hours = 24,
  group?: string
): Promise<PerformanceMetricsData> {
  const res = await api.get<PerformanceMetricsData>('/api/perf-metrics', {
    params: {
      model: modelName,
      hours,
      group,
    },
    optionalAuth: true,
  })
  return res.data
}
