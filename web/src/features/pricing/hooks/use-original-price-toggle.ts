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
import { useCallback, useState } from 'react'

/** Display preference, deliberately outside the URL filter state. */
const STORAGE_KEY = 'new-api:pricing:show-original-price'

/**
 * Read the stored choice. Returns null when the visitor never chose, so the
 * operator-configured default still applies.
 *
 * localStorage is read in a state initializer and not during module evaluation:
 * the module can be evaluated on a server, where the store does not exist.
 */
function readStoredChoice(): boolean | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === 'true') return true
    if (raw === 'false') return false
    return null
  } catch {
    // Private mode and blocked storage both throw; fall back to the default.
    return null
  }
}

function writeStoredChoice(value: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, String(value))
  } catch {
    // Losing the preference is not worth breaking the page over.
  }
}

/**
 * Visitor toggle for showing the original price and discount.
 *
 * @param showByDefault operator-configured initial state (`show_by_default`)
 * @returns the effective value and a setter that persists the choice
 */
export function useOriginalPriceToggle(
  showByDefault: boolean
): [boolean, (value: boolean) => void] {
  const [storedChoice, setStoredChoice] = useState<boolean | null>(
    readStoredChoice
  )

  const setShowOriginalPrice = useCallback((value: boolean) => {
    setStoredChoice(value)
    writeStoredChoice(value)
  }, [])

  return [storedChoice ?? showByDefault, setShowOriginalPrice]
}
