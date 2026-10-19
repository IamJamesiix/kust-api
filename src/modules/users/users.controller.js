import * as usersService from './users.service.js'

export async function getMe(req, res) {
  res.json({ user: await usersService.getMe(req.user.id) })
}

export async function updateMe(req, res) {
  res.json({ user: await usersService.updateMe(req.user.id, req.body) })
}

export async function changePassword(req, res) {
  res.json(await usersService.changePassword(req.user.id, req.body))
}

export async function deleteMe(req, res) {
  await usersService.deleteMe(req.user.id, req.body)
  res.status(204).end()
}
