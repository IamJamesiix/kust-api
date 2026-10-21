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
import reviewRoutes from './modules/reviews/reviews.routes.js'
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
v1.use('/reviews', requireAuth, requireVerified, reviewRoutes)
app.use('/api/v1', v1)

app.use(notFound)
app.use(errorHandler)

export default app
