import crypto from 'node:crypto'
import { prisma } from '../../lib/prisma.js'
import { env } from '../../config/env.js'
import { AppError } from '../../utils/AppError.js'
import { sendEmail, codeEmail } from '../../lib/email.js'

const TTL_MINUTES = 10
const MAX_ATTEMPTS = 5
const RESEND_COOLDOWN_SECONDS = 60

// Hash with a secret so a leaked database can't be used to brute-force codes offline.
const hashCode = (userId, purpose, code) =>
  crypto.createHmac('sha256', env.JWT_ACCESS_SECRET).update(`${userId}:${purpose}:${code}`).digest('hex')

// Create a new 6-digit code (killing any older one) and email it.
export async function sendCode(user, purpose) {
  const last = await prisma.otpCode.findFirst({
    where: { userId: user.id, purpose },
    orderBy: { createdAt: 'desc' },
  })
  if (last && Date.now() - last.createdAt.getTime() < RESEND_COOLDOWN_SECONDS * 1000) {
    const wait = Math.ceil((RESEND_COOLDOWN_SECONDS * 1000 - (Date.now() - last.createdAt.getTime())) / 1000)
    throw new AppError(429, 'OTP_COOLDOWN', `Wait ${wait}s before asking for another code`, { retryAfter: wait })
  }

  const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0')

  await prisma.$transaction([
    prisma.otpCode.updateMany({
      where: { userId: user.id, purpose, usedAt: null },
      data: { usedAt: new Date() }, // old codes stop working
    }),
    prisma.otpCode.create({
      data: {
        userId: user.id,
        purpose,
        codeHash: hashCode(user.id, purpose, code),
        expiresAt: new Date(Date.now() + TTL_MINUTES * 60 * 1000),
      },
    }),
  ])

  return sendEmail({ to: user.email, ...codeEmail({ code, purpose }) })
}

// Check a code. Throws if wrong/expired/too many tries. Marks it used if right.
export async function useCode(userId, purpose, code) {
  const otp = await prisma.otpCode.findFirst({
    where: { userId, purpose, usedAt: null },
    orderBy: { createdAt: 'desc' },
  })

  if (!otp || otp.expiresAt < new Date()) {
    throw new AppError(400, 'OTP_EXPIRED', 'That code has expired. Ask for a new one.')
  }
  if (otp.attempts >= MAX_ATTEMPTS) {
    throw new AppError(429, 'OTP_TOO_MANY_ATTEMPTS', 'Too many wrong tries. Ask for a new code.')
  }

  const expected = Buffer.from(otp.codeHash)
  const given = Buffer.from(hashCode(userId, purpose, code))
  const match = expected.length === given.length && crypto.timingSafeEqual(expected, given)

  if (!match) {
    await prisma.otpCode.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } })
    const left = MAX_ATTEMPTS - otp.attempts - 1
    throw new AppError(400, 'OTP_INVALID', `Wrong code. ${left} ${left === 1 ? 'try' : 'tries'} left.`)
  }

  await prisma.otpCode.update({ where: { id: otp.id }, data: { usedAt: new Date() } })
}
