// Sends ONE test email with your current settings (.env locally, or Render's env).
// Usage: npm run email:test -- you@example.com
import { env } from '../src/config/env.js'
import { sendEmail, codeEmail } from '../src/lib/email.js'

const to = process.argv[2]
if (!to || !to.includes('@')) {
  console.log('Usage: npm run email:test -- you@example.com')
  process.exit(1)
}

console.log(`Sending a test email to ${to} with EMAIL_PROVIDER=${env.EMAIL_PROVIDER}, from ${env.EMAIL_FROM}…`)
const ok = await sendEmail({ to, ...codeEmail({ code: '123456', purpose: 'VERIFY_EMAIL' }) })
if (!ok) console.log('Not sent. The reason is printed above.')
else if (env.EMAIL_PROVIDER === 'log') console.log('EMAIL_PROVIDER=log: printed above, nothing was really sent.')
else console.log('Sent. Check the inbox (and the spam folder).')
process.exit(ok ? 0 : 1)
