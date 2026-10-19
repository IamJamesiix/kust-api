import * as expensesService from './expenses.service.js'
import { listExpensesQuery } from './expenses.schemas.js'

// POST /budgets/:id/expenses
export async function create(req, res) {
  res.status(201).json({ expense: await expensesService.create(req.user.id, req.params.id, req.body) })
}

// GET /budgets/:id/expenses
export async function list(req, res) {
  res.json(await expensesService.list(req.user.id, req.params.id, listExpensesQuery.parse(req.query)))
}

// PATCH /expenses/:id
export async function update(req, res) {
  res.json({ expense: await expensesService.update(req.user.id, req.params.id, req.body) })
}

// DELETE /expenses/:id
export async function remove(req, res) {
  await expensesService.remove(req.user.id, req.params.id)
  res.status(204).end()
}
