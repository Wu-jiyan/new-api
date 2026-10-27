import { render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'

import { TieredPricingEditor } from '../tiered-pricing-editor'

// A tier selection that depends on a request header. The gateway bills it from
// the header of the actual request, so the editor's estimator must not report a
// missing-context error for a perfectly valid expression.
const HEADER_EXPR =
  'header("x-25y-service-tier") == "fast" ? (len <= 272000 ? tier("Fast / Short", p * 20 + c * 100) : tier("Fast / Long", p * 40 + c * 150)) : (len <= 272000 ? tier("Standard / Short", p * 10 + c * 50) : tier("Standard / Long", p * 20 + c * 75))'

describe('tiered pricing editor token estimator', () => {
  test('estimates a header-conditioned expression without a context error', () => {
    render(
      <TieredPricingEditor
        billingExpr={HEADER_EXPR}
        requestRuleExpr=''
        onBillingExprChange={vi.fn()}
        onRequestRuleExprChange={vi.fn()}
      />
    )

    expect(screen.queryByText(/Expression error/)).not.toBeInTheDocument()
    expect(
      screen.getByText(/prices by request headers or body fields/)
    ).toBeVisible()
  })
})
