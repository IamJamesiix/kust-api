import { prisma } from '../../lib/prisma.js'
import { buildReview, monthRange } from './review.js'

// Months that have at least one budget, newest first: ["2026-10", "2026-09"]
export async function months(userId, tzOffsetMin) {
  const rows = await prisma.budget.findMany({ where: { userId }, select: { periodStart: true }, orderBy: { periodStart: 'desc' } })
  const shift = tzOffsetMin * 60 * 1000
  const seen = new Set()
  for (const r of rows) seen.add(new Date(r.periodStart.getTime() + shift).toISOString().slice(0, 7))
  return [...seen]
}

export async function review(userId, month, tzOffsetMin) {
  const { start, end } = monthRange(month, tzOffsetMin)
  const budgets = await prisma.budget.findMany({
    where: { userId, periodStart: { gte: start, lt: end } },
    include: { allocations: true },
  })
  const expenses = budgets.length
    ? await prisma.expense.findMany({
        where: { budgetId: { in: budgets.map((b) => b.id) } },
        select: { allocationId: true, amountKobo: true, category: true, spentAt: true },
      })
    : []
  return buildReview({ month, budgets, expenses, tzOffsetMin })
}
