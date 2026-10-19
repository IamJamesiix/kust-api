import * as formulasService from './formulas.service.js'

export async function list(req, res) {
  res.json({ formulas: await formulasService.listForUser(req.user.id) })
}

export async function getOne(req, res) {
  res.json({ formula: await formulasService.getForUser(req.user.id, req.params.id) })
}

export async function create(req, res) {
  res.status(201).json({ formula: await formulasService.create(req.user, req.body) })
}

export async function update(req, res) {
  res.json({ formula: await formulasService.update(req.user, req.params.id, req.body) })
}

export async function remove(req, res) {
  await formulasService.remove(req.user, req.params.id)
  res.status(204).end()
}
