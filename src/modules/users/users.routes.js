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
    // onboarding answers
    moneySource: z.enum(['allowance', 'salary', 'clients', 'business', 'mixed']).nullable().optional(),
    nextMoneyAt: z.coerce.date().nullable().optional(),
    unavoidablePct: z.number().int().min(0).max(100).nullable().optional(),
    goal: z.enum(['STOP_RUNNING_OUT', 'SAVE_FOR_SOMETHING', 'BUILD_CUSHION']).nullable().optional(),
    onboarded: z.literal(true).optional(), // finishing onboarding
    // settings
    remindersOn: z.boolean().optional(),
    handwritingOn: z.boolean().optional(),
    shareAmounts: z.boolean().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, 'Send at least one field to update')

// "Name your buckets": what each kind of bucket is called and where its money lives
const placesSchema = z.object({
  buckets: z
    .array(
      z.object({
        colorKey: z.string().trim().min(1).max(20),
        baseLabel: z.string().trim().min(1).max(40).optional(),
        label: z.string().trim().min(1).max(40).optional(),
        livesIn: z.string().trim().min(1).max(40).nullable().optional(),
      })
    )
    .min(1)
    .max(8),
})

const passwordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordRule,
})

// password is required for accounts that have one (checked in the service)
const deleteSchema = z.object({ password: z.string().min(1).optional() })

router.get('/me', c.getMe)
router.patch('/me', validate(updateSchema), c.updateMe)
router.get('/me/buckets', c.getPlaces)
router.put('/me/buckets', validate(placesSchema), c.savePlaces)
router.post('/me/password', validate(passwordSchema), c.changePassword)
router.delete('/me', validate(deleteSchema), c.deleteMe)

export default router
