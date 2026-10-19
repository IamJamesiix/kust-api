#!/usr/bin/env bash
# Kust backend scaffold — Node (ESM) + Express 5 + Prisma 7 + Postgres
# Run from your project root (the folder where you ran `npx prisma init`):
#   bash setup-kust.sh
set -e

echo "==> Installing packages"
npm pkg set type=module
# Prisma pinned to 7.10.0 on purpose: npm's "latest" tag currently points at an 8.0 RC with a different CLI.
npm i express zod dotenv cors helmet bcryptjs jsonwebtoken @prisma/client@7.10.0 @prisma/adapter-pg@7.10.0 pg
npm i -D prisma@7.10.0 tsx

npm pkg set scripts.dev="tsx watch src/server.js"
npm pkg set scripts.start="tsx src/server.js"
npm pkg set scripts.db:migrate="prisma migrate dev"
npm pkg set scripts.db:generate="prisma generate"
npm pkg set scripts.db:seed="prisma db seed"
npm pkg set scripts.db:studio="prisma studio"
npm pkg set scripts.postinstall="prisma generate"

echo "==> Creating folders"
mkdir -p prisma src/config src/lib src/utils src/middleware \
  src/modules/auth src/modules/formulas src/modules/budgets

# ---------------------------------------------------------------- env files
if [ ! -f .env ]; then
  SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")
  cat > .env <<EOF
NODE_ENV=development
PORT=3000
DATABASE_URL="postgres://PASTE_YOUR_URL_HERE"
JWT_ACCESS_SECRET=$SECRET
ACCESS_TOKEN_TTL=15m
REFRESH_TOKEN_DAYS=30
EOF
  echo "   created .env (paste your DATABASE_URL in it)"
else
  echo "   .env exists — make sure it has DATABASE_URL, JWT_ACCESS_SECRET (32+ chars), ACCESS_TOKEN_TTL, REFRESH_TOKEN_DAYS"
fi

cat > .env.example <<'EOF'
NODE_ENV=development
PORT=3000
DATABASE_URL="postgres://user:password@host:5432/db"
JWT_ACCESS_SECRET=at-least-32-random-characters
ACCESS_TOKEN_TTL=15m
REFRESH_TOKEN_DAYS=30
EOF

cat > .gitignore <<'EOF'
node_modules
.env
src/generated
EOF

# ---------------------------------------------------------------- prisma
cat > prisma.config.ts <<'EOF'
import 'dotenv/config'
import { defineConfig, env } from 'prisma/config'

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.js',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
})
EOF

cat > prisma/schema.prisma <<'EOF'
// Money is stored in KOBO as BigInt (₦1,500.50 = 150050). Never floats.
// Percentages are basis points: 5000 = 50%, 1250 = 12.5%.

generator client {
  provider = "prisma-client"
  output   = "../src/generated/prisma"
}

datasource db {
  provider = "postgresql"
}

enum IncomeType {
  STUDENT
  SALARIED
  FREELANCE
}

model User {
  id            String         @id @default(uuid())
  email         String         @unique
  passwordHash  String
  incomeType    IncomeType     @default(SALARIED)
  budgets       Budget[]
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

  @@index([budgetId])
}
EOF

cat > prisma/seed.js <<'EOF'
import { prisma } from '../src/lib/prisma.js'

// Built-in formulas. Rename buckets to match what your questionnaire people expect.
const formulas = [
  {
    id: 'sys-50-30-20',
    name: '50/30/20',
    description: 'Needs, wants, savings. The classic.',
    buckets: [
      ['Needs', 5000, 'needs'],
      ['Wants', 3000, 'wants'],
      ['Savings', 2000, 'savings'],
    ],
  },
  {
    id: 'sys-50-25-15-10',
    name: '50/25/15/10',
    description: 'Needs, wants, savings, investments.',
    buckets: [
      ['Needs', 5000, 'needs'],
      ['Wants', 2500, 'wants'],
      ['Savings', 1500, 'savings'],
      ['Investments', 1000, 'invest'],
    ],
  },
  {
    id: 'sys-70-20-10',
    name: '70/20/10',
    description: 'Living costs, savings, debt or giving.',
    buckets: [
      ['Living', 7000, 'needs'],
      ['Savings', 2000, 'savings'],
      ['Debt / Giving', 1000, 'wants'],
    ],
  },
  {
    id: 'sys-80-20',
    name: '80/20',
    description: 'Spend 80, save 20. Simple.',
    buckets: [
      ['Spending', 8000, 'needs'],
      ['Savings', 2000, 'savings'],
    ],
  },
]

for (const f of formulas) {
  const total = f.buckets.reduce((sum, b) => sum + b[1], 0)
  if (total !== 10000) throw new Error(`${f.name} adds up to ${total}, not 10000`)

  await prisma.formula.upsert({
    where: { id: f.id },
    update: { name: f.name, description: f.description },
    create: {
      id: f.id,
      name: f.name,
      description: f.description,
      isSystem: true,
      buckets: {
        create: f.buckets.map(([label, percent, colorKey], position) => ({
          label, percent, colorKey, position,
        })),
      },
    },
  })
  console.log('seeded', f.name)
}

await prisma.$disconnect()
EOF

# ---------------------------------------------------------------- config / lib / utils
cat > src/config/env.js <<'EOF'
import 'dotenv/config'
import { z } from 'zod'

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_DAYS: z.coerce.number().int().positive().default(30),
})

const parsed = schema.safeParse(process.env)

if (!parsed.success) {
  console.error('Bad environment variables:')
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join('.')}: ${issue.message}`)
  }
  process.exit(1)
}

export const env = parsed.data
EOF

cat > src/lib/prisma.js <<'EOF'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../generated/prisma/client.js'
import { env } from '../config/env.js'

const adapter = new PrismaPg({ connectionString: env.DATABASE_URL })

export const prisma = new PrismaClient({ adapter })
EOF

cat > src/utils/AppError.js <<'EOF'
// throw new AppError(404, 'NOT_FOUND', 'Budget not found')
export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}
EOF

# ---------------------------------------------------------------- middleware
cat > src/middleware/validate.js <<'EOF'
// validate(zodSchema) -> parses req.body, replaces it with the clean version
export const validate = (schema) => (req, res, next) => {
  req.body = schema.parse(req.body ?? {})
  next()
}
EOF

cat > src/middleware/requireAuth.js <<'EOF'
import jwt from 'jsonwebtoken'
import { env } from '../config/env.js'
import { AppError } from '../utils/AppError.js'

// Mobile sends: Authorization: Bearer <accessToken>
export function requireAuth(req, res, next) {
  const [type, token] = (req.headers.authorization || '').split(' ')

  if (type !== 'Bearer' || !token) {
    throw new AppError(401, 'UNAUTHORIZED', 'Missing access token')
  }

  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET)
    req.user = { id: payload.sub }
  } catch {
    throw new AppError(401, 'TOKEN_INVALID', 'Access token invalid or expired')
  }

  next()
}
EOF

cat > src/middleware/errorHandler.js <<'EOF'
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

  // Prisma unique constraint
  if (err.code === 'P2002') {
    return res.status(409).json({ error: { code: 'CONFLICT', message: 'That already exists' } })
  }

  console.error(err)
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: env.NODE_ENV === 'production' ? 'Something broke on our side' : err.message,
    },
  })
}
EOF

# ---------------------------------------------------------------- auth module
cat > src/modules/auth/auth.service.js <<'EOF'
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
EOF

cat > src/modules/auth/auth.controller.js <<'EOF'
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

export async function me(req, res) {
  res.json({ user: await authService.me(req.user.id) })
}
EOF

cat > src/modules/auth/auth.routes.js <<'EOF'
import { Router } from 'express'
import { z } from 'zod'
import { validate } from '../../middleware/validate.js'
import { requireAuth } from '../../middleware/requireAuth.js'
import * as c from './auth.controller.js'

const router = Router()

const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  incomeType: z.enum(['STUDENT', 'SALARIED', 'FREELANCE']).optional(),
})

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
})

const tokenSchema = z.object({ refreshToken: z.string().min(1) })

router.post('/register', validate(registerSchema), c.register)
router.post('/login', validate(loginSchema), c.login)
router.post('/refresh', validate(tokenSchema), c.refresh)
router.post('/logout', validate(tokenSchema), c.logout)
router.get('/me', requireAuth, c.me)

export default router
EOF

# ---------------------------------------------------------------- formulas module
cat > src/modules/formulas/formulas.service.js <<'EOF'
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
EOF

cat > src/modules/formulas/formulas.controller.js <<'EOF'
import * as formulasService from './formulas.service.js'

export async function list(req, res) {
  res.json({ formulas: await formulasService.listForUser(req.user.id) })
}

export async function getOne(req, res) {
  res.json({ formula: await formulasService.getForUser(req.user.id, req.params.id) })
}

export async function create(req, res) {
  res.status(201).json({ formula: await formulasService.createCustom(req.user.id, req.body) })
}
EOF

cat > src/modules/formulas/formulas.routes.js <<'EOF'
import { Router } from 'express'
import { z } from 'zod'
import { validate } from '../../middleware/validate.js'
import * as c from './formulas.controller.js'

const router = Router()

const createSchema = z.object({
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(200).optional(),
  buckets: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(40),
        percent: z.number().int().min(1).max(10000), // basis points
        colorKey: z.string().trim().min(1).max(20),
      })
    )
    .min(2)
    .max(8),
})

router.get('/', c.list)
router.get('/:id', c.getOne)
router.post('/', validate(createSchema), c.create)

export default router
EOF

# ---------------------------------------------------------------- budgets module
cat > src/modules/budgets/split.js <<'EOF'
// The heart of the app. Pure function, easy to test.
// incomeKobo: BigInt. buckets: [{ label, percent (basis points), colorKey }]
// Floors each bucket, then gives the leftover kobo to the last bucket,
// so the parts ALWAYS add up to the exact income.
export function splitIncome(incomeKobo, buckets) {
  let allocated = 0n

  const parts = buckets.map((b, position) => {
    const amountKobo = (incomeKobo * BigInt(b.percent)) / 10000n
    allocated += amountKobo
    return { label: b.label, colorKey: b.colorKey, percent: b.percent, amountKobo, position }
  })

  parts[parts.length - 1].amountKobo += incomeKobo - allocated
  return parts
}
EOF

cat > src/modules/budgets/budgets.service.js <<'EOF'
import { prisma } from '../../lib/prisma.js'
import { AppError } from '../../utils/AppError.js'
import { getForUser as getFormula } from '../formulas/formulas.service.js'
import { splitIncome } from './split.js'

const include = {
  allocations: { orderBy: { position: 'asc' } },
  formula: { select: { id: true, name: true } },
}

// BigInt can't go through JSON, so turn kobo into normal numbers on the way out.
// (Safe up to ~₦90 trillion.)
function toDTO(budget) {
  return {
    ...budget,
    incomeKobo: Number(budget.incomeKobo),
    allocations: budget.allocations.map((a) => ({ ...a, amountKobo: Number(a.amountKobo) })),
  }
}

export async function create(userId, { formulaId, incomeKobo, periodStart }, idempotencyKey) {
  // Phone retried after a network drop? Hand back the budget we already made.
  if (idempotencyKey) {
    const existing = await prisma.budget.findUnique({
      where: { userId_idempotencyKey: { userId, idempotencyKey } },
      include,
    })
    if (existing) return { budget: toDTO(existing), replayed: true }
  }

  const formula = await getFormula(userId, formulaId)
  const income = BigInt(incomeKobo)
  const parts = splitIncome(income, formula.buckets)

  const budget = await prisma.budget.create({
    data: {
      userId,
      formulaId: formula.id,
      incomeKobo: income,
      periodStart,
      idempotencyKey,
      allocations: { create: parts },
    },
    include,
  })

  return { budget: toDTO(budget), replayed: false }
}

// Cursor pagination: ?limit=20&cursor=<last budget id>
export async function list(userId, { limit = 20, cursor }) {
  const rows = await prisma.budget.findMany({
    where: { userId },
    include,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(cursor && { cursor: { id: cursor }, skip: 1 }),
  })

  const hasMore = rows.length > limit
  const items = hasMore ? rows.slice(0, limit) : rows

  return {
    budgets: items.map(toDTO),
    nextCursor: hasMore ? items[items.length - 1].id : null,
  }
}

export async function getOne(userId, id) {
  const budget = await prisma.budget.findFirst({ where: { id, userId }, include })
  if (!budget) throw new AppError(404, 'BUDGET_NOT_FOUND', 'Budget not found')
  return toDTO(budget)
}
EOF

cat > src/modules/budgets/budgets.controller.js <<'EOF'
import { z } from 'zod'
import * as budgetsService from './budgets.service.js'

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().optional(),
})

export async function create(req, res) {
  const key = req.get('Idempotency-Key') || undefined
  const { budget, replayed } = await budgetsService.create(req.user.id, req.body, key)
  res.status(replayed ? 200 : 201).json({ budget })
}

export async function list(req, res) {
  res.json(await budgetsService.list(req.user.id, listQuery.parse(req.query)))
}

export async function getOne(req, res) {
  res.json({ budget: await budgetsService.getOne(req.user.id, req.params.id) })
}
EOF

cat > src/modules/budgets/budgets.routes.js <<'EOF'
import { Router } from 'express'
import { z } from 'zod'
import { validate } from '../../middleware/validate.js'
import * as c from './budgets.controller.js'

const router = Router()

const createSchema = z.object({
  formulaId: z.string().min(1),
  // in kobo: ₦150,000 = 15000000
  incomeKobo: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  periodStart: z.coerce.date().optional(),
})

router.post('/', validate(createSchema), c.create)
router.get('/', c.list)
router.get('/:id', c.getOne)

export default router
EOF

# ---------------------------------------------------------------- app + server
cat > src/app.js <<'EOF'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import authRoutes from './modules/auth/auth.routes.js'
import formulaRoutes from './modules/formulas/formulas.routes.js'
import budgetRoutes from './modules/budgets/budgets.routes.js'
import { requireAuth } from './middleware/requireAuth.js'
import { notFound, errorHandler } from './middleware/errorHandler.js'

const app = express()

app.use(helmet())
app.use(cors())
app.use(express.json({ limit: '100kb' }))

app.get('/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }))

// Versioned from day one — old app builds stay on people's phones for months.
const v1 = express.Router()
v1.use('/auth', authRoutes)
v1.use('/formulas', requireAuth, formulaRoutes)
v1.use('/budgets', requireAuth, budgetRoutes)
app.use('/api/v1', v1)

app.use(notFound)
app.use(errorHandler)

export default app
EOF

cat > src/server.js <<'EOF'
import app from './app.js'
import { env } from './config/env.js'
import { prisma } from './lib/prisma.js'

// 0.0.0.0 so your phone on the same Wi-Fi can reach it via your laptop's IP
const server = app.listen(env.PORT, '0.0.0.0', () => {
  console.log(`Kust API running on http://localhost:${env.PORT}`)
})

async function shutdown() {
  console.log('Shutting down...')
  server.close()
  await prisma.$disconnect()
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
EOF

echo ""
echo "==> Done. Next:"
echo "   1. Put your Postgres URL in .env (DATABASE_URL)"
echo "   2. npx prisma migrate dev --name init"
echo "   3. npx prisma generate"
echo "   4. npx prisma db seed"
echo "   5. npm run dev"
