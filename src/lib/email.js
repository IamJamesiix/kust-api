import { env } from '../config/env.js'

// Sends through Resend's HTTP API (https, port 443 — works on Render, which blocks SMTP ports).
// Returns true if sent, false if not. Never throws: a failed email shouldn't crash sign-up.
export async function sendEmail({ to, subject, html, text }) {
  if (!env.RESEND_API_KEY) {
    console.log(`\n📧 [DEV EMAIL — no RESEND_API_KEY]\n   To: ${to}\n   Subject: ${subject}\n   ${text}\n`)
    return true
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: env.EMAIL_FROM, to, subject, html, text }),
    })

    if (!res.ok) {
      console.error(`Email to ${to} failed: ${res.status} ${await res.text()}`)
      if (env.NODE_ENV !== 'production') console.log(`   (dev fallback) ${text}`)
      return false
    }
    return true
  } catch (err) {
    console.error(`Email to ${to} failed: ${err.message}`)
    if (env.NODE_ENV !== 'production') console.log(`   (dev fallback) ${text}`)
    return false
  }
}

export function codeEmail({ code, purpose }) {
  const title = purpose === 'VERIFY_EMAIL' ? 'Verify your email' : 'Reset your password'
  const intro =
    purpose === 'VERIFY_EMAIL'
      ? 'Welcome to Kust! Enter this code in the app to verify your email:'
      : 'Someone asked to reset your Kust password. If it was you, enter this code in the app:'

  return {
    subject: `${code} is your Kust code`,
    text: `${intro} ${code} — it expires in 10 minutes. If you didn't ask for this, ignore this email.`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:420px;margin:auto;padding:24px">
        <h2 style="margin:0 0 12px">${title}</h2>
        <p style="color:#444">${intro}</p>
        <p style="font-size:32px;font-weight:bold;letter-spacing:8px;margin:20px 0">${code}</p>
        <p style="color:#888;font-size:13px">This code expires in 10 minutes. If you didn't ask for it, you can ignore this email.</p>
      </div>`,
  }
}
