import { Router } from 'express'
import { z } from 'zod'
import { validate } from '../../middleware/validate.js'
import * as c from './formulas.controller.js'

const router = Router()

const buckets = z
  .array(
    z.object({
      label: z.string().trim().min(1).max(40),
      percent: z.number().int().min(1).max(10000), // basis points: 5000 = 50%
      colorKey: z.string().trim().min(1).max(20),
    })
  )
  .min(2, 'A formula needs at least 2 buckets')
  .max(8, 'A formula can have at most 8 buckets')

const createSchema = z.object({
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(200).optional(),
  buckets,
  system: z.boolean().optional(), // admins only: make it a built-in formula
})

const updateSchema = z
  .object({
    name: z.string().trim().min(1).max(60).optional(),
    description: z.string().trim().max(200).optional(),
    buckets: buckets.optional(),
  })
  .refine((d) => Object.keys(d).length > 0, 'Send at least one field to update')

router.get('/', c.list)
router.get('/:id', c.getOne)
router.post('/', validate(createSchema), c.create)
router.patch('/:id', validate(updateSchema), c.update)
router.delete('/:id', c.remove)

export default router
