import { ZodError } from 'zod'
import { AppError } from '../utils/AppError.js'
import { env } from '../config/env.js'

// Every error leaves the API as: { error: { code, message, details? } }
export function notFound(req, res) {
  res.status(404).json({ error: { code: 'ROUTE_NOT_FOUND', message: `${req.method} ${req.path} not found` } })
}

export function errorHandler(err, req, res, next) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Some fields are wrong',
        details: err.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      },
    })
  }

  if (err instanceof AppError) {
    return res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details },
    })
  }

  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'BAD_JSON', message: 'Request body is not valid JSON' } })
  }

  // Prisma: unique constraint
  if (err.code === 'P2002') {
    return res.status(409).json({ error: { code: 'CONFLICT', message: 'That already exists' } })
  }

  // Prisma: something else still points at this record
  if (err.code === 'P2003') {
    return res.status(409).json({ error: { code: 'IN_USE', message: 'That is still being used elsewhere' } })
  }

  // Prisma: record to update/delete wasn't found
  if (err.code === 'P2025') {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found' } })
  }

  console.error(err)
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: env.NODE_ENV === 'production' ? 'Something broke on our side' : err.message,
    },
  })
}
