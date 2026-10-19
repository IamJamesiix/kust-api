#!/usr/bin/env bash
# Kust backend v2: roles, rate limiting, logging, users, formula edit/delete,
# budget preview/current/delete + spending summaries, expenses, tests, API docs.
# Run from the project root:  bash kust-v2.sh
set -e

if [ ! -f prisma.config.ts ] || [ ! -d src/modules ]; then
  echo "Run this from your kust-api project folder (the one with prisma.config.ts and src/)"; exit 1
fi

echo "==> Installing new packages"
npm i express-rate-limit morgan
npm pkg set scripts.make-admin="tsx scripts/make-admin.js"
npm pkg set scripts.test="node --test tests/*.test.js"

echo "==> Writing files"
mkdir -p src/modules/users src/modules/expenses scripts tests

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

enum IncomeType {
  STUDENT
  SALARIED
  FREELANCE
}

model User {
  id            String         @id @default(uuid())
  email         String         @unique
  name          String?
  passwordHash  String
  role          Role           @default(USER)
  incomeType    IncomeType     @default(SALARIED)
  budgets       Budget[]
  expenses      Expense[]
  formulas      Formula[]
  refreshTokens RefreshToken[]
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
import { requireAuth } from './middleware/requireAuth.js'
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
v1.use('/formulas', requireAuth, formulaRoutes)
v1.use('/budgets', requireAuth, budgetRoutes)
v1.use('/expenses', requireAuth, expenseRoutes)
app.use('/api/v1', v1)

app.use(notFound)
app.use(errorHandler)

export default app
KUSTEOF
echo '   src/app.js'

cat > src/middleware/errorHandler.js <<'KUSTEOF'
import { ZodError } from 'zod'
import { AppError } from '../utils/AppError.js'
import { env } from '../config/env.js'

// Every error leaves the API as: { error: { code, message, details? } }
export function notFound(req, res) {
  res.status(404).json({ error: { code: 'ROUTE_NOT_FOUND', message: `${req.method} ${req.path} not found` } })
}

export function errorHandler(err, req, res, next) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Some fields are wrong',
        details: err.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      },
    })
  }

  if (err instanceof AppError) {
    return res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details },
    })
  }

  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'BAD_JSON', message: 'Request body is not valid JSON' } })
  }

  // Prisma: unique constraint
  if (err.code === 'P2002') {
    return res.status(409).json({ error: { code: 'CONFLICT', message: 'That already exists' } })
  }

  // Prisma: something else still points at this record
  if (err.code === 'P2003') {
    return res.status(409).json({ error: { code: 'IN_USE', message: 'That is still being used elsewhere' } })
  }

  // Prisma: record to update/delete wasn't found
  if (err.code === 'P2025') {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found' } })
  }

  console.error(err)
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: env.NODE_ENV === 'production' ? 'Something broke on our side' : err.message,
    },
  })
}
KUSTEOF
echo '   src/middleware/errorHandler.js'

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
    req.user = { id: payload.sub, role: payload.role ?? 'USER' }
  } catch {
    throw new AppError(401, 'TOKEN_INVALID', 'Access token invalid or expired')
  }

  next()
}
KUSTEOF
echo '   src/middleware/requireAuth.js'

cat > src/middleware/requireRole.js <<'KUSTEOF'
import { AppError } from '../utils/AppError.js'

// AUTHORISATION (role-based): what are you allowed to do?
// Use after requireAuth:  router.post('/x', requireRole('ADMIN'), handler)
export const requireRole = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user?.role)) {
    throw new AppError(403, 'FORBIDDEN', 'You are not allowed to do that')
  }
  next()
}
KUSTEOF
echo '   src/middleware/requireRole.js'

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
KUSTEOF
echo '   src/middleware/rateLimit.js'

cat > src/utils/password.js <<'KUSTEOF'
import bcrypt from 'bcryptjs'

export const hashPassword = (plain) => bcrypt.hash(plain, 12)
export const checkPassword = (plain, hash) => bcrypt.compare(plain, hash)

// Never send passwordHash to the app
export const publicUser = ({ passwordHash, ...user }) => user
KUSTEOF
echo '   src/utils/password.js'

cat > src/modules/auth/tokens.js <<'KUSTEOF'
import crypto from 'node:crypto'
import jwt from 'jsonwebtoken'
import { prisma } from '../../lib/prisma.js'
import { env } from '../../config/env.js'

export const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex')

// Access token: short-lived JWT (15m). Carries user id (sub) and role.
// Refresh token: long random string. We only store its hash, like a password.
export async function issueTokens(user) {
  const accessToken = jwt.sign({ role: user.role }, env.JWT_ACCESS_SECRET, {
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

cat > src/modules/auth/auth.service.js <<'KUSTEOF'
import { prisma } from '../../lib/prisma.js'
import { AppError } from '../../utils/AppError.js'
import { hashPassword, checkPassword, publicUser } from '../../utils/password.js'
import { issueTokens, revokeAllTokens, sha256 } from './tokens.js'

export async function register({ email, password, name, incomeType }) {
  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) throw new AppError(409, 'EMAIL_TAKEN', 'An account with that email already exists')

  const user = await prisma.user.create({
    data: { email, name, incomeType, passwordHash: await hashPassword(password) },
  })

  return { user: publicUser(user), ...(await issueTokens(user)) }
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
KUSTEOF
echo '   src/modules/auth/auth.controller.js'

cat > src/modules/auth/auth.routes.js <<'KUSTEOF'
import { Router } from 'express'
import { z } from 'zod'
import { validate } from '../../middleware/validate.js'
import { requireAuth } from '../../middleware/requireAuth.js'
import { authLimiter } from '../../middleware/rateLimit.js'
import * as c from './auth.controller.js'

const router = Router()

const email = z.string().trim().toLowerCase().email('Enter a valid email')
export const passwordRule = z.string().min(8, 'Password must be at least 8 characters').max(72)

const registerSchema = z.object({
  email,
  password: passwordRule,
  name: z.string().trim().min(1).max(60).optional(),
  incomeType: z.enum(['STUDENT', 'SALARIED', 'FREELANCE']).optional(),
})

const loginSchema = z.object({ email, password: z.string().min(1) })
const tokenSchema = z.object({ refreshToken: z.string().min(1) })

router.post('/register', authLimiter, validate(registerSchema), c.register)
router.post('/login', authLimiter, validate(loginSchema), c.login)
router.post('/refresh', validate(tokenSchema), c.refresh)
router.post('/logout', validate(tokenSchema), c.logout)
router.post('/logout-all', requireAuth, c.logoutAll)

export default router
KUSTEOF
echo '   src/modules/auth/auth.routes.js'

cat > src/modules/users/users.service.js <<'KUSTEOF'
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
  if (!(await checkPassword(currentPassword, user.passwordHash))) {
    throw new AppError(401, 'BAD_CREDENTIALS', 'Current password is wrong')
  }

  await prisma.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(newPassword) } })
  await revokeAllTokens(userId)
  return issueTokens(user)
}

export async function deleteMe(userId, { password }) {
  const user = await getUserOrThrow(userId)
  if (!(await checkPassword(password, user.passwordHash))) {
    throw new AppError(401, 'BAD_CREDENTIALS', 'Password is wrong')
  }

  // Budgets first (they point at formulas), then the user. Everything else cascades.
  await prisma.$transaction([
    prisma.budget.deleteMany({ where: { userId } }),
    prisma.user.delete({ where: { id: userId } }),
  ])
}
KUSTEOF
echo '   src/modules/users/users.service.js'

cat > src/modules/users/users.controller.js <<'KUSTEOF'
import * as usersService from './users.service.js'

export async function getMe(req, res) {
  res.json({ user: await usersService.getMe(req.user.id) })
}

export async function updateMe(req, res) {
  res.json({ user: await usersService.updateMe(req.user.id, req.body) })
}

export async function changePassword(req, res) {
  res.json(await usersService.changePassword(req.user.id, req.body))
}

export async function deleteMe(req, res) {
  await usersService.deleteMe(req.user.id, req.body)
  res.status(204).end()
}
KUSTEOF
echo '   src/modules/users/users.controller.js'

cat > src/modules/users/users.routes.js <<'KUSTEOF'
import { Router } from 'express'
import { z } from 'zod'
import { validate } from '../../middleware/validate.js'
import { passwordRule } from '../auth/auth.routes.js'
import * as c from './users.controller.js'

const router = Router()

const updateSchema = z
  .object({
    name: z.string().trim().min(1).max(60).optional(),
    incomeType: z.enum(['STUDENT', 'SALARIED', 'FREELANCE']).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, 'Send at least one field to update')

const passwordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordRule,
})

const deleteSchema = z.object({ password: z.string().min(1) })

router.get('/me', c.getMe)
router.patch('/me', validate(updateSchema), c.updateMe)
router.post('/me/password', validate(passwordSchema), c.changePassword)
router.delete('/me', validate(deleteSchema), c.deleteMe)

export default router
KUSTEOF
echo '   src/modules/users/users.routes.js'

cat > src/modules/formulas/formulas.service.js <<'KUSTEOF'
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
KUSTEOF
echo '   src/modules/formulas/formulas.service.js'

cat > src/modules/formulas/formulas.controller.js <<'KUSTEOF'
import * as formulasService from './formulas.service.js'

export async function list(req, res) {
  res.json({ formulas: await formulasService.listForUser(req.user.id) })
}

export async function getOne(req, res) {
  res.json({ formula: await formulasService.getForUser(req.user.id, req.params.id) })
}

export async function create(req, res) {
  res.status(201).json({ formula: await formulasService.create(req.user, req.body) })
}

export async function update(req, res) {
  res.json({ formula: await formulasService.update(req.user, req.params.id, req.body) })
}

export async function remove(req, res) {
  await formulasService.remove(req.user, req.params.id)
  res.status(204).end()
}
KUSTEOF
echo '   src/modules/formulas/formulas.controller.js'

cat > src/modules/formulas/formulas.routes.js <<'KUSTEOF'
import { Router } from 'express'
import { z } from 'zod'
import { validate } from '../../middleware/validate.js'
import * as c from './formulas.controller.js'

const router = Router()

const buckets = z
  .array(
    z.object({
      label: z.string().trim().min(1).max(40),
      percent: z.number().int().min(1).max(10000), // basis points: 5000 = 50%
      colorKey: z.string().trim().min(1).max(20),
    })
  )
  .min(2, 'A formula needs at least 2 buckets')
  .max(8, 'A formula can have at most 8 buckets')

const createSchema = z.object({
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(200).optional(),
  buckets,
  system: z.boolean().optional(), // admins only: make it a built-in formula
})

const updateSchema = z
  .object({
    name: z.string().trim().min(1).max(60).optional(),
    description: z.string().trim().max(200).optional(),
    buckets: buckets.optional(),
  })
  .refine((d) => Object.keys(d).length > 0, 'Send at least one field to update')

router.get('/', c.list)
router.get('/:id', c.getOne)
router.post('/', validate(createSchema), c.create)
router.patch('/:id', validate(updateSchema), c.update)
router.delete('/:id', c.remove)

export default router
KUSTEOF
echo '   src/modules/formulas/formulas.routes.js'

cat > src/modules/budgets/summary.js <<'KUSTEOF'
// Pure function: budget + how much was spent per bucket -> numbers the app shows.
// spentByAllocation: Map<allocationId, BigInt kobo>
export function summarize(budget, spentByAllocation) {
  let totalSpent = 0n

  const allocations = budget.allocations.map((a) => {
    const spentKobo = spentByAllocation.get(a.id) ?? 0n
    const remainingKobo = a.amountKobo - spentKobo
    totalSpent += spentKobo

    return {
      ...a,
      spentKobo,
      remainingKobo,
      // 42.5 means 42.5% of this bucket is used
      usedPercent: a.amountKobo > 0n ? Number((spentKobo * 10000n) / a.amountKobo) / 100 : 0,
      overspent: remainingKobo < 0n,
    }
  })

  return {
    ...budget,
    allocations,
    totals: {
      incomeKobo: budget.incomeKobo,
      spentKobo: totalSpent,
      remainingKobo: budget.incomeKobo - totalSpent,
    },
  }
}
KUSTEOF
echo '   src/modules/budgets/summary.js'

cat > src/modules/budgets/budgets.service.js <<'KUSTEOF'
import { prisma } from '../../lib/prisma.js'
import { AppError } from '../../utils/AppError.js'
import { getForUser as getFormula } from '../formulas/formulas.service.js'
import { splitIncome } from './split.js'
import { summarize } from './summary.js'

const include = {
  allocations: { orderBy: { position: 'asc' } },
  formula: { select: { id: true, name: true } },
}

async function spentMap(budgetId) {
  const rows = await prisma.expense.groupBy({
    by: ['allocationId'],
    where: { budgetId },
    _sum: { amountKobo: true },
  })
  return new Map(rows.map((r) => [r.allocationId, r._sum.amountKobo ?? 0n]))
}

async function withSummary(budget) {
  return summarize(budget, await spentMap(budget.id))
}

// AUTHORISATION (ownership): the budget must belong to this user.
// Someone else's budget looks exactly like a missing one.
export async function getOwned(userId, budgetId) {
  const budget = await prisma.budget.findFirst({ where: { id: budgetId, userId }, include })
  if (!budget) throw new AppError(404, 'BUDGET_NOT_FOUND', 'Budget not found')
  return budget
}

// Show the split without saving anything — for the "pick a formula" screen.
export async function preview(userId, { formulaId, incomeKobo }) {
  const formula = await getFormula(userId, formulaId)
  return {
    formula: { id: formula.id, name: formula.name },
    incomeKobo: BigInt(incomeKobo),
    allocations: splitIncome(BigInt(incomeKobo), formula.buckets),
  }
}

export async function create(userId, { formulaId, incomeKobo, periodStart }, idempotencyKey) {
  // Phone retried after a network drop? Hand back the budget we already made.
  if (idempotencyKey) {
    const existing = await prisma.budget.findUnique({
      where: { userId_idempotencyKey: { userId, idempotencyKey } },
      include,
    })
    if (existing) return { budget: await withSummary(existing), replayed: true }
  }

  const formula = await getFormula(userId, formulaId)
  const income = BigInt(incomeKobo)

  const budget = await prisma.budget.create({
    data: {
      userId,
      formulaId: formula.id,
      incomeKobo: income,
      periodStart,
      idempotencyKey,
      allocations: { create: splitIncome(income, formula.buckets) },
    },
    include,
  })

  return { budget: await withSummary(budget), replayed: false }
}

// Cursor pagination: ?limit=20&cursor=<last budget id>
export async function list(userId, { limit, cursor }) {
  const rows = await prisma.budget.findMany({
    where: { userId },
    include: { formula: include.formula },
    orderBy: [{ periodStart: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(cursor && { cursor: { id: cursor }, skip: 1 }),
  })

  const hasMore = rows.length > limit
  const items = hasMore ? rows.slice(0, limit) : rows

  // Total spent per budget, in one query
  const sums = await prisma.expense.groupBy({
    by: ['budgetId'],
    where: { budgetId: { in: items.map((b) => b.id) } },
    _sum: { amountKobo: true },
  })
  const spent = new Map(sums.map((s) => [s.budgetId, s._sum.amountKobo ?? 0n]))

  return {
    budgets: items.map((b) => {
      const spentKobo = spent.get(b.id) ?? 0n
      return { ...b, totals: { incomeKobo: b.incomeKobo, spentKobo, remainingKobo: b.incomeKobo - spentKobo } }
    }),
    nextCursor: hasMore ? items[items.length - 1].id : null,
  }
}

export async function getOne(userId, id) {
  return withSummary(await getOwned(userId, id))
}

// The home screen: the most recent budget, with how much is left in each bucket.
export async function current(userId) {
  const budget = await prisma.budget.findFirst({
    where: { userId },
    include,
    orderBy: [{ periodStart: 'desc' }, { createdAt: 'desc' }],
  })
  return budget ? withSummary(budget) : null
}

export async function remove(userId, id) {
  const budget = await getOwned(userId, id)
  await prisma.budget.delete({ where: { id: budget.id } }) // allocations + expenses cascade
}
KUSTEOF
echo '   src/modules/budgets/budgets.service.js'

cat > src/modules/budgets/budgets.controller.js <<'KUSTEOF'
import { z } from 'zod'
import * as budgetsService from './budgets.service.js'

export const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().optional(),
})

export async function preview(req, res) {
  res.json({ preview: await budgetsService.preview(req.user.id, req.body) })
}

export async function create(req, res) {
  const key = req.get('Idempotency-Key') || undefined
  const { budget, replayed } = await budgetsService.create(req.user.id, req.body, key)
  res.status(replayed ? 200 : 201).json({ budget })
}

export async function list(req, res) {
  res.json(await budgetsService.list(req.user.id, listQuery.parse(req.query)))
}

export async function current(req, res) {
  res.json({ budget: await budgetsService.current(req.user.id) })
}

export async function getOne(req, res) {
  res.json({ budget: await budgetsService.getOne(req.user.id, req.params.id) })
}

export async function remove(req, res) {
  await budgetsService.remove(req.user.id, req.params.id)
  res.status(204).end()
}
KUSTEOF
echo '   src/modules/budgets/budgets.controller.js'

cat > src/modules/budgets/budgets.routes.js <<'KUSTEOF'
import { Router } from 'express'
import { z } from 'zod'
import { validate } from '../../middleware/validate.js'
import * as c from './budgets.controller.js'
import * as expenses from '../expenses/expenses.controller.js'
import { createExpenseSchema } from '../expenses/expenses.schemas.js'

const router = Router()

const splitSchema = z.object({
  formulaId: z.string().min(1),
  // in kobo: ₦150,000 = 15000000
  incomeKobo: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
})

const createSchema = splitSchema.extend({
  periodStart: z.coerce.date().optional(),
})

router.post('/preview', validate(splitSchema), c.preview)
router.post('/', validate(createSchema), c.create)
router.get('/', c.list)
router.get('/current', c.current) // must come before /:id, or "current" is read as an id
router.get('/:id', c.getOne)
router.delete('/:id', c.remove)

// Expenses inside a budget
router.post('/:id/expenses', validate(createExpenseSchema), expenses.create)
router.get('/:id/expenses', expenses.list)

export default router
KUSTEOF
echo '   src/modules/budgets/budgets.routes.js'

cat > src/modules/expenses/expenses.schemas.js <<'KUSTEOF'
import { z } from 'zod'

const amountKobo = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)

export const createExpenseSchema = z.object({
  allocationId: z.string().min(1), // which bucket (Needs, Wants...) this came out of
  amountKobo,
  note: z.string().trim().max(140).optional(),
  spentAt: z.coerce.date().optional(),
})

export const updateExpenseSchema = z
  .object({
    allocationId: z.string().min(1).optional(),
    amountKobo: amountKobo.optional(),
    note: z.string().trim().max(140).nullable().optional(),
    spentAt: z.coerce.date().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, 'Send at least one field to update')

export const listExpensesQuery = z.object({
  allocationId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().optional(),
})
KUSTEOF
echo '   src/modules/expenses/expenses.schemas.js'

cat > src/modules/expenses/expenses.service.js <<'KUSTEOF'
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
KUSTEOF
echo '   src/modules/expenses/expenses.service.js'

cat > src/modules/expenses/expenses.controller.js <<'KUSTEOF'
import * as expensesService from './expenses.service.js'
import { listExpensesQuery } from './expenses.schemas.js'

// POST /budgets/:id/expenses
export async function create(req, res) {
  res.status(201).json({ expense: await expensesService.create(req.user.id, req.params.id, req.body) })
}

// GET /budgets/:id/expenses
export async function list(req, res) {
  res.json(await expensesService.list(req.user.id, req.params.id, listExpensesQuery.parse(req.query)))
}

// PATCH /expenses/:id
export async function update(req, res) {
  res.json({ expense: await expensesService.update(req.user.id, req.params.id, req.body) })
}

// DELETE /expenses/:id
export async function remove(req, res) {
  await expensesService.remove(req.user.id, req.params.id)
  res.status(204).end()
}
KUSTEOF
echo '   src/modules/expenses/expenses.controller.js'

cat > src/modules/expenses/expenses.routes.js <<'KUSTEOF'
import { Router } from 'express'
import { validate } from '../../middleware/validate.js'
import { updateExpenseSchema } from './expenses.schemas.js'
import * as c from './expenses.controller.js'

// Creating and listing live under /budgets/:id/expenses (see budgets.routes.js).
// Editing and deleting a single expense live here.
const router = Router()

router.patch('/:id', validate(updateExpenseSchema), c.update)
router.delete('/:id', c.remove)

export default router
KUSTEOF
echo '   src/modules/expenses/expenses.routes.js'

cat > scripts/make-admin.js <<'KUSTEOF'
// Usage: npm run make-admin -- you@example.com
// The user must log in again afterwards — the role lives inside the access token.
import { prisma } from '../src/lib/prisma.js'

const email = process.argv[2]?.toLowerCase()
if (!email) {
  console.error('Usage: npm run make-admin -- you@example.com')
  process.exit(1)
}

const user = await prisma.user.update({ where: { email }, data: { role: 'ADMIN' } }).catch(() => null)
console.log(user ? `${user.email} is now an ADMIN. Log in again to get a new token.` : `No user with email ${email}`)
await prisma.$disconnect()
KUSTEOF
echo '   scripts/make-admin.js'

cat > tests/money.test.js <<'KUSTEOF'
// Run: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { splitIncome } from '../src/modules/budgets/split.js'
import { summarize } from '../src/modules/budgets/summary.js'

const buckets = [
  { label: 'Needs', percent: 5000, colorKey: 'needs' },
  { label: 'Wants', percent: 3000, colorKey: 'wants' },
  { label: 'Savings', percent: 2000, colorKey: 'savings' },
]

test('50/30/20 of ₦150,000', () => {
  const parts = splitIncome(15000000n, buckets)
  assert.deepEqual(parts.map((p) => p.amountKobo), [7500000n, 4500000n, 3000000n])
})

test('odd amounts never lose a kobo', () => {
  for (const income of [1n, 7n, 99n, 15000001n, 1234567891n]) {
    const total = splitIncome(income, buckets).reduce((s, p) => s + p.amountKobo, 0n)
    assert.equal(total, income)
  }
})

test('summary: spent, remaining, overspent', () => {
  const budget = {
    id: 'b1',
    incomeKobo: 10000n,
    allocations: [
      { id: 'a1', amountKobo: 5000n },
      { id: 'a2', amountKobo: 5000n },
    ],
  }
  const s = summarize(budget, new Map([['a1', 2500n], ['a2', 6000n]]))
  assert.equal(s.allocations[0].usedPercent, 50)
  assert.equal(s.allocations[0].overspent, false)
  assert.equal(s.allocations[1].remainingKobo, -1000n)
  assert.equal(s.allocations[1].overspent, true)
  assert.equal(s.totals.spentKobo, 8500n)
  assert.equal(s.totals.remainingKobo, 1500n)
})
KUSTEOF
echo '   tests/money.test.js'

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

`incomeType` is one of `STUDENT`, `SALARIED`, `FREELANCE`.

## Users 🔒

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/users/me` | – | `{ user }` |
| PATCH | `/users/me` | `{ name?, incomeType? }` | `{ user }` |
| POST | `/users/me/password` | `{ currentPassword, newPassword }` | `{ accessToken, refreshToken }`. Other devices are logged out. |
| DELETE | `/users/me` | `{ password }` | `204`. Deletes the account and all its data. |

## Formulas 🔒

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/formulas` | – | `{ formulas }` (built-in ones first, then the user's own) |
| GET | `/formulas/:id` | – | `{ formula }` |
| POST | `/formulas` | `{ name, description?, buckets: [{ label, percent, colorKey }] }` | `201 { formula }` |
| PATCH | `/formulas/:id` | `{ name?, description?, buckets? }` | `{ formula }` |
| DELETE | `/formulas/:id` | – | `204`, or `409 FORMULA_IN_USE` if budgets use it |

Buckets must add up to exactly `10000`. Users can only edit their own formulas. Built-in formulas are admin-only: an admin can create one by sending `system: true`.

Built-in formula ids: `sys-50-30-20`, `sys-50-25-15-10`, `sys-70-20-10`, `sys-80-20`.

## Budgets 🔒

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

## Expenses 🔒

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/budgets/:id/expenses` | `{ allocationId, amountKobo, note?, spentAt? }` | `201 { expense }` |
| GET | `/budgets/:id/expenses` | `?allocationId&limit&cursor` | `{ expenses, nextCursor }` (newest first) |
| PATCH | `/expenses/:id` | `{ allocationId?, amountKobo?, note?, spentAt? }` | `{ expense }` |
| DELETE | `/expenses/:id` | – | `204` |

`allocationId` is the bucket the money came out of (Needs, Wants…), taken from `budget.allocations[].id`. Overspending is allowed: that bucket then shows `overspent: true` and a negative `remainingKobo`.

## Limits

- All of `/api/v1`: 300 requests per 15 minutes per IP.
- Login and register: 10 failed attempts per 15 minutes per IP in production (100 in development). Over the limit, the API returns `429 RATE_LIMITED`.

## Admin

Make a user an admin with `npm run make-admin -- email@example.com`. They then need to log in again.

## Common error codes

`VALIDATION_ERROR`, `BAD_JSON`, `UNAUTHORIZED`, `TOKEN_INVALID`, `BAD_CREDENTIALS`, `EMAIL_TAKEN`, `REFRESH_INVALID`, `REFRESH_REUSED`, `REFRESH_EXPIRED`, `FORBIDDEN`, `FORMULA_NOT_FOUND`, `BUDGET_NOT_FOUND`, `EXPENSE_NOT_FOUND`, `BAD_SPLIT`, `BAD_ALLOCATION`, `FORMULA_IN_USE`, `RATE_LIMITED`, `ROUTE_NOT_FOUND`, `INTERNAL_ERROR`
KUSTEOF
echo '   API.md'


echo ""
echo "==> Done. Next:"
echo "   1. npx prisma migrate dev --name roles_and_expenses"
echo "   2. npx prisma generate"
echo "   3. npm test"
echo "   4. npm run dev"
