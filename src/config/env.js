import 'dotenv/config'
import { z } from 'zod'

// Empty strings in .env count as not set
const optional = z.preprocess((v) => v || undefined, z.string().optional())

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_DAYS: z.coerce.number().int().positive().default(30),

  // Email. EMAIL_PROVIDER = gmail | resend | log (print in the terminal).
  // Left empty: resend if RESEND_API_KEY is set, otherwise log.
  EMAIL_PROVIDER: z.preprocess((v) => v || undefined, z.enum(['gmail', 'resend', 'log']).optional()),
  EMAIL_FROM: z.preprocess((v) => v || undefined, z.string().default('Kust <onboarding@resend.dev>')),
  RESEND_API_KEY: optional,
  // Gmail API (the mailer OAuth client + a refresh token for the Kust Gmail account)
  GMAIL_CLIENT_ID: optional,
  GMAIL_CLIENT_SECRET: optional,
  GMAIL_REFRESH_TOKEN: optional,

  // Google sign-in: the OAuth client ids from Google Cloud, comma separated.
  // Put the WEB client id FIRST (Android/iOS ids after it, later).
  // Empty = Google sign-in switched off.
  GOOGLE_CLIENT_IDS: z
    .string()
    .default('')
    .transform((s) => s.split(',').map((id) => id.trim()).filter(Boolean)),
  // The web client's secret. The web app sends a one-time code, and only the
  // server (with this secret) can swap it for the person's ID token. Never put
  // this in the mobile app.
  GOOGLE_WEB_CLIENT_SECRET: z.string().optional(),
})

const parsed = schema.safeParse(process.env)

if (!parsed.success) {
  console.error('Bad environment variables:')
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join('.')}: ${issue.message}`)
  }
  process.exit(1)
}

const data = parsed.data
data.EMAIL_PROVIDER ??= data.RESEND_API_KEY ? 'resend' : 'log'

// Fail at startup, not when the first user signs up
const emailProblems = []
if (data.EMAIL_PROVIDER === 'gmail') {
  for (const key of ['GMAIL_CLIENT_ID', 'GMAIL_CLIENT_SECRET', 'GMAIL_REFRESH_TOKEN']) {
    if (!data[key]) emailProblems.push(`${key} is required when EMAIL_PROVIDER=gmail`)
  }
  if (!/@gmail\.com>?\s*$/i.test(data.EMAIL_FROM)) {
    emailProblems.push('EMAIL_FROM must be the Kust Gmail address, e.g. Kust <kust.budget.app@gmail.com>')
  }
}
if (data.EMAIL_PROVIDER === 'resend' && !data.RESEND_API_KEY) {
  emailProblems.push('RESEND_API_KEY is required when EMAIL_PROVIDER=resend')
}
if (data.NODE_ENV === 'production' && data.EMAIL_PROVIDER === 'log') {
  emailProblems.push('EMAIL_PROVIDER=log only prints codes; production needs gmail or resend (users need their codes)')
}
if (emailProblems.length) {
  console.error('Email settings problem:')
  for (const p of emailProblems) console.error(`  ${p}`)
  process.exit(1)
}

export const env = data
