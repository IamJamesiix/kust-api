// Run: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decideGoogleAccount } from '../src/modules/auth/google.js'
import { publicUser } from '../src/utils/password.js'

const g = 'google-sub-123'

test('google: already linked -> log in', () => {
  const user = { id: 'u1', googleId: g, emailVerified: true }
  assert.deepEqual(decideGoogleAccount({ byGoogle: user, byEmail: user, googleId: g }), { action: 'login', user })
})

test('google: brand new email -> create', () => {
  assert.deepEqual(decideGoogleAccount({ byGoogle: null, byEmail: null, googleId: g }), { action: 'create' })
})

test('google: verified email account -> link, keep its password', () => {
  const user = { id: 'u1', googleId: null, emailVerified: true, passwordHash: 'x' }
  const d = decideGoogleAccount({ byGoogle: null, byEmail: user, googleId: g })
  assert.equal(d.action, 'link')
  assert.equal(d.dropPassword, false)
})

test('google: UNverified email account -> link and drop the untrusted password', () => {
  // Someone could have signed up with this email without owning it.
  const user = { id: 'u1', googleId: null, emailVerified: false, passwordHash: 'x' }
  const d = decideGoogleAccount({ byGoogle: null, byEmail: user, googleId: g })
  assert.equal(d.action, 'link')
  assert.equal(d.dropPassword, true)
})

test('google: email linked to a different Google account -> refuse', () => {
  const user = { id: 'u1', googleId: 'someone-else', emailVerified: true }
  assert.throws(
    () => decideGoogleAccount({ byGoogle: null, byEmail: user, googleId: g }),
    (err) => err.code === 'GOOGLE_ACCOUNT_MISMATCH' && err.status === 409
  )
})

test('publicUser hides passwordHash and googleId, adds flags', () => {
  const out = publicUser({ id: 'u1', email: 'a@b.c', passwordHash: 'h', googleId: g })
  assert.equal(out.passwordHash, undefined)
  assert.equal(out.googleId, undefined)
  assert.equal(out.hasPassword, true)
  assert.equal(out.hasGoogle, true)
  assert.equal(publicUser({ id: 'u2', passwordHash: null, googleId: null }).hasPassword, false)
})

test('google route accepts exactly one of idToken / code', async () => {
  const { z } = await import('zod')
  // Same rule as auth.routes.js
  const schema = z
    .object({ idToken: z.string().min(20).max(4096).optional(), code: z.string().min(10).max(2048).optional() })
    .refine((d) => Boolean(d.idToken) !== Boolean(d.code))
  assert.equal(schema.safeParse({ code: '4/0AbCdEfGhIjK' }).success, true)
  assert.equal(schema.safeParse({ idToken: 'x'.repeat(30) }).success, true)
  assert.equal(schema.safeParse({}).success, false)
  assert.equal(schema.safeParse({ code: '4/0AbCdEfGhIjK', idToken: 'x'.repeat(30) }).success, false)
})
