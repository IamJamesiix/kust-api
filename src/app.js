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
