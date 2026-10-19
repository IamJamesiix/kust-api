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
