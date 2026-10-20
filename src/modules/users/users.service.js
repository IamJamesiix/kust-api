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

export async function updateMe(userId, { name, incomeType }) {
  const user = await prisma.user.update({ where: { id: userId }, data: { name, incomeType } })
  return publicUser(user)
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
