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
  // where the money came from ("balance" = splitting what you already have)
  source: z.enum(['allowance', 'salary', 'client', 'sales', 'gift', 'other', 'balance']).optional(),
})

const movedSchema = z.object({ moved: z.boolean() })

router.post('/preview', validate(splitSchema), c.preview)
router.post('/', validate(createSchema), c.create)
router.get('/', c.list)
router.get('/current', c.current) // must come before /:id, or "current" is read as an id
router.get('/:id', c.getOne)
router.delete('/:id', c.remove)
router.patch('/:id/allocations/:allocationId', validate(movedSchema), c.setMoved)

// Expenses inside a budget
router.post('/:id/expenses', validate(createExpenseSchema), expenses.create)
router.get('/:id/expenses', expenses.list)

export default router
