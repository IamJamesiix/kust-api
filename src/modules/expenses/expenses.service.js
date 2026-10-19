import { prisma } from '../../lib/prisma.js'
import { AppError } from '../../utils/AppError.js'
import { getOwned as getBudget } from '../budgets/budgets.service.js'

// The bucket must belong to this budget (you can't log Wants money against someone else's Needs)
function assertBucket(budget, allocationId) {
  if (!budget.allocations.some((a) => a.id === allocationId)) {
    throw new AppError(400, 'BAD_ALLOCATION', "That bucket isn't part of this budget")
  }
}

async function getOwnedExpense(userId, expenseId) {
  const expense = await prisma.expense.findFirst({ where: { id: expenseId, userId } })
  if (!expense) throw new AppError(404, 'EXPENSE_NOT_FOUND', 'Expense not found')
  return expense
}

export async function create(userId, budgetId, { allocationId, amountKobo, note, spentAt }) {
  const budget = await getBudget(userId, budgetId)
  assertBucket(budget, allocationId)

  return prisma.expense.create({
    data: { userId, budgetId: budget.id, allocationId, amountKobo: BigInt(amountKobo), note, spentAt },
  })
}

// Newest first. ?allocationId= to see one bucket only.
export async function list(userId, budgetId, { allocationId, limit, cursor }) {
  const budget = await getBudget(userId, budgetId)

  const rows = await prisma.expense.findMany({
    where: { budgetId: budget.id, ...(allocationId && { allocationId }) },
    orderBy: [{ spentAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(cursor && { cursor: { id: cursor }, skip: 1 }),
  })

  const hasMore = rows.length > limit
  const items = hasMore ? rows.slice(0, limit) : rows
  return { expenses: items, nextCursor: hasMore ? items[items.length - 1].id : null }
}

export async function update(userId, expenseId, data) {
  const expense = await getOwnedExpense(userId, expenseId)

  if (data.allocationId) {
    const budget = await getBudget(userId, expense.budgetId)
    assertBucket(budget, data.allocationId)
  }

  return prisma.expense.update({
    where: { id: expense.id },
    data: {
      ...data,
      ...(data.amountKobo !== undefined && { amountKobo: BigInt(data.amountKobo) }),
    },
  })
}

export async function remove(userId, expenseId) {
  const expense = await getOwnedExpense(userId, expenseId)
  await prisma.expense.delete({ where: { id: expense.id } })
}
