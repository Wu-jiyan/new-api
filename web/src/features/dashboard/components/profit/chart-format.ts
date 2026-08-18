import { formatLogQuota } from '@/lib/format'

export function formatProfitChartValue(value: number): string {
  return formatLogQuota(value)
}

export function normalizeProfitModelName(
  modelName: string | null | undefined,
  fallback: string
): string {
  const normalized = modelName?.trim()
  return !normalized || normalized === '-' ? fallback : normalized
}
