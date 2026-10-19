import jwt from 'jsonwebtoken'
import { env } from '../config/env.js'
import { AppError } from '../utils/AppError.js'

// AUTHENTICATION: who are you?
// Mobile sends: Authorization: Bearer <accessToken>
export function requireAuth(req, res, next) {
  const [type, token] = (req.headers.authorization || '').split(' ')

  if (type !== 'Bearer' || !token) {
    throw new AppError(401, 'UNAUTHORIZED', 'Missing access token')
  }

  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET)
    req.user = { id: payload.sub, role: payload.role ?? 'USER' }
  } catch {
    throw new AppError(401, 'TOKEN_INVALID', 'Access token invalid or expired')
  }

  next()
}
