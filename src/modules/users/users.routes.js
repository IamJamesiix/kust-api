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

// password is required for accounts that have one (checked in the service)
const deleteSchema = z.object({ password: z.string().min(1).optional() })

router.get('/me', c.getMe)
router.patch('/me', validate(updateSchema), c.updateMe)
router.post('/me/password', validate(passwordSchema), c.changePassword)
router.delete('/me', validate(deleteSchema), c.deleteMe)

export default router
