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
import { useMemo } from 'react'

import { usePricingData } from '@/features/pricing/hooks/use-pricing-data'
import { resolveModelProvider } from '@/lib/model-provider'

export type ResolvedModelIcon = {
  readonly icon: string
  readonly label?: string
}

/**
 * Resolve a log row's model icon from the operator-configured catalog.
 *
 * The pricing catalog is the source of truth for model metadata: it carries each
 * model's own `icon` plus its vendor's icon, so a model the operator mapped to a
 * vendor keeps that vendor's icon. The substring table in
 * `resolveModelProvider` only covers names that carry no catalog icon, because it
 * guesses from the name and cannot see operator mappings such as a Meta model
 * that happens to contain "spark".
 */
export function useModelIcon(modelName: string): ResolvedModelIcon | null {
  const { models } = usePricingData()

  return useMemo(() => {
    const model = models.find((item) => item.model_name === modelName)
    const icon = model?.icon || model?.vendor_icon
    if (icon) {
      return { icon, label: modelName }
    }
    const provider = resolveModelProvider(modelName)
    return provider?.icon
      ? { icon: provider.icon, label: provider.label ?? provider.name }
      : null
  }, [modelName, models])
}
