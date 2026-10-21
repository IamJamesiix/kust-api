import { prisma } from '../../lib/prisma.js'
import { AppError } from '../../utils/AppError.js'
import { hashPassword, checkPassword, publicUser } from '../../utils/password.js'
import { issueTokens, revokeAllTokens } from '../auth/tokens.js'

async function getUserOrThrow(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found')
  return user
}

export async function getMe(userId) {
  return publicUser(await getUserOrThrow(userId))
}

export async function updateMe(userId, { onboarded, ...fields }) {
  const user = await prisma.user.update({
    where: { id: userId },
    data: { ...fields, ...(onboarded && { onboardedAt: new Date() }) },
  })
  return publicUser(user)
}

// ---------------------------------------------------------------- bucket names + where money lives

const placeFields = { colorKey: true, baseLabel: true, label: true, livesIn: true }

export function getPlaces(userId) {
  return prisma.bucketPlace.findMany({ where: { userId }, select: placeFields, orderBy: { colorKey: 'asc' } })
}

// Saves the names/places, and updates the CURRENT budget's buckets to match,
// so renaming "Needs" to "Bills" shows up right away. Older budgets keep their names.
export async function savePlaces(userId, buckets) {
  const current = await prisma.budget.findFirst({
    where: { userId },
    orderBy: [{ periodStart: 'desc' }, { createdAt: 'desc' }],
    include: { allocations: true },
  })

  await prisma.$transaction(async (tx) => {
    for (const b of buckets) {
      const before = await tx.bucketPlace.findUnique({ where: { userId_colorKey: { userId, colorKey: b.colorKey } } })
      await tx.bucketPlace.upsert({
        where: { userId_colorKey: { userId, colorKey: b.colorKey } },
        create: { userId, colorKey: b.colorKey, baseLabel: b.baseLabel, label: b.label, livesIn: b.livesIn },
        update: {
          ...(b.baseLabel !== undefined && { baseLabel: b.baseLabel }),
          ...(b.label !== undefined && { label: b.label }),
          ...(b.livesIn !== undefined && { livesIn: b.livesIn }),
        },
      })

      for (const a of current?.allocations ?? []) {
        if (a.colorKey !== b.colorKey) continue
        // Rename only the bucket the user was looking at (same original or previous name).
        const sameBucket = [b.baseLabel, before?.label, before?.baseLabel].filter(Boolean).includes(a.label)
        await tx.allocation.update({
          where: { id: a.id },
          data: {
            ...(b.livesIn !== undefined && { livesIn: b.livesIn }),
            ...(b.label && sameBucket && { label: b.label }),
          },
        })
      }
    }
  })

  return getPlaces(userId)
}

// New password = every device gets logged out, and this device gets fresh tokens.
export async function changePassword(userId, { currentPassword, newPassword }) {
  const user = await getUserOrThrow(userId)
  if (!user.passwordHash) {
    throw new AppError(400, 'NO_PASSWORD', 'You sign in with Google. Use "Forgot password" to add a password.')
  }
  if (!(await checkPassword(currentPassword, user.passwordHash))) {
    throw new AppError(401, 'BAD_CREDENTIALS', 'Current password is wrong')
  }

  await prisma.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(newPassword) } })
  await revokeAllTokens(userId)
  return issueTokens(user)
}

export async function deleteMe(userId, { password }) {
  const user = await getUserOrThrow(userId)
  // Google-only accounts have no password to confirm with; being logged in is the proof.
  if (user.passwordHash && !(password && (await checkPassword(password, user.passwordHash)))) {
    throw new AppError(401, 'BAD_CREDENTIALS', 'Password is wrong')
  }

  // Budgets first (they point at formulas), then the user. Everything else cascades.
  await prisma.$transaction([
    prisma.budget.deleteMany({ where: { userId } }),
    prisma.user.delete({ where: { id: userId } }),
  ])
}
