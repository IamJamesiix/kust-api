import { z } from 'zod'
import * as budgetsService from './budgets.service.js'

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().optional(),
})

export async function create(req, res) {
  const key = req.get('Idempotency-Key') || undefined
  const { budget, replayed } = await budgetsService.create(req.user.id, req.body, key)
  res.status(replayed ? 200 : 201).json({ budget })
}

export async function list(req, res) {
  res.json(await budgetsService.list(req.user.id, listQuery.parse(req.query)))
}

export async function getOne(req, res) {
  res.json({ budget: await budgetsService.getOne(req.user.id, req.params.id) })
}
