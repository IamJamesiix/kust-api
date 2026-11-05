// Email: MIME build, base64url, provider switch, failure paths. No real email is sent.
import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.DATABASE_URL ||= 'postgres://test:test@localhost:5432/test'
process.env.JWT_ACCESS_SECRET ||= 'test-secret-test-secret-test-secret-123'
const { toBase64Url, buildRawMessage, gmailSender, createMailer, logSender, codeEmail } = await import(
  '../src/lib/email.js'
)

const fromBase64Url = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
const msg = { to: 'ada@example.com', ...codeEmail({ code: '123456', purpose: 'VERIFY_EMAIL' }) }

// Swallow console output inside a test, and give it back for checking
async function quietly(fn) {
  const logs = []
  const [log, error] = [console.log, console.error]
  console.log = console.error = (...a) => logs.push(a.join(' '))
  try {
    return { result: await fn(), logs: logs.join('\n') }
  } finally {
    console.log = log
    console.error = error
  }
}

test('base64url has no + / or = padding', () => {
  const encoded = toBase64Url(Buffer.from([0xfb, 0xff, 0xfe, 0x3e, 0x3f]))
  assert.doesNotMatch(encoded, /[+/=]/)
  assert.equal(encoded, '-__-Pj8')
})

test('MIME message has headers, a plain-text part and an HTML part', async () => {
  const raw = await buildRawMessage({ from: 'Kust <kust.budget.app@gmail.com>', ...msg })
  assert.doesNotMatch(raw, /[+/=]/)
  const mime = fromBase64Url(raw)
  assert.match(mime, /^From: Kust <kust\.budget\.app@gmail\.com>/m)
  assert.match(mime, /^To: ada@example\.com/m)
  assert.match(mime, /^Subject: Your Kust code: 123456/m)
  assert.match(mime, /Content-Type: multipart\/alternative/)
  assert.match(mime, /Content-Type: text\/plain/)
  assert.match(mime, /Content-Type: text\/html/)
})

test('subject lines carry the code, for both purposes', () => {
  assert.equal(codeEmail({ code: '000111', purpose: 'RESET_PASSWORD' }).subject, 'Your Kust code: 000111')
  assert.match(codeEmail({ code: '000111', purpose: 'RESET_PASSWORD' }).text, /reset your Kust password/)
})

test('log provider prints the email and counts as sent', async () => {
  const send = createMailer({ provider: 'log', send: logSender() })
  const { result, logs } = await quietly(() => send(msg))
  assert.equal(result, true)
  assert.match(logs, /To: ada@example\.com/)
  assert.match(logs, /Subject: Your Kust code: 123456/)
})

test('unknown provider is refused', () => {
  assert.throws(() => createMailer({ provider: 'smtp', send: async () => {} }), /Unknown EMAIL_PROVIDER/)
})

test('gmail: gets a token, posts the raw message to the Gmail API', async () => {
  const calls = []
  const oauthClient = { setCredentials() {}, getAccessToken: async () => ({ token: 'ya29.fake' }) }
  const fetchImpl = async (url, init) => {
    calls.push({ url, init })
    return { ok: true, status: 200, text: async () => '{}' }
  }
  const send = createMailer({
    provider: 'gmail',
    send: gmailSender({ from: 'Kust <kust.budget.app@gmail.com>', refreshToken: 'r', oauthClient, fetchImpl }),
  })
  assert.equal(await send(msg), true)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send')
  assert.equal(calls[0].init.headers.Authorization, 'Bearer ya29.fake')
  const { raw } = JSON.parse(calls[0].init.body)
  assert.match(fromBase64Url(raw), /^Subject: Your Kust code: 123456/m)
})

test('gmail: API error returns false, never throws, and says why', async () => {
  const oauthClient = { setCredentials() {}, getAccessToken: async () => ({ token: 'ya29.fake' }) }
  const fetchImpl = async () => ({ ok: false, status: 403, text: async () => '{"error":"insufficientPermissions"}' })
  const send = createMailer({ provider: 'gmail', send: gmailSender({ from: 'x', oauthClient, fetchImpl }), isProd: true })
  const { result, logs } = await quietly(() => send(msg))
  assert.equal(result, false)
  assert.match(logs, /failed \(gmail\): Gmail API 403/)
  assert.doesNotMatch(logs, /dev fallback/) // production never prints the code
})

test('gmail: a revoked refresh token is called out as invalid_grant', async () => {
  const oauthClient = {
    setCredentials() {},
    getAccessToken: async () => {
      throw Object.assign(new Error('invalid_grant'), { response: { data: { error: 'invalid_grant' } } })
    },
  }
  let fetched = false
  const fetchImpl = async () => ((fetched = true), { ok: true, text: async () => '' })
  const send = createMailer({ provider: 'gmail', send: gmailSender({ from: 'x', oauthClient, fetchImpl }) })
  const { result, logs } = await quietly(() => send(msg))
  assert.equal(result, false)
  assert.equal(fetched, false)
  assert.match(logs, /invalid_grant: the Gmail refresh token was revoked or has expired/)
  assert.match(logs, /dev fallback/) // in dev, the code is still printed so you can keep testing
})
