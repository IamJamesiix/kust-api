import crypto from 'node:crypto'
import jwt from 'jsonwebtoken'
import { prisma } from '../../lib/prisma.js'
import { env } from '../../config/env.js'

export const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex')

// Access token: short-lived JWT (15m). Carries user id (sub), role and whether the email is verified (ev).
// Refresh token: long random string. We only store its hash, like a password.
export async function issueTokens(user) {
  const accessToken = jwt.sign({ role: user.role, ev: user.emailVerified }, env.JWT_ACCESS_SECRET, {
    subject: user.id,
    expiresIn: env.ACCESS_TOKEN_TTL,
  })

  const refreshToken = crypto.randomBytes(48).toString('hex')
  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: sha256(refreshToken),
      expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000),
    },
  })

  return { accessToken, refreshToken }
}

// Log out everywhere: kill every live refresh token for this user
export function revokeAllTokens(userId) {
  return prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  })
}
