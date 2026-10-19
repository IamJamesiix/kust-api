import { prisma } from '../../lib/prisma.js'
import { AppError } from '../../utils/AppError.js'

const withBuckets = { buckets: { orderBy: { position: 'asc' } } }

// Built-in formulas + the ones this user made
export function listForUser(userId) {
  return prisma.formula.findMany({
    where: { OR: [{ isSystem: true }, { ownerId: userId }] },
    include: withBuckets,
    orderBy: [{ isSystem: 'desc' }, { createdAt: 'asc' }],
  })
}

export async function getForUser(userId, formulaId) {
  const formula = await prisma.formula.findFirst({
    where: { id: formulaId, OR: [{ isSystem: true }, { ownerId: userId }] },
    include: withBuckets,
  })
  if (!formula) throw new AppError(404, 'FORMULA_NOT_FOUND', 'Formula not found')
  return formula
}

export async function createCustom(userId, { name, description, buckets }) {
  const total = buckets.reduce((sum, b) => sum + b.percent, 0)
  if (total !== 10000) {
    throw new AppError(400, 'BAD_SPLIT', `Buckets must add up to 100% (10000). Yours add up to ${total}.`)
  }

  return prisma.formula.create({
    data: {
      name,
      description,
      ownerId: userId,
      buckets: { create: buckets.map((b, position) => ({ ...b, position })) },
    },
    include: withBuckets,
  })
}
