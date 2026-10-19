/**
 * Shared group-ratio display rules.
 *
 * A group ratio of exactly 0 means every request billed as that group is free.
 * It is a deliberate value, not a missing one, so it must never fall back to 1
 * the way an unconfigured group does.
 */

export function isFreeGroupRatio(ratio: number | null | undefined): boolean {
  return ratio === 0
}

/**
 * Text for a group-ratio chip: a free group reads as "Free" rather than "0x",
 * which reads like a typo to anyone who has not configured the ratio.
 *
 * The free wording is passed in so a React caller can use its own `t()` and
 * stay subscribed to language changes.
 */
export function formatGroupRatioLabel(
  ratio: number | null | undefined,
  freeLabel: string
): string {
  if (isFreeGroupRatio(ratio)) return freeLabel
  return `${String(ratio)}x`
}
