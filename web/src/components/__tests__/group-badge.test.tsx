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
import { describe, expect, it } from 'vitest'

import { GroupBadge, GroupMultiplierBadge } from '@/components/group-badge'

const FREE = 'Free of charge'

describe('GroupMultiplierBadge', () => {
  it('labels a zero ratio as free instead of showing "0x"', () => {
    render(<GroupMultiplierBadge ratio={0} />)
    expect(screen.getByText(FREE)).toBeVisible()
    expect(screen.queryByText('0x')).not.toBeInTheDocument()
  })

  it('shows the multiplier for a paid ratio', () => {
    render(<GroupMultiplierBadge ratio={0.5} />)
    expect(screen.getByText('0.5x')).toBeVisible()
  })

  it('lets an explicit label win over the free wording', () => {
    render(<GroupMultiplierBadge ratio={0} label='gift' />)
    expect(screen.getByText('gift')).toBeVisible()
    expect(screen.queryByText(FREE)).not.toBeInTheDocument()
  })
})

describe('GroupBadge', () => {
  it('shows the free label next to a zero-ratio group', () => {
    render(<GroupBadge group='free-tier' ratio={0} />)
    expect(screen.getByText('free-tier')).toBeVisible()
    expect(screen.getByText(FREE)).toBeVisible()
  })

  it('renders only the group chip when the ratio is unknown', () => {
    render(<GroupBadge group='free-tier' />)
    expect(screen.getByText('free-tier')).toBeVisible()
    expect(screen.queryByText(FREE)).not.toBeInTheDocument()
  })
})
