import { Router } from 'express'
import { z } from 'zod'
import * as service from './reviews.service.js'

const router = Router()

// ?tz=60 = minutes ahead of UTC (Nigeria). The app sends its own.
const tzQuery = z.object({ tz: z.coerce.number().int().min(-720).max(840).default(60) })
const monthParam = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Month looks like 2026-10')

router.get('/', async (req, res) => {
  const { tz } = tzQuery.parse(req.query)
  res.json({ months: await service.months(req.user.id, tz) })
})

router.get('/:month', async (req, res) => {
  const { tz } = tzQuery.parse(req.query)
  const month = monthParam.parse(req.params.month)
  res.json({ review: await service.review(req.user.id, month, tz) })
})

export default router
