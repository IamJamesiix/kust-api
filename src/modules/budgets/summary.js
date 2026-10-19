// Pure function: budget + how much was spent per bucket -> numbers the app shows.
// spentByAllocation: Map<allocationId, BigInt kobo>
export function summarize(budget, spentByAllocation) {
  let totalSpent = 0n

  const allocations = budget.allocations.map((a) => {
    const spentKobo = spentByAllocation.get(a.id) ?? 0n
    const remainingKobo = a.amountKobo - spentKobo
    totalSpent += spentKobo

    return {
      ...a,
      spentKobo,
      remainingKobo,
      // 42.5 means 42.5% of this bucket is used
      usedPercent: a.amountKobo > 0n ? Number((spentKobo * 10000n) / a.amountKobo) / 100 : 0,
      overspent: remainingKobo < 0n,
    }
  })

  return {
    ...budget,
    allocations,
    totals: {
      incomeKobo: budget.incomeKobo,
      spentKobo: totalSpent,
      remainingKobo: budget.incomeKobo - totalSpent,
    },
  }
}
