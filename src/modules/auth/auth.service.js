import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { prisma } from '../../lib/prisma.js'
import { env } from '../../config/env.js'
import { AppError } from '../../utils/AppError.js'

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex')

const publicUser = ({ passwordHash, ...user }) => user

async function issueTokens(userId) {
  const accessToken = jwt.sign({}, env.JWT_ACCESS_SECRET, {
    subject: userId,
    expiresIn: env.ACCESS_TOKEN_TTL,
  })

  // Refresh token is a random string. We only store its hash.
  const refreshToken = crypto.randomBytes(48).toString('hex')
  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: sha256(refreshToken),
      expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000),
    },
  })

  return { accessToken, refreshToken }
}

export async function register({ email, password, incomeType }) {
  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) throw new AppError(409, 'EMAIL_TAKEN', 'An account with that email already exists')

  const user = await prisma.user.create({
    data: { email, incomeType, passwordHash: await bcrypt.hash(password, 12) },
  })

  return { user: publicUser(user), ...(await issueTokens(user.id)) }
}

export async function login({ email, password }) {
  const user = await prisma.user.findUnique({ where: { email } })
  const ok = user && (await bcrypt.compare(password, user.passwordHash))
  if (!ok) throw new AppError(401, 'BAD_CREDENTIALS', 'Email or password is wrong')

  return { user: publicUser(user), ...(await issueTokens(user.id)) }
}

// Rotation: every refresh kills the old token and hands out a new pair.
export async function refresh({ refreshToken }) {
  const stored = await prisma.refreshToken.findUnique({ where: { tokenHash: sha256(refreshToken) } })

  if (!stored) throw new AppError(401, 'REFRESH_INVALID', 'Refresh token invalid')

  // An already-used token showing up again = probably stolen. Log the user out everywhere.
  if (stored.revokedAt) {
    await prisma.refreshToken.updateMany({
      where: { userId: stored.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    })
    throw new AppError(401, 'REFRESH_REUSED', 'Session expired, log in again')
  }

  if (stored.expiresAt < new Date()) throw new AppError(401, 'REFRESH_EXPIRED', 'Session expired, log in again')

  await prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } })
  return issueTokens(stored.userId)
}

export async function logout({ refreshToken }) {
  await prisma.refreshToken.updateMany({
    where: { tokenHash: sha256(refreshToken), revokedAt: null },
    data: { revokedAt: new Date() },
  })
}

export async function me(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found')
  return publicUser(user)
}
