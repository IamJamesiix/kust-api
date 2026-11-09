// Run: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { codeEmailParts } from '../src/lib/code-email.js'

for (const purpose of ['VERIFY_EMAIL', 'RESET_PASSWORD']) {
  test(`code email (${purpose}): subject, code, safe HTML`, () => {
    const m = codeEmailParts({ code: '123456', purpose })
    assert.equal(m.subject, 'Your Kust code: 123456')
    assert.match(m.text, /123456/)
    assert.match(m.html, />123456</) // digits together, so copying gives the code
    assert.doesNotMatch(m.html, /<script/i)
    assert.doesNotMatch(m.html, /<form/i)
    assert.ok(Buffer.byteLength(m.html) < 20000, 'small enough that Gmail never clips it')
  })
}

test('reset email text says what the code is for', () => {
  assert.match(codeEmailParts({ code: '123456', purpose: 'RESET_PASSWORD' }).text, /reset your Kust password/)
})
