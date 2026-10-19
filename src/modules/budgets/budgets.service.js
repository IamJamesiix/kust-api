import { prisma } from '../../lib/prisma.js'
import { AppError } from '../../utils/AppError.js'
import { getForUser as getFormula } from '../formulas/formulas.service.js'
import { splitIncome } from './split.js'

const include = {
  allocations: { orderBy: { position: 'asc' } },
  formula: { select: { id: true, name: true } },
}

// BigInt can't go through JSON, so turn kobo into normal numbers on the way out.
// (Safe up to ~₦90 trillion.)
function toDTO(budget) {
  return {
    ...budget,
    incomeKobo: Number(budget.incomeKobo),
    allocations: budget.allocations.map((a) => ({ ...a, amountKobo: Number(a.amountKobo) })),
  }
}

export async function create(userId, { formulaId, incomeKobo, periodStart }, idempotencyKey) {
  // Phone retried after a network drop? Hand back the budget we already made.
  if (idempotencyKey) {
    const existing = await prisma.budget.findUnique({
      where: { userId_idempotencyKey: { userId, idempotencyKey } },
      include,
    })
    if (existing) return { budget: toDTO(existing), replayed: true }
  }

  const formula = await getFormula(userId, formulaId)
  const income = BigInt(incomeKobo)
  const parts = splitIncome(income, formula.buckets)

  const budget = await prisma.budget.create({
    data: {
      userId,
      formulaId: formula.id,
      incomeKobo: income,
      periodStart,
      idempotencyKey,
      allocations: { create: parts },
    },
    include,
  })

  return { budget: toDTO(budget), replayed: false }
}

// Cursor pagination: ?limit=20&cursor=<last budget id>
export async function list(userId, { limit = 20, cursor }) {
  const rows = await prisma.budget.findMany({
    where: { userId },
    include,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(cursor && { cursor: { id: cursor }, skip: 1 }),
  })

  const hasMore = rows.length > limit
  const items = hasMore ? rows.slice(0, limit) : rows

  return {
    budgets: items.map(toDTO),
    nextCursor: hasMore ? items[items.length - 1].id : null,
  }
}

export async function getOne(userId, id) {
  const budget = await prisma.budget.findFirst({ where: { id, userId }, include })
  if (!budget) throw new AppError(404, 'BUDGET_NOT_FOUND', 'Budget not found')
  return toDTO(budget)
}
