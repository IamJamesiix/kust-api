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
// Google ID tokens are JWTs, normally ~1-2 KB.
const googleSchema = z.object({ idToken: z.string().min(20).max(4096) })

router.post('/register', authLimiter, validate(registerSchema), c.register)
router.post('/login', authLimiter, validate(loginSchema), c.login)
router.post('/google', authLimiter, validate(googleSchema), c.google)
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
