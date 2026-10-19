import { Router } from 'express'
import { validate } from '../../middleware/validate.js'
import { updateExpenseSchema } from './expenses.schemas.js'
import * as c from './expenses.controller.js'

// Creating and listing live under /budgets/:id/expenses (see budgets.routes.js).
// Editing and deleting a single expense live here.
const router = Router()

router.patch('/:id', validate(updateExpenseSchema), c.update)
router.delete('/:id', c.remove)

export default router
