import MailComposer from 'nodemailer/lib/mail-composer/index.js'
import { OAuth2Client } from 'google-auth-library'
import { env } from '../config/env.js'

// How Kust sends email. Pick one with EMAIL_PROVIDER:
//   gmail  - Gmail API over HTTPS (port 443). Works on Render's free plan, which
//            blocks the normal mail ports (25/465/587), so plain SMTP can't work there.
//   resend - Resend's HTTP API. For later, once Kust has its own domain.
//   log    - print the email in the terminal (local dev and tests).
// sendEmail() never throws: a failed email must not crash sign-up. It returns true/false.

const GMAIL_SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send'

// Gmail wants the whole email as base64url: base64 with - and _ instead of + and /, no = padding.
export const toBase64Url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

// Build a full email (headers + plain-text part + HTML part) and return it as base64url.
export async function buildRawMessage({ from, to, subject, text, html }) {
  const mime = await new MailComposer({ from, to, subject, text, html }).compile().build()
  return toBase64Url(mime)
}

// Turn Google's token errors into something a human can act on.
function explainTokenError(err) {
  const reason = err?.response?.data?.error || err?.message || String(err)
  if (String(reason).includes('invalid_grant')) {
    return new Error(
      'invalid_grant: the Gmail refresh token was revoked or has expired. ' +
        'Make a new one in the OAuth Playground and update GMAIL_REFRESH_TOKEN on Render.'
    )
  }
  return new Error(`could not get a Gmail access token: ${reason}`)
}

// Gmail API sender. The refresh token is long-lived; OAuth2Client swaps it for a
// short-lived access token and caches that until it expires.
export function gmailSender({ clientId, clientSecret, refreshToken, from, fetchImpl = fetch, oauthClient }) {
  const client = oauthClient ?? new OAuth2Client(clientId, clientSecret)
  client.setCredentials({ refresh_token: refreshToken })

  return async ({ to, subject, text, html }) => {
    let token
    try {
      ;({ token } = await client.getAccessToken())
    } catch (err) {
      throw explainTokenError(err)
    }
    if (!token) throw new Error('could not get a Gmail access token (empty token)')

    const raw = await buildRawMessage({ from, to, subject, text, html })
    const res = await fetchImpl(GMAIL_SEND_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw }),
    })
    if (!res.ok) throw new Error(`Gmail API ${res.status}: ${(await res.text()).slice(0, 300)}`)
  }
}

// Resend sender (kept for when Kust has a domain).
export function resendSender({ apiKey, from, fetchImpl = fetch }) {
  return async ({ to, subject, text, html }) => {
    const res = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject, html, text }),
    })
    if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 300)}`)
  }
}

// Log "sender": prints the email instead of sending it.
export const logSender = () => async ({ to, subject, text }) => {
  console.log(`\n📧 [DEV EMAIL, not sent]\n   To: ${to}\n   Subject: ${subject}\n   ${text}\n`)
}

// Wraps a sender so it never throws, and logs failures clearly.
export function createMailer({ provider, send, isProd = false }) {
  if (!['gmail', 'resend', 'log'].includes(provider)) throw new Error(`Unknown EMAIL_PROVIDER: ${provider}`)

  return async function sendEmail(message) {
    try {
      await send(message)
      return true
    } catch (err) {
      console.error(`Email to ${message.to} failed (${provider}): ${err.message}`)
      if (!isProd) console.log(`   (dev fallback) ${message.text}`)
      return false
    }
  }
}

function mailerFromEnv() {
  const from = env.EMAIL_FROM
  const send =
    env.EMAIL_PROVIDER === 'gmail'
      ? gmailSender({
          clientId: env.GMAIL_CLIENT_ID,
          clientSecret: env.GMAIL_CLIENT_SECRET,
          refreshToken: env.GMAIL_REFRESH_TOKEN,
          from,
        })
      : env.EMAIL_PROVIDER === 'resend'
        ? resendSender({ apiKey: env.RESEND_API_KEY, from })
        : logSender()
  return createMailer({ provider: env.EMAIL_PROVIDER, send, isProd: env.NODE_ENV === 'production' })
}

let mailer
// The one the app uses. Built on first use from the env settings.
export function sendEmail(message) {
  mailer ??= mailerFromEnv()
  return mailer(message)
}

// The 6-digit code email (verify email / reset password). The notebook-look design
// lives in code-email.js; this keeps the same name, inputs and { subject, text, html } output.
export { codeEmailParts as codeEmail } from './code-email.js'
