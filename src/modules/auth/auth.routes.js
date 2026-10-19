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
