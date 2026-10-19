import { rateLimit } from 'express-rate-limit'
import { env } from '../config/env.js'

const isProd = env.NODE_ENV === 'production'

const limited = (message) => ({
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message } },
})

// Everything under /api/v1: 300 requests per 15 minutes per IP.
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  ...limited('Too many requests, slow down a bit'),
})

// Login/register: 10 FAILED attempts per 15 minutes per IP in production. Stops password guessing.
// Successful logins don't count, so real users never hit it. (100 in development so you
// don't lock yourself out while testing.)
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: isProd ? 10 : 100,
  skipSuccessfulRequests: true,
  ...limited('Too many attempts. Try again in 15 minutes'),
})

// Sending codes by email: 5 per 15 minutes per IP in production (each one costs an email).
export const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: isProd ? 5 : 50,
  ...limited('Too many code requests. Try again in 15 minutes'),
})
