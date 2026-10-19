import * as authService from './auth.service.js'

export async function register(req, res) {
  res.status(201).json(await authService.register(req.body))
}

export async function login(req, res) {
  res.json(await authService.login(req.body))
}

export async function refresh(req, res) {
  res.json(await authService.refresh(req.body))
}

export async function logout(req, res) {
  await authService.logout(req.body)
  res.status(204).end()
}

export async function logoutAll(req, res) {
  await authService.logoutAll(req.user.id)
  res.status(204).end()
}

export async function resendVerification(req, res) {
  res.json(await authService.resendVerification(req.user.id))
}

export async function verifyEmail(req, res) {
  res.json(await authService.verifyEmail(req.user.id, req.body))
}

export async function forgotPassword(req, res) {
  res.json(await authService.forgotPassword(req.body))
}

export async function resetPassword(req, res) {
  res.json(await authService.resetPassword(req.body))
}
