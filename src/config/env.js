import 'dotenv/config'
import { z } from 'zod'

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_DAYS: z.coerce.number().int().positive().default(30),

  // Email (Resend). Without a key, codes are printed in the terminal instead (dev only).
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default('Kust <onboarding@resend.dev>'),

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

if (parsed.data.NODE_ENV === 'production' && !parsed.data.RESEND_API_KEY) {
  console.error('RESEND_API_KEY is required in production (users need their codes)')
  process.exit(1)
}

export const env = parsed.data
