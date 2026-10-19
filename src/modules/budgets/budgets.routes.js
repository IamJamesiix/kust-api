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
