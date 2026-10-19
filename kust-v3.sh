#!/usr/bin/env bash
# Kust backend v3: email verification (OTP), forgot/reset password, Resend email,
# and deploy prep for Render.
# Run from the project root:  bash kust-v3.sh
set -e

if [ ! -f prisma.config.ts ] || [ ! -d src/modules/expenses ]; then
  echo "Run this from your kust-api folder, after v2 is installed"; exit 1
fi

echo "==> Moving tsx + prisma to main dependencies (Render needs them at runtime)"
npm i --save-prod tsx prisma@7.10.0
npm pkg set engines.node=">=20.19"

echo "==> Adding email settings to .env"
if ! grep -q RESEND_API_KEY .env; then
  printf '\n# Email (Resend). Empty in development = codes print in the terminal instead.\nRESEND_API_KEY=\nEMAIL_FROM="Kust <onboarding@resend.dev>"\n' >> .env
fi
if ! grep -q RESEND_API_KEY .env.example; then
  printf 'RESEND_API_KEY=re_xxxxxxxx\nEMAIL_FROM="Kust <noreply@yourdomain.com>"\n' >> .env.example
fi

echo "==> Writing files"
mkdir -p src/lib

cat > prisma/schema.prisma <<'KUSTEOF'
// Money is stored in KOBO as BigInt (₦1,500.50 = 150050). Never floats.
// Percentages are basis points: 5000 = 50%, 1250 = 12.5%.

generator client {
  provider = "prisma-client"
  output   = "../src/generated/prisma"
}

datasource db {
  provider = "postgresql"
}

enum Role {
  USER
  ADMIN
}

enum OtpPurpose {
  VERIFY_EMAIL
  RESET_PASSWORD
}

enum IncomeType {
  STUDENT
  SALARIED
  FREELANCE
}

model User {
  id            String         @id @default(uuid())
  email         String         @unique
  emailVerified Boolean        @default(false)
  name          String?
  passwordHash  String
  role          Role           @default(USER)
  incomeType    IncomeType     @default(SALARIED)
  budgets       Budget[]
  expenses      Expense[]
  formulas      Formula[]
  refreshTokens RefreshToken[]
  otpCodes      OtpCode[]
  createdAt     DateTime       @default(now())
  updatedAt     DateTime       @updatedAt
}

model RefreshToken {
  id        String    @id @default(uuid())
  tokenHash String    @unique
  userId    String
  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  expiresAt DateTime
  revokedAt DateTime?
  createdAt DateTime  @default(now())

  @@index([userId])
}

// One-time codes sent by email. Only the hash is stored.
model OtpCode {
  id        String     @id @default(uuid())
  userId    String
  user      User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  purpose   OtpPurpose
  codeHash  String
  expiresAt DateTime
  attempts  Int        @default(0)
  usedAt    DateTime?
  createdAt DateTime   @default(now())

  @@index([userId, purpose])
}

model Formula {
  id          String          @id @default(uuid())
  name        String
  description String?
  isSystem    Boolean         @default(false)
  ownerId     String?
  owner       User?           @relation(fields: [ownerId], references: [id], onDelete: Cascade)
  buckets     FormulaBucket[]
  budgets     Budget[]
  createdAt   DateTime        @default(now())

  @@index([ownerId])
}

model FormulaBucket {
  id        String  @id @default(uuid())
  formulaId String
  formula   Formula @relation(fields: [formulaId], references: [id], onDelete: Cascade)
  label     String
  percent   Int
  colorKey  String
  position  Int

  @@index([formulaId])
}

model Budget {
  id             String       @id @default(uuid())
  userId         String
  user           User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  formulaId      String
  formula        Formula      @relation(fields: [formulaId], references: [id])
  incomeKobo     BigInt
  periodStart    DateTime     @default(now())
  idempotencyKey String?
  allocations    Allocation[]
  expenses       Expense[]
  createdAt      DateTime     @default(now())

  @@unique([userId, idempotencyKey])
  @@index([userId, createdAt])
}

model Allocation {
  id         String @id @default(uuid())
  budgetId   String
  budget     Budget @relation(fields: [budgetId], references: [id], onDelete: Cascade)
  label      String
  colorKey   String
  percent    Int
  amountKobo BigInt
  position   Int
  expenses   Expense[]

  @@index([budgetId])
}

// Money the user actually spent, logged against one bucket of one budget.
model Expense {
  id           String     @id @default(uuid())
  userId       String
  user         User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  budgetId     String
  budget       Budget     @relation(fields: [budgetId], references: [id], onDelete: Cascade)
  allocationId String
  allocation   Allocation @relation(fields: [allocationId], references: [id], onDelete: Cascade)
  amountKobo   BigInt
  note         String?
  spentAt      DateTime   @default(now())
  createdAt    DateTime   @default(now())
  updatedAt    DateTime   @updatedAt

  @@index([budgetId])
  @@index([allocationId])
  @@index([userId, spentAt])
}
KUSTEOF
echo '   prisma/schema.prisma'

cat > src/app.js <<'KUSTEOF'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import morgan from 'morgan'
import { env } from './config/env.js'
import { prisma } from './lib/prisma.js'
import authRoutes from './modules/auth/auth.routes.js'
import userRoutes from './modules/users/users.routes.js'
import formulaRoutes from './modules/formulas/formulas.routes.js'
import budgetRoutes from './modules/budgets/budgets.routes.js'
import expenseRoutes from './modules/expenses/expenses.routes.js'
import { requireAuth, requireVerified } from './middleware/requireAuth.js'
import { apiLimiter } from './middleware/rateLimit.js'
import { notFound, errorHandler } from './middleware/errorHandler.js'

const app = express()

// Behind a host like Render/Railway, the real client IP is in X-Forwarded-For.
// Rate limiting needs the real IP, so trust the first proxy.
app.set('trust proxy', 1)

// Money is BigInt in the database. JSON can't carry BigInt, so every response
// turns BigInt into a normal number on the way out. (Safe up to ~₦90 trillion.)
app.set('json replacer', (key, value) => (typeof value === 'bigint' ? Number(value) : value))

app.use(helmet())
app.use(cors())
app.use(express.json({ limit: '100kb' }))
if (env.NODE_ENV !== 'test') app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'))

app.get('/health', async (req, res) => {
  await prisma.$queryRaw`SELECT 1`
  res.json({ ok: true, db: 'up', time: new Date().toISOString() })
})

// Versioned from day one — old app builds stay on people's phones for months.
const v1 = express.Router()
v1.use(apiLimiter)
v1.use('/auth', authRoutes)
v1.use('/users', requireAuth, userRoutes)
// The main features need a verified email. /users stays open so the app can show status.
v1.use('/formulas', requireAuth, requireVerified, formulaRoutes)
v1.use('/budgets', requireAuth, requireVerified, budgetRoutes)
v1.use('/expenses', requireAuth, requireVerified, expenseRoutes)
app.use('/api/v1', v1)

app.use(notFound)
app.use(errorHandler)

export default app
KUSTEOF
echo '   src/app.js'

cat > src/config/env.js <<'KUSTEOF'
import 'dotenv/config'
import { z } from 'zod'

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_DAYS: z.coerce.number().int().positive().default(30),

  // Email (Resend). Without a key, codes are printed in the terminal instead (dev only).
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default('Kust <onboarding@resend.dev>'),
})

const parsed = schema.safeParse(process.env)

if (!parsed.success) {
  console.error('Bad environment variables:')
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join('.')}: ${issue.message}`)
  }
  process.exit(1)
}

if (parsed.data.NODE_ENV === 'production' && !parsed.data.RESEND_API_KEY) {
  console.error('RESEND_API_KEY is required in production (users need their codes)')
  process.exit(1)
}

export const env = parsed.data
KUSTEOF
echo '   src/config/env.js'

cat > src/lib/email.js <<'KUSTEOF'
import { env } from '../config/env.js'

// Sends through Resend's HTTP API (https, port 443 — works on Render, which blocks SMTP ports).
// Returns true if sent, false if not. Never throws: a failed email shouldn't crash sign-up.
export async function sendEmail({ to, subject, html, text }) {
  if (!env.RESEND_API_KEY) {
    console.log(`\n📧 [DEV EMAIL — no RESEND_API_KEY]\n   To: ${to}\n   Subject: ${subject}\n   ${text}\n`)
    return true
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: env.EMAIL_FROM, to, subject, html, text }),
    })

    if (!res.ok) {
      console.error(`Email to ${to} failed: ${res.status} ${await res.text()}`)
      if (env.NODE_ENV !== 'production') console.log(`   (dev fallback) ${text}`)
      return false
    }
    return true
  } catch (err) {
    console.error(`Email to ${to} failed: ${err.message}`)
    if (env.NODE_ENV !== 'production') console.log(`   (dev fallback) ${text}`)
    return false
  }
}

export function codeEmail({ code, purpose }) {
  const title = purpose === 'VERIFY_EMAIL' ? 'Verify your email' : 'Reset your password'
  const intro =
    purpose === 'VERIFY_EMAIL'
      ? 'Welcome to Kust! Enter this code in the app to verify your email:'
      : 'Someone asked to reset your Kust password. If it was you, enter this code in the app:'

  return {
    subject: `${code} is your Kust code`,
    text: `${intro} ${code} — it expires in 10 minutes. If you didn't ask for this, ignore this email.`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:420px;margin:auto;padding:24px">
        <h2 style="margin:0 0 12px">${title}</h2>
        <p style="color:#444">${intro}</p>
        <p style="font-size:32px;font-weight:bold;letter-spacing:8px;margin:20px 0">${code}</p>
        <p style="color:#888;font-size:13px">This code expires in 10 minutes. If you didn't ask for it, you can ignore this email.</p>
      </div>`,
  }
}
KUSTEOF
echo '   src/lib/email.js'

cat > src/middleware/rateLimit.js <<'KUSTEOF'
import { rateLimit } from 'express-rate-limit'
import { env } from '../config/env.js'

const isProd = env.NODE_ENV === 'production'

const limited = (message) => ({
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message } },
})

// Everything under /api/v1: 300 requests per 15 minutes per IP.
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  ...limited('Too many requests, slow down a bit'),
})

// Login/register: 10 FAILED attempts per 15 minutes per IP in production. Stops password guessing.
// Successful logins don't count, so real users never hit it. (100 in development so you
// don't lock yourself out while testing.)
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: isProd ? 10 : 100,
  skipSuccessfulRequests: true,
  ...limited('Too many attempts. Try again in 15 minutes'),
})

// Sending codes by email: 5 per 15 minutes per IP in production (each one costs an email).
export const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: isProd ? 5 : 50,
  ...limited('Too many code requests. Try again in 15 minutes'),
})
KUSTEOF
echo '   src/middleware/rateLimit.js'

cat > src/middleware/requireAuth.js <<'KUSTEOF'
import jwt from 'jsonwebtoken'
import { env } from '../config/env.js'
import { AppError } from '../utils/AppError.js'

// AUTHENTICATION: who are you?
// Mobile sends: Authorization: Bearer <accessToken>
export function requireAuth(req, res, next) {
  const [type, token] = (req.headers.authorization || '').split(' ')

  if (type !== 'Bearer' || !token) {
    throw new AppError(401, 'UNAUTHORIZED', 'Missing access token')
  }

  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET)
    req.user = { id: payload.sub, role: payload.role ?? 'USER', emailVerified: payload.ev === true }
  } catch {
    throw new AppError(401, 'TOKEN_INVALID', 'Access token invalid or expired')
  }

  next()
}

// Use after requireAuth on routes that need a verified email (the main app features).
export function requireVerified(req, res, next) {
  if (!req.user?.emailVerified) {
    throw new AppError(403, 'EMAIL_NOT_VERIFIED', 'Verify your email to continue')
  }
  next()
}
KUSTEOF
echo '   src/middleware/requireAuth.js'

cat > src/modules/auth/tokens.js <<'KUSTEOF'
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
KUSTEOF
echo '   src/modules/auth/tokens.js'

cat > src/modules/auth/otp.js <<'KUSTEOF'
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
KUSTEOF
echo '   src/modules/auth/otp.js'

cat > src/modules/auth/auth.service.js <<'KUSTEOF'
import { prisma } from '../../lib/prisma.js'
import { AppError } from '../../utils/AppError.js'
import { hashPassword, checkPassword, publicUser } from '../../utils/password.js'
import { issueTokens, revokeAllTokens, sha256 } from './tokens.js'
import { sendCode, useCode } from './otp.js'

export async function register({ email, password, name, incomeType }) {
  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) throw new AppError(409, 'EMAIL_TAKEN', 'An account with that email already exists')

  const user = await prisma.user.create({
    data: { email, name, incomeType, passwordHash: await hashPassword(password) },
  })

  // Send the verification code. If email fails, sign-up still works — they can tap "resend".
  const emailSent = await sendCode(user, 'VERIFY_EMAIL')

  return { user: publicUser(user), emailSent, ...(await issueTokens(user)) }
}

export async function login({ email, password }) {
  const user = await prisma.user.findUnique({ where: { email } })
  const ok = user && (await checkPassword(password, user.passwordHash))
  // Same message for "no such email" and "wrong password" so attackers can't
  // use login to find out which emails have accounts.
  if (!ok) throw new AppError(401, 'BAD_CREDENTIALS', 'Email or password is wrong')

  return { user: publicUser(user), ...(await issueTokens(user)) }
}

// Rotation: every refresh kills the old token and hands out a new pair.
export async function refresh({ refreshToken }) {
  const stored = await prisma.refreshToken.findUnique({
    where: { tokenHash: sha256(refreshToken) },
    include: { user: true },
  })

  if (!stored) throw new AppError(401, 'REFRESH_INVALID', 'Refresh token invalid')

  // An already-used token showing up again = probably stolen. Log the user out everywhere.
  if (stored.revokedAt) {
    await revokeAllTokens(stored.userId)
    throw new AppError(401, 'REFRESH_REUSED', 'Session expired, log in again')
  }

  if (stored.expiresAt < new Date()) throw new AppError(401, 'REFRESH_EXPIRED', 'Session expired, log in again')

  await prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } })
  return issueTokens(stored.user)
}

export async function logout({ refreshToken }) {
  await prisma.refreshToken.updateMany({
    where: { tokenHash: sha256(refreshToken), revokedAt: null },
    data: { revokedAt: new Date() },
  })
}

export async function logoutAll(userId) {
  await revokeAllTokens(userId)
}

// ---------------------------------------------------------------- email verification

export async function resendVerification(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found')
  if (user.emailVerified) throw new AppError(400, 'ALREADY_VERIFIED', 'Your email is already verified')

  const emailSent = await sendCode(user, 'VERIFY_EMAIL')
  return { emailSent }
}

// Returns fresh tokens: the old access token still says "not verified".
export async function verifyEmail(userId, { code }) {
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found')
  if (user.emailVerified) throw new AppError(400, 'ALREADY_VERIFIED', 'Your email is already verified')

  await useCode(user.id, 'VERIFY_EMAIL', code)
  const verified = await prisma.user.update({ where: { id: user.id }, data: { emailVerified: true } })

  return { user: publicUser(verified), ...(await issueTokens(verified)) }
}

// ---------------------------------------------------------------- forgot / reset password

// Always answers the same way, whether the email exists or not, so this can't be
// used to find out who has an account.
export async function forgotPassword({ email }) {
  const user = await prisma.user.findUnique({ where: { email } })
  if (user) {
    try {
      await sendCode(user, 'RESET_PASSWORD')
    } catch (err) {
      if (err.code !== 'OTP_COOLDOWN') throw err // cooldown: stay quiet, a code was just sent
    }
  }
  return { message: 'If that email has an account, a reset code is on its way.' }
}

export async function resetPassword({ email, code, newPassword }) {
  const user = await prisma.user.findUnique({ where: { email } })
  if (!user) throw new AppError(400, 'OTP_EXPIRED', 'That code has expired. Ask for a new one.')

  await useCode(user.id, 'RESET_PASSWORD', code)

  // They proved they own the inbox, so the email counts as verified too.
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(newPassword), emailVerified: true },
  })
  await revokeAllTokens(user.id) // every old session dies

  return { user: publicUser(updated), ...(await issueTokens(updated)) }
}
KUSTEOF
echo '   src/modules/auth/auth.service.js'

cat > src/modules/auth/auth.controller.js <<'KUSTEOF'
import * as authService from './auth.service.js'

export async function register(req, res) {
  res.status(201).json(await authService.register(req.body))
}

export async function login(req, res) {
  res.json(await authService.login(req.body))
}

export async function refresh(req, res) {
  res.json(await authService.refresh(req.body))
}

export async function logout(req, res) {
  await authService.logout(req.body)
  res.status(204).end()
}

export async function logoutAll(req, res) {
  await authService.logoutAll(req.user.id)
  res.status(204).end()
}

export async function resendVerification(req, res) {
  res.json(await authService.resendVerification(req.user.id))
}

export async function verifyEmail(req, res) {
  res.json(await authService.verifyEmail(req.user.id, req.body))
}

export async function forgotPassword(req, res) {
  res.json(await authService.forgotPassword(req.body))
}

export async function resetPassword(req, res) {
  res.json(await authService.resetPassword(req.body))
}
KUSTEOF
echo '   src/modules/auth/auth.controller.js'

cat > src/modules/auth/auth.routes.js <<'KUSTEOF'
import { Router } from 'express'
import { z } from 'zod'
import { validate } from '../../middleware/validate.js'
import { requireAuth } from '../../middleware/requireAuth.js'
import { authLimiter, otpLimiter } from '../../middleware/rateLimit.js'
import * as c from './auth.controller.js'

const router = Router()

const email = z.string().trim().toLowerCase().email('Enter a valid email')
export const passwordRule = z.string().min(8, 'Password must be at least 8 characters').max(72)
const code = z.string().trim().regex(/^\d{6}$/, 'The code is 6 digits')

const registerSchema = z.object({
  email,
  password: passwordRule,
  name: z.string().trim().min(1).max(60).optional(),
  incomeType: z.enum(['STUDENT', 'SALARIED', 'FREELANCE']).optional(),
})

const loginSchema = z.object({ email, password: z.string().min(1) })
const tokenSchema = z.object({ refreshToken: z.string().min(1) })
const verifySchema = z.object({ code })
const forgotSchema = z.object({ email })
const resetSchema = z.object({ email, code, newPassword: passwordRule })

router.post('/register', authLimiter, validate(registerSchema), c.register)
router.post('/login', authLimiter, validate(loginSchema), c.login)
router.post('/refresh', validate(tokenSchema), c.refresh)
router.post('/logout', validate(tokenSchema), c.logout)
router.post('/logout-all', requireAuth, c.logoutAll)

// Email verification (logged in, right after sign-up)
router.post('/verify-email', requireAuth, authLimiter, validate(verifySchema), c.verifyEmail)
router.post('/resend-verification', requireAuth, otpLimiter, c.resendVerification)

// Forgot password (logged out)
router.post('/forgot-password', otpLimiter, validate(forgotSchema), c.forgotPassword)
router.post('/reset-password', authLimiter, validate(resetSchema), c.resetPassword)

export default router
KUSTEOF
echo '   src/modules/auth/auth.routes.js'

cat > render.yaml <<'KUSTEOF'
# Render Blueprint: Render reads this file and sets up the service for you.
# Dashboard -> New -> Blueprint -> pick this repo.
services:
  - type: web
    name: kust-api
    runtime: node
    plan: free
    region: frankfurt # closest Render region to Nigeria
    buildCommand: npm ci && npx prisma migrate deploy
    startCommand: npm start
    healthCheckPath: /health
    envVars:
      - key: NODE_ENV
        value: production
      - key: JWT_ACCESS_SECRET
        generateValue: true # Render makes a strong random secret
      - key: DATABASE_URL
        sync: false # you paste it in the dashboard
      - key: RESEND_API_KEY
        sync: false
      - key: EMAIL_FROM
        sync: false
KUSTEOF
echo '   render.yaml'

cat > API.md <<'KUSTEOF'
# Kust API (v1)

Base URL (local): `http://localhost:3000/api/v1`

## Conventions

- **Money is in kobo, as whole numbers.** ₦1,500.50 = `150050`. Divide by 100 to display.
- **Percentages are basis points.** `5000` = 50%, `1250` = 12.5%.
- **Auth:** send `Authorization: Bearer <accessToken>` on every route marked 🔒.
- **Access tokens last 15 minutes.** When a request returns `401 TOKEN_INVALID`, call `POST /auth/refresh` with the stored refresh token, save the new pair, and retry the request once.
- **Refresh tokens last 30 days and rotate.** Every refresh returns a new refresh token and the old one stops working. Always save the new one.
- **Errors always look like this:**
  ```json
  { "error": { "code": "EMAIL_TAKEN", "message": "An account with that email already exists", "details": [] } }
  ```
  The app should check `code` and show `message`. `details` only appears on `VALIDATION_ERROR` (one entry per bad field).
- **Lists use cursor pagination:** `?limit=20&cursor=<nextCursor from the last page>`. `nextCursor: null` means there are no more pages.

## Auth

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/auth/register` | `{ email, password (8+), name?, incomeType? }` | `201 { user, accessToken, refreshToken }` |
| POST | `/auth/login` | `{ email, password }` | `{ user, accessToken, refreshToken }` |
| POST | `/auth/refresh` | `{ refreshToken }` | `{ accessToken, refreshToken }` |
| POST | `/auth/logout` | `{ refreshToken }` | `204` |
| POST | `/auth/logout-all` 🔒 | – | `204` (every device logged out) |
| POST | `/auth/verify-email` 🔒 | `{ code }` | `{ user, accessToken, refreshToken }`. Save the new tokens. |
| POST | `/auth/resend-verification` 🔒 | – | `{ emailSent }` |
| POST | `/auth/forgot-password` | `{ email }` | `{ message }` (same answer whether or not the email exists) |
| POST | `/auth/reset-password` | `{ email, code, newPassword }` | `{ user, accessToken, refreshToken }`. Other devices are logged out. |

`incomeType` is one of `STUDENT`, `SALARIED`, `FREELANCE`.

### Email verification (OTP)

- `register` emails a **6-digit code** and returns `emailSent` along with the tokens. The user is logged in but **unverified**.
- Until they verify, `/formulas`, `/budgets` and `/expenses` return `403 EMAIL_NOT_VERIFIED`. `/users/me` still works.
- App flow: after register (or a login where `user.emailVerified` is `false`), show the code screen, then call `POST /auth/verify-email` and **replace the stored tokens** with the ones it returns.
- Codes expire after **10 minutes**, allow **5 wrong tries**, and work only once. Asking for a new code kills the old one.
- `resend-verification` and `forgot-password` have a **60-second cooldown** (`429 OTP_COOLDOWN`, and `details.retryAfter` says how many seconds to wait).

### Forgot password

1. `POST /auth/forgot-password { email }`, then show the code screen
2. `POST /auth/reset-password { email, code, newPassword }`, which logs the user in. Every other session is ended, and the email counts as verified.

## Users 🔒 (no verified email needed)

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/users/me` | – | `{ user }` |
| PATCH | `/users/me` | `{ name?, incomeType? }` | `{ user }` |
| POST | `/users/me/password` | `{ currentPassword, newPassword }` | `{ accessToken, refreshToken }`. Other devices are logged out. |
| DELETE | `/users/me` | `{ password }` | `204`. Deletes the account and all its data. |

## Formulas 🔒 ✉️ (verified email required)

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/formulas` | – | `{ formulas }` (built-in ones first, then the user's own) |
| GET | `/formulas/:id` | – | `{ formula }` |
| POST | `/formulas` | `{ name, description?, buckets: [{ label, percent, colorKey }] }` | `201 { formula }` |
| PATCH | `/formulas/:id` | `{ name?, description?, buckets? }` | `{ formula }` |
| DELETE | `/formulas/:id` | – | `204`, or `409 FORMULA_IN_USE` if budgets use it |

Buckets must add up to exactly `10000`. Users can only edit their own formulas. Built-in formulas are admin-only: an admin can create one by sending `system: true`.

Built-in formula ids: `sys-50-30-20`, `sys-50-25-15-10`, `sys-70-20-10`, `sys-80-20`.

## Budgets 🔒 ✉️

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/budgets/preview` | `{ formulaId, incomeKobo }` | `{ preview }` (the split, nothing saved) |
| POST | `/budgets` | `{ formulaId, incomeKobo, periodStart? }` | `201 { budget }` |
| GET | `/budgets` | `?limit&cursor` | `{ budgets, nextCursor }`. Each budget has `totals`. |
| GET | `/budgets/current` | – | `{ budget }` (most recent budget, or `null`) |
| GET | `/budgets/:id` | – | `{ budget }` |
| DELETE | `/budgets/:id` | – | `204` (its expenses are deleted too) |

Send an `Idempotency-Key: <random uuid>` header on `POST /budgets`. If the phone retries after a network drop, it gets the same budget back (`200`) instead of a duplicate.

A full budget looks like this:

```json
{
  "id": "…", "formulaId": "sys-50-30-20", "incomeKobo": 15000000, "periodStart": "…",
  "formula": { "id": "sys-50-30-20", "name": "50/30/20" },
  "allocations": [
    { "id": "…", "label": "Needs", "colorKey": "needs", "percent": 5000,
      "amountKobo": 7500000, "spentKobo": 2500000, "remainingKobo": 5000000,
      "usedPercent": 33.33, "overspent": false, "position": 0 }
  ],
  "totals": { "incomeKobo": 15000000, "spentKobo": 2500000, "remainingKobo": 12500000 }
}
```

## Expenses 🔒 ✉️

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/budgets/:id/expenses` | `{ allocationId, amountKobo, note?, spentAt? }` | `201 { expense }` |
| GET | `/budgets/:id/expenses` | `?allocationId&limit&cursor` | `{ expenses, nextCursor }` (newest first) |
| PATCH | `/expenses/:id` | `{ allocationId?, amountKobo?, note?, spentAt? }` | `{ expense }` |
| DELETE | `/expenses/:id` | – | `204` |

`allocationId` is the bucket the money came out of (Needs, Wants…), taken from `budget.allocations[].id`. Overspending is allowed: that bucket then shows `overspent: true` and a negative `remainingKobo`.

## Limits

- All of `/api/v1`: 300 requests per 15 minutes per IP.
- Login, register, verify and reset: 10 failed attempts per 15 minutes per IP in production (100 in development).
- Sending codes (resend-verification, forgot-password): 5 per 15 minutes per IP in production.
- Over a limit, the API returns `429 RATE_LIMITED`.

## Admin

Make a user an admin with `npm run make-admin -- email@example.com`. They then need to log in again.

## Common error codes

`VALIDATION_ERROR`, `BAD_JSON`, `UNAUTHORIZED`, `TOKEN_INVALID`, `BAD_CREDENTIALS`, `EMAIL_TAKEN`, `REFRESH_INVALID`, `REFRESH_REUSED`, `REFRESH_EXPIRED`, `FORBIDDEN`, `FORMULA_NOT_FOUND`, `BUDGET_NOT_FOUND`, `EXPENSE_NOT_FOUND`, `BAD_SPLIT`, `BAD_ALLOCATION`, `FORMULA_IN_USE`, `EMAIL_NOT_VERIFIED`, `ALREADY_VERIFIED`, `OTP_INVALID`, `OTP_EXPIRED`, `OTP_TOO_MANY_ATTEMPTS`, `OTP_COOLDOWN`, `RATE_LIMITED`, `ROUTE_NOT_FOUND`, `INTERNAL_ERROR`
KUSTEOF
echo '   API.md'


echo ""
echo "==> Done. Next:"
echo "   1. npx prisma migrate dev --name email_otp"
echo "   2. npx prisma generate"
echo "   3. npm run dev"
