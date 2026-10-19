import { AppError } from '../utils/AppError.js'

// AUTHORISATION (role-based): what are you allowed to do?
// Use after requireAuth:  router.post('/x', requireRole('ADMIN'), handler)
export const requireRole = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user?.role)) {
    throw new AppError(403, 'FORBIDDEN', 'You are not allowed to do that')
  }
  next()
}
