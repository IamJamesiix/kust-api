import { Router } from 'express'
import { z } from 'zod'
import { validate } from '../../middleware/validate.js'
import * as c from './formulas.controller.js'

const router = Router()

const createSchema = z.object({
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(200).optional(),
  buckets: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(40),
        percent: z.number().int().min(1).max(10000), // basis points
        colorKey: z.string().trim().min(1).max(20),
      })
    )
    .min(2)
    .max(8),
})

router.get('/', c.list)
router.get('/:id', c.getOne)
router.post('/', validate(createSchema), c.create)

export default router
