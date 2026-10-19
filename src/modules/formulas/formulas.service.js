import { prisma } from '../../lib/prisma.js'
import { AppError } from '../../utils/AppError.js'

const withBuckets = { buckets: { orderBy: { position: 'asc' } } }

function checkSplit(buckets) {
  const total = buckets.reduce((sum, b) => sum + b.percent, 0)
  if (total !== 10000) {
    throw new AppError(400, 'BAD_SPLIT', `Buckets must add up to 100% (10000). Yours add up to ${total}.`)
  }
}

// AUTHORISATION (ownership): built-in formulas belong to admins, custom ones to their owner.
function assertCanEdit(user, formula) {
  const allowed = formula.isSystem ? user.role === 'ADMIN' : formula.ownerId === user.id
  if (!allowed) throw new AppError(403, 'FORBIDDEN', 'You can only change your own formulas')
}

// Built-in formulas + the ones this user made
export function listForUser(userId) {
  return prisma.formula.findMany({
    where: { OR: [{ isSystem: true }, { ownerId: userId }] },
    include: withBuckets,
    orderBy: [{ isSystem: 'desc' }, { createdAt: 'asc' }],
  })
}

// A user can see built-ins and their own. Someone else's formula = "not found",
// so we don't even reveal it exists.
export async function getForUser(userId, formulaId) {
  const formula = await prisma.formula.findFirst({
    where: { id: formulaId, OR: [{ isSystem: true }, { ownerId: userId }] },
    include: withBuckets,
  })
  if (!formula) throw new AppError(404, 'FORMULA_NOT_FOUND', 'Formula not found')
  return formula
}

export async function create(user, { name, description, buckets, system }) {
  checkSplit(buckets)
  if (system && user.role !== 'ADMIN') {
    throw new AppError(403, 'FORBIDDEN', 'Only admins can create built-in formulas')
  }

  return prisma.formula.create({
    data: {
      name,
      description,
      isSystem: Boolean(system),
      ownerId: system ? null : user.id,
      buckets: { create: buckets.map((b, position) => ({ ...b, position })) },
    },
    include: withBuckets,
  })
}

// Changing buckets doesn't touch old budgets — their allocations were copied when made.
export async function update(user, formulaId, { name, description, buckets }) {
  const formula = await getForUser(user.id, formulaId)
  assertCanEdit(user, formula)
  if (buckets) checkSplit(buckets)

  return prisma.formula.update({
    where: { id: formula.id },
    data: {
      name,
      description,
      ...(buckets && {
        buckets: {
          deleteMany: {},
          create: buckets.map((b, position) => ({ ...b, position })),
        },
      }),
    },
    include: withBuckets,
  })
}

export async function remove(user, formulaId) {
  const formula = await getForUser(user.id, formulaId)
  assertCanEdit(user, formula)

  const used = await prisma.budget.count({ where: { formulaId: formula.id } })
  if (used > 0) {
    throw new AppError(409, 'FORMULA_IN_USE', `This formula is used by ${used} budget(s). Delete those first.`)
  }

  await prisma.formula.delete({ where: { id: formula.id } })
}
