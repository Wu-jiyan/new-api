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
/**
 * Cards per page for the model-square grid.
 *
 * A page must end on a whole row, otherwise the last row shows one or two
 * cards and reads as a missing tile. The grid renders 1, 2 or 3 columns
 * (`grid-cols-1 md:grid-cols-2 xl:grid-cols-3`), so the page size follows the
 * rendered column count instead of a fixed 20.
 *
 * Two columns of six rows match the old density; a single column keeps the
 * page shorter because 12 stacked cards already mean a long scroll on a phone.
 */
const ROWS_PER_PAGE = 6
const SINGLE_COLUMN_PAGE_SIZE = 8

export function cardPageSizeForColumns(columns: number): number {
  const safeColumns = Math.max(1, Math.floor(columns))
  return safeColumns <= 1
    ? SINGLE_COLUMN_PAGE_SIZE
    : safeColumns * ROWS_PER_PAGE
}

/**
 * Columns the card grid actually renders, mirroring its Tailwind classes
 * (`grid-cols-1 md:grid-cols-2 xl:grid-cols-3`). Keep the two in step: the page
 * size derived here is only a whole number of rows if they agree.
 */
export function gridColumnsFor(isMedium: boolean, isWide: boolean): number {
  if (isWide) return 3
  if (isMedium) return 2
  return 1
}
