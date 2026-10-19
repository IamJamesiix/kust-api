import { prisma } from '../../lib/prisma.js'
import { AppError } from '../../utils/AppError.js'
import { getForUser as getFormula } from '../formulas/formulas.service.js'
import { splitIncome } from './split.js'
import { summarize } from './summary.js'

const include = {
  allocations: { orderBy: { position: 'asc' } },
  formula: { select: { id: true, name: true } },
}

async function spentMap(budgetId) {
  const rows = await prisma.expense.groupBy({
    by: ['allocationId'],
    where: { budgetId },
    _sum: { amountKobo: true },
  })
  return new Map(rows.map((r) => [r.allocationId, r._sum.amountKobo ?? 0n]))
}

async function withSummary(budget) {
  return summarize(budget, await spentMap(budget.id))
}

// AUTHORISATION (ownership): the budget must belong to this user.
// Someone else's budget looks exactly like a missing one.
export async function getOwned(userId, budgetId) {
  const budget = await prisma.budget.findFirst({ where: { id: budgetId, userId }, include })
  if (!budget) throw new AppError(404, 'BUDGET_NOT_FOUND', 'Budget not found')
  return budget
}

// Show the split without saving anything — for the "pick a formula" screen.
export async function preview(userId, { formulaId, incomeKobo }) {
  const formula = await getFormula(userId, formulaId)
  return {
    formula: { id: formula.id, name: formula.name },
    incomeKobo: BigInt(incomeKobo),
    allocations: splitIncome(BigInt(incomeKobo), formula.buckets),
  }
}

export async function create(userId, { formulaId, incomeKobo, periodStart }, idempotencyKey) {
  // Phone retried after a network drop? Hand back the budget we already made.
  if (idempotencyKey) {
    const existing = await prisma.budget.findUnique({
      where: { userId_idempotencyKey: { userId, idempotencyKey } },
      include,
    })
    if (existing) return { budget: await withSummary(existing), replayed: true }
  }

  const formula = await getFormula(userId, formulaId)
  const income = BigInt(incomeKobo)

  const budget = await prisma.budget.create({
    data: {
      userId,
      formulaId: formula.id,
      incomeKobo: income,
      periodStart,
      idempotencyKey,
      allocations: { create: splitIncome(income, formula.buckets) },
    },
    include,
  })

  return { budget: await withSummary(budget), replayed: false }
}

// Cursor pagination: ?limit=20&cursor=<last budget id>
export async function list(userId, { limit, cursor }) {
  const rows = await prisma.budget.findMany({
    where: { userId },
    include: { formula: include.formula },
    orderBy: [{ periodStart: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(cursor && { cursor: { id: cursor }, skip: 1 }),
  })

  const hasMore = rows.length > limit
  const items = hasMore ? rows.slice(0, limit) : rows

  // Total spent per budget, in one query
  const sums = await prisma.expense.groupBy({
    by: ['budgetId'],
    where: { budgetId: { in: items.map((b) => b.id) } },
    _sum: { amountKobo: true },
  })
  const spent = new Map(sums.map((s) => [s.budgetId, s._sum.amountKobo ?? 0n]))

  return {
    budgets: items.map((b) => {
      const spentKobo = spent.get(b.id) ?? 0n
      return { ...b, totals: { incomeKobo: b.incomeKobo, spentKobo, remainingKobo: b.incomeKobo - spentKobo } }
    }),
    nextCursor: hasMore ? items[items.length - 1].id : null,
  }
}

export async function getOne(userId, id) {
  return withSummary(await getOwned(userId, id))
}

// The home screen: the most recent budget, with how much is left in each bucket.
export async function current(userId) {
  const budget = await prisma.budget.findFirst({
    where: { userId },
    include,
    orderBy: [{ periodStart: 'desc' }, { createdAt: 'desc' }],
  })
  return budget ? withSummary(budget) : null
}

export async function remove(userId, id) {
  const budget = await getOwned(userId, id)
  await prisma.budget.delete({ where: { id: budget.id } }) // allocations + expenses cascade
}
